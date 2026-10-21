// Package chat runs a generation: build the context, stream the LLM, call tools, persist,
// and emit the SSE events of docs/API.md#sse-events (docs/SPEC.md §6).
package chat

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"chatfrog/api/internal/admin"
	"chatfrog/api/internal/config"
	"chatfrog/api/internal/files"
	"chatfrog/api/internal/provider"
	"chatfrog/api/internal/store"
	"chatfrog/api/internal/tools"
)

// Emitter sends one SSE event.
type Emitter func(event string, data any)

type Service struct {
	cfg        *config.Config
	store      *store.Store
	storage    *files.Storage
	llm        provider.LLMProvider
	images     *tools.ImageTool
	monitor    *admin.Monitor
	llmSlots   *Limiter
	imageSlots *Limiter

	mu     sync.Mutex
	active map[bson.ObjectID]context.CancelFunc
}

func New(cfg *config.Config, st *store.Store, storage *files.Storage, llm provider.LLMProvider,
	images *tools.ImageTool, monitor *admin.Monitor) *Service {
	return &Service{
		cfg: cfg, store: st, storage: storage, llm: llm, images: images, monitor: monitor,
		llmSlots:   NewLimiter(cfg.LLMMaxConcurrency),
		imageSlots: NewLimiter(cfg.ImageMaxConcurrency),
		active:     map[bson.ObjectID]context.CancelFunc{},
	}
}

// Claim reserves a conversation for one generation (false → 409 conflict). The returned
// context is also cancelled by Cancel.
func (s *Service) Claim(parent context.Context, convID bson.ObjectID) (context.Context, func(), bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, busy := s.active[convID]; busy {
		return nil, nil, false
	}
	ctx, cancel := context.WithCancel(parent)
	s.active[convID] = cancel
	return ctx, func() {
		cancel()
		s.mu.Lock()
		delete(s.active, convID)
		s.mu.Unlock()
	}, true
}

// Cancel stops the running generation of a conversation, if any.
func (s *Service) Cancel(convID bson.ObjectID) {
	s.mu.Lock()
	cancel := s.active[convID]
	s.mu.Unlock()
	if cancel != nil {
		cancel()
	}
}

type Turn struct {
	User         *store.User
	Conversation *store.Conversation
	UserMessage  *store.Message
	// Assistant is already stored with status "streaming" and no parts.
	Assistant *store.Message
}

// Run streams the answer for t. It returns when the message is final; a cancelled ctx
// (client gone / Stop) stores what was generated with status "stopped".
func (s *Service) Run(ctx context.Context, t *Turn, emit Emitter) {
	start := time.Now()
	emit("message.created", map[string]any{
		"conversation":      t.Conversation.JSON(),
		"user_message":      t.UserMessage.JSON(),
		"assistant_message": t.Assistant.JSON(),
	})

	g := &generation{s: s, t: t, emit: emit, msg: t.Assistant, cur: -1}
	status, msgErr := g.run(ctx)

	msg := g.msg
	if status != store.MsgComplete {
		closeOpenTools(msg.Parts)
	}
	msg.Status, msg.Error = status, msgErr
	msg.Model = s.llm.Model()
	msg.LatencyMS = time.Since(start).Milliseconds()
	if g.usage.PromptTokens+g.usage.CompletionTokens > 0 {
		msg.Usage = &g.usage
	}
	saveCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
	defer cancel()
	if err := s.store.FinishMessage(saveCtx, msg); err != nil {
		slog.ErrorContext(ctx, "save message", "message", msg.ID.Hex(), "err", err)
	}
	if err := s.store.TouchConversation(saveCtx, t.Conversation.ID); err != nil {
		slog.ErrorContext(ctx, "touch conversation", "err", err)
	}

	switch status {
	case store.MsgComplete:
		emit("message.done", map[string]any{"message": msg.JSON()})
	case store.MsgError:
		emit("error", msgErr)
	}
	if t.Conversation.Title == "" {
		s.autoTitle(ctx, t, emit, status == store.MsgComplete)
	}
}

type generation struct {
	s     *Service
	t     *Turn
	emit  Emitter
	msg   *store.Message
	usage store.Usage

	cur        int // index of the part receiving deltas, -1 when none
	thinkStart time.Time
	// buffer, when set, collects the content deltas instead of streaming them.
	buffer *strings.Builder
}

var (
	errModel = &store.MessageError{Code: "model_unavailable", Message: "Máy chủ mô hình hiện không khả dụng. Vui lòng thử lại sau."}
	errEmpty = &store.MessageError{Code: "empty_response", Message: "Mô hình không trả lời. Hãy thử tạo lại."}
	errInner = &store.MessageError{Code: "internal", Message: "Lỗi máy chủ nội bộ."}
)

func (g *generation) run(ctx context.Context) (string, *store.MessageError) {
	cfg := g.s.cfg
	msgs, err := g.s.buildContext(ctx, g.t)
	if err != nil {
		if ctx.Err() != nil {
			return store.MsgStopped, nil
		}
		slog.ErrorContext(ctx, "build context", "err", err)
		return store.MsgError, errInner
	}

	// Round 1: the answer, possibly with tool calls. Round 2 (only after tools ran): one short
	// confirmation sentence, without thinking or tools, so it never re-calls the tool.
	res, err := g.complete(ctx, msgs, true, cfg.LLMReasoningEffort, cfg.LLMMaxOutputTokens)
	if err == nil && res.Content == "" && len(res.ToolCalls) == 0 && cfg.LLMReasoningEffort != "none" {
		// Some servers end the turn right after thinking when tools are offered:
		// ask again without thinking.
		res, err = g.complete(ctx, msgs, true, "none", cfg.LLMMaxOutputTokens)
	}
	if ctx.Err() != nil {
		return store.MsgStopped, nil
	}
	if err != nil {
		return g.llmFailed(ctx, err)
	}
	if len(res.ToolCalls) == 0 {
		return g.finished()
	}

	for i := range res.ToolCalls {
		if res.ToolCalls[i].ID == "" {
			res.ToolCalls[i].ID = fmt.Sprintf("call_%d", i)
		}
		res.ToolCalls[i].Type = "function"
	}
	msgs = append(msgs, provider.ChatMessage{Role: "assistant", Content: res.Content, ToolCalls: res.ToolCalls})
	for _, tc := range res.ToolCalls {
		result := g.runTool(ctx, tc)
		msgs = append(msgs, provider.ChatMessage{Role: "tool", ToolCallID: tc.ID, Content: result})
	}
	if ctx.Err() != nil {
		return store.MsgStopped, nil
	}
	// Checkpoint, so a crash keeps the images already made.
	if err := g.s.store.SetMessageParts(context.WithoutCancel(ctx), g.msg.ID, g.msg.Parts); err != nil {
		slog.WarnContext(ctx, "checkpoint message", "err", err)
	}

	// The closing sentence is buffered, cleaned, then emitted once: the small model sometimes
	// wraps it in brackets or quotes or copies image labels.
	g.buffer = &strings.Builder{}
	_, err = g.complete(ctx, msgs, false, "none", afterToolMaxTokens)
	buffered := g.buffer.String()
	g.buffer = nil
	if err != nil {
		if ctx.Err() != nil {
			return store.MsgStopped, nil
		}
		// The images are there; a missing closing sentence is not worth an error.
		g.s.monitor.Record("llm", err)
		slog.WarnContext(ctx, "llm after tool", "err", err)
	} else if cleaned := cleanReply(buffered); cleaned != "" {
		g.onDelta(provider.Delta{Content: cleaned})
	}
	if ctx.Err() != nil {
		return store.MsgStopped, nil
	}
	return g.finished()
}

// afterToolMaxTokens bounds the one-sentence reply that follows an image.
const afterToolMaxTokens = 160

func (g *generation) finished() (string, *store.MessageError) {
	if !g.hasOutput() {
		return store.MsgError, errEmpty
	}
	return store.MsgComplete, nil
}

func (g *generation) llmFailed(ctx context.Context, err error) (string, *store.MessageError) {
	g.s.monitor.Record("llm", err)
	slog.WarnContext(ctx, "llm", "err", err)
	if provider.IsUnavailable(err) {
		return store.MsgError, errModel
	}
	return store.MsgError, &store.MessageError{Code: "model_error", Message: "Mô hình trả về lỗi: " + err.Error()}
}

func (g *generation) hasOutput() bool {
	for _, p := range g.msg.Parts {
		if (p.Type == store.PartText && strings.TrimSpace(p.Text) != "") || p.Type == store.PartToolCall {
			return true
		}
	}
	return false
}

// complete runs one streamed LLM call, turning deltas into reasoning / text parts.
func (g *generation) complete(ctx context.Context, msgs []provider.ChatMessage, allowTools bool, effort string, maxTokens int) (*provider.ChatResult, error) {
	release, err := g.s.llmSlots.Acquire(ctx, func(p int) { g.emit("queue", map[string]int{"position": p}) })
	if err != nil {
		return nil, err
	}
	defer release()

	req := provider.ChatRequest{Messages: msgs, MaxTokens: maxTokens, ReasoningEffort: effort}
	if allowTools {
		req.Tools = []provider.Tool{tools.GenerateImageDef}
	}
	res, err := g.s.llm.StreamChat(ctx, req, g.onDelta)
	g.closeReasoning()
	g.cur = -1
	if res != nil && res.Usage != nil {
		g.usage.PromptTokens += res.Usage.PromptTokens
		g.usage.CompletionTokens += res.Usage.CompletionTokens
	}
	return res, err
}

func (g *generation) onDelta(d provider.Delta) {
	if g.buffer != nil {
		g.buffer.WriteString(d.Content)
		return
	}
	if d.Reasoning != "" {
		if !g.open(store.PartReasoning) {
			g.cur = len(g.msg.Parts)
			g.msg.Parts = append(g.msg.Parts, store.Part{Type: store.PartReasoning})
			g.thinkStart = time.Now()
		}
		g.msg.Parts[g.cur].Text += d.Reasoning
		g.emit("reasoning.delta", map[string]any{"index": g.cur, "delta": d.Reasoning})
	}
	if d.Content != "" {
		g.closeReasoning()
		text := d.Content
		if !g.open(store.PartText) {
			// Models often start the answer with blank lines after thinking.
			if text = strings.TrimLeft(text, " \t\r\n"); text == "" {
				return
			}
			g.cur = len(g.msg.Parts)
			g.msg.Parts = append(g.msg.Parts, store.Part{Type: store.PartText})
		}
		g.msg.Parts[g.cur].Text += text
		g.emit("text.delta", map[string]any{"index": g.cur, "delta": text})
	}
}

func (g *generation) open(kind string) bool {
	return g.cur >= 0 && g.msg.Parts[g.cur].Type == kind
}

func (g *generation) closeReasoning() {
	if !g.open(store.PartReasoning) {
		return
	}
	p := &g.msg.Parts[g.cur]
	p.DurationMS = max(1, time.Since(g.thinkStart).Milliseconds())
	g.emit("reasoning.done", map[string]any{"index": g.cur, "duration_ms": p.DurationMS})
	g.cur = -1
}

// runTool executes one tool call and returns the tool message content for the LLM.
func (g *generation) runTool(ctx context.Context, tc provider.ToolCall) string {
	if tc.Function.Name != tools.GenerateImageName {
		return fmt.Sprintf("Lỗi: không có tool %q.", tc.Function.Name)
	}
	args, err := tools.ParseArgs(tc.Function.Arguments)
	if err != nil {
		return "Lỗi khi gọi generate_image: " + err.Error()
	}
	idx := len(g.msg.Parts)
	g.msg.Parts = append(g.msg.Parts, store.Part{
		Type: store.PartToolCall, ID: tc.ID, Name: tools.GenerateImageName, Args: &args, Status: store.ToolQueued,
	})
	g.emit("tool.start", map[string]any{"index": idx, "id": tc.ID, "name": tools.GenerateImageName, "args": args})
	fail := func(msg string) string {
		g.msg.Parts[idx].Status, g.msg.Parts[idx].Error = store.ToolError, msg
		if ctx.Err() == nil {
			g.emit("tool.error", map[string]any{"index": idx, "id": tc.ID, "error": msg})
		}
		return "Lỗi khi tạo ảnh: " + msg + ". Báo lỗi này cho người dùng bằng một câu ngắn."
	}

	release, err := g.s.imageSlots.Acquire(ctx, nil)
	if err != nil {
		return fail("Đã dừng")
	}
	defer release()
	g.msg.Parts[idx].Status = store.ToolRunning
	g.emit("tool.running", map[string]any{"index": idx, "id": tc.ID})

	f, err := g.s.images.Run(ctx, g.t.User.ID, g.t.Conversation.ID, args)
	if err != nil {
		var ue *tools.UserError
		switch {
		case ctx.Err() != nil:
			return fail("Đã dừng")
		case errors.As(err, &ue):
			return fail(ue.Msg)
		default:
			slog.ErrorContext(ctx, "generate_image", "err", err)
			return fail("Không tạo được ảnh")
		}
	}
	ref := f.Ref()
	g.msg.Parts[idx].Status = store.ToolDone
	g.msg.Parts[idx].Result = &store.ToolResult{File: ref}
	g.emit("tool.done", map[string]any{"index": idx, "id": tc.ID, "result": store.ToolResult{File: ref}})
	return fmt.Sprintf("Đã tạo ảnh id=%s và hiển thị cho người dùng. Trả lời người dùng bằng đúng MỘT câu ngắn, "+
		"dạng \"Tôi đã tạo cho bạn bức ảnh về …\". Không mô tả chi tiết, không lặp lại prompt, không hỏi thêm. Không dùng dấu ngoặc vuông [] hay dấu ngoặc kép.", ref.ID)
}

// closeOpenTools marks unfinished tool calls as stopped (they can never complete now).
func closeOpenTools(parts []store.Part) {
	for i := range parts {
		if parts[i].Type == store.PartToolCall && (parts[i].Status == store.ToolQueued || parts[i].Status == store.ToolRunning) {
			parts[i].Status, parts[i].Error = store.ToolError, "Đã dừng"
		}
	}
}

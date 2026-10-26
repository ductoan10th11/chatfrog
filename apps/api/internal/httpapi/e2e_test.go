package httpapi

// End-to-end test against a real MongoDB and real model servers, using the environment
// (.env). It runs in a throwaway database `<MONGO_DB>_e2e`, dropped afterwards:
//
//	set -a && source ../../.env && set +a && CHATFROG_E2E=1 go test -run E2E -v ./internal/httpapi

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"chatfrog/api/internal/admin"
	"chatfrog/api/internal/auth"
	"chatfrog/api/internal/chat"
	"chatfrog/api/internal/config"
	"chatfrog/api/internal/files"
	"chatfrog/api/internal/provider"
	"chatfrog/api/internal/store"
	"chatfrog/api/internal/tools"
)

type sseEvent struct {
	Name string
	Data json.RawMessage
}

type e2e struct {
	t      *testing.T
	srv    *httptest.Server
	origin string
	cookie string
}

func (e *e2e) req(method, path string, body io.Reader, contentType string) *http.Response {
	e.t.Helper()
	r, _ := http.NewRequest(method, e.srv.URL+path, body)
	r.Header.Set("Origin", e.origin)
	r.Header.Set("Cookie", auth.SessionCookie+"="+e.cookie)
	if contentType != "" {
		r.Header.Set("Content-Type", contentType)
	}
	res, err := http.DefaultClient.Do(r)
	if err != nil {
		e.t.Fatal(err)
	}
	return res
}

func (e *e2e) json(method, path string, body any, wantStatus int, out any) {
	e.t.Helper()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	res := e.req(method, path, rd, "application/json")
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	if res.StatusCode != wantStatus {
		e.t.Fatalf("%s %s: status %d, want %d: %s", method, path, res.StatusCode, wantStatus, raw)
	}
	if out != nil {
		if err := json.Unmarshal(raw, out); err != nil {
			e.t.Fatalf("%s %s: %v: %s", method, path, err, raw)
		}
	}
}

func (e *e2e) stream(path string, body any) []sseEvent {
	e.t.Helper()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	res := e.req(http.MethodPost, path, rd, "application/json")
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(res.Body)
		e.t.Fatalf("POST %s: status %d: %s", path, res.StatusCode, raw)
	}
	var events []sseEvent
	var cur sseEvent
	sc := bufio.NewScanner(res.Body)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	for sc.Scan() {
		line := sc.Text()
		switch {
		case strings.HasPrefix(line, "event: "):
			cur.Name = strings.TrimPrefix(line, "event: ")
		case strings.HasPrefix(line, "data: "):
			cur.Data = json.RawMessage(strings.TrimPrefix(line, "data: "))
		case line == "" && cur.Name != "":
			events = append(events, cur)
			cur = sseEvent{}
		}
	}
	return events
}

func find(events []sseEvent, name string) []sseEvent {
	var out []sseEvent
	for _, ev := range events {
		if ev.Name == name {
			out = append(out, ev)
		}
	}
	return out
}

func TestE2E(t *testing.T) {
	if os.Getenv("CHATFROG_E2E") != "1" {
		t.Skip("set CHATFROG_E2E=1 (with .env loaded) to run")
	}
	cfg, err := config.Load()
	if err != nil {
		t.Fatal(err)
	}
	cfg.MongoDB += "_e2e"
	cfg.FilesDir = t.TempDir()
	ctx := context.Background()

	st, err := store.Connect(ctx, cfg.MongoURI, cfg.MongoDB)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = st.DropDatabase(context.Background())
		_ = st.Close(context.Background())
	})
	if err := st.EnsureIndexes(ctx); err != nil {
		t.Fatal(err)
	}
	storage, _ := files.NewStorage(cfg.FilesDir)
	llm := provider.NewLLM(cfg.LLMBaseURL, cfg.LLMAPIKey, cfg.LLMModel)
	img := provider.NewImage(cfg.ImageBaseURL, cfg.ImageAPIKey, cfg.ImageModel)
	monitor := admin.NewMonitor(llm, img, st)
	chatSvc := chat.New(cfg, st, storage, llm, tools.NewImageTool(st, storage, img, cfg.ImageTimeout), monitor)
	srv := httptest.NewServer(New(cfg, st, storage, auth.New(cfg, st), chatSvc, monitor).Router())
	defer srv.Close()

	// A signed-in admin, as the Google callback would create it.
	user := &store.User{GoogleSub: "e2e", Email: "e2e@example.com", Name: "E2E", Role: store.RoleAdmin,
		Status: store.StatusActive, Settings: store.Settings{Theme: "system"}, LastLoginAt: time.Now()}
	if err := st.CreateUser(ctx, user); err != nil {
		t.Fatal(err)
	}
	token := "e2e-token"
	sum := sha256.Sum256([]byte(token))
	if err := st.CreateSession(ctx, &store.Session{TokenHash: hex.EncodeToString(sum[:]), UserID: user.ID,
		ExpiresAt: time.Now().Add(time.Hour)}); err != nil {
		t.Fatal(err)
	}
	e := &e2e{t: t, srv: srv, origin: cfg.AppOrigin, cookie: token}

	// Auth / CSRF basics.
	var me store.UserJSON
	e.json(http.MethodGet, "/api/me", nil, http.StatusOK, &me)
	if me.Email != user.Email || me.AvatarURL != nil {
		t.Fatalf("me = %+v", me)
	}
	e.origin = "https://evil.example"
	e.json(http.MethodPost, "/api/conversations", map[string]string{}, http.StatusForbidden, nil)
	e.origin = cfg.AppOrigin

	// 1. New conversation + plain answer (reasoning, text, title).
	events := e.stream("/api/conversations/new/messages", map[string]any{"content": "Giải thích ngắn gọn goroutine trong Go là gì?"})
	if len(events) == 0 || events[0].Name != "message.created" {
		t.Fatalf("first event: %+v", events)
	}
	var created struct {
		Conversation     store.ConversationJSON `json:"conversation"`
		AssistantMessage store.MessageJSON      `json:"assistant_message"`
	}
	_ = json.Unmarshal(events[0].Data, &created)
	convID := created.Conversation.ID
	if len(find(events, "text.delta")) == 0 || len(find(events, "message.done")) != 1 {
		t.Fatalf("events: %v", names(events))
	}
	if len(find(events, "conversation.title")) != 1 {
		t.Errorf("no title event: %v", names(events))
	}
	t.Logf("turn 1 events: %v", summarize(events))

	// 2. Image generation through the tool.
	events = e.stream("/api/conversations/"+convID+"/messages", map[string]any{"content": "Vẽ cho mình một chú ếch xanh ngồi trên lá sen, phong cách màu nước"})
	t.Logf("turn 2 events: %v", summarize(events))
	t.Logf("turn 2 answer: %q", answerText(events))
	done := find(events, "tool.done")
	if len(done) == 0 {
		t.Fatalf("no tool.done: %v\nanswer: %s", summarize(events), answerText(events))
	}
	var toolDone struct {
		Result struct {
			File store.FileRef `json:"file"`
		} `json:"result"`
	}
	_ = json.Unmarshal(done[0].Data, &toolDone)
	imgRes := e.req(http.MethodGet, toolDone.Result.File.URL, nil, "")
	if imgRes.StatusCode != 200 || !strings.HasPrefix(imgRes.Header.Get("Content-Type"), "image/") {
		t.Fatalf("image fetch: %d %s", imgRes.StatusCode, imgRes.Header.Get("Content-Type"))
	}
	imgRes.Body.Close()
	thumb := e.req(http.MethodGet, toolDone.Result.File.URL+"/thumb", nil, "")
	if thumb.StatusCode != 200 || thumb.Header.Get("Content-Type") != "image/jpeg" {
		t.Fatalf("thumb: %d", thumb.StatusCode)
	}
	thumb.Body.Close()

	// 2b. Edit the generated image (images.edit). Logged only: small models may not pass the id.
	events = e.stream("/api/conversations/"+convID+"/messages", map[string]any{"content": "Đổi nền bức ảnh vừa rồi thành màu cam"})
	t.Logf("turn 2b events: %v", summarize(events))
	t.Logf("turn 2b answer: %q", answerText(events))

	// 3. Upload an image + a document and ask about them (vision + document inlining).
	var b bytes.Buffer
	_ = png.Encode(&b, image.NewRGBA(image.Rect(0, 0, 64, 64)))
	var imgRef, docRef store.FileRef
	e.upload("square.png", b.Bytes(), convID, &imgRef)
	e.upload("ghi-chu.md", []byte("# Ghi chú\nMật khẩu wifi của văn phòng là ECH-XANH-2026."), "", &docRef)
	events = e.stream("/api/conversations/"+convID+"/messages", map[string]any{
		"content": "Mật khẩu wifi trong tài liệu là gì? Ảnh mình gửi màu gì?", "attachment_ids": []string{imgRef.ID, docRef.ID},
	})
	t.Logf("turn 3 events: %v", summarize(events))
	if text := answerText(events); !strings.Contains(text, "ECH-XANH-2026") {
		t.Errorf("document not used, answer: %q", text)
	}
	e.json(http.MethodDelete, "/api/files/"+docRef.ID, nil, http.StatusConflict, nil)

	// The libraries list the uploads once they belong to a conversation.
	var imgs, docs page[store.FileListItem]
	e.json(http.MethodGet, "/api/files?type=image", nil, http.StatusOK, &imgs)
	e.json(http.MethodGet, "/api/files?type=document", nil, http.StatusOK, &docs)
	if !hasFile(imgs.Items, imgRef.ID) || hasFile(docs.Items, imgRef.ID) || !hasFile(docs.Items, docRef.ID) {
		t.Errorf("file libraries wrong: images=%v documents=%v", imgs.Items, docs.Items)
	}
	e.json(http.MethodGet, "/api/files?type=other", nil, http.StatusBadRequest, nil)

	// 4. Regenerate the last answer, then edit the first message.
	var msgs page[store.MessageJSON]
	e.json(http.MethodGet, "/api/conversations/"+convID+"/messages?limit=50", nil, http.StatusOK, &msgs)
	if len(msgs.Items) != 8 {
		t.Fatalf("want 8 messages, got %d", len(msgs.Items))
	}
	last := msgs.Items[len(msgs.Items)-1]
	events = e.stream("/api/messages/"+last.ID+"/regenerate", nil)
	if len(find(events, "message.done")) != 1 {
		t.Fatalf("regenerate: %v", summarize(events))
	}
	e.json(http.MethodPost, "/api/messages/"+msgs.Items[0].ID+"/regenerate", nil, http.StatusBadRequest, nil)
	events = e.stream("/api/messages/"+msgs.Items[0].ID+"/edit", map[string]any{"content": "Chào bạn, trả lời đúng một từ: xin chào"})
	if len(find(events, "message.done")) != 1 {
		t.Fatalf("edit: %v", summarize(events))
	}
	e.json(http.MethodGet, "/api/conversations/"+convID+"/messages?limit=1", nil, http.StatusOK, &msgs)
	if len(msgs.Items) != 1 || msgs.NextCursor == nil {
		t.Fatalf("paging: %+v", msgs)
	}
	e.json(http.MethodGet, "/api/conversations/"+convID+"/messages?limit=1&cursor="+*msgs.NextCursor, nil, http.StatusOK, &msgs)
	if len(msgs.Items) != 1 || msgs.NextCursor != nil || msgs.Items[0].Role != store.RoleUser {
		t.Fatalf("after edit: %+v", msgs)
	}

	// 5. Stop: abort the request mid-stream → message saved as stopped.
	sctx, cancel := context.WithCancel(ctx)
	body, _ := json.Marshal(map[string]string{"content": "Viết một bài văn dài 1000 từ về mùa thu Hà Nội"})
	r, _ := http.NewRequestWithContext(sctx, http.MethodPost, srv.URL+"/api/conversations/"+convID+"/messages", bytes.NewReader(body))
	r.Header.Set("Origin", e.origin)
	r.Header.Set("Cookie", auth.SessionCookie+"="+token)
	res, err := http.DefaultClient.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, 512)
	_, _ = res.Body.Read(buf)
	// A second generation in the same conversation is refused while this one runs.
	e.json(http.MethodPost, "/api/conversations/"+convID+"/messages", map[string]string{"content": "x"}, http.StatusConflict, nil)
	time.Sleep(1500 * time.Millisecond)
	cancel()
	res.Body.Close()
	time.Sleep(time.Second)
	e.json(http.MethodGet, "/api/conversations/"+convID+"/messages?limit=1", nil, http.StatusOK, &msgs)
	if msgs.Items[0].Status != store.MsgStopped {
		t.Errorf("after stop: status %s", msgs.Items[0].Status)
	}

	// 6. Conversations, search, settings, admin.
	var convs page[store.ConversationJSON]
	e.json(http.MethodPatch, "/api/conversations/"+convID, map[string]any{"pinned": true}, http.StatusOK, nil)
	e.json(http.MethodGet, "/api/conversations?q=goroutine", nil, http.StatusOK, &convs)
	if len(convs.Items) != 1 || !convs.Items[0].Pinned {
		t.Errorf("search: %+v", convs)
	}
	e.json(http.MethodPut, "/api/settings", map[string]string{"custom_instructions": "Xưng hô là bạn", "theme": "dark"}, http.StatusOK, nil)
	e.json(http.MethodPut, "/api/settings", map[string]string{"custom_instructions": "", "theme": "pink"}, http.StatusBadRequest, nil)
	var stats map[string]any
	e.json(http.MethodGet, "/api/admin/stats", nil, http.StatusOK, &stats)
	var health admin.Health
	e.json(http.MethodGet, "/api/admin/health", nil, http.StatusOK, &health)
	if !health.LLM.OK || !health.Image.OK || !health.Mongo.OK {
		t.Errorf("health: %+v", health)
	}
	var users page[adminUser]
	e.json(http.MethodGet, "/api/admin/users", nil, http.StatusOK, &users)
	// After the edit only the first user message and the stopped one remain.
	if len(users.Items) != 1 || users.Items[0].MessageCount != 2 || users.Items[0].ImageCount < 1 {
		t.Errorf("users: %+v", users.Items)
	}
	e.json(http.MethodPatch, "/api/admin/users/"+user.ID.Hex(), map[string]string{"status": "blocked"}, http.StatusBadRequest, nil)

	e.json(http.MethodDelete, "/api/conversations/"+convID, nil, http.StatusNoContent, nil)
	e.json(http.MethodGet, "/api/conversations/"+convID, nil, http.StatusNotFound, nil)
	e.json(http.MethodGet, toolDone.Result.File.URL, nil, http.StatusNotFound, nil)
}

func hasFile(items []store.FileListItem, id string) bool {
	for _, f := range items {
		if f.ID == id {
			return true
		}
	}
	return false
}

func (e *e2e) upload(name string, data []byte, convID string, out *store.FileRef) {
	e.t.Helper()
	var b bytes.Buffer
	w := multipart.NewWriter(&b)
	fw, _ := w.CreateFormFile("file", name)
	fw.Write(data)
	if convID != "" {
		w.WriteField("conversation_id", convID)
	}
	w.Close()
	res := e.req(http.MethodPost, "/api/files", &b, w.FormDataContentType())
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	if res.StatusCode != http.StatusCreated {
		e.t.Fatalf("upload %s: %d %s", name, res.StatusCode, raw)
	}
	_ = json.Unmarshal(raw, out)
}

func names(events []sseEvent) []string {
	out := make([]string, len(events))
	for i, ev := range events {
		out[i] = ev.Name
	}
	return out
}

// summarize collapses repeated deltas: "text.delta×42".
func summarize(events []sseEvent) []string {
	var out []string
	for i := 0; i < len(events); {
		j := i
		for j < len(events) && events[j].Name == events[i].Name {
			j++
		}
		s := events[i].Name
		if j-i > 1 {
			s += "×" + strconv.Itoa(j-i)
		}
		if events[i].Name == "error" || events[i].Name == "tool.error" || events[i].Name == "conversation.title" || events[i].Name == "tool.start" {
			s += " " + string(events[i].Data)
		}
		out = append(out, s)
		i = j
	}
	return out
}

func answerText(events []sseEvent) string {
	var sb strings.Builder
	for _, ev := range find(events, "text.delta") {
		var d struct {
			Delta string `json:"delta"`
		}
		_ = json.Unmarshal(ev.Data, &d)
		sb.WriteString(d.Delta)
	}
	return sb.String()
}

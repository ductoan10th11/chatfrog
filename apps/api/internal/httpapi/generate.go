package httpapi

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"go.mongodb.org/mongo-driver/v2/bson"

	"chatfrog/api/internal/auth"
	"chatfrog/api/internal/chat"
	"chatfrog/api/internal/httpx"
	"chatfrog/api/internal/store"
)

const maxAttachments = 5

type sendBody struct {
	Content       *string   `json:"content"`
	AttachmentIDs *[]string `json:"attachment_ids"`
}

func busy(w http.ResponseWriter) {
	httpx.Error(w, http.StatusConflict, "conflict", "Hội thoại đang tạo câu trả lời")
}

// readSend validates the body; attachments is nil when attachment_ids was omitted.
func (s *Server) readSend(w http.ResponseWriter, r *http.Request) (content string, attachments []store.File, given bool, ok bool) {
	var body sendBody
	if httpx.Decode(w, r, &body, 1<<20) != nil {
		return "", nil, false, false
	}
	if body.Content == nil {
		httpx.BadRequest(w, "Thiếu nội dung tin nhắn")
		return "", nil, false, false
	}
	content = strings.TrimSpace(*body.Content)
	if content == "" {
		httpx.BadRequest(w, "Tin nhắn không được để trống")
		return "", nil, false, false
	}
	if n := utf8.RuneCountInString(content); n > s.cfg.MaxMessageChars {
		httpx.BadRequest(w, fmt.Sprintf("Tin nhắn quá dài (tối đa %d ký tự)", s.cfg.MaxMessageChars))
		return "", nil, false, false
	}
	if body.AttachmentIDs == nil {
		return content, nil, false, true
	}
	ids := *body.AttachmentIDs
	if len(ids) > maxAttachments {
		httpx.BadRequest(w, fmt.Sprintf("Tối đa %d tệp đính kèm", maxAttachments))
		return "", nil, false, false
	}
	oids := make([]bson.ObjectID, 0, len(ids))
	seen := map[bson.ObjectID]bool{}
	for _, id := range ids {
		oid, err := bson.ObjectIDFromHex(id)
		if err != nil {
			httpx.BadRequest(w, "Tệp đính kèm không tồn tại: "+id)
			return "", nil, false, false
		}
		if !seen[oid] {
			seen[oid] = true
			oids = append(oids, oid)
		}
	}
	found, err := s.store.GetFiles(r.Context(), auth.UserFrom(r.Context()).ID, oids)
	if err != nil {
		httpx.Internal(w, r, err)
		return "", nil, false, false
	}
	byID := map[bson.ObjectID]store.File{}
	for _, f := range found {
		byID[f.ID] = f
	}
	for _, oid := range oids {
		f, exists := byID[oid]
		if !exists {
			httpx.BadRequest(w, "Tệp đính kèm không tồn tại: "+oid.Hex())
			return "", nil, false, false
		}
		attachments = append(attachments, f)
	}
	return content, attachments, true, true
}

func attachmentParts(list []store.File) []store.Part {
	parts := make([]store.Part, 0, len(list))
	for i := range list {
		ref := list[i].Ref()
		parts = append(parts, store.Part{Type: store.PartAttachment, File: &ref})
	}
	return parts
}

func fileIDs(list []store.File) []bson.ObjectID {
	ids := make([]bson.ObjectID, len(list))
	for i := range list {
		ids[i] = list[i].ID
	}
	return ids
}

// POST /api/conversations/{id}/messages ({id} = "new" creates the conversation).
func (s *Server) sendMessage(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user := auth.UserFrom(ctx)
	content, attachments, _, ok := s.readSend(w, r)
	if !ok {
		return
	}
	var conv *store.Conversation
	if chi.URLParam(r, "id") == "new" {
		c, err := s.store.CreateConversation(ctx, user.ID, "")
		if err != nil {
			httpx.Internal(w, r, err)
			return
		}
		conv = c
	} else if conv, ok = s.conversation(w, r); !ok {
		return
	}

	genCtx, release, ok := s.chat.Claim(ctx, conv.ID)
	if !ok {
		busy(w)
		return
	}
	defer release()

	userMsg := &store.Message{
		ConversationID: conv.ID, UserID: user.ID, Role: store.RoleUser, Status: store.MsgComplete,
		Parts: append(attachmentParts(attachments), store.Part{Type: store.PartText, Text: content}),
	}
	if err := s.store.InsertMessage(ctx, userMsg); err != nil {
		httpx.Internal(w, r, err)
		return
	}
	if err := s.store.AttachFiles(ctx, fileIDs(attachments), conv.ID); err != nil {
		httpx.Internal(w, r, err)
		return
	}
	s.generate(w, r, genCtx, conv, userMsg)
}

// POST /api/messages/{id}/regenerate: replaces the last assistant message.
func (s *Server) regenerate(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	msg, conv, ok := s.messageAndConversation(w, r)
	if !ok {
		return
	}
	if msg.Role != store.RoleAssistant {
		httpx.BadRequest(w, "Chỉ tạo lại được tin nhắn assistant cuối cùng")
		return
	}
	genCtx, release, ok := s.chat.Claim(ctx, conv.ID)
	if !ok {
		busy(w)
		return
	}
	defer release()

	last, err := s.store.LastMessage(ctx, conv.ID)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	prev, _, err := s.store.ListMessagesPage(ctx, conv.ID, msg.ID, 1)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	if last.ID != msg.ID || len(prev) == 0 || prev[0].Role != store.RoleUser {
		httpx.BadRequest(w, "Chỉ tạo lại được tin nhắn assistant cuối cùng")
		return
	}
	if err := s.store.DeleteMessage(ctx, msg.ID); err != nil {
		httpx.Internal(w, r, err)
		return
	}
	s.generate(w, r, genCtx, conv, &prev[0])
}

// POST /api/messages/{id}/edit: rewrites a user message, drops what follows, answers again.
// attachment_ids omitted keeps the current attachments.
func (s *Server) editMessage(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	msg, conv, ok := s.messageAndConversation(w, r)
	if !ok {
		return
	}
	if msg.Role != store.RoleUser {
		httpx.BadRequest(w, "Chỉ sửa được tin nhắn của người dùng")
		return
	}
	content, attachments, given, ok := s.readSend(w, r)
	if !ok {
		return
	}
	genCtx, release, ok := s.chat.Claim(ctx, conv.ID)
	if !ok {
		busy(w)
		return
	}
	defer release()

	var parts []store.Part
	if given {
		parts = attachmentParts(attachments)
	} else {
		for _, p := range msg.Parts {
			if p.Type == store.PartAttachment {
				parts = append(parts, p)
			}
		}
	}
	msg.Parts = append(parts, store.Part{Type: store.PartText, Text: content})
	if err := s.store.DeleteMessagesAfter(ctx, conv.ID, msg.ID); err != nil {
		httpx.Internal(w, r, err)
		return
	}
	if err := s.store.SetMessageParts(ctx, msg.ID, msg.Parts); err != nil {
		httpx.Internal(w, r, err)
		return
	}
	if err := s.store.AttachFiles(ctx, fileIDs(attachments), conv.ID); err != nil {
		httpx.Internal(w, r, err)
		return
	}
	s.generate(w, r, genCtx, conv, msg)
}

// generate creates the assistant message and streams the answer as SSE.
func (s *Server) generate(w http.ResponseWriter, r *http.Request, genCtx context.Context, conv *store.Conversation, userMsg *store.Message) {
	user := auth.UserFrom(r.Context())
	assistant := &store.Message{
		ConversationID: conv.ID, UserID: user.ID, Role: store.RoleAssistant, Status: store.MsgStreaming,
		Parts: []store.Part{},
	}
	if err := s.store.InsertMessage(r.Context(), assistant); err != nil {
		httpx.Internal(w, r, err)
		return
	}
	conv.UpdatedAt = assistant.CreatedAt
	if err := s.store.TouchConversation(r.Context(), conv.ID); err != nil {
		httpx.Internal(w, r, err)
		return
	}
	sse := httpx.NewSSE(w)
	defer sse.Close()
	s.chat.Run(genCtx, &chat.Turn{User: user, Conversation: conv, UserMessage: userMsg, Assistant: assistant}, sse.Emit)
}

func (s *Server) messageAndConversation(w http.ResponseWriter, r *http.Request) (*store.Message, *store.Conversation, bool) {
	id, ok := idParam(w, r, "tin nhắn")
	if !ok {
		return nil, nil, false
	}
	user := auth.UserFrom(r.Context())
	msg, err := s.store.GetMessage(r.Context(), user.ID, id)
	if err == nil {
		var conv *store.Conversation
		if conv, err = s.store.GetConversation(r.Context(), user.ID, msg.ConversationID); err == nil {
			return msg, conv, true
		}
	}
	if errors.Is(err, store.ErrNotFound) {
		httpx.NotFound(w, "tin nhắn")
	} else {
		httpx.Internal(w, r, err)
	}
	return nil, nil, false
}

package chat

import (
	"context"
	"log/slog"
	"strings"
	"time"
	"unicode/utf8"

	"chatfrog/api/internal/provider"
	"chatfrog/api/internal/store"
)

const titlePrompt = "Bạn là công cụ đặt tiêu đề. Không trả lời câu hỏi. Chỉ trả về một tiêu đề tiếng Việt ngắn " +
	"(3–8 từ) tóm tắt chủ đề của tin nhắn, không dấu ngoặc kép, không dấu chấm cuối."

// autoTitle names an untitled conversation after its first answer (LLM without thinking,
// falling back to the first 60 characters of the message).
func (s *Service) autoTitle(ctx context.Context, t *Turn, emit Emitter, useLLM bool) {
	userText := strings.TrimSpace(messageText(t.UserMessage))
	title := ""
	if useLLM && ctx.Err() == nil && userText != "" {
		title = s.llmTitle(ctx, userText)
	}
	if title == "" {
		title = fallbackTitle(userText)
	}
	saveCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancel()
	ok, err := s.store.SetTitleIfEmpty(saveCtx, t.Conversation.ID, title)
	if err != nil {
		slog.ErrorContext(ctx, "set title", "err", err)
		return
	}
	if ok && ctx.Err() == nil {
		emit("conversation.title", map[string]string{"conversation_id": t.Conversation.ID.Hex(), "title": title})
	}
}

func (s *Service) llmTitle(ctx context.Context, userText string) string {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	release, err := s.llmSlots.Acquire(ctx, nil)
	if err != nil {
		return ""
	}
	defer release()
	if utf8.RuneCountInString(userText) > 1000 {
		userText = string([]rune(userText)[:1000])
	}
	res, err := s.llm.StreamChat(ctx, provider.ChatRequest{
		Messages: []provider.ChatMessage{
			{Role: "system", Content: titlePrompt},
			{Role: "user", Content: "Tin nhắn:\n\"\"\"\n" + userText + "\n\"\"\"\n\nTiêu đề:"},
		},
		MaxTokens:       40,
		ReasoningEffort: "none",
	}, func(provider.Delta) {})
	if err != nil {
		slog.WarnContext(ctx, "title", "err", err)
		return ""
	}
	return cleanTitle(res.Content)
}

func cleanTitle(s string) string {
	for _, line := range strings.Split(s, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		for _, prefix := range []string{"Tiêu đề:", "tiêu đề:", "Title:"} {
			line = strings.TrimSpace(strings.TrimPrefix(line, prefix))
		}
		line = strings.Trim(line, "\"'“”*#`. ")
		if len(strings.Fields(line)) > 14 { // an answer, not a title
			return ""
		}
		return truncateRunes(line, 80)
	}
	return ""
}

func fallbackTitle(text string) string {
	text = strings.Join(strings.Fields(text), " ")
	if text == "" {
		return "Hội thoại mới"
	}
	return truncateRunes(text, 60)
}

func truncateRunes(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return strings.TrimSpace(string([]rune(s)[:n]))
}

func messageText(m *store.Message) string {
	var parts []string
	for _, p := range m.Parts {
		if p.Type == store.PartText {
			parts = append(parts, p.Text)
		}
	}
	return strings.Join(parts, "\n")
}

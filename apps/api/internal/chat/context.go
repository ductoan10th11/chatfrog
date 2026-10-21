package chat

import (
	"context"
	"encoding/base64"
	"fmt"
	"log/slog"
	"strings"
	"time"
	"unicode/utf8"

	"go.mongodb.org/mongo-driver/v2/bson"

	"chatfrog/api/internal/files"
	"chatfrog/api/internal/provider"
	"chatfrog/api/internal/store"
)

const systemPrompt = `Bạn là ChatFrog, một trợ lý AI thân thiện và hữu ích.
- Trả lời bằng tiếng Việt, trừ khi người dùng dùng ngôn ngữ khác. Thuật ngữ chuyên môn giữ nguyên tiếng Anh.
- Dùng Markdown khi phù hợp (danh sách, bảng, code block có ghi ngôn ngữ).
- Hôm nay là %s.

Tạo và chỉnh sửa ảnh bằng tool generate_image:
- Chỉ gọi tool khi người dùng muốn có ảnh (vẽ, tạo, minh hoạ, thiết kế, chỉnh sửa ảnh…).
- Trước khi gọi, viết 1 câu tiếng Việt ngắn cho biết bạn sẽ tạo gì. Sau khi có kết quả, chỉ trả lời đúng 1 câu ngắn dạng "Tôi đã tạo cho bạn bức ảnh về …", không giải thích thêm. Không chèn link hay cú pháp ảnh Markdown, ảnh đã được hiển thị cho người dùng.
- Tham số prompt PHẢI viết bằng tiếng Anh, chi tiết về chủ thể, bố cục, ánh sáng, phong cách.
- Mỗi ảnh trong hội thoại có nhãn [image id=...]. Khi người dùng muốn chỉnh sửa hoặc dựa trên một ảnh, truyền id của ảnh đó vào reference_image_ids.
- Mặc định size 1024x1024. Chỉ dùng kích thước 2048 khi người dùng yêu cầu ảnh lớn hoặc nét.`

// Rough token estimates: ~2.5 characters per token, a vision image ~1100 tokens.
const (
	imageTokens = 1100
	toolsTokens = 400
	msgOverhead = 8
)

func (s *Service) systemPrompt(u *store.User) string {
	today := time.Now().In(s.cfg.StatsTimezone).Format("02/01/2006")
	p := fmt.Sprintf(systemPrompt, today)
	if ci := strings.TrimSpace(u.Settings.CustomInstructions); ci != "" {
		p += "\n\nHướng dẫn riêng của người dùng (ưu tiên làm theo):\n" + ci
	}
	return p
}

// buildContext turns the stored history (everything before the assistant message) into
// chat messages: reasoning dropped, old tool calls reduced to [image id=...], documents
// inlined, images sent to the vision model only for the latest user message, oldest
// messages trimmed to fit the context window.
func (s *Service) buildContext(ctx context.Context, t *Turn) ([]provider.ChatMessage, error) {
	history, err := s.store.ListMessages(ctx, t.Conversation.ID, t.Assistant.ID)
	if err != nil {
		return nil, err
	}
	var ids []bson.ObjectID
	lastUser := -1
	for i, m := range history {
		if m.Role == store.RoleUser {
			lastUser = i
		}
		for _, p := range m.Parts {
			if p.Type == store.PartAttachment && p.File != nil {
				if oid, err := bson.ObjectIDFromHex(p.File.ID); err == nil {
					ids = append(ids, oid)
				}
			}
		}
	}
	found, err := s.store.GetFiles(ctx, t.User.ID, ids)
	if err != nil {
		return nil, err
	}
	byID := make(map[string]*store.File, len(found))
	for i := range found {
		byID[found[i].ID.Hex()] = &found[i]
	}

	var msgs []provider.ChatMessage
	for i, m := range history {
		switch m.Role {
		case store.RoleUser:
			msgs = append(msgs, s.userMessage(ctx, &m, byID, i == lastUser && s.cfg.LLMVision))
		case store.RoleAssistant:
			if text := assistantText(&m); text != "" && m.Status != store.MsgStreaming {
				msgs = append(msgs, provider.ChatMessage{Role: "assistant", Content: text})
			}
		}
	}

	system := provider.ChatMessage{Role: "system", Content: s.systemPrompt(t.User)}
	budget := s.cfg.LLMContextTokens - s.cfg.LLMMaxOutputTokens - estimate(system) - toolsTokens
	return append([]provider.ChatMessage{system}, trimToBudget(msgs, budget)...), nil
}

func (s *Service) userMessage(ctx context.Context, m *store.Message, byID map[string]*store.File, vision bool) provider.ChatMessage {
	var sb strings.Builder
	var images []provider.ContentPart
	for _, p := range m.Parts {
		switch {
		case p.Type == store.PartText:
			sb.WriteString(p.Text)
		case p.Type == store.PartAttachment && p.File != nil:
			f := byID[p.File.ID]
			if f == nil {
				fmt.Fprintf(&sb, "[tệp %q đã bị xoá]\n", p.File.Name)
				continue
			}
			if f.IsImage() {
				fmt.Fprintf(&sb, "[image id=%s]\n", f.ID.Hex())
				if vision {
					if part, ok := s.visionPart(ctx, f); ok {
						images = append(images, part)
					}
				}
				continue
			}
			text := f.ExtractedText
			if strings.TrimSpace(text) == "" {
				text = "(Không trích xuất được nội dung văn bản từ tệp này.)"
			}
			fmt.Fprintf(&sb, "<document name=\"%s\">\n%s\n</document>\n", strings.ReplaceAll(f.Name, `"`, "'"), text)
			if f.Truncated {
				sb.WriteString("(Tài liệu quá dài nên đã bị cắt bớt.)\n")
			}
		}
	}
	if len(images) == 0 {
		return provider.ChatMessage{Role: "user", Content: sb.String()}
	}
	content := append([]provider.ContentPart{{Type: "text", Text: sb.String()}}, images...)
	return provider.ChatMessage{Role: "user", Content: content}
}

func (s *Service) visionPart(ctx context.Context, f *store.File) (provider.ContentPart, bool) {
	data, err := s.storage.Read(f.StorageKey)
	if err == nil {
		data, err = files.FitJPEG(data, s.cfg.VisionMaxPx, 85)
	}
	if err != nil {
		slog.WarnContext(ctx, "vision image", "file", f.ID.Hex(), "err", err)
		return provider.ContentPart{}, false
	}
	url := "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(data)
	return provider.ContentPart{Type: "image_url", ImageURL: &provider.ImageURL{URL: url}}, true
}

func assistantText(m *store.Message) string {
	var out []string
	for _, p := range m.Parts {
		switch p.Type {
		case store.PartText:
			if t := strings.TrimSpace(p.Text); t != "" {
				out = append(out, t)
			}
		case store.PartToolCall:
			if p.Status == store.ToolDone && p.Result != nil {
				out = append(out, fmt.Sprintf("[image id=%s]", p.Result.File.ID))
			} else if p.Error != "" {
				out = append(out, "[Tạo ảnh thất bại: "+p.Error+"]")
			}
		}
	}
	return strings.Join(out, "\n\n")
}

func estimate(m provider.ChatMessage) int {
	n := msgOverhead
	switch c := m.Content.(type) {
	case string:
		n += utf8.RuneCountInString(c) * 2 / 5
	case []provider.ContentPart:
		for _, p := range c {
			if p.ImageURL != nil {
				n += imageTokens
			} else {
				n += utf8.RuneCountInString(p.Text) * 2 / 5
			}
		}
	}
	return n
}

// trimToBudget keeps the newest messages that fit (always the last one) and makes the
// kept history start with a user message.
func trimToBudget(msgs []provider.ChatMessage, budget int) []provider.ChatMessage {
	start := len(msgs)
	total := 0
	for i := len(msgs) - 1; i >= 0; i-- {
		total += estimate(msgs[i])
		if total > budget && i < len(msgs)-1 {
			break
		}
		start = i
	}
	for start < len(msgs)-1 && msgs[start].Role != "user" {
		start++
	}
	return msgs[start:]
}

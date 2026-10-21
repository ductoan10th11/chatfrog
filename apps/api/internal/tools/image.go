// Package tools implements the tools the LLM may call (docs/SPEC.md §4.2).
package tools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"chatfrog/api/internal/files"
	"chatfrog/api/internal/provider"
	"chatfrog/api/internal/store"
)

const GenerateImageName = "generate_image"

var Sizes = []string{"1024x1024", "1536x1024", "1024x1536", "2048x2048", "2048x1152", "1152x2048"}

const maxReferences = 3

// GenerateImageDef is the OpenAI function definition sent to the LLM.
var GenerateImageDef = provider.Tool{
	Type: "function",
	Function: provider.FunctionDef{
		Name:        GenerateImageName,
		Description: "Tạo ảnh mới hoặc chỉnh sửa ảnh có sẵn. Chỉ gọi khi người dùng muốn có ảnh. Viết prompt bằng tiếng Anh, chi tiết về chủ thể, bố cục, ánh sáng, phong cách.",
		Parameters: json.RawMessage(`{
  "type": "object",
  "properties": {
    "prompt": { "type": "string", "description": "Prompt tiếng Anh đã được viết lại, chi tiết" },
    "size": { "type": "string", "enum": ["1024x1024", "1536x1024", "1024x1536", "2048x2048", "2048x1152", "1152x2048"], "default": "1024x1024" },
    "reference_image_ids": { "type": "array", "items": { "type": "string" }, "description": "ID các ảnh trong hội thoại cần chỉnh sửa / tham chiếu" }
  },
  "required": ["prompt"]
}`),
	},
}

// ParseArgs decodes and normalises the LLM's arguments.
func ParseArgs(raw string) (store.ToolArgs, error) {
	var a store.ToolArgs
	if err := json.Unmarshal([]byte(raw), &a); err != nil {
		return a, fmt.Errorf("tham số không hợp lệ: %w", err)
	}
	a.Prompt = strings.TrimSpace(a.Prompt)
	if a.Prompt == "" {
		return a, errors.New("thiếu prompt")
	}
	if !slices.Contains(Sizes, a.Size) {
		a.Size = "1024x1024"
	}
	if len(a.ReferenceImageIDs) > maxReferences {
		a.ReferenceImageIDs = a.ReferenceImageIDs[:maxReferences]
	}
	return a, nil
}

// UserError is safe to show to the user (and to the LLM).
type UserError struct{ Msg string }

func (e *UserError) Error() string { return e.Msg }

type ImageTool struct {
	store    *store.Store
	storage  *files.Storage
	provider provider.ImageProvider
	timeout  time.Duration
	OnResult func(err error) // health reporting
}

func NewImageTool(st *store.Store, storage *files.Storage, p provider.ImageProvider, timeout time.Duration) *ImageTool {
	return &ImageTool{store: st, storage: storage, provider: p, timeout: timeout}
}

// Run generates (or edits, with reference images) one image and stores it as a generated file.
func (t *ImageTool) Run(ctx context.Context, userID, convID bson.ObjectID, args store.ToolArgs) (*store.File, error) {
	refs, err := t.references(ctx, userID, args.ReferenceImageIDs)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, t.timeout)
	defer cancel()
	var data []byte
	if len(refs) > 0 {
		data, err = t.provider.Edit(ctx, args.Prompt, args.Size, refs)
	} else {
		data, err = t.provider.Generate(ctx, args.Prompt, args.Size)
	}
	if t.OnResult != nil && !errors.Is(err, context.Canceled) {
		t.OnResult(err)
	}
	if err != nil {
		switch {
		case errors.Is(err, context.Canceled):
			return nil, err
		case errors.Is(err, context.DeadlineExceeded):
			return nil, &UserError{"Tạo ảnh quá thời gian cho phép"}
		}
		slog.WarnContext(ctx, "image provider", "err", err)
		return nil, &UserError{"Máy chủ tạo ảnh hiện không khả dụng"}
	}

	mime := http.DetectContentType(data)
	if mime != "image/png" && mime != "image/jpeg" && mime != "image/webp" {
		return nil, &UserError{"Máy chủ tạo ảnh trả về dữ liệu không hợp lệ"}
	}
	w, h, err := files.ImageSize(data)
	if err != nil {
		return nil, &UserError{"Máy chủ tạo ảnh trả về dữ liệu không hợp lệ"}
	}
	id := bson.NewObjectID()
	key, err := t.storage.Save(id.Hex(), time.Now(), data)
	if err != nil {
		return nil, fmt.Errorf("save image: %w", err)
	}
	ext := map[string]string{"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}[mime]
	f := &store.File{
		ID: id, UserID: userID, ConversationID: &convID, Kind: store.KindGenerated,
		Mime: mime, Size: int64(len(data)), Width: w, Height: h,
		Name: "anh-" + id.Hex()[18:] + ext, StorageKey: key, Prompt: args.Prompt,
	}
	if err := t.store.InsertFile(context.WithoutCancel(ctx), f); err != nil {
		t.storage.Remove(key, id.Hex())
		return nil, fmt.Errorf("insert image: %w", err)
	}
	return f, nil
}

func (t *ImageTool) references(ctx context.Context, userID bson.ObjectID, ids []string) ([]provider.ImageInput, error) {
	var oids []bson.ObjectID
	for _, s := range ids {
		oid, err := bson.ObjectIDFromHex(strings.TrimSpace(s))
		if err != nil {
			return nil, &UserError{fmt.Sprintf("Không tìm thấy ảnh id=%s", s)}
		}
		oids = append(oids, oid)
	}
	found, err := t.store.GetFiles(ctx, userID, oids)
	if err != nil {
		return nil, err
	}
	var out []provider.ImageInput
	for _, oid := range oids {
		i := slices.IndexFunc(found, func(f store.File) bool { return f.ID == oid })
		if i < 0 || !found[i].IsImage() {
			return nil, &UserError{fmt.Sprintf("Không tìm thấy ảnh id=%s", oid.Hex())}
		}
		data, err := t.storage.Read(found[i].StorageKey)
		if err != nil {
			return nil, fmt.Errorf("read reference: %w", err)
		}
		out = append(out, provider.ImageInput{Name: found[i].Name, Mime: found[i].Mime, Data: data})
	}
	return out, nil
}

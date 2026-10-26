package httpapi

import (
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"go.mongodb.org/mongo-driver/v2/bson"

	"chatfrog/api/internal/auth"
	"chatfrog/api/internal/files"
	"chatfrog/api/internal/httpx"
	"chatfrog/api/internal/store"
)

func tooLarge(w http.ResponseWriter, msg string) {
	httpx.Error(w, http.StatusRequestEntityTooLarge, "payload_too_large", msg)
}

// POST /api/files (multipart: file, conversation_id?)
func (s *Server) uploadFile(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user := auth.UserFrom(ctx)
	maxBytes := s.cfg.MaxUploadBytes
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes+(1<<20))
	mr, err := r.MultipartReader()
	if err != nil {
		httpx.BadRequest(w, "Cần multipart/form-data")
		return
	}

	var data []byte
	var name, convField string
	for {
		part, err := mr.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			s.uploadReadError(w, err)
			return
		}
		switch part.FormName() {
		case "file":
			name = part.FileName()
			data, err = io.ReadAll(io.LimitReader(part, maxBytes+1))
		case "conversation_id":
			var b []byte
			b, err = io.ReadAll(io.LimitReader(part, 64))
			convField = strings.TrimSpace(string(b))
		}
		part.Close()
		if err != nil {
			s.uploadReadError(w, err)
			return
		}
	}
	if data == nil {
		httpx.BadRequest(w, "Thiếu trường file")
		return
	}
	if int64(len(data)) > maxBytes {
		tooLarge(w, fmt.Sprintf("Tệp quá lớn (tối đa %d MB)", maxBytes>>20))
		return
	}
	if len(data) == 0 {
		httpx.BadRequest(w, "Tệp rỗng")
		return
	}
	mime, isImage, err := files.Sniff(name, data)
	if err != nil {
		httpx.Error(w, http.StatusUnsupportedMediaType, "unsupported_media_type", "Định dạng tệp không được hỗ trợ")
		return
	}
	if isImage && len(data) > files.MaxImageBytes {
		tooLarge(w, "Ảnh quá lớn (tối đa 10 MB)")
		return
	}

	f := &store.File{
		ID: bson.NewObjectID(), UserID: user.ID, Kind: store.KindUpload,
		Mime: mime, Size: int64(len(data)), Name: cleanFileName(name),
	}
	if convField != "" {
		oid, err := bson.ObjectIDFromHex(convField)
		if err == nil {
			_, err = s.store.GetConversation(ctx, user.ID, oid)
		}
		if err != nil {
			httpx.NotFound(w, "hội thoại")
			return
		}
		f.ConversationID = &oid
	}
	if isImage {
		if f.Width, f.Height, err = files.ImageSize(data); err != nil {
			httpx.Error(w, http.StatusUnsupportedMediaType, "unsupported_media_type", "Ảnh không hợp lệ hoặc quá lớn")
			return
		}
	} else {
		if f.ExtractedText, f.Truncated, err = files.ExtractText(mime, data, s.cfg.DocMaxChars); err != nil {
			slog.WarnContext(ctx, "extract text", "name", f.Name, "err", err)
			httpx.BadRequest(w, "Không đọc được nội dung tài liệu")
			return
		}
	}
	if f.StorageKey, err = s.storage.Save(f.ID.Hex(), time.Now(), data); err != nil {
		httpx.Internal(w, r, err)
		return
	}
	if err := s.store.InsertFile(ctx, f); err != nil {
		s.storage.Remove(f.StorageKey, f.ID.Hex())
		httpx.Internal(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, f.Ref())
}

func (s *Server) uploadReadError(w http.ResponseWriter, err error) {
	var mbe *http.MaxBytesError
	if errors.As(err, &mbe) {
		tooLarge(w, fmt.Sprintf("Tệp quá lớn (tối đa %d MB)", s.cfg.MaxUploadBytes>>20))
		return
	}
	httpx.BadRequest(w, "Dữ liệu multipart không hợp lệ")
}

// GET /api/files?type=image|document&limit&cursor: the user's files, newest first.
func (s *Server) listFiles(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFrom(r.Context())
	var images bool
	switch r.URL.Query().Get("type") {
	case "image":
		images = true
	case "document":
	default:
		httpx.BadRequest(w, "type phải là image hoặc document")
		return
	}
	limit := limitParam(r, 30, 100)
	offset := offsetCursor(r)
	list, more, err := s.store.ListFiles(r.Context(), user.ID, images, offset, limit)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	items := make([]store.FileListItem, len(list))
	for i := range list {
		items[i] = list[i].ListItem()
	}
	next := ""
	if more {
		next = encodeOffset(offset + limit)
	}
	httpx.JSON(w, http.StatusOK, newPage(items, next))
}

// GET /api/files/{id}: images inline, everything else as attachment.
func (s *Server) serveFile(w http.ResponseWriter, r *http.Request) {
	f, ok := s.file(w, r)
	if !ok {
		return
	}
	fh, err := os.Open(s.storage.Path(f.StorageKey))
	if err != nil {
		slog.ErrorContext(r.Context(), "open file", "file", f.ID.Hex(), "err", err)
		httpx.NotFound(w, "tệp")
		return
	}
	defer fh.Close()
	disposition := "attachment"
	if f.IsImage() {
		disposition = "inline"
	}
	h := w.Header()
	h.Set("Content-Type", f.Mime)
	h.Set("Content-Disposition", fmt.Sprintf("%s; filename*=UTF-8''%s", disposition, url.PathEscape(f.Name)))
	h.Set("Cache-Control", "private, max-age=31536000, immutable")
	http.ServeContent(w, r, "", f.CreatedAt, fh)
}

// GET /api/files/{id}/thumb: JPEG, longest side 384 px, cached on disk.
func (s *Server) serveThumb(w http.ResponseWriter, r *http.Request) {
	f, ok := s.file(w, r)
	if !ok {
		return
	}
	if !f.IsImage() {
		httpx.NotFound(w, "ảnh thu nhỏ")
		return
	}
	path := s.storage.ThumbPath(f.ID.Hex())
	if _, err := os.Stat(path); err != nil {
		data, err := s.storage.Read(f.StorageKey)
		if err == nil {
			data, err = files.FitJPEG(data, files.ThumbPx, 80)
		}
		if err == nil {
			tmp := path + ".tmp"
			if err = os.WriteFile(tmp, data, 0o640); err == nil {
				err = os.Rename(tmp, path)
			}
		}
		if err != nil {
			httpx.Internal(w, r, err)
			return
		}
	}
	fh, err := os.Open(path)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	defer fh.Close()
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	http.ServeContent(w, r, "", f.CreatedAt, fh)
}

// DELETE /api/files/{id}: 409 once the file is part of a message.
func (s *Server) deleteFile(w http.ResponseWriter, r *http.Request) {
	f, ok := s.file(w, r)
	if !ok {
		return
	}
	used, err := s.store.FileUsedInMessage(r.Context(), f.ID.Hex())
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	if used {
		httpx.Error(w, http.StatusConflict, "conflict", "Tệp đã được dùng trong một tin nhắn")
		return
	}
	if err := s.store.DeleteFile(r.Context(), f.ID); err != nil {
		httpx.Internal(w, r, err)
		return
	}
	s.storage.Remove(f.StorageKey, f.ID.Hex())
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) file(w http.ResponseWriter, r *http.Request) (*store.File, bool) {
	id, ok := idParam(w, r, "tệp")
	if !ok {
		return nil, false
	}
	f, err := s.store.GetFile(r.Context(), auth.UserFrom(r.Context()).ID, id)
	if errors.Is(err, store.ErrNotFound) {
		httpx.NotFound(w, "tệp")
		return nil, false
	}
	if err != nil {
		httpx.Internal(w, r, err)
		return nil, false
	}
	return f, true
}

// cleanFileName keeps a display name only; storage never uses it.
func cleanFileName(name string) string {
	if i := strings.LastIndexAny(name, `/\`); i >= 0 {
		name = name[i+1:]
	}
	name = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, strings.ToValidUTF8(name, ""))
	name = strings.TrimSpace(name)
	if utf8.RuneCountInString(name) > 200 {
		ext := filepath.Ext(name)
		if utf8.RuneCountInString(ext) > 20 {
			ext = ""
		}
		name = string([]rune(name)[:200-utf8.RuneCountInString(ext)]) + ext
	}
	if name == "" || name == "." || name == ".." {
		return "tep"
	}
	return name
}

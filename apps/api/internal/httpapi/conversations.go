package httpapi

import (
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"

	"go.mongodb.org/mongo-driver/v2/bson"

	"chatfrog/api/internal/auth"
	"chatfrog/api/internal/httpx"
	"chatfrog/api/internal/store"
)

const maxTitleChars = 200

func (s *Server) listConversations(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFrom(r.Context())
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if utf8.RuneCountInString(q) > 200 {
		q = string([]rune(q)[:200])
	}
	limit := limitParam(r, 30, 100)
	offset := offsetCursor(r)
	list, more, err := s.store.ListConversations(r.Context(), user.ID, q, offset, limit)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	items := make([]store.ConversationJSON, len(list))
	for i := range list {
		items[i] = list[i].JSON()
	}
	next := ""
	if more {
		next = encodeOffset(offset + limit)
	}
	httpx.JSON(w, http.StatusOK, newPage(items, next))
}

func (s *Server) createConversation(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Title string `json:"title"`
	}
	if r.ContentLength != 0 {
		if httpx.Decode(w, r, &body, 64<<10) != nil {
			return
		}
	}
	title, ok := cleanTitle(w, body.Title)
	if !ok {
		return
	}
	c, err := s.store.CreateConversation(r.Context(), auth.UserFrom(r.Context()).ID, title)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, c.JSON())
}

func (s *Server) getConversation(w http.ResponseWriter, r *http.Request) {
	c, ok := s.conversation(w, r)
	if !ok {
		return
	}
	httpx.JSON(w, http.StatusOK, c.JSON())
}

func (s *Server) updateConversation(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "hội thoại")
	if !ok {
		return
	}
	var body struct {
		Title  *string `json:"title"`
		Pinned *bool   `json:"pinned"`
	}
	if httpx.Decode(w, r, &body, 64<<10) != nil {
		return
	}
	set := bson.M{}
	if body.Title != nil {
		title, ok := cleanTitle(w, *body.Title)
		if !ok {
			return
		}
		set["title"] = title
	}
	if body.Pinned != nil {
		set["pinned"] = *body.Pinned
	}
	user := auth.UserFrom(r.Context())
	var c *store.Conversation
	var err error
	if len(set) == 0 {
		c, err = s.store.GetConversation(r.Context(), user.ID, id)
	} else {
		c, err = s.store.UpdateConversation(r.Context(), user.ID, id, set)
	}
	if errors.Is(err, store.ErrNotFound) {
		httpx.NotFound(w, "hội thoại")
		return
	}
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, c.JSON())
}

func (s *Server) deleteConversation(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "hội thoại")
	if !ok {
		return
	}
	s.chat.Cancel(id)
	removed, err := s.store.DeleteConversation(r.Context(), auth.UserFrom(r.Context()).ID, id)
	if errors.Is(err, store.ErrNotFound) {
		httpx.NotFound(w, "hội thoại")
		return
	}
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	for _, f := range removed {
		s.storage.Remove(f.StorageKey, f.ID.Hex())
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) listMessages(w http.ResponseWriter, r *http.Request) {
	c, ok := s.conversation(w, r)
	if !ok {
		return
	}
	var before bson.ObjectID
	if cur := r.URL.Query().Get("cursor"); cur != "" {
		oid, err := bson.ObjectIDFromHex(cur)
		if err != nil {
			httpx.BadRequest(w, "cursor không hợp lệ")
			return
		}
		before = oid
	}
	list, more, err := s.store.ListMessagesPage(r.Context(), c.ID, before, limitParam(r, 50, 200))
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	items := make([]store.MessageJSON, len(list))
	for i := range list {
		items[i] = list[i].JSON()
	}
	next := ""
	if more && len(list) > 0 {
		next = list[0].ID.Hex() // the cursor walks into the past
	}
	httpx.JSON(w, http.StatusOK, newPage(items, next))
}

// conversation loads {id} owned by the current user, answering 404 otherwise.
func (s *Server) conversation(w http.ResponseWriter, r *http.Request) (*store.Conversation, bool) {
	id, ok := idParam(w, r, "hội thoại")
	if !ok {
		return nil, false
	}
	c, err := s.store.GetConversation(r.Context(), auth.UserFrom(r.Context()).ID, id)
	if errors.Is(err, store.ErrNotFound) {
		httpx.NotFound(w, "hội thoại")
		return nil, false
	}
	if err != nil {
		httpx.Internal(w, r, err)
		return nil, false
	}
	return c, true
}

func cleanTitle(w http.ResponseWriter, title string) (string, bool) {
	title = strings.Join(strings.Fields(title), " ")
	if utf8.RuneCountInString(title) > maxTitleChars {
		httpx.BadRequest(w, "Tiêu đề tối đa 200 ký tự")
		return "", false
	}
	return title, true
}

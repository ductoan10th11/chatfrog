package httpapi

import (
	"net/http"
	"unicode/utf8"

	"go.mongodb.org/mongo-driver/v2/bson"

	"chatfrog/api/internal/auth"
	"chatfrog/api/internal/httpx"
	"chatfrog/api/internal/store"
)

const maxCustomInstructions = 2000

func (s *Server) getSettings(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, auth.UserFrom(r.Context()).JSON().Settings)
}

func (s *Server) putSettings(w http.ResponseWriter, r *http.Request) {
	var body struct {
		CustomInstructions *string `json:"custom_instructions"`
		Theme              *string `json:"theme"`
	}
	if httpx.Decode(w, r, &body, 64<<10) != nil {
		return
	}
	if body.CustomInstructions == nil || body.Theme == nil {
		httpx.BadRequest(w, "Cài đặt không hợp lệ")
		return
	}
	switch *body.Theme {
	case "light", "dark", "system":
	default:
		httpx.BadRequest(w, "Cài đặt không hợp lệ")
		return
	}
	if utf8.RuneCountInString(*body.CustomInstructions) > maxCustomInstructions {
		httpx.BadRequest(w, "Custom instructions tối đa 2000 ký tự")
		return
	}
	settings := store.Settings{CustomInstructions: *body.CustomInstructions, Theme: *body.Theme}
	u, err := s.store.UpdateUser(r.Context(), auth.UserFrom(r.Context()).ID, bson.M{"settings": settings})
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, u.JSON().Settings)
}

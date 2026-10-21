// Package httpapi wires the Chi router, middleware and handlers of docs/API.md.
package httpapi

import (
	"encoding/base64"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"go.mongodb.org/mongo-driver/v2/bson"

	"chatfrog/api/internal/admin"
	"chatfrog/api/internal/auth"
	"chatfrog/api/internal/chat"
	"chatfrog/api/internal/config"
	"chatfrog/api/internal/files"
	"chatfrog/api/internal/httpx"
	"chatfrog/api/internal/store"
)

type Server struct {
	cfg     *config.Config
	store   *store.Store
	storage *files.Storage
	auth    *auth.Service
	chat    *chat.Service
	monitor *admin.Monitor
}

func New(cfg *config.Config, st *store.Store, storage *files.Storage, a *auth.Service, c *chat.Service, m *admin.Monitor) *Server {
	return &Server{cfg: cfg, store: st, storage: storage, auth: a, chat: c, monitor: m}
}

func (s *Server) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID, logRequests, middleware.Recoverer, securityHeaders, s.checkOrigin)

	r.Get("/api/healthz", func(w http.ResponseWriter, r *http.Request) {
		httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
	})
	r.Get("/api/auth/google/login", s.auth.Login)
	r.Get("/api/auth/google/callback", s.auth.Callback)
	if p := s.cfg.CallbackPath(); p != "" && p != "/api/auth/google/callback" {
		r.Get(p, s.auth.Callback) // GG_CALLBACK_URL registered in Google Cloud Console
	}

	r.Group(func(r chi.Router) {
		r.Use(s.auth.Session)
		r.Post("/api/auth/logout", s.auth.Logout)
		r.With(auth.RequireUser).Get("/api/me", s.me)

		r.Group(func(r chi.Router) {
			r.Use(auth.RequireActive)

			r.Get("/api/conversations", s.listConversations)
			r.Post("/api/conversations", s.createConversation)
			r.Get("/api/conversations/{id}", s.getConversation)
			r.Patch("/api/conversations/{id}", s.updateConversation)
			r.Delete("/api/conversations/{id}", s.deleteConversation)
			r.Get("/api/conversations/{id}/messages", s.listMessages)

			r.Post("/api/conversations/{id}/messages", s.sendMessage)
			r.Post("/api/messages/{id}/regenerate", s.regenerate)
			r.Post("/api/messages/{id}/edit", s.editMessage)

			r.Post("/api/files", s.uploadFile)
			r.Get("/api/files/{id}", s.serveFile)
			r.Get("/api/files/{id}/thumb", s.serveThumb)
			r.Delete("/api/files/{id}", s.deleteFile)

			r.Get("/api/settings", s.getSettings)
			r.Put("/api/settings", s.putSettings)
		})

		r.Group(func(r chi.Router) {
			r.Use(auth.RequireAdmin)
			r.Get("/api/admin/users", s.listUsers)
			r.Patch("/api/admin/users/{id}", s.updateUser)
			r.Get("/api/admin/stats", s.stats)
			r.Get("/api/admin/health", s.health)
		})
	})

	r.NotFound(func(w http.ResponseWriter, r *http.Request) { httpx.NotFound(w, "đường dẫn") })
	r.MethodNotAllowed(func(w http.ResponseWriter, r *http.Request) {
		httpx.Error(w, http.StatusMethodNotAllowed, "invalid_request", "Phương thức không được hỗ trợ")
	})
	return r
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, auth.UserFrom(r.Context()).JSON())
}

/* ---------------------------------------------------------------- middleware */

// checkOrigin: every non-GET request must come from APP_ORIGIN (CSRF, docs/SPEC.md §8).
func (s *Server) checkOrigin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
		default:
			if r.Header.Get("Origin") != s.cfg.AppOrigin {
				httpx.Error(w, http.StatusForbidden, "forbidden", "Origin không hợp lệ")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		if strings.HasPrefix(r.URL.Path, "/api/") && !strings.HasPrefix(r.URL.Path, "/api/files/") {
			h.Set("Cache-Control", "no-store")
		}
		next.ServeHTTP(w, r)
	})
}

func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/healthz" {
			next.ServeHTTP(w, r)
			return
		}
		start := time.Now()
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(ww, r)
		slog.InfoContext(r.Context(), "http",
			"method", r.Method, "path", r.URL.Path, "status", ww.Status(),
			"bytes", ww.BytesWritten(), "ms", time.Since(start).Milliseconds(),
			"ip", httpx.ClientIP(r), "req", middleware.GetReqID(r.Context()))
	})
}

/* ---------------------------------------------------------------- helpers */

type page[T any] struct {
	Items      []T     `json:"items"`
	NextCursor *string `json:"next_cursor"`
}

func newPage[T any](items []T, next string) page[T] {
	if items == nil {
		items = []T{}
	}
	p := page[T]{Items: items}
	if next != "" {
		p.NextCursor = &next
	}
	return p
}

func limitParam(r *http.Request, def, maxN int) int {
	n, err := strconv.Atoi(r.URL.Query().Get("limit"))
	if err != nil || n <= 0 {
		return def
	}
	return min(n, maxN)
}

// Offset cursors are opaque to clients: base64("o:<offset>").
func offsetCursor(r *http.Request) int {
	raw, err := base64.RawURLEncoding.DecodeString(r.URL.Query().Get("cursor"))
	if err != nil {
		return 0
	}
	n, err := strconv.Atoi(strings.TrimPrefix(string(raw), "o:"))
	if err != nil || n < 0 {
		return 0
	}
	return n
}

func encodeOffset(n int) string {
	return base64.RawURLEncoding.EncodeToString([]byte("o:" + strconv.Itoa(n)))
}

// idParam parses {id}; an invalid id is answered with 404.
func idParam(w http.ResponseWriter, r *http.Request, what string) (bson.ObjectID, bool) {
	oid, err := bson.ObjectIDFromHex(chi.URLParam(r, "id"))
	if err != nil {
		httpx.NotFound(w, what)
		return oid, false
	}
	return oid, true
}

package httpapi

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"chatfrog/api/internal/auth"
	"chatfrog/api/internal/httpx"
	"chatfrog/api/internal/store"
)

type adminUser struct {
	store.UserJSON
	MessageCount int64 `json:"message_count"`
	ImageCount   int64 `json:"image_count"`
}

func (s *Server) adminUsers(r *http.Request, users []store.User) ([]adminUser, error) {
	ids := make([]bson.ObjectID, len(users))
	for i := range users {
		ids[i] = users[i].ID
	}
	msgs, imgs, err := s.store.UserCounts(r.Context(), ids)
	if err != nil {
		return nil, err
	}
	out := make([]adminUser, len(users))
	for i := range users {
		out[i] = adminUser{UserJSON: users[i].JSON(), MessageCount: msgs[users[i].ID], ImageCount: imgs[users[i].ID]}
	}
	return out, nil
}

func (s *Server) listUsers(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	status := q.Get("status")
	switch status {
	case "", store.StatusPending, store.StatusActive, store.StatusBlocked:
	default:
		httpx.BadRequest(w, "status không hợp lệ")
		return
	}
	limit := limitParam(r, 50, 100)
	offset := offsetCursor(r)
	users, more, err := s.store.ListUsers(r.Context(), status, strings.TrimSpace(q.Get("q")), offset, limit)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	items, err := s.adminUsers(r, users)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	next := ""
	if more {
		next = encodeOffset(offset + limit)
	}
	httpx.JSON(w, http.StatusOK, newPage(items, next))
}

func (s *Server) updateUser(w http.ResponseWriter, r *http.Request) {
	id, ok := idParam(w, r, "người dùng")
	if !ok {
		return
	}
	var body struct {
		Status *string `json:"status"`
		Role   *string `json:"role"`
	}
	if httpx.Decode(w, r, &body, 4<<10) != nil {
		return
	}
	me := auth.UserFrom(r.Context())
	set := bson.M{}
	if body.Status != nil {
		if *body.Status != store.StatusActive && *body.Status != store.StatusBlocked {
			httpx.BadRequest(w, "status không hợp lệ")
			return
		}
		set["status"] = *body.Status
	}
	if body.Role != nil {
		if *body.Role != store.RoleUser && *body.Role != store.RoleAdmin {
			httpx.BadRequest(w, "role không hợp lệ")
			return
		}
		set["role"] = *body.Role
	}
	if id == me.ID && (set["status"] == store.StatusBlocked || set["role"] == store.RoleUser) {
		httpx.BadRequest(w, "Không thể tự chặn hoặc hạ quyền chính mình")
		return
	}

	var u *store.User
	var err error
	if len(set) == 0 {
		u, err = s.store.GetUser(r.Context(), id)
	} else {
		u, err = s.store.UpdateUser(r.Context(), id, set)
	}
	if errors.Is(err, store.ErrNotFound) {
		httpx.NotFound(w, "người dùng")
		return
	}
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	if len(set) > 0 {
		if u.Status == store.StatusBlocked {
			if err := s.store.DeleteUserSessions(r.Context(), u.ID); err != nil {
				httpx.Internal(w, r, err)
				return
			}
		}
		if err := s.store.Audit(r.Context(), me.ID, "user.update", u.ID, set); err != nil {
			httpx.Internal(w, r, err)
			return
		}
	}
	items, err := s.adminUsers(r, []store.User{*u})
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, items[0])
}

// GET /api/admin/stats?from=2026-10-01&to=2026-10-21 (default: last 30 days, max 366).
func (s *Server) stats(w http.ResponseWriter, r *http.Request) {
	loc := s.cfg.StatsTimezone
	parse := func(v string, def time.Time) (time.Time, bool) {
		if v == "" {
			return def, true
		}
		t, err := time.ParseInLocation("2006-01-02", v, loc)
		return t, err == nil
	}
	today := time.Now().In(loc)
	to, ok1 := parse(r.URL.Query().Get("to"), today)
	from, ok2 := parse(r.URL.Query().Get("from"), to.AddDate(0, 0, -29))
	if !ok1 || !ok2 || from.After(to) || to.Sub(from) > 366*24*time.Hour {
		httpx.BadRequest(w, "Khoảng thời gian không hợp lệ")
		return
	}
	days, err := s.store.DailyStats(r.Context(), from, to, loc)
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	totals, err := s.store.Totals(r.Context())
	if err != nil {
		httpx.Internal(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"days": days, "totals": totals})
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	httpx.JSON(w, http.StatusOK, s.monitor.Check(r.Context()))
}

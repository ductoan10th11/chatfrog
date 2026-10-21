// Package auth implements Google sign-in (OIDC, Authorization Code + PKCE) and cookie sessions.
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"go.mongodb.org/mongo-driver/v2/bson"
	"golang.org/x/oauth2"

	"chatfrog/api/internal/config"
	"chatfrog/api/internal/httpx"
	"chatfrog/api/internal/store"
)

const (
	SessionCookie = "cf_session"
	oauthCookie   = "cf_oauth"
	googleIssuer  = "https://accounts.google.com"
)

type Service struct {
	cfg   *config.Config
	store *store.Store

	mu       sync.Mutex
	verifier *oidc.IDTokenVerifier
	oauth    *oauth2.Config
}

func New(cfg *config.Config, st *store.Store) *Service {
	return &Service{cfg: cfg, store: st}
}

// provider discovers Google's endpoints on first use, so a network hiccup at startup
// does not keep the api down.
func (s *Service) provider(ctx context.Context) (*oauth2.Config, *oidc.IDTokenVerifier, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.oauth != nil {
		return s.oauth, s.verifier, nil
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	p, err := oidc.NewProvider(ctx, googleIssuer)
	if err != nil {
		return nil, nil, err
	}
	s.oauth = &oauth2.Config{
		ClientID:     s.cfg.GoogleClientID,
		ClientSecret: s.cfg.GoogleClientSecret,
		RedirectURL:  s.cfg.GoogleCallbackURL,
		Endpoint:     p.Endpoint(),
		Scopes:       []string{oidc.ScopeOpenID, "email", "profile"},
	}
	s.verifier = p.Verifier(&oidc.Config{ClientID: s.cfg.GoogleClientID})
	return s.oauth, s.verifier, nil
}

type oauthState struct {
	State    string `json:"s"`
	Nonce    string `json:"n"`
	Verifier string `json:"v"`
	Redirect string `json:"r"`
}

// Login: GET /api/auth/google/login?redirect=/c/abc
func (s *Service) Login(w http.ResponseWriter, r *http.Request) {
	oc, _, err := s.provider(r.Context())
	if err != nil {
		slog.ErrorContext(r.Context(), "oidc discovery", "err", err)
		http.Redirect(w, r, "/login?error=google_unavailable", http.StatusFound)
		return
	}
	st := oauthState{
		State:    randomToken(16),
		Nonce:    randomToken(16),
		Verifier: oauth2.GenerateVerifier(),
		Redirect: SafeRedirect(r.URL.Query().Get("redirect")),
	}
	raw, _ := json.Marshal(st)
	http.SetCookie(w, &http.Cookie{
		Name:     oauthCookie,
		Value:    base64.RawURLEncoding.EncodeToString(raw),
		Path:     "/",
		MaxAge:   600,
		HttpOnly: true,
		Secure:   s.cfg.CookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
	authURL := oc.AuthCodeURL(st.State,
		oidc.Nonce(st.Nonce),
		oauth2.S256ChallengeOption(st.Verifier),
		oauth2.SetAuthURLParam("prompt", "select_account"),
	)
	http.Redirect(w, r, authURL, http.StatusFound)
}

// Callback: Google redirects here with ?code&state.
func (s *Service) Callback(w http.ResponseWriter, r *http.Request) {
	fail := func(reason string, err error) {
		if err != nil {
			slog.WarnContext(r.Context(), "google callback", "reason", reason, "err", err)
		}
		http.Redirect(w, r, "/login?error="+url.QueryEscape(reason), http.StatusFound)
	}
	http.SetCookie(w, &http.Cookie{Name: oauthCookie, Value: "", Path: "/", MaxAge: -1,
		HttpOnly: true, Secure: s.cfg.CookieSecure, SameSite: http.SameSiteLaxMode})

	q := r.URL.Query()
	if e := q.Get("error"); e != "" {
		fail("access_denied", nil)
		return
	}
	c, err := r.Cookie(oauthCookie)
	if err != nil {
		fail("state_missing", err)
		return
	}
	var st oauthState
	raw, err := base64.RawURLEncoding.DecodeString(c.Value)
	if err == nil {
		err = json.Unmarshal(raw, &st)
	}
	if err != nil || st.State == "" || subtle.ConstantTimeCompare([]byte(st.State), []byte(q.Get("state"))) != 1 {
		fail("state_mismatch", err)
		return
	}

	oc, verifier, err := s.provider(r.Context())
	if err != nil {
		fail("google_unavailable", err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	tok, err := oc.Exchange(ctx, q.Get("code"), oauth2.VerifierOption(st.Verifier))
	if err != nil {
		fail("exchange_failed", err)
		return
	}
	rawID, _ := tok.Extra("id_token").(string)
	idTok, err := verifier.Verify(ctx, rawID)
	if err != nil {
		fail("invalid_token", err)
		return
	}
	if subtle.ConstantTimeCompare([]byte(idTok.Nonce), []byte(st.Nonce)) != 1 {
		fail("invalid_token", errors.New("nonce mismatch"))
		return
	}
	var claims struct {
		Email         string `json:"email"`
		EmailVerified bool   `json:"email_verified"`
		Name          string `json:"name"`
		Picture       string `json:"picture"`
	}
	if err := idTok.Claims(&claims); err != nil {
		fail("invalid_token", err)
		return
	}
	if !claims.EmailVerified || claims.Email == "" {
		fail("email_unverified", nil)
		return
	}

	user, err := s.upsertUser(ctx, idTok.Subject, strings.ToLower(claims.Email), claims.Name, claims.Picture)
	if err != nil {
		fail("internal", err)
		return
	}
	if err := s.startSession(ctx, w, r, user.ID); err != nil {
		fail("internal", err)
		return
	}
	slog.InfoContext(r.Context(), "login", "user", user.ID.Hex(), "status", user.Status)
	dest := st.Redirect
	if user.Status != store.StatusActive {
		dest = "/pending"
	}
	http.Redirect(w, r, dest, http.StatusFound)
}

// upsertUser applies the bootstrap rules: ADMIN_EMAILS → active admin, ALLOWED_EMAILS → active.
func (s *Service) upsertUser(ctx context.Context, sub, email, name, picture string) (*store.User, error) {
	isAdmin := s.cfg.AdminEmails[email]
	isAllowed := s.cfg.AllowedEmails[email]
	now := time.Now().UTC()

	u, err := s.store.FindUserByGoogle(ctx, sub, email)
	if errors.Is(err, store.ErrNotFound) {
		u = &store.User{
			GoogleSub: sub, Email: email, Name: name, AvatarURL: picture,
			Role: store.RoleUser, Status: store.StatusPending,
			Settings:    store.Settings{Theme: "system"},
			LastLoginAt: now,
		}
		if isAdmin {
			u.Role, u.Status = store.RoleAdmin, store.StatusActive
		} else if isAllowed {
			u.Status = store.StatusActive
		}
		return u, s.store.CreateUser(ctx, u)
	}
	if err != nil {
		return nil, err
	}
	set := bson.M{"google_sub": sub, "email": email, "name": name, "avatar_url": picture, "last_login_at": now}
	switch {
	case isAdmin:
		set["role"], set["status"] = store.RoleAdmin, store.StatusActive
	case isAllowed && u.Status == store.StatusPending:
		set["status"] = store.StatusActive
	}
	return s.store.UpdateUser(ctx, u.ID, set)
}

func (s *Service) startSession(ctx context.Context, w http.ResponseWriter, r *http.Request, userID bson.ObjectID) error {
	token := randomToken(32)
	sess := &store.Session{
		TokenHash: hashToken(token),
		UserID:    userID,
		UserAgent: truncate(r.UserAgent(), 300),
		IP:        httpx.ClientIP(r),
		ExpiresAt: time.Now().Add(s.cfg.SessionTTL).UTC(),
	}
	if err := s.store.CreateSession(ctx, sess); err != nil {
		return err
	}
	s.setSessionCookie(w, token)
	return nil
}

func (s *Service) setSessionCookie(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     SessionCookie,
		Value:    token,
		Path:     "/",
		MaxAge:   int(s.cfg.SessionTTL.Seconds()),
		HttpOnly: true,
		Secure:   s.cfg.CookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
}

// Logout: POST /api/auth/logout
func (s *Service) Logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(SessionCookie); err == nil && c.Value != "" {
		if err := s.store.DeleteSession(r.Context(), hashToken(c.Value)); err != nil {
			httpx.Internal(w, r, err)
			return
		}
	}
	http.SetCookie(w, &http.Cookie{Name: SessionCookie, Value: "", Path: "/", MaxAge: -1,
		HttpOnly: true, Secure: s.cfg.CookieSecure, SameSite: http.SameSiteLaxMode})
	w.WriteHeader(http.StatusNoContent)
}

/* ---------------------------------------------------------------- middleware */

type ctxKey struct{}

func UserFrom(ctx context.Context) *store.User {
	u, _ := ctx.Value(ctxKey{}).(*store.User)
	return u
}

// Session loads the signed-in user (if any) and slides the session expiry.
func (s *Service) Session(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(SessionCookie)
		if err != nil || c.Value == "" {
			next.ServeHTTP(w, r)
			return
		}
		ctx := r.Context()
		sess, err := s.store.GetSession(ctx, hashToken(c.Value))
		if err != nil {
			if !errors.Is(err, store.ErrNotFound) {
				httpx.Internal(w, r, err)
				return
			}
			next.ServeHTTP(w, r)
			return
		}
		user, err := s.store.GetUser(ctx, sess.UserID)
		if err != nil {
			if !errors.Is(err, store.ErrNotFound) {
				httpx.Internal(w, r, err)
				return
			}
			next.ServeHTTP(w, r)
			return
		}
		// Sliding expiry, written at most once per half TTL.
		if time.Until(sess.ExpiresAt) < s.cfg.SessionTTL/2 {
			if err := s.store.ExtendSession(ctx, sess.ID, time.Now().Add(s.cfg.SessionTTL).UTC()); err == nil {
				s.setSessionCookie(w, c.Value)
			}
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(ctx, ctxKey{}, user)))
	})
}

func RequireUser(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if UserFrom(r.Context()) == nil {
			httpx.Error(w, http.StatusUnauthorized, "unauthenticated", "Bạn cần đăng nhập")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RequireActive rejects pending / blocked accounts.
func RequireActive(next http.Handler) http.Handler {
	return RequireUser(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch UserFrom(r.Context()).Status {
		case store.StatusActive:
			next.ServeHTTP(w, r)
		case store.StatusBlocked:
			httpx.Error(w, http.StatusForbidden, "account_blocked", "Tài khoản đã bị chặn")
		default:
			httpx.Error(w, http.StatusForbidden, "account_pending", "Tài khoản đang chờ duyệt")
		}
	}))
}

func RequireAdmin(next http.Handler) http.Handler {
	return RequireActive(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if UserFrom(r.Context()).Role != store.RoleAdmin {
			httpx.Error(w, http.StatusForbidden, "forbidden", "Bạn không có quyền")
			return
		}
		next.ServeHTTP(w, r)
	}))
}

/* ---------------------------------------------------------------- helpers */

// SafeRedirect only accepts same-origin relative paths.
func SafeRedirect(v string) string {
	if v == "" || !strings.HasPrefix(v, "/") || strings.HasPrefix(v, "//") || strings.Contains(v, `\`) {
		return "/"
	}
	return v
}

func randomToken(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

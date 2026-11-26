// Package config reads the api configuration from environment variables (see docs/SPEC.md §9).
package config

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

// LLMProfile is one LLM server/model, configured by <PROFILE>_BASE_URL, _API_KEY, _LLM_MODEL,
// _LLM_CONTEXT_TOKENS, _LLM_MAX_OUTPUT_TOKENS, _LLM_VISION, _VISION_MAX_PX.
type LLMProfile struct {
	Key, Profile, BaseURL, APIKey, Model string
	ContextTokens, MaxOutputTokens       int
	Vision                               bool
	VisionMaxPx                          int
}

// ImageProfile is one image server/model: <PROFILE>_IMAGE_MODEL, _IMAGE_MAX_CONCURRENCY, _IMAGE_TIMEOUT.
type ImageProfile struct {
	Key, Profile, BaseURL, APIKey, Model string
	MaxConcurrency                       int
	Timeout                              time.Duration
}

type Config struct {
	AppOrigin string
	HTTPAddr  string

	MongoURI string
	MongoDB  string

	GoogleClientID     string
	GoogleClientSecret string
	GoogleCallbackURL  string
	AdminEmails        map[string]bool
	AllowedEmails      map[string]bool
	SessionTTL         time.Duration
	CookieSecure       bool

	// Profiles in default order (cloud first). One LLM and one image model are on at a time.
	LLMs   []LLMProfile
	Images []ImageProfile

	LLMMaxConcurrency int
	// LLMReasoningEffort is sent as `reasoning_effort`; "none" disables thinking.
	LLMReasoningEffort string
	// ImageMaxConcurrency is the largest IMAGE_MAX_CONCURRENCY of any profile.
	ImageMaxConcurrency int

	FilesDir        string
	MaxUploadBytes  int64
	DocMaxChars     int
	MaxMessageChars int
	StatsTimezone   *time.Location
}

// Load reads the environment. Names from docs/SPEC.md are accepted alongside the short
// names used in .env (API_PORT, BASE_URL, API_KEY, GG_*).
func Load() (*Config, error) {
	var errs []error
	c := &Config{}

	c.HTTPAddr = env("HTTP_ADDR", "")
	if c.HTTPAddr == "" {
		c.HTTPAddr = ":" + env("API_PORT", "9260")
	}

	c.MongoURI = env("MONGO_URI", "")
	if c.MongoURI == "" {
		errs = append(errs, errors.New("MONGO_URI is required"))
	}
	c.MongoDB = env("MONGO_DB", dbFromURI(c.MongoURI))

	c.GoogleClientID = env("GG_CLIENT_ID", env("GOOGLE_CLIENT_ID", ""))
	c.GoogleClientSecret = env("GG_CLIENT_SECRET", env("GOOGLE_CLIENT_SECRET", ""))
	c.GoogleCallbackURL = env("GG_CALLBACK_URL", env("GOOGLE_CALLBACK_URL", ""))
	if c.GoogleClientID == "" || c.GoogleClientSecret == "" || c.GoogleCallbackURL == "" {
		errs = append(errs, errors.New("GG_CLIENT_ID, GG_CLIENT_SECRET and GG_CALLBACK_URL are required"))
	}

	c.AppOrigin = strings.TrimRight(env("APP_ORIGIN", originOf(c.GoogleCallbackURL)), "/")
	if c.AppOrigin == "" {
		errs = append(errs, errors.New("APP_ORIGIN is required (or derivable from GG_CALLBACK_URL)"))
	}
	c.CookieSecure = boolEnv("COOKIE_SECURE", strings.HasPrefix(c.AppOrigin, "https://"), &errs)
	c.AdminEmails = emailSet(env("ADMIN_EMAILS", ""))
	c.AllowedEmails = emailSet(env("ALLOWED_EMAILS", ""))
	c.SessionTTL = durationEnv("SESSION_TTL", 720*time.Hour, &errs)

	for _, prof := range []string{"cloud", "local"} {
		P := strings.ToUpper(prof) + "_"
		base := strings.TrimRight(env(P+"BASE_URL", ""), "/")
		key := env(P+"API_KEY", "none")
		if m := env(P+"LLM_MODEL", ""); m != "" && base != "" {
			l := LLMProfile{Key: "llm_" + prof, Profile: prof, BaseURL: base, APIKey: key, Model: m,
				ContextTokens:   intEnv(P+"LLM_CONTEXT_TOKENS", 32768, &errs),
				MaxOutputTokens: intEnv(P+"LLM_MAX_OUTPUT_TOKENS", 4096, &errs),
				Vision:          boolEnv(P+"LLM_VISION", true, &errs),
				VisionMaxPx:     intEnv(P+"VISION_MAX_PX", 1024, &errs)}
			if l.ContextTokens <= l.MaxOutputTokens {
				errs = append(errs, fmt.Errorf("%sLLM_CONTEXT_TOKENS must be greater than %sLLM_MAX_OUTPUT_TOKENS", P, P))
			}
			c.LLMs = append(c.LLMs, l)
		}
		if m := env(P+"IMAGE_MODEL", ""); m != "" && base != "" {
			im := ImageProfile{Key: "image_" + prof, Profile: prof, BaseURL: base, APIKey: key, Model: m,
				MaxConcurrency: intEnv(P+"IMAGE_MAX_CONCURRENCY", 1, &errs),
				Timeout:        durationEnv(P+"IMAGE_TIMEOUT", 180*time.Second, &errs)}
			if im.MaxConcurrency < 1 {
				errs = append(errs, fmt.Errorf("%sIMAGE_MAX_CONCURRENCY must be >= 1", P))
			}
			c.ImageMaxConcurrency = max(c.ImageMaxConcurrency, im.MaxConcurrency)
			c.Images = append(c.Images, im)
		}
	}
	if len(c.LLMs) == 0 {
		errs = append(errs, errors.New("set CLOUD_ or LOCAL_ BASE_URL and LLM_MODEL (e.g. CLOUD_LLM_MODEL)"))
	}
	if len(c.Images) == 0 {
		errs = append(errs, errors.New("set CLOUD_ or LOCAL_ BASE_URL and IMAGE_MODEL (e.g. CLOUD_IMAGE_MODEL)"))
	}
	c.LLMMaxConcurrency = intEnv("LLM_MAX_CONCURRENCY", 2, &errs)
	c.LLMReasoningEffort = env("LLM_REASONING_EFFORT", "low")

	c.FilesDir = env("FILES_DIR", "./data/files")
	c.MaxUploadBytes = int64(intEnv("MAX_UPLOAD_MB", 20, &errs)) << 20
	c.DocMaxChars = intEnv("DOC_MAX_CHARS", 24000, &errs)
	c.MaxMessageChars = intEnv("MAX_MESSAGE_CHARS", 16000, &errs)

	tz, err := time.LoadLocation(env("STATS_TZ", "Asia/Ho_Chi_Minh"))
	if err != nil {
		errs = append(errs, fmt.Errorf("STATS_TZ: %w", err))
	}
	c.StatsTimezone = tz

	if c.LLMMaxConcurrency < 1 {
		errs = append(errs, errors.New("LLM_MAX_CONCURRENCY must be >= 1"))
	}
	return c, errors.Join(errs...)
}

// CallbackPath is the path of GG_CALLBACK_URL, mounted in addition to /api/auth/google/callback.
func (c *Config) CallbackPath() string {
	u, err := url.Parse(c.GoogleCallbackURL)
	if err != nil {
		return ""
	}
	return u.Path
}

func env(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && strings.TrimSpace(v) != "" {
		return strings.TrimSpace(v)
	}
	return fallback
}

func intEnv(key string, fallback int, errs *[]error) int {
	v := env(key, "")
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		*errs = append(*errs, fmt.Errorf("%s: %w", key, err))
		return fallback
	}
	return n
}

func boolEnv(key string, fallback bool, errs *[]error) bool {
	v := env(key, "")
	if v == "" {
		return fallback
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		*errs = append(*errs, fmt.Errorf("%s: %w", key, err))
		return fallback
	}
	return b
}

func durationEnv(key string, fallback time.Duration, errs *[]error) time.Duration {
	v := env(key, "")
	if v == "" {
		return fallback
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		*errs = append(*errs, fmt.Errorf("%s: %w", key, err))
		return fallback
	}
	return d
}

func emailSet(list string) map[string]bool {
	set := map[string]bool{}
	for _, e := range strings.Split(list, ",") {
		if e = strings.ToLower(strings.TrimSpace(e)); e != "" {
			set[e] = true
		}
	}
	return set
}

func originOf(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return ""
	}
	return u.Scheme + "://" + u.Host
}

func dbFromURI(uri string) string {
	u, err := url.Parse(uri)
	if err == nil {
		if name := strings.Trim(u.Path, "/"); name != "" {
			return name
		}
	}
	return "chatfrog"
}

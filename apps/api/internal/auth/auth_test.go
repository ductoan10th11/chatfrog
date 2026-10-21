package auth

import "testing"

func TestSafeRedirect(t *testing.T) {
	cases := map[string]string{
		"":                    "/",
		"/c/abc":              "/c/abc",
		"//evil.com":          "/",
		"https://evil.com":    "/",
		`/\evil.com`:          "/",
		"/settings?tab=theme": "/settings?tab=theme",
	}
	for in, want := range cases {
		if got := SafeRedirect(in); got != want {
			t.Errorf("SafeRedirect(%q) = %q, want %q", in, got, want)
		}
	}
}

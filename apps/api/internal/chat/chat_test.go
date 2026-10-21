package chat

import (
	"context"
	"strings"
	"testing"
	"time"

	"chatfrog/api/internal/provider"
	"chatfrog/api/internal/store"
)

func TestLimiterQueuePositions(t *testing.T) {
	l := NewLimiter(1)
	release1, err := l.Acquire(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}

	positions := make(chan int, 10)
	got2 := make(chan func())
	go func() {
		r, _ := l.Acquire(context.Background(), func(p int) { positions <- p })
		got2 <- r
	}()
	if p := <-positions; p != 1 {
		t.Fatalf("first waiter position = %d", p)
	}

	ctx3, cancel3 := context.WithCancel(context.Background())
	errs3 := make(chan error)
	go func() {
		_, err := l.Acquire(ctx3, func(p int) { positions <- 100 + p })
		errs3 <- err
	}()
	if p := <-positions; p != 102 {
		t.Fatalf("second waiter position = %d", p)
	}

	cancel3()
	if err := <-errs3; err == nil {
		t.Fatal("cancelled waiter should fail")
	}
	release1()
	select {
	case r := <-got2:
		r()
		r() // idempotent
	case <-time.After(time.Second):
		t.Fatal("waiter not granted")
	}
	// Both slots are back: one acquire must succeed immediately.
	r, err := l.Acquire(context.Background(), func(int) { t.Error("should not queue") })
	if err != nil {
		t.Fatal(err)
	}
	r()
}

func TestTrimToBudget(t *testing.T) {
	long := strings.Repeat("a", 1000) // ~400 tokens
	msgs := []provider.ChatMessage{
		{Role: "user", Content: long},
		{Role: "assistant", Content: long},
		{Role: "user", Content: long},
		{Role: "assistant", Content: long},
		{Role: "user", Content: "hi"},
	}
	got := trimToBudget(msgs, 900)
	if len(got) != 3 || got[0].Role != "user" {
		t.Fatalf("got %d messages starting with %s", len(got), got[0].Role)
	}
	// The last message is always kept, even over budget.
	if got := trimToBudget(msgs[:1], 10); len(got) != 1 {
		t.Fatalf("last message dropped")
	}
}

func TestAssistantText(t *testing.T) {
	m := &store.Message{Parts: []store.Part{
		{Type: store.PartReasoning, Text: "secret"},
		{Type: store.PartText, Text: "Mình sẽ vẽ."},
		{Type: store.PartToolCall, Status: store.ToolDone, Result: &store.ToolResult{File: store.FileRef{ID: "abc"}}},
		{Type: store.PartToolCall, Status: store.ToolError, Error: "timeout"},
	}}
	want := "Mình sẽ vẽ.\n\n[image id=abc]\n\n[Tạo ảnh thất bại: timeout]"
	if got := assistantText(m); got != want {
		t.Errorf("got %q", got)
	}
}

func TestCleanTitle(t *testing.T) {
	cases := map[string]string{
		"\"Vẽ chú ếch xanh\"\n":    "Vẽ chú ếch xanh",
		"Tiêu đề: Học Go cơ bản.":  "Học Go cơ bản",
		"\n\n**Kế hoạch du lịch**": "Kế hoạch du lịch",
		"":                         "",
	}
	for in, want := range cases {
		if got := cleanTitle(in); got != want {
			t.Errorf("cleanTitle(%q) = %q, want %q", in, got, want)
		}
	}
	if got := fallbackTitle(strings.Repeat("ab ", 40)); len([]rune(got)) > 60 {
		t.Errorf("fallback too long: %q", got)
	}
}

func TestCleanReply(t *testing.T) {
	cases := map[string]string{
		"[Tôi đã tạo cho bạn bức ảnh về một con mèo màu cam đang ngồi trên ghế sofa].": "Tôi đã tạo cho bạn bức ảnh về một con mèo màu cam đang ngồi trên ghế sofa.",
		"[abc]":    "abc",
		"[abc].":   "abc.",
		"\"abc\"":  "abc",
		"\"abc\".": "abc.",
		"“abc”":    "abc",
		"“abc”.":   "abc.",
		"[image id=6ad8f0e2c1]  Tôi đã tạo ảnh cho bạn.": "Tôi đã tạo ảnh cho bạn.",
		"[image id=6ad8f0e2c1] [Tôi đã tạo ảnh.]":        "Tôi đã tạo ảnh.",
		"Tôi đã tạo ảnh [beta] cho bạn.":                 "Tôi đã tạo ảnh [beta] cho bạn.",
		"[a [b] c]":                "a [b] c",
		"Tôi đã tạo ảnh.":          "Tôi đã tạo ảnh.",
		"  Tôi   đã\n tạo  ảnh.  ": "Tôi đã tạo ảnh.",
		"":                         "",
		"[a] và [b]":               "[a] và [b]",
		"\"a\" và \"b\"":           "\"a\" và \"b\"",
	}
	for in, want := range cases {
		if got := cleanReply(in); got != want {
			t.Errorf("cleanReply(%q) = %q, want %q", in, got, want)
		}
	}
}

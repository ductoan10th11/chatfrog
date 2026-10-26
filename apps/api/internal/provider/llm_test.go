package provider

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestThinkSplitter(t *testing.T) {
	chunks := []string{"Hi <th", "ink>step 1", " step 2</thi", "nk>\n\nAnswer", " done<"}
	var ts thinkSplitter
	var r, c strings.Builder
	for _, ch := range chunks {
		a, b := ts.feed(ch)
		r.WriteString(a)
		c.WriteString(b)
	}
	a, b := ts.flush()
	r.WriteString(a)
	c.WriteString(b)
	if got := r.String(); got != "step 1 step 2" {
		t.Errorf("reasoning = %q", got)
	}
	if got := c.String(); got != "Hi \n\nAnswer done<" {
		t.Errorf("content = %q", got)
	}
}

func sseServer(t *testing.T, lines []string, check func(body map[string]any)) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer k" {
			t.Errorf("missing auth header")
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		if check != nil {
			check(body)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		for _, l := range lines {
			fmt.Fprintf(w, "data: %s\n\n", l)
		}
	}))
}

func TestStreamChatOllamaReasoningAndTools(t *testing.T) {
	srv := sseServer(t, []string{
		`{"choices":[{"delta":{"role":"assistant","content":"","reasoning":"Think"}}]}`,
		`{"choices":[{"delta":{"content":"","reasoning":"ing"}}]}`,
		`{"choices":[{"delta":{"content":"Mình sẽ vẽ."}}]}`,
		`{"choices":[{"delta":{"tool_calls":[{"id":"call_1","index":0,"type":"function","function":{"name":"generate_image","arguments":"{\"prompt\":"}}]}}]}`,
		`{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"a frog\"}"}}]}}]}`,
		`{"choices":[{"delta":{},"finish_reason":"tool_calls"}]}`,
		`{"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5}}`,
		`[DONE]`,
	}, func(body map[string]any) {
		if body["reasoning_effort"] != "low" || body["stream"] != true {
			t.Errorf("unexpected body: %v", body)
		}
	})
	defer srv.Close()

	llm := NewLLM(srv.URL, "k", "m")
	var deltas []Delta
	var announced []string
	res, err := llm.StreamChat(context.Background(), ChatRequest{
		ReasoningEffort: "low",
		OnToolCall:      func(name string) { announced = append(announced, name) },
	}, func(d Delta) { deltas = append(deltas, d) })
	if err != nil {
		t.Fatal(err)
	}
	if len(announced) != 1 || announced[0] != "generate_image" {
		t.Errorf("OnToolCall = %v, want one call announced once", announced)
	}
	if res.Reasoning != "Thinking" || res.Content != "Mình sẽ vẽ." {
		t.Errorf("reasoning=%q content=%q", res.Reasoning, res.Content)
	}
	if len(res.ToolCalls) != 1 || res.ToolCalls[0].ID != "call_1" || res.ToolCalls[0].Function.Arguments != `{"prompt":"a frog"}` {
		t.Errorf("tool calls = %+v", res.ToolCalls)
	}
	if res.FinishReason != "tool_calls" || res.Usage == nil || res.Usage.CompletionTokens != 5 {
		t.Errorf("finish=%q usage=%+v", res.FinishReason, res.Usage)
	}
	if len(deltas) != 3 {
		t.Errorf("deltas = %+v", deltas)
	}
}

func TestStreamChatDisableThinking(t *testing.T) {
	srv := sseServer(t, []string{`{"choices":[{"delta":{"reasoning_content":"r","content":"x"},"finish_reason":"stop"}]}`},
		func(body map[string]any) {
			kw, _ := body["chat_template_kwargs"].(map[string]any)
			if body["reasoning_effort"] != "none" || kw["enable_thinking"] != false {
				t.Errorf("thinking not disabled: %v", body)
			}
		})
	defer srv.Close()
	res, err := NewLLM(srv.URL, "k", "m").StreamChat(context.Background(), ChatRequest{ReasoningEffort: "none"}, func(Delta) {})
	if err != nil {
		t.Fatal(err)
	}
	if res.Reasoning != "r" || res.Content != "x" || res.FinishReason != "stop" {
		t.Errorf("%+v", res)
	}
}

func TestStreamChatHTTPError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "boom", http.StatusServiceUnavailable)
	}))
	defer srv.Close()
	_, err := NewLLM(srv.URL, "k", "m").StreamChat(context.Background(), ChatRequest{}, func(Delta) {})
	if !IsUnavailable(err) {
		t.Fatalf("want unavailable, got %v", err)
	}
}

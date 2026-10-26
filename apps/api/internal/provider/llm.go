package provider

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"sort"
	"strings"
)

type LLM struct{ client }

func NewLLM(baseURL, apiKey, model string) *LLM {
	return &LLM{newClient(baseURL, apiKey, model)}
}

type chatBody struct {
	Model              string         `json:"model"`
	Messages           []ChatMessage  `json:"messages"`
	Tools              []Tool         `json:"tools,omitempty"`
	Stream             bool           `json:"stream"`
	StreamOptions      map[string]any `json:"stream_options,omitempty"`
	MaxTokens          int            `json:"max_tokens,omitempty"`
	ReasoningEffort    string         `json:"reasoning_effort,omitempty"`
	ChatTemplateKwargs map[string]any `json:"chat_template_kwargs,omitempty"`
}

type streamChunk struct {
	Choices []struct {
		Delta struct {
			Content          string `json:"content"`
			Reasoning        string `json:"reasoning"`
			ReasoningContent string `json:"reasoning_content"`
			ToolCalls        []struct {
				Index    int    `json:"index"`
				ID       string `json:"id"`
				Function struct {
					Name      string `json:"name"`
					Arguments string `json:"arguments"`
				} `json:"function"`
			} `json:"tool_calls"`
		} `json:"delta"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Usage *Usage `json:"usage"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

func (l *LLM) StreamChat(ctx context.Context, req ChatRequest, onDelta func(Delta)) (*ChatResult, error) {
	body := chatBody{
		Model:           l.model,
		Messages:        req.Messages,
		Tools:           req.Tools,
		Stream:          true,
		StreamOptions:   map[string]any{"include_usage": true},
		MaxTokens:       req.MaxTokens,
		ReasoningEffort: req.ReasoningEffort,
	}
	if req.ReasoningEffort == "none" {
		// llama.cpp / vLLM ignore reasoning_effort; Qwen templates read this instead.
		body.ChatTemplateKwargs = map[string]any{"enable_thinking": false}
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, l.baseURL+"/chat/completions", bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")
	res, err := l.do(httpReq)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()

	result := &ChatResult{}
	var content, reasoning strings.Builder
	type partialCall struct {
		id, name string
		args     strings.Builder
	}
	calls := map[int]*partialCall{}
	think := &thinkSplitter{}
	emit := func(d Delta) {
		if d.Reasoning == "" && d.Content == "" {
			return
		}
		reasoning.WriteString(d.Reasoning)
		content.WriteString(d.Content)
		onDelta(d)
	}

	reader := bufio.NewReaderSize(res.Body, 64*1024)
read:
	for {
		line, readErr := reader.ReadString('\n')
		if readErr != nil && !errors.Is(readErr, io.EOF) {
			return result, readErr
		}
		eof := readErr != nil
		data, ok := strings.CutPrefix(strings.TrimSpace(line), "data:")
		data = strings.TrimSpace(data)
		var chunk streamChunk
		switch {
		case data == "[DONE]":
			break read
		case !ok || json.Unmarshal([]byte(data), &chunk) != nil:
			if eof {
				break read
			}
			continue
		}
		if chunk.Error != nil {
			return result, &APIError{Status: http.StatusBadGateway, Body: chunk.Error.Message}
		}
		if chunk.Usage != nil {
			result.Usage = chunk.Usage
		}
		for _, choice := range chunk.Choices {
			d := choice.Delta
			r := d.Reasoning + d.ReasoningContent
			r2, c := think.feed(d.Content)
			emit(Delta{Reasoning: r + r2, Content: c})
			for _, tc := range d.ToolCalls {
				pc := calls[tc.Index]
				if pc == nil {
					pc = &partialCall{}
					calls[tc.Index] = pc
				}
				if tc.ID != "" {
					pc.id = tc.ID
				}
				if tc.Function.Name != "" {
					if pc.name == "" && req.OnToolCall != nil {
						req.OnToolCall(tc.Function.Name)
					}
					pc.name = tc.Function.Name
				}
				pc.args.WriteString(tc.Function.Arguments)
			}
			if choice.FinishReason != "" {
				result.FinishReason = choice.FinishReason
			}
		}
		if eof {
			break
		}
	}
	r, c := think.flush()
	emit(Delta{Reasoning: r, Content: c})

	idx := make([]int, 0, len(calls))
	for i := range calls {
		idx = append(idx, i)
	}
	sort.Ints(idx)
	for _, i := range idx {
		pc := calls[i]
		result.ToolCalls = append(result.ToolCalls, ToolCall{
			ID: pc.id, Type: "function", Function: FunctionCall{Name: pc.name, Arguments: pc.args.String()},
		})
	}
	if len(result.ToolCalls) > 0 && result.FinishReason != "length" {
		result.FinishReason = "tool_calls"
	}
	result.Content = content.String()
	result.Reasoning = reasoning.String()
	return result, ctx.Err()
}

const (
	thinkOpen  = "<think>"
	thinkClose = "</think>"
)

// thinkSplitter separates `<think>…</think>` from streamed content, across chunk boundaries.
type thinkSplitter struct {
	inThink bool
	buf     string
}

func (t *thinkSplitter) feed(s string) (reasoning, content string) {
	t.buf += s
	var r, c strings.Builder
	for t.buf != "" {
		tag := thinkOpen
		if t.inThink {
			tag = thinkClose
		}
		out := &c
		if t.inThink {
			out = &r
		}
		if i := strings.Index(t.buf, tag); i >= 0 {
			out.WriteString(t.buf[:i])
			t.buf = t.buf[i+len(tag):]
			t.inThink = !t.inThink
			continue
		}
		// Keep a suffix that could be the start of the tag.
		keep := 0
		for k := min(len(tag)-1, len(t.buf)); k > 0; k-- {
			if strings.HasPrefix(tag, t.buf[len(t.buf)-k:]) {
				keep = k
				break
			}
		}
		out.WriteString(t.buf[:len(t.buf)-keep])
		t.buf = t.buf[len(t.buf)-keep:]
		break
	}
	return r.String(), c.String()
}

func (t *thinkSplitter) flush() (reasoning, content string) {
	rest := t.buf
	t.buf = ""
	if t.inThink {
		return rest, ""
	}
	return "", rest
}

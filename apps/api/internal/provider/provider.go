// Package provider talks to the OpenAI-compatible model servers (chat completions and images).
//
// It is a small hand-written client rather than openai-go: the gateway streams reasoning in
// non-standard fields (`reasoning` for Ollama, `reasoning_content` for llama.cpp / vLLM, or
// `<think>` tags inside `content`), which are easier to handle on raw JSON.
package provider

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type ContentPart struct {
	Type     string    `json:"type"`
	Text     string    `json:"text,omitempty"`
	ImageURL *ImageURL `json:"image_url,omitempty"`
}

type ImageURL struct {
	URL string `json:"url"`
}

// ChatMessage.Content is a string or []ContentPart.
type ChatMessage struct {
	Role       string     `json:"role"`
	Content    any        `json:"content"`
	ToolCalls  []ToolCall `json:"tool_calls,omitempty"`
	ToolCallID string     `json:"tool_call_id,omitempty"`
}

type ToolCall struct {
	ID       string       `json:"id"`
	Type     string       `json:"type"`
	Function FunctionCall `json:"function"`
}

type FunctionCall struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
}

type Tool struct {
	Type     string      `json:"type"`
	Function FunctionDef `json:"function"`
}

type FunctionDef struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Parameters  json.RawMessage `json:"parameters"`
}

type ChatRequest struct {
	Messages  []ChatMessage
	Tools     []Tool
	MaxTokens int
	// ReasoningEffort: "" leaves the server default, "none" disables thinking.
	ReasoningEffort string
}

type Delta struct {
	Reasoning string
	Content   string
}

type Usage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
}

type ChatResult struct {
	Content      string
	Reasoning    string
	ToolCalls    []ToolCall
	FinishReason string
	Usage        *Usage
}

type LLMProvider interface {
	// StreamChat streams one completion, calling onDelta for every reasoning/content piece.
	StreamChat(ctx context.Context, req ChatRequest, onDelta func(Delta)) (*ChatResult, error)
	Model() string
	Ping(ctx context.Context) error
}

type ImageInput struct {
	Name string
	Mime string
	Data []byte
}

type ImageProvider interface {
	Generate(ctx context.Context, prompt, size string) ([]byte, error)
	Edit(ctx context.Context, prompt, size string, images []ImageInput) ([]byte, error)
	Model() string
	Ping(ctx context.Context) error
}

// APIError is a non-2xx answer from a model server.
type APIError struct {
	Status int
	Body   string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("model server: HTTP %d: %s", e.Status, e.Body)
}

type client struct {
	baseURL string
	apiKey  string
	model   string
	http    *http.Client
}

func newClient(baseURL, apiKey, model string) client {
	return client{baseURL: strings.TrimRight(baseURL, "/"), apiKey: apiKey, model: model, http: &http.Client{}}
}

func (c *client) Model() string { return c.model }

func (c *client) do(req *http.Request) (*http.Response, error) {
	if c.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
	}
	res, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	if res.StatusCode/100 != 2 {
		defer res.Body.Close()
		body, _ := io.ReadAll(io.LimitReader(res.Body, 2048))
		return nil, &APIError{Status: res.StatusCode, Body: strings.TrimSpace(string(body))}
	}
	return res, nil
}

// Ping lists models and checks ours is served.
func (c *client) Ping(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/models", nil)
	if err != nil {
		return err
	}
	res, err := c.do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	var body struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		return fmt.Errorf("models: %w", err)
	}
	for _, m := range body.Data {
		if m.ID == c.model {
			return nil
		}
	}
	return fmt.Errorf("model %q is not served", c.model)
}

// IsUnavailable reports errors meaning the model server could not be reached or failed.
func IsUnavailable(err error) bool {
	if err == nil || errors.Is(err, context.Canceled) {
		return false
	}
	var apiErr *APIError
	if errors.As(err, &apiErr) {
		return apiErr.Status >= 500 || apiErr.Status == 404 || apiErr.Status == 429
	}
	return true
}

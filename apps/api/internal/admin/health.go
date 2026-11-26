// Package admin holds the health monitor and model switches behind /api/admin.
package admin

import (
	"context"
	"errors"
	"sync"
	"time"

	"chatfrog/api/internal/provider"
	"chatfrog/api/internal/store"
)

type ServiceHealth struct {
	Key       string    `json:"key"`
	Profile   string    `json:"profile"`
	OK        bool      `json:"ok"`
	LatencyMS *int64    `json:"latency_ms"`
	Model     string    `json:"model"`
	LastError *string   `json:"last_error"`
	CheckedAt time.Time `json:"checked_at"`
	Enabled   bool      `json:"enabled"`
}

type Health struct {
	LLMs   []ServiceHealth `json:"llms"`
	Images []ServiceHealth `json:"images"`
	Mongo  struct {
		OK bool `json:"ok"`
	} `json:"mongo"`
}

// LLMSpec is one LLM with its own limits. Key is "llm_<profile>".
type LLMSpec struct {
	Key, Profile string
	Provider     provider.LLMProvider
	Limits       provider.LLMLimits
}

// ImageSpec is one image model. Key is "image_<profile>".
type ImageSpec struct {
	Key, Profile string
	Provider     provider.ImageProvider
	Timeout      time.Duration
}

var ErrUnknownModel = errors.New("unknown model")
var ErrModelDisabled = errors.New("mô hình đang bị tắt")

type pinger interface {
	Ping(ctx context.Context) error
	Model() string
}

// Monitor remembers the last error seen by real calls, pings the servers on demand, and holds
// the admin switches (persisted in the store). Within the LLMs and within the images at most
// one model is on at a time; the first listed wins by default.
type Monitor struct {
	llms   []LLMSpec
	images []ImageSpec
	store  *store.Store

	mu       sync.Mutex
	lastErr  map[string]string
	disabled map[string]bool
}

func NewMonitor(llms []LLMSpec, images []ImageSpec, st *store.Store) *Monitor {
	return &Monitor{llms: llms, images: images, store: st, lastErr: map[string]string{}, disabled: map[string]bool{}}
}

func (m *Monitor) llmKeys() (k []string) {
	for _, l := range m.llms {
		k = append(k, l.Key)
	}
	return
}

func (m *Monitor) imageKeys() (k []string) {
	for _, i := range m.images {
		k = append(k, i.Key)
	}
	return
}

// Load reads the saved switches and makes sure at most one model per group is on.
func (m *Monitor) Load(ctx context.Context) error {
	d, err := m.store.DisabledModels(ctx)
	if err != nil {
		return err
	}
	for _, group := range [][]string{m.llmKeys(), m.imageKeys()} {
		on := false
		for _, k := range group {
			if d[k] {
				continue
			}
			if on {
				d[k] = true
			}
			on = true
		}
	}
	m.mu.Lock()
	m.disabled = d
	m.mu.Unlock()
	return nil
}

func (m *Monitor) enabled(key string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return !m.disabled[key]
}

// SetEnabled flips a switch. Turning a model on turns the others of its kind off.
func (m *Monitor) SetEnabled(ctx context.Context, key string, on bool) error {
	var group []string
	for _, g := range [][]string{m.llmKeys(), m.imageKeys()} {
		for _, k := range g {
			if k == key {
				group = g
			}
		}
	}
	if group == nil {
		return ErrUnknownModel
	}
	set := map[string]bool{key: !on}
	if on {
		for _, k := range group {
			if k != key {
				set[k] = true
			}
		}
	}
	for k, off := range set {
		if err := m.store.SetModelEnabled(ctx, k, !off); err != nil {
			return err
		}
	}
	m.mu.Lock()
	for k, off := range set {
		m.disabled[k] = off
	}
	m.mu.Unlock()
	return nil
}

// Record stores the outcome of a real call ("llm" or "image"); success does not clear the error.
func (m *Monitor) Record(service string, err error) {
	if err == nil {
		return
	}
	// The error belongs to the model that was in use.
	switch service {
	case "llm":
		if p := (llmRouter{m}).pick(); p != nil {
			service = p.Key
		}
	case "image":
		if p := (imageGate{m}).pick(); p != nil {
			service = p.Key
		}
	}
	m.mu.Lock()
	m.lastErr[service] = time.Now().UTC().Format(time.RFC3339) + " " + err.Error()
	m.mu.Unlock()
}

func (m *Monitor) Check(ctx context.Context) Health {
	h := Health{LLMs: make([]ServiceHealth, len(m.llms)), Images: make([]ServiceHealth, len(m.images))}
	var wg sync.WaitGroup
	run := func(f func()) {
		wg.Add(1)
		go func() { defer wg.Done(); f() }()
	}
	for i, l := range m.llms {
		run(func() { h.LLMs[i] = m.check(ctx, l.Key, l.Profile, l.Provider) })
	}
	for i, im := range m.images {
		run(func() { h.Images[i] = m.check(ctx, im.Key, im.Profile, im.Provider) })
	}
	run(func() {
		pctx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		h.Mongo.OK = m.store.Ping(pctx) == nil
	})
	wg.Wait()
	return h
}

func (m *Monitor) check(ctx context.Context, key, profile string, p pinger) ServiceHealth {
	start := time.Now()
	err := p.Ping(ctx)
	h := ServiceHealth{Key: key, Profile: profile, OK: err == nil, Model: p.Model(), CheckedAt: time.Now().UTC(), Enabled: m.enabled(key)}
	if err == nil {
		ms := time.Since(start).Milliseconds()
		h.LatencyMS = &ms
	}
	m.mu.Lock()
	if err != nil {
		m.lastErr[key] = time.Now().UTC().Format(time.RFC3339) + " " + err.Error()
	} else {
		delete(m.lastErr, key) // a stale error must not outlive a healthy ping
	}
	if e, ok := m.lastErr[key]; ok {
		h.LastError = &e
	}
	m.mu.Unlock()
	return h
}

// LLM returns a provider that uses whichever LLM is switched on.
func (m *Monitor) LLM() provider.LLMProvider { return llmRouter{m} }

type llmRouter struct{ m *Monitor }

func (r llmRouter) pick() *LLMSpec {
	for i := range r.m.llms {
		if r.m.enabled(r.m.llms[i].Key) {
			return &r.m.llms[i]
		}
	}
	return nil
}

func (r llmRouter) StreamChat(ctx context.Context, req provider.ChatRequest, onDelta func(provider.Delta)) (*provider.ChatResult, error) {
	p := r.pick()
	if p == nil {
		return nil, ErrModelDisabled
	}
	return p.Provider.StreamChat(ctx, req, onDelta)
}

func (r llmRouter) Model() string {
	if p := r.pick(); p != nil {
		return p.Provider.Model()
	}
	return r.m.llms[0].Provider.Model()
}

// Limits are the caps of the LLM in use.
func (r llmRouter) Limits() provider.LLMLimits {
	p := r.pick()
	if p == nil {
		p = &r.m.llms[0]
	}
	return p.Limits
}

func (r llmRouter) Ping(ctx context.Context) error { return r.m.llms[0].Provider.Ping(ctx) }

// Image returns an image provider that uses whichever image model is on, and refuses calls
// while none is.
func (m *Monitor) Image() provider.ImageProvider { return imageGate{m} }

type imageGate struct{ m *Monitor }

func (g imageGate) pick() *ImageSpec {
	for i := range g.m.images {
		if g.m.enabled(g.m.images[i].Key) {
			return &g.m.images[i]
		}
	}
	return nil
}

func (g imageGate) Generate(ctx context.Context, prompt, size string) ([]byte, error) {
	p := g.pick()
	if p == nil {
		return nil, ErrModelDisabled
	}
	ctx, cancel := context.WithTimeout(ctx, p.Timeout)
	defer cancel()
	return p.Provider.Generate(ctx, prompt, size)
}

func (g imageGate) Edit(ctx context.Context, prompt, size string, imgs []provider.ImageInput) ([]byte, error) {
	p := g.pick()
	if p == nil {
		return nil, ErrModelDisabled
	}
	ctx, cancel := context.WithTimeout(ctx, p.Timeout)
	defer cancel()
	return p.Provider.Edit(ctx, prompt, size, imgs)
}

func (g imageGate) Model() string {
	if p := g.pick(); p != nil {
		return p.Provider.Model()
	}
	return g.m.images[0].Provider.Model()
}

func (g imageGate) Ping(ctx context.Context) error { return g.m.images[0].Provider.Ping(ctx) }

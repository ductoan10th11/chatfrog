// Package admin holds the health monitor behind GET /api/admin/health.
package admin

import (
	"context"
	"sync"
	"time"

	"chatfrog/api/internal/provider"
	"chatfrog/api/internal/store"
)

type ServiceHealth struct {
	OK        bool      `json:"ok"`
	LatencyMS *int64    `json:"latency_ms"`
	Model     string    `json:"model"`
	LastError *string   `json:"last_error"`
	CheckedAt time.Time `json:"checked_at"`
}

type Health struct {
	LLM   ServiceHealth `json:"llm"`
	Image ServiceHealth `json:"image"`
	Mongo struct {
		OK bool `json:"ok"`
	} `json:"mongo"`
}

type pinger interface {
	Ping(ctx context.Context) error
	Model() string
}

// Monitor remembers the last error seen by real calls, and pings the servers on demand.
type Monitor struct {
	llm, image pinger
	store      *store.Store

	mu      sync.Mutex
	lastErr map[string]string
}

func NewMonitor(llm provider.LLMProvider, image provider.ImageProvider, st *store.Store) *Monitor {
	return &Monitor{llm: llm, image: image, store: st, lastErr: map[string]string{}}
}

// Record stores the outcome of a real call ("llm" or "image"); success does not clear the error.
func (m *Monitor) Record(service string, err error) {
	if err == nil {
		return
	}
	m.mu.Lock()
	m.lastErr[service] = time.Now().UTC().Format(time.RFC3339) + " " + err.Error()
	m.mu.Unlock()
}

func (m *Monitor) Check(ctx context.Context) Health {
	var h Health
	var wg sync.WaitGroup
	wg.Add(3)
	go func() { defer wg.Done(); h.LLM = m.check(ctx, "llm", m.llm) }()
	go func() { defer wg.Done(); h.Image = m.check(ctx, "image", m.image) }()
	go func() {
		defer wg.Done()
		pctx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		h.Mongo.OK = m.store.Ping(pctx) == nil
	}()
	wg.Wait()
	return h
}

func (m *Monitor) check(ctx context.Context, name string, p pinger) ServiceHealth {
	start := time.Now()
	err := p.Ping(ctx)
	h := ServiceHealth{OK: err == nil, Model: p.Model(), CheckedAt: time.Now().UTC()}
	if err == nil {
		ms := time.Since(start).Milliseconds()
		h.LatencyMS = &ms
	} else {
		m.Record(name, err)
	}
	m.mu.Lock()
	if e, ok := m.lastErr[name]; ok {
		h.LastError = &e
	}
	m.mu.Unlock()
	return h
}

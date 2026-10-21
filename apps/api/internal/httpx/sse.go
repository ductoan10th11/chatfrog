package httpx

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

// SSE writes `text/event-stream` frames and a `: ping` comment every 15 s.
type SSE struct {
	w    http.ResponseWriter
	rc   *http.ResponseController
	mu   sync.Mutex
	stop chan struct{}
	once sync.Once
}

func NewSSE(w http.ResponseWriter) *SSE {
	h := w.Header()
	h.Set("Content-Type", "text/event-stream; charset=utf-8")
	h.Set("Cache-Control", "no-cache, no-transform")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	s := &SSE{w: w, rc: http.NewResponseController(w), stop: make(chan struct{})}
	_ = s.rc.Flush()
	go s.ping()
	return s
}

func (s *SSE) ping() {
	t := time.NewTicker(15 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-s.stop:
			return
		case <-t.C:
			s.write(": ping\n\n")
		}
	}
}

func (s *SSE) write(frame string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	select {
	case <-s.stop:
		return
	default:
	}
	if _, err := s.w.Write([]byte(frame)); err == nil {
		_ = s.rc.Flush()
	}
}

// Emit sends one event. Write errors are ignored: a gone client cancels the request context.
func (s *SSE) Emit(event string, data any) {
	b, err := json.Marshal(data)
	if err != nil {
		b = []byte(`{}`)
	}
	s.write(fmt.Sprintf("event: %s\ndata: %s\n\n", event, b))
}

// Close stops the pings; no frames are written afterwards.
func (s *SSE) Close() {
	s.once.Do(func() {
		s.mu.Lock()
		close(s.stop)
		s.mu.Unlock()
	})
}

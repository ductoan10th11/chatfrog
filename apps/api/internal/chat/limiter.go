package chat

import (
	"context"
	"sync"
)

// Limiter is a FIFO semaphore that reports each waiter's queue position (SSE `queue`).
type Limiter struct {
	mu      sync.Mutex
	free    int
	waiters []*waiter
}

type waiter struct {
	ready chan struct{}
	pos   chan int
}

func NewLimiter(n int) *Limiter { return &Limiter{free: n} }

// Acquire blocks until a slot is free. onQueue (may be nil) receives the 1-based position
// whenever it changes while waiting.
func (l *Limiter) Acquire(ctx context.Context, onQueue func(position int)) (release func(), err error) {
	l.mu.Lock()
	if l.free > 0 && len(l.waiters) == 0 {
		l.free--
		l.mu.Unlock()
		return l.releaser(), nil
	}
	w := &waiter{ready: make(chan struct{}), pos: make(chan int, 1)}
	l.waiters = append(l.waiters, w)
	pos := len(l.waiters)
	l.mu.Unlock()

	if onQueue != nil {
		onQueue(pos)
	}
	for {
		select {
		case <-w.ready:
			return l.releaser(), nil
		case p := <-w.pos:
			if onQueue != nil {
				onQueue(p)
			}
		case <-ctx.Done():
			l.mu.Lock()
			select {
			case <-w.ready: // granted while cancelling: hand the slot on
				l.mu.Unlock()
				l.release()
				return nil, ctx.Err()
			default:
			}
			for i, x := range l.waiters {
				if x == w {
					l.waiters = append(l.waiters[:i], l.waiters[i+1:]...)
					break
				}
			}
			l.notifyLocked()
			l.mu.Unlock()
			return nil, ctx.Err()
		}
	}
}

func (l *Limiter) releaser() func() {
	var once sync.Once
	return func() { once.Do(l.release) }
}

func (l *Limiter) release() {
	l.mu.Lock()
	defer l.mu.Unlock()
	if len(l.waiters) == 0 {
		l.free++
		return
	}
	w := l.waiters[0]
	l.waiters = l.waiters[1:]
	close(w.ready)
	l.notifyLocked()
}

func (l *Limiter) notifyLocked() {
	for i, w := range l.waiters {
		select {
		case <-w.pos:
		default:
		}
		w.pos <- i + 1
	}
}

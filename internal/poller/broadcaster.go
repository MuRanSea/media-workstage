package poller

import (
	"context"
	"encoding/json"
	"sync"
)

// Event represents an event payload sent over SSE.
type Event struct {
	Type string `json:"type"`
	Data string `json:"data"`
}

// EventBroadcaster defines the interface for subscribing and broadcasting real-time task events.
type EventBroadcaster interface {
	Broadcast(eventType string, payload interface{})
	Subscribe(ctx context.Context) <-chan Event
}

// InMemoryBroadcaster implements EventBroadcaster using Go channels.
type InMemoryBroadcaster struct {
	mu          sync.RWMutex
	subscribers map[chan Event]struct{}
}

// NewInMemoryBroadcaster creates a new InMemoryBroadcaster instance.
func NewInMemoryBroadcaster() *InMemoryBroadcaster {
	return &InMemoryBroadcaster{
		subscribers: make(map[chan Event]struct{}),
	}
}

// Broadcast sends an event to all active subscriber channels.
func (b *InMemoryBroadcaster) Broadcast(eventType string, payload interface{}) {
	b.mu.RLock()
	defer b.mu.RUnlock()

	var dataStr string
	if s, ok := payload.(string); ok {
		dataStr = s
	} else {
		bJSON, err := json.Marshal(payload)
		if err != nil {
			dataStr = "{}"
		} else {
			dataStr = string(bJSON)
		}
	}

	evt := Event{
		Type: eventType,
		Data: dataStr,
	}

	for ch := range b.subscribers {
		select {
		case ch <- evt:
		default:
			// Non-blocking drop if subscriber is backlogged
		}
	}
}

// Subscribe returns a read-only channel of events and automatically unsubscribes on context cancellation.
func (b *InMemoryBroadcaster) Subscribe(ctx context.Context) <-chan Event {
	ch := make(chan Event, 128)
	b.mu.Lock()
	b.subscribers[ch] = struct{}{}
	b.mu.Unlock()

	go func() {
		<-ctx.Done()
		b.mu.Lock()
		delete(b.subscribers, ch)
		close(ch)
		b.mu.Unlock()
	}()

	return ch
}

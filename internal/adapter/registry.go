package adapter

import (
	"strings"
	"sync"
)

// AdapterRegistry manages ProviderAdapters with thread-safe atomic access and runtime swapping.
type AdapterRegistry struct {
	mu       sync.RWMutex
	adapters map[string]ProviderAdapter
	fallback map[string]ProviderAdapter // historical fake adapters to handle in-flight fake tasks gracefully
}

// NewAdapterRegistry creates and initializes a new thread-safe AdapterRegistry.
func NewAdapterRegistry(initial map[string]ProviderAdapter) *AdapterRegistry {
	r := &AdapterRegistry{
		adapters: make(map[string]ProviderAdapter),
		fallback: make(map[string]ProviderAdapter),
	}
	if initial != nil {
		for k, v := range initial {
			r.adapters[k] = v
		}
	}
	return r
}

// Get atomically retrieves an adapter by provider name under RLock.
func (r *AdapterRegistry) Get(name string) (ProviderAdapter, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	a, ok := r.adapters[name]
	return a, ok
}

// GetForTask retrieves the appropriate adapter, gracefully falling back to mock provider for legacy in-flight fake tasks.
func (r *AdapterRegistry) GetForTask(providerName string, providerTaskID string) (ProviderAdapter, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	// If the task was submitted to a fake adapter (starts with "fake-"), route to fallback if swapped
	if strings.HasPrefix(providerTaskID, "fake-") {
		if fb, ok := r.fallback[providerName]; ok {
			return fb, true
		}
	}

	a, ok := r.adapters[providerName]
	return a, ok
}

// Set atomically updates or swaps an adapter for a provider under Lock.
func (r *AdapterRegistry) Set(name string, ad ProviderAdapter) {
	r.mu.Lock()
	defer r.mu.Unlock()

	// If current is a fake adapter, archive it in fallback so in-flight tasks can finish
	if curr, ok := r.adapters[name]; ok {
		if _, isFake := curr.(*FakeProviderAdapter); isFake {
			r.fallback[name] = curr
		}
	}

	r.adapters[name] = ad
}

// Delete removes a provider's adapter, e.g. after its channel configuration is cleared.
func (r *AdapterRegistry) Delete(name string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.adapters, name)
}

// GetAll returns a thread-safe snapshot map of all registered adapters.
func (r *AdapterRegistry) GetAll() map[string]ProviderAdapter {
	r.mu.RLock()
	defer r.mu.RUnlock()
	copyMap := make(map[string]ProviderAdapter, len(r.adapters))
	for k, v := range r.adapters {
		copyMap[k] = v
	}
	return copyMap
}

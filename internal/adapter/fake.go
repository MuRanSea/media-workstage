package adapter

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"media-workstage/internal/model"

	"github.com/google/uuid"
)

// FakeProviderAdapter is an in-memory mock implementation of ProviderAdapter for deterministic testing.
type FakeProviderAdapter struct {
	name            string
	mu              sync.RWMutex
	customResponses map[string]*PollResult
	pollCounts      map[string]int
}

func NewFakeProviderAdapter(name string) *FakeProviderAdapter {
	return &FakeProviderAdapter{
		name:            name,
		customResponses: make(map[string]*PollResult),
		pollCounts:      make(map[string]int),
	}
}

func (f *FakeProviderAdapter) ProviderName() string {
	return f.name
}

func (f *FakeProviderAdapter) SubmitTask(ctx context.Context, task *model.MediaTask) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	providerTaskID := fmt.Sprintf("fake-%s-%s", f.name, uuid.New().String()[:8])
	return providerTaskID, nil
}

func (f *FakeProviderAdapter) SetNextPollResult(providerTaskID string, result *PollResult) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.customResponses[providerTaskID] = result
}

func (f *FakeProviderAdapter) PollTask(ctx context.Context, task *model.MediaTask) (*PollResult, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	f.pollCounts[task.ProviderTaskID]++
	if res, ok := f.customResponses[task.ProviderTaskID]; ok {
		return res, nil
	}

	// Default fallback: simulate running state
	return &PollResult{
		Status:   model.TaskStatusRunning,
		Progress: 35,
	}, nil
}

func (f *FakeProviderAdapter) DownloadAsset(ctx context.Context, remoteURL string, targetLocalPath string) error {
	dir := filepath.Dir(targetLocalPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create destination directory: %w", err)
	}

	mockContent := fmt.Sprintf("MOCK_MEDIA_CONTENT_%d_%s", time.Now().UnixNano(), filepath.Base(remoteURL))
	return os.WriteFile(targetLocalPath, []byte(mockContent), 0644)
}

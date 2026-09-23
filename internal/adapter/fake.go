package adapter

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"media-workstage/internal/model"
)

// Valid 1-second 320x240 H.264/AAC MP4 video fixture for browser playback
const validBlankMP4Base64 = "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LjAwAIAAAADvZYiEDPJigACwvJycnJycnJycnJycnJycnJycnJ11111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111114hEARgjBwhEARgjBwAAAAHQZo4GeAS2CEQBGCMHCEQBGCMHAAAAAdBmlQGeAS2IRAEYIwcIRAEYIwcAAAAB0GaYDPAJbAhEARgjBwAAAAHQZqAM8AlsCEQBGCMHCEQBGCMHAAAAAdBmqAzwCWwIRAEYIwcIRAEYIwcAAAAB0GawDPAJbAhEARgjBwhEARgjBwAAAAHQZrgM8AlsCEQBGCMHAAAAAdBmwAzwCWwIRAEYIwcIRAEYIwcAAAAB0GbIDPAJbAhEARgjBwhEARgjBwAAAAHQZtAM8AlsCEQBGCMHAAAAAdBm2AzwCWwIRAEYIwcIRAEYIwcAAAAB0GbgDPAJbAhEARgjBwhEARgjBwAAAAHQZugM8AlsCEQBGCMHCEQBGCMHAAAAAdBm8AzwCWwIRAEYIwcAAAAB0Gb4DPAJbAhEARgjBwhEARgjBwAAAAHQZoAM8AlsCEQBGCMHCEQBGCMHAAAAAdBmiAzwCWwIRAEYIwcIRAEYIwcAAAAB0GaQDPAJbAhEARgjBwAAAAHQZpgM8AlsCEQBGCMHCEQBGCMHAAAAAdBmoAzwCWwIRAEYIwcIRAEYIwcAAAAB0GaoDPAJbAhEARgjBwAAAAHQZrAL8AlsCEQBGCMHCEQBGCMHAAAAAdBmuAvwCWwIRAEYIwcIRAEYIwcAAAAB0GbACvAJbAhEARgjBwhEARgjBw="

// Valid 1x1 transparent PNG fixture
const valid1x1PNGBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

// FakeProviderAdapter is an in-memory mock implementation of ProviderAdapter for deterministic testing and offline dev.
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
func (f *FakeProviderAdapter) GetConfig() ProviderConfigInfo {
	f.mu.RLock()
	defer f.mu.RUnlock()
	defaultURL := "https://ark.cn-beijing.volces.com/api/v3"
	if f.name == "minimax" {
		defaultURL = "https://api.minimax.chat/v1"
	}
	return ProviderConfigInfo{
		ProviderName: f.name,
		BaseURL:      defaultURL,
		IsConfigured: false,
		MaskedKey:    "",
	}
}

func (f *FakeProviderAdapter) UpdateConfig(baseURL string, apiKey string, extra map[string]string) error {
	return nil
}


func (f *FakeProviderAdapter) SubmitTask(ctx context.Context, task *model.MediaTask) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	providerTaskID := task.ProviderTaskID
	if providerTaskID == "" {
		providerTaskID = fmt.Sprintf("fake-%s-%s", f.name, task.ID)
	}
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
	if res, ok := f.customResponses[task.ID]; ok {
		return res, nil
	}

	count := f.pollCounts[task.ProviderTaskID]

	// Simulate progressive advancement: Poll 1 -> running (45%), Poll 2+ -> succeeded (100%)
	if count < 2 {
		return &PollResult{
			Status:   model.TaskStatusRunning,
			Progress: 45,
		}, nil
	}

	// Succeeded state simulation
	res := &PollResult{
		Status:            model.TaskStatusSucceeded,
		Progress:          100,
		OutputDurationSec: 5.0,
		UsageTokens:       1024,
		BillingDetailsJSON: `{"status":"succeeded","mock":true}`,
	}

	if task.TaskType == "image_generation" {
		isLayerDecomp := strings.Contains(task.ParamsJSON, `"layer_decomposition":true`) || task.TaskMode == "layer_decomp"
		isSeq := strings.Contains(task.ParamsJSON, `"sequential_image_generation":"auto"`) || task.TaskMode == "sequential"

		if isLayerDecomp {
			res.Assets = []model.TaskAsset{
				{
					AssetIndex: 0,
					Kind:       "image_base",
					Name:       "base.png",
					RemoteURL:  "https://example.com/base.png",
					LocalPath:  fmt.Sprintf("images/%s/base.png", task.ID),
					ZIndex:     0,
				},
				{
					AssetIndex:      1,
					Kind:            "image_layer",
					Name:            "Character",
					Description:     "机甲少女主体图层",
					RemoteURL:       "https://example.com/layer_00.png",
					LocalPath:       fmt.Sprintf("images/%s/layer_00.png", task.ID),
					ZIndex:          1,
					BoundingBoxJSON: `{"absolute":[100,200,500,800]}`,
				},
				{
					AssetIndex:      2,
					Kind:            "image_layer",
					Name:            "Background",
					Description:     "雨夜霓虹背景图层",
					RemoteURL:       "https://example.com/layer_01.png",
					LocalPath:       fmt.Sprintf("images/%s/layer_01.png", task.ID),
					ZIndex:          2,
					BoundingBoxJSON: `{"absolute":[0,0,2048,2048]}`,
				},
			}
		} else if isSeq {
			res.Assets = []model.TaskAsset{
				{
					AssetIndex: 0,
					Kind:       "image_frame",
					Name:       "storyboard_00.png",
					RemoteURL:  "https://example.com/storyboard_00.png",
					LocalPath:  fmt.Sprintf("images/%s/storyboard_00.png", task.ID),
					ZIndex:     0,
				},
				{
					AssetIndex: 1,
					Kind:       "image_frame",
					Name:       "storyboard_01.png",
					RemoteURL:  "https://example.com/storyboard_01.png",
					LocalPath:  fmt.Sprintf("images/%s/storyboard_01.png", task.ID),
					ZIndex:     1,
				},
			}
		} else {
			res.Assets = []model.TaskAsset{
				{
					AssetIndex: 0,
					Kind:       "image_base",
					Name:       "base.png",
					RemoteURL:  "https://example.com/base.png",
					LocalPath:  fmt.Sprintf("images/%s/base.png", task.ID),
					ZIndex:     0,
				},
			}
		}
	} else {
		// Video generation
		res.Assets = []model.TaskAsset{
			{
				AssetIndex: 0,
				Kind:       "video",
				Name:       "output.mp4",
				RemoteURL:  "https://example.com/output.mp4",
				LocalPath:  fmt.Sprintf("videos/%s/output.mp4", task.ID),
			},
		}
	}

	return res, nil
}

func (f *FakeProviderAdapter) DownloadAsset(ctx context.Context, remoteURL string, targetLocalPath string) error {
	dir := filepath.Dir(targetLocalPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create destination directory: %w", err)
	}

	ext := strings.ToLower(filepath.Ext(targetLocalPath))
	if ext == ".mp4" || strings.HasSuffix(remoteURL, ".mp4") {
		data, err := base64.StdEncoding.DecodeString(validBlankMP4Base64)
		if err == nil {
			return os.WriteFile(targetLocalPath, data, 0644)
		}
	}

	if ext == ".png" || strings.HasSuffix(remoteURL, ".png") {
		data, err := base64.StdEncoding.DecodeString(valid1x1PNGBase64)
		if err == nil {
			return os.WriteFile(targetLocalPath, data, 0644)
		}
	}

	mockContent := fmt.Sprintf("MOCK_MEDIA_CONTENT_%d_%s", time.Now().UnixNano(), filepath.Base(remoteURL))
	return os.WriteFile(targetLocalPath, []byte(mockContent), 0644)
}

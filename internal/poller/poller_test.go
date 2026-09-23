package poller

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"media-workstage/internal/adapter"
	"media-workstage/internal/db"
	"media-workstage/internal/model"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

func setupTestDB(t *testing.T) *gorm.DB {
	tempDir := t.TempDir()
	dbPath := filepath.Join(tempDir, fmt.Sprintf("test_poller_%d.db", time.Now().UnixNano()))
	database, err := db.InitDB(dbPath)
	if err != nil {
		t.Fatalf("failed to init db: %v", err)
	}

	t.Cleanup(func() {
		sqlDB, err := database.DB()
		if err == nil && sqlDB != nil {
			_ = sqlDB.Close()
		}
	})

	return database
}

func TestTaskPoller_VideoTaskLifecycle(t *testing.T) {
	database := setupTestDB(t)
	assetDir := t.TempDir()
	fakeAdapter := adapter.NewFakeProviderAdapter("ark")
	adapters := map[string]adapter.ProviderAdapter{
		"ark": fakeAdapter,
	}

	broadcaster := NewInMemoryBroadcaster()
	limiter := NewIPMLimiter(60, 60)

	poller := NewTaskPoller(TaskPollerConfig{
		DB:                database,
		Adapters:          adapters,
		AssetDir:          assetDir,
		Limiter:           limiter,
		Broadcaster:       broadcaster,
		VideoPollInterval: 10 * time.Millisecond,
		VideoInitialDelay: 10 * time.Millisecond,
		VideoTimeout:      2 * time.Second,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	eventsCh := broadcaster.Subscribe(ctx)

	// Create queued video task
	taskID := uuid.New().String()
	now := time.Now().UTC()
	task := model.MediaTask{
		ID:         taskID,
		Provider:   "ark",
		Model:      "doubao-seedance-2-5-260628",
		TaskType:   "video_generation",
		TaskMode:   "all_modal",
		Prompt:     "A cinematic shot of a drone over mountains",
		ParamsJSON: `{"resolution": "720p", "ratio": "16:9", "duration": 5}`,
		Status:     model.TaskStatusQueued,
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	if err := database.Create(&task).Error; err != nil {
		t.Fatalf("failed to create task: %v", err)
	}

	// Prepare expected poll response
	fakeAdapter.SetNextPollResult(taskID, &adapter.PollResult{
		Status:            model.TaskStatusSucceeded,
		Progress:          100,
		OutputDurationSec: 5.0,
		UsageTokens:       256,
		ResultURL:         "https://example.com/video.mp4",
		Assets: []model.TaskAsset{
			{
				AssetIndex: 0,
				Kind:       "video",
				Name:       "output.mp4",
				RemoteURL:  "https://example.com/video.mp4",
				LocalPath:  fmt.Sprintf("videos/%s/output.mp4", taskID),
			},
			{
				AssetIndex: 1,
				Kind:       "image_frame",
				Name:       "last_frame.png",
				RemoteURL:  "https://example.com/last_frame.png",
				LocalPath:  fmt.Sprintf("videos/%s/last_frame.png", taskID),
			},
		},
	})

	// Process task in background
	go poller.ProcessTask(ctx, taskID)

	// Wait for succeeded event
	var finalTask model.MediaTask
	succeededFound := false

	for !succeededFound {
		select {
		case <-ctx.Done():
			t.Fatal("timed out waiting for task.succeeded event")
		case evt := <-eventsCh:
			if evt.Type == "task.succeeded" {
				_ = json.Unmarshal([]byte(evt.Data), &finalTask)
				if finalTask.ID == taskID {
					succeededFound = true
				}
			}
		}
	}

	// Verify database state
	var savedTask model.MediaTask
	if err := database.Preload("Assets").First(&savedTask, "id = ?", taskID).Error; err != nil {
		t.Fatalf("failed to query task: %v", err)
	}

	if savedTask.Status != model.TaskStatusSucceeded {
		t.Errorf("expected status 'succeeded', got '%s'", savedTask.Status)
	}
	if savedTask.OutputDurationSec != 5.0 {
		t.Errorf("expected duration 5.0, got %f", savedTask.OutputDurationSec)
	}
	if savedTask.UsageTokens != 256 {
		t.Errorf("expected 256 usage tokens, got %d", savedTask.UsageTokens)
	}
	if len(savedTask.Assets) != 2 {
		t.Fatalf("expected 2 child assets, got %d", len(savedTask.Assets))
	}

	// Verify downloaded files exist on local filesystem
	for _, asset := range savedTask.Assets {
		fullPath := filepath.Join(assetDir, asset.LocalPath)
		if _, err := os.Stat(fullPath); err != nil {
			t.Errorf("downloaded asset file not found at %s: %v", fullPath, err)
		}
	}
}

func TestTaskPoller_ImageLayerDecomposition_RateLimitingAndRefund(t *testing.T) {
	database := setupTestDB(t)
	assetDir := t.TempDir()
	fakeAdapter := adapter.NewFakeProviderAdapter("ark")
	adapters := map[string]adapter.ProviderAdapter{
		"ark": fakeAdapter,
	}

	broadcaster := NewInMemoryBroadcaster()
	// Initialize with 30 tokens
	limiter := NewIPMLimiter(30, 60)

	poller := NewTaskPoller(TaskPollerConfig{
		DB:                database,
		Adapters:          adapters,
		AssetDir:          assetDir,
		Limiter:           limiter,
		Broadcaster:       broadcaster,
		ImagePollInterval: 10 * time.Millisecond,
		ImageInitialDelay: 10 * time.Millisecond,
		ImageTimeout:      2 * time.Second,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	taskID := uuid.New().String()
	now := time.Now().UTC()
	task := model.MediaTask{
		ID:         taskID,
		Provider:   "ark",
		Model:      "doubao-seedream-5-0-pro-260628",
		TaskType:   "image_generation",
		TaskMode:   "layer_decomp",
		Prompt:     "A layered character portrait",
		ParamsJSON: `{"size": "2K", "layer_decomposition": true}`,
		Status:     model.TaskStatusQueued,
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	if err := database.Create(&task).Error; err != nil {
		t.Fatalf("failed to create task: %v", err)
	}

	// Mock PollResult returning 1 base image + 2 layers (total 3 assets)
	fakeAdapter.SetNextPollResult(taskID, &adapter.PollResult{
		Status:      model.TaskStatusSucceeded,
		Progress:    100,
		UsageTokens: 16384,
		ResultURL:   "https://example.com/base.png",
		Assets: []model.TaskAsset{
			{
				AssetIndex: 0,
				Kind:       "image_base",
				Name:       "base.png",
				RemoteURL:  "https://example.com/base.png",
				LocalPath:  fmt.Sprintf("images/%s/base.png", taskID),
				ZIndex:     0,
			},
			{
				AssetIndex:      1,
				Kind:            "image_layer",
				Name:            "layer_00.png",
				Description:     "Character",
				RemoteURL:       "https://example.com/layer_00.png",
				LocalPath:       fmt.Sprintf("images/%s/layer_00.png", taskID),
				ZIndex:          1,
				BoundingBoxJSON: `{"absolute":[100,200,500,800]}`,
			},
			{
				AssetIndex:      2,
				Kind:            "image_layer",
				Name:            "layer_01.png",
				Description:     "Background",
				RemoteURL:       "https://example.com/layer_01.png",
				LocalPath:       fmt.Sprintf("images/%s/layer_01.png", taskID),
				ZIndex:          2,
				BoundingBoxJSON: `{"absolute":[0,0,2048,2048]}`,
			},
		},
	})

	poller.ProcessTask(ctx, taskID)

	// Verify database state
	var savedTask model.MediaTask
	if err := database.Preload("Assets").First(&savedTask, "id = ?", taskID).Error; err != nil {
		t.Fatalf("failed to get task: %v", err)
	}

	if savedTask.Status != model.TaskStatusSucceeded {
		t.Fatalf("expected succeeded status, got %s", savedTask.Status)
	}
	if len(savedTask.Assets) != 3 {
		t.Fatalf("expected 3 assets (1 base + 2 layers), got %d", len(savedTask.Assets))
	}

	// Check token refund: 17 pre-deducted, 1 base + 2 layers = 3 consumed. 17 - 3 = 14 refunded.
	// Initial tokens was 30 -> 30 - 17 + 14 = 27 tokens.
	availTokens := limiter.AvailableTokens()
	if availTokens < 26.5 || availTokens > 27.5 {
		t.Fatalf("expected ~27 tokens available after refund (14 refunded), got %f", availTokens)
	}
}

func TestTaskPoller_TaskFailureAndFullRefund(t *testing.T) {
	database := setupTestDB(t)
	assetDir := t.TempDir()
	fakeAdapter := adapter.NewFakeProviderAdapter("ark")
	adapters := map[string]adapter.ProviderAdapter{
		"ark": fakeAdapter,
	}

	broadcaster := NewInMemoryBroadcaster()
	limiter := NewIPMLimiter(30, 60)

	poller := NewTaskPoller(TaskPollerConfig{
		DB:                database,
		Adapters:          adapters,
		AssetDir:          assetDir,
		Limiter:           limiter,
		Broadcaster:       broadcaster,
		ImagePollInterval: 10 * time.Millisecond,
		ImageInitialDelay: 10 * time.Millisecond,
		ImageTimeout:      2 * time.Second,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	taskID := uuid.New().String()
	now := time.Now().UTC()
	task := model.MediaTask{
		ID:         taskID,
		Provider:   "ark",
		Model:      "doubao-seedream-5-0-pro-260628",
		TaskType:   "image_generation",
		TaskMode:   "layer_decomp",
		Prompt:     "Test",
		ParamsJSON: `{"layer_decomposition": true}`,
		Status:     model.TaskStatusQueued,
		CreatedAt:  now,
		UpdatedAt:  now,
	}
	if err := database.Create(&task).Error; err != nil {
		t.Fatalf("failed to create task: %v", err)
	}

	// Set failed response
	fakeAdapter.SetNextPollResult(taskID, &adapter.PollResult{
		Status:       model.TaskStatusFailed,
		ErrorCode:    "AccountOverdue",
		ErrorMessage: "Account balance insufficient",
	})

	poller.ProcessTask(ctx, taskID)

	var savedTask model.MediaTask
	if err := database.First(&savedTask, "id = ?", taskID).Error; err != nil {
		t.Fatalf("failed to get task: %v", err)
	}

	if savedTask.Status != model.TaskStatusFailed {
		t.Errorf("expected failed status, got %s", savedTask.Status)
	}
	if savedTask.ErrorCode != "AccountOverdue" {
		t.Errorf("unexpected error code: %s", savedTask.ErrorCode)
	}

	// Full 17 tokens should be refunded on failure -> 30 tokens available
	availTokens := limiter.AvailableTokens()
	if availTokens < 29.5 || availTokens > 30.0 {
		t.Fatalf("expected 30 tokens after full refund on failure, got %f", availTokens)
	}
}

func TestTaskPoller_StartupRecovery(t *testing.T) {
	database := setupTestDB(t)
	fakeAdapter := adapter.NewFakeProviderAdapter("ark")
	adapters := map[string]adapter.ProviderAdapter{
		"ark": fakeAdapter,
	}

	broadcaster := NewInMemoryBroadcaster()
	limiter := NewIPMLimiter(60, 60)

	poller := NewTaskPoller(TaskPollerConfig{
		DB:                 database,
		Adapters:           adapters,
		Limiter:            limiter,
		Broadcaster:        broadcaster,
		VideoPollInterval:  10 * time.Millisecond,
		VideoInitialDelay:  10 * time.Millisecond,
		ConcurrencyWorkers: 4,
	})

	// Seed 2 unfinished tasks in DB
	task1 := model.MediaTask{
		ID:        "rec-task-1",
		Provider:  "ark",
		Model:     "doubao-seedance-2-5-260628",
		TaskType:  "video_generation",
		TaskMode:  "text_to_video",
		Prompt:    "Video 1",
		Status:    model.TaskStatusQueued,
		CreatedAt: time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
	}
	task2 := model.MediaTask{
		ID:             "rec-task-2",
		Provider:       "ark",
		ProviderTaskID: "prov-task-2",
		Model:          "doubao-seedance-2-5-260628",
		TaskType:       "video_generation",
		TaskMode:       "text_to_video",
		Prompt:         "Video 2",
		Status:         model.TaskStatusRunning,
		CreatedAt:      time.Now().UTC(),
		UpdatedAt:      time.Now().UTC(),
	}

	database.Create(&task1)
	database.Create(&task2)

	fakeAdapter.SetNextPollResult("prov-task-2", &adapter.PollResult{
		Status:            model.TaskStatusSucceeded,
		Progress:          100,
		OutputDurationSec: 6.0,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	poller.Start(ctx)
	defer poller.Stop()

	// Wait briefly for recovery worker to process tasks
	time.Sleep(200 * time.Millisecond)

	var recoveredTask2 model.MediaTask
	if err := database.First(&recoveredTask2, "id = ?", "rec-task-2").Error; err != nil {
		t.Fatalf("failed to query recovered task: %v", err)
	}

	if recoveredTask2.Status != model.TaskStatusSucceeded {
		t.Errorf("expected rec-task-2 to be succeeded, got %s", recoveredTask2.Status)
	}
}

func TestTaskPoller_TaskTimeout(t *testing.T) {
	database := setupTestDB(t)
	fakeAdapter := adapter.NewFakeProviderAdapter("ark")
	adapters := map[string]adapter.ProviderAdapter{
		"ark": fakeAdapter,
	}

	poller := NewTaskPoller(TaskPollerConfig{
		DB:                database,
		Adapters:          adapters,
		VideoPollInterval: 10 * time.Millisecond,
		VideoInitialDelay: 10 * time.Millisecond,
		VideoTimeout:      50 * time.Millisecond, // very short timeout
	})

	ctx := context.Background()

	taskID := "timeout-task-1"
	task := model.MediaTask{
		ID:        taskID,
		Provider:  "ark",
		Model:     "doubao-seedance-2-5-260628",
		TaskType:  "video_generation",
		TaskMode:  "text_to_video",
		Prompt:    "Long running task",
		Status:    model.TaskStatusQueued,
		CreatedAt: time.Now().UTC(),
		UpdatedAt: time.Now().UTC(),
	}
	database.Create(&task)

	// Explicit running response to test timeout
	fakeAdapter.SetNextPollResult(taskID, &adapter.PollResult{
		Status:   model.TaskStatusRunning,
		Progress: 20,
	})

	poller.ProcessTask(ctx, taskID)

	var timedOutTask model.MediaTask
	if err := database.First(&timedOutTask, "id = ?", taskID).Error; err != nil {
		t.Fatalf("failed to query task: %v", err)
	}

	if timedOutTask.Status != model.TaskStatusExpired {
		t.Errorf("expected expired status, got %s", timedOutTask.Status)
	}
	if timedOutTask.ErrorCode != "TaskTimeout" {
		t.Errorf("expected TaskTimeout error code, got %s", timedOutTask.ErrorCode)
	}
}

// failingDownloadAdapter reports success but cannot fetch the result files,
// like a relay that rejects the download request.
type failingDownloadAdapter struct {
	*adapter.FakeProviderAdapter
}

func (failingDownloadAdapter) DownloadAsset(context.Context, string, string) error {
	return fmt.Errorf("asset download returned HTTP 401")
}

func TestTaskPoller_AllDownloadsFailedMarksTaskFailed(t *testing.T) {
	database := setupTestDB(t)
	fake := adapter.NewFakeProviderAdapter("apimart")
	poller := NewTaskPoller(TaskPollerConfig{
		DB:                database,
		Adapters:          map[string]adapter.ProviderAdapter{"apimart": failingDownloadAdapter{fake}},
		AssetDir:          t.TempDir(),
		ImagePollInterval: 10 * time.Millisecond,
		ImageInitialDelay: 10 * time.Millisecond,
	})

	taskID := uuid.New().String()
	now := time.Now().UTC()
	task := model.MediaTask{
		ID: taskID, Provider: "apimart", Model: "seedream-5-0-lite", TaskType: "image_generation",
		Prompt: "风景图", ParamsJSON: `{}`, Status: model.TaskStatusQueued, CreatedAt: now, UpdatedAt: now,
	}
	if err := database.Create(&task).Error; err != nil {
		t.Fatalf("failed to create task: %v", err)
	}
	fake.SetNextPollResult(taskID, &adapter.PollResult{
		Status: model.TaskStatusSucceeded, Progress: 100,
		Assets: []model.TaskAsset{{Kind: "image_base", RemoteURL: "https://relay/content/0", LocalPath: "images/" + taskID + "/base.png"}},
	})

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	poller.ProcessTask(ctx, taskID)

	var got model.MediaTask
	if err := database.First(&got, "id = ?", taskID).Error; err != nil {
		t.Fatalf("reload task: %v", err)
	}
	if got.Status != model.TaskStatusFailed || got.ErrorCode != "DownloadFailed" {
		t.Fatalf("want failed/DownloadFailed, got %s/%s (%s)", got.Status, got.ErrorCode, got.ErrorMessage)
	}
	var assets int64
	database.Model(&model.TaskAsset{}).Where("task_id = ?", taskID).Count(&assets)
	if assets != 0 {
		t.Fatalf("no asset rows should be kept for a failed download, got %d", assets)
	}
}

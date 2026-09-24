package poller

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"media-workstage/internal/adapter"
	"media-workstage/internal/model"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// TaskPollerConfig holds configuration for the background task poller.
type TaskPollerConfig struct {
	DB       *gorm.DB
	Adapters map[string]adapter.ProviderAdapter
	Registry *adapter.AdapterRegistry
	AssetDir string
	// AssetRoot, when set, picks the download root per task (a project's assets
	// folder). An empty result falls back to AssetDir.
	AssetRoot          func(task *model.MediaTask) string
	Limiter            *IPMLimiter
	Broadcaster        EventBroadcaster
	ImagePollInterval  time.Duration
	ImageTimeout       time.Duration
	VideoPollInterval  time.Duration
	VideoTimeout       time.Duration
	VideoInitialDelay  time.Duration
	ImageInitialDelay  time.Duration
	WorkerQueueSize    int
	ConcurrencyWorkers int
}

// TaskPoller manages background task execution, polling, rate limiting, and asset persistence.
type TaskPoller struct {
	db                *gorm.DB
	registry          *adapter.AdapterRegistry
	assetDir          string
	assetRoot         func(task *model.MediaTask) string
	limiter           *IPMLimiter
	broadcaster       EventBroadcaster
	imagePollInterval time.Duration
	imageTimeout      time.Duration
	videoPollInterval time.Duration
	videoTimeout      time.Duration
	videoInitialDelay time.Duration
	imageInitialDelay time.Duration
	taskQueue         chan string
	activeTasks       sync.Map // map[string]context.CancelFunc
	cancelWorkerCtx   context.CancelFunc
	workerWg          sync.WaitGroup
}

// NewTaskPoller creates and initializes a new TaskPoller instance.
func NewTaskPoller(cfg TaskPollerConfig) *TaskPoller {
	imageInterval := cfg.ImagePollInterval
	if imageInterval <= 0 {
		imageInterval = 2 * time.Second
	}

	imageTimeout := cfg.ImageTimeout
	if imageTimeout <= 0 {
		imageTimeout = 60 * time.Second
	}

	videoInterval := cfg.VideoPollInterval
	if videoInterval <= 0 {
		videoInterval = 6 * time.Second
	}

	videoTimeout := cfg.VideoTimeout
	if videoTimeout <= 0 {
		videoTimeout = 600 * time.Second
	}

	imageInitDelay := cfg.ImageInitialDelay
	if imageInitDelay <= 0 {
		imageInitDelay = 500 * time.Millisecond
	}

	videoInitDelay := cfg.VideoInitialDelay
	if videoInitDelay <= 0 {
		videoInitDelay = 5 * time.Second
	}

	queueSize := cfg.WorkerQueueSize
	if queueSize <= 0 {
		queueSize = 256
	}

	concurrency := cfg.ConcurrencyWorkers
	if concurrency <= 0 {
		concurrency = 16
	}

	limiter := cfg.Limiter
	if limiter == nil {
		limiter = NewIPMLimiter(60, 60)
	}

	broadcaster := cfg.Broadcaster
	if broadcaster == nil {
		broadcaster = NewInMemoryBroadcaster()
	}

	assetDir := cfg.AssetDir
	if assetDir == "" {
		assetDir = "./assets"
	}

	var reg *adapter.AdapterRegistry
	if cfg.Registry != nil {
		reg = cfg.Registry
	} else {
		reg = adapter.NewAdapterRegistry(cfg.Adapters)
	}

	return &TaskPoller{
		db:                cfg.DB,
		registry:          reg,
		assetDir:          assetDir,
		assetRoot:         cfg.AssetRoot,
		limiter:           limiter,
		broadcaster:       broadcaster,
		imagePollInterval: imageInterval,
		imageTimeout:      imageTimeout,
		videoPollInterval: videoInterval,
		videoTimeout:      videoTimeout,
		videoInitialDelay: videoInitDelay,
		imageInitialDelay: imageInitDelay,
		taskQueue:         make(chan string, queueSize),
	}
}

// Broadcaster returns the associated EventBroadcaster.
func (p *TaskPoller) Broadcaster() EventBroadcaster {
	return p.broadcaster
}

// Limiter returns the IPMLimiter.
func (p *TaskPoller) Limiter() *IPMLimiter {
	return p.limiter
}

// Registry returns the AdapterRegistry.
func (p *TaskPoller) Registry() *adapter.AdapterRegistry {
	return p.registry
}

// Start launches the background task dispatcher and starts startup recovery.
func (p *TaskPoller) Start(ctx context.Context) {
	workerCtx, cancel := context.WithCancel(ctx)
	p.cancelWorkerCtx = cancel

	concurrency := 16
	for range concurrency {
		p.workerWg.Add(1)
		go p.workerLoop(workerCtx)
	}

	// Startup Recovery: resume uncompleted tasks from SQLite
	p.StartRecovery(workerCtx)
}

// Stop gracefully shuts down poller workers.
func (p *TaskPoller) Stop() {
	if p.cancelWorkerCtx != nil {
		p.cancelWorkerCtx()
	}
	p.workerWg.Wait()
}

// StartRecovery scans SQLite for tasks in 'queued' or 'running' state and re-enqueues them.
func (p *TaskPoller) StartRecovery(ctx context.Context) {
	var uncompleted []model.MediaTask
	if err := p.db.Where("status IN ('queued', 'running')").Find(&uncompleted).Error; err != nil {
		log.Printf("[TaskPoller] Startup recovery query error: %v", err)
		return
	}

	for _, task := range uncompleted {
		p.Enqueue(task.ID)
	}
}

// Enqueue submits a task ID into the background processing queue.
func (p *TaskPoller) Enqueue(taskID string) {
	select {
	case p.taskQueue <- taskID:
	default:
		// Queue full fallback: launch independent goroutine
		go func() {
			p.taskQueue <- taskID
		}()
	}
}

func (p *TaskPoller) workerLoop(ctx context.Context) {
	defer p.workerWg.Done()
	for {
		select {
		case <-ctx.Done():
			return
		case taskID, ok := <-p.taskQueue:
			if !ok {
				return
			}
			p.ProcessTask(ctx, taskID)
		}
	}
}

// ProcessTask handles the complete lifecycle: rate-limiting -> submission -> polling -> asset download -> persistence.
func (p *TaskPoller) ProcessTask(ctx context.Context, taskID string) {
	// Guard against duplicate processing of the same task concurrently
	taskCtx, cancel := context.WithCancel(ctx)
	if _, loaded := p.activeTasks.LoadOrStore(taskID, cancel); loaded {
		cancel()
		return
	}
	defer func() {
		p.activeTasks.Delete(taskID)
		cancel()
	}()

	var task model.MediaTask
	if err := p.db.First(&task, "id = ?", taskID).Error; err != nil {
		log.Printf("[TaskPoller] Task %s not found in DB: %v", taskID, err)
		return
	}

	// If already in terminal state, nothing to do
	switch task.Status {
	case model.TaskStatusSucceeded, model.TaskStatusFailed, model.TaskStatusCancelled, model.TaskStatusExpired:
		return
	}

	provAdapter, ok := p.registry.GetForTask(task.Provider, task.ProviderTaskID)
	if !ok {
		p.failTask(taskCtx, &task, "UnsupportedProvider", fmt.Sprintf("服务商 %s 未配置 API Key 或尚未接入生成，请在设置中检查", task.Provider))
		return
	}

	isImage := task.TaskType == "image_generation"
	isLayerDecomp := false

	if isImage {
		var pMap map[string]interface{}
		_ = json.Unmarshal([]byte(task.ParamsJSON), &pMap)
		if pMap["layer_decomposition"] == true || task.TaskMode == "layer_decomp" {
			isLayerDecomp = true
		}
	}

	// 1. If task is still queued, perform rate limiting & submit
	if task.Status == model.TaskStatusQueued {
		if isImage {
			if isLayerDecomp {
				if err := p.limiter.PreDeductLayerDecomposition(taskCtx); err != nil {
					p.failTask(taskCtx, &task, "RateLimitError", "rate limit acquisition cancelled")
					return
				}
			} else {
				if err := p.limiter.Wait(taskCtx, 1); err != nil {
					p.failTask(taskCtx, &task, "RateLimitError", "rate limit acquisition cancelled")
					return
				}
			}
		}

		providerTaskID, err := provAdapter.SubmitTask(taskCtx, &task)
		if err != nil {
			// Refund on submit failure
			if isImage {
				if isLayerDecomp {
					p.limiter.FullRefundLayerDecomposition()
				} else {
					p.limiter.Refund(1)
				}
			}
			p.failTask(taskCtx, &task, "SubmitFailed", err.Error())
			return
		}

		task.ProviderTaskID = providerTaskID
		task.Status = model.TaskStatusRunning
		task.Progress = 10
		task.UpdatedAt = time.Now().UTC()
		if err := p.db.Save(&task).Error; err != nil {
			log.Printf("[TaskPoller] Error saving running task %s: %v", task.ID, err)
		}
		p.broadcaster.Broadcast("task.progress", task)
	}

	// 2. Polling loop with smart backoff and timeouts
	timeoutDuration := p.videoTimeout
	pollInterval := p.videoPollInterval
	initDelay := p.videoInitialDelay

	if isImage {
		timeoutDuration = p.imageTimeout
		pollInterval = p.imagePollInterval
		initDelay = p.imageInitialDelay
	}
	if hinter, ok := provAdapter.(adapter.PollTimeoutHinter); ok {
		if d := hinter.PollTimeout(&task); d > 0 {
			timeoutDuration = d
		}
	}

	pollCtx, pollCancel := context.WithTimeout(taskCtx, timeoutDuration)
	defer pollCancel()

	// Initial delay before first poll
	select {
	case <-pollCtx.Done():
		p.handleTimeout(taskCtx, &task, isLayerDecomp)
		return
	case <-time.After(initDelay):
	}

	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	for {
		pollResult, err := provAdapter.PollTask(pollCtx, &task)
		if err != nil {
			// Transient network/polling error: continue and retry on next tick
			log.Printf("[TaskPoller] Poll error for task %s: %v (retrying)", task.ID, err)
		} else if pollResult != nil {
			switch pollResult.Status {
			case model.TaskStatusRunning:
				if pollResult.Progress > task.Progress {
					task.Progress = pollResult.Progress
					task.UpdatedAt = time.Now().UTC()
					_ = p.db.Model(&task).Updates(map[string]interface{}{
						"progress":   task.Progress,
						"updated_at": task.UpdatedAt,
					})
					p.broadcaster.Broadcast("task.progress", task)
				}

			case model.TaskStatusFailed, model.TaskStatusCancelled, model.TaskStatusExpired:
				if isLayerDecomp {
					p.limiter.FullRefundLayerDecomposition()
				}
				p.failTask(taskCtx, &task, pollResult.ErrorCode, pollResult.ErrorMessage)
				return

			case model.TaskStatusSucceeded:
				p.handleSuccess(taskCtx, &task, pollResult, provAdapter, isLayerDecomp)
				return
			}
		}

		select {
		case <-pollCtx.Done():
			p.handleTimeout(taskCtx, &task, isLayerDecomp)
			return
		case <-ticker.C:
		}
	}
}

// assetRootFor returns the folder a task's outputs are downloaded into.
func (p *TaskPoller) assetRootFor(task *model.MediaTask) string {
	if p.assetRoot != nil {
		if root := p.assetRoot(task); root != "" {
			return root
		}
	}
	return p.assetDir
}

func (p *TaskPoller) handleSuccess(ctx context.Context, task *model.MediaTask, res *adapter.PollResult, provAdapter adapter.ProviderAdapter, isLayerDecomp bool) {
	now := time.Now().UTC()
	var downloadedAssets []model.TaskAsset
	actualLayersCount := 0
	downloadedCount := 0
	var firstDownloadErr error

	// Download each asset to local disk
	for _, asset := range res.Assets {
		if asset.Kind == "image_layer" {
			actualLayersCount++
		}

		targetLocalPath := filepath.Join(p.assetRootFor(task), asset.LocalPath)
		if err := provAdapter.DownloadAsset(ctx, asset.RemoteURL, targetLocalPath); err != nil {
			log.Printf("[TaskPoller] Failed to download asset %s to %s: %v", asset.RemoteURL, targetLocalPath, err)
			if firstDownloadErr == nil {
				firstDownloadErr = err
			}
		} else {
			downloadedCount++
		}

		fileSize := int64(0)
		if stat, err := os.Stat(targetLocalPath); err == nil {
			fileSize = stat.Size()
		}

		taskAsset := model.TaskAsset{
			ID:              uuid.New().String(),
			TaskID:          task.ID,
			AssetIndex:      asset.AssetIndex,
			Kind:            asset.Kind,
			Name:            asset.Name,
			Description:     asset.Description,
			ZIndex:          asset.ZIndex,
			BoundingBoxJSON: asset.BoundingBoxJSON,
			RemoteURL:       asset.RemoteURL,
			LocalPath:       asset.LocalPath,
			FileSizeBytes:   fileSize,
			DownloadedAt:    &now,
		}

		downloadedAssets = append(downloadedAssets, taskAsset)
	}

	// Refund unused IPM tokens for layer decomposition
	if isLayerDecomp {
		p.limiter.RefundLayerDecomposition(actualLayersCount)
	}

	// A "success" with no file on disk would leave the card blank; report why instead.
	if len(res.Assets) > 0 && downloadedCount == 0 {
		p.failTask(ctx, task, "DownloadFailed", fmt.Sprintf("生成成功，但结果文件下载失败：%v", firstDownloadErr))
		return
	}

	for i := range downloadedAssets {
		if err := p.db.Create(&downloadedAssets[i]).Error; err != nil {
			log.Printf("[TaskPoller] Error saving task_asset for task %s: %v", task.ID, err)
		}
	}

	// Update Task in DB
	task.Status = model.TaskStatusSucceeded
	task.Progress = 100
	task.OutputDurationSec = res.OutputDurationSec
	task.UsageTokens = res.UsageTokens
	task.BillingDetailsJSON = res.BillingDetailsJSON
	task.CompletedAt = &now
	task.UpdatedAt = now
	task.Assets = downloadedAssets

	if err := p.db.Omit("Assets").Save(task).Error; err != nil {
		log.Printf("[TaskPoller] Error updating succeeded task %s: %v", task.ID, err)
	}

	p.broadcaster.Broadcast("task.succeeded", task)
}

func (p *TaskPoller) failTask(ctx context.Context, task *model.MediaTask, errCode, errMsg string) {
	now := time.Now().UTC()
	task.Status = model.TaskStatusFailed
	task.ErrorCode = errCode
	task.ErrorMessage = errMsg
	task.CompletedAt = &now
	task.UpdatedAt = now

	_ = p.db.Save(task)
	p.broadcaster.Broadcast("task.failed", task)
}

// FailProviderTasks fails every queued or running task of a provider that no longer
// exists (e.g. a deleted custom provider), so cards stop waiting on work no adapter
// can finish. It returns how many tasks it failed.
func (p *TaskPoller) FailProviderTasks(provider, errCode, errMsg string) int {
	var tasks []model.MediaTask
	if err := p.db.Where("provider = ? AND status IN ?", provider,
		[]string{model.TaskStatusQueued, model.TaskStatusRunning}).Find(&tasks).Error; err != nil {
		return 0
	}
	for i := range tasks {
		p.failTask(context.Background(), &tasks[i], errCode, errMsg)
	}
	return len(tasks)
}

func (p *TaskPoller) handleTimeout(ctx context.Context, task *model.MediaTask, isLayerDecomp bool) {
	if isLayerDecomp {
		p.limiter.FullRefundLayerDecomposition()
	}
	now := time.Now().UTC()
	task.Status = model.TaskStatusExpired
	task.ErrorCode = "TaskTimeout"
	task.ErrorMessage = "Task execution timed out"
	task.CompletedAt = &now
	task.UpdatedAt = now

	_ = p.db.Save(task)
	p.broadcaster.Broadcast("task.failed", task)
}

package poller

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"media-workstage/internal/adapter"
	"media-workstage/internal/model"

	"github.com/stretchr/testify/require"
)

// A transfer that completes well within the delivery budget but outlives one generation poll.
type recoveredVideo struct{ *adapter.FakeProviderAdapter }

func (a *recoveredVideo) PollTask(context.Context, *model.MediaTask) (*adapter.PollResult, error) {
	return &adapter.PollResult{Status: model.TaskStatusSucceeded, Delivery: &adapter.MediaDelivery{Expected: 1}, Assets: []model.TaskAsset{{AssetIndex: 0, Kind: "video", RemoteURL: "fixture", LocalPath: "video.mp4"}}}, nil
}
func (a *recoveredVideo) DownloadAsset(ctx context.Context, _ string, target string) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(75 * time.Millisecond):
		return os.WriteFile(target, []byte("video"), 0600)
	}
}
func TestRecoveryGivesReadyVideoIndependentTransferDeadline(t *testing.T) {
	database := setupTestDB(t)
	old := time.Now().Add(-2 * time.Hour)
	task := model.MediaTask{ID: "recover", Provider: "hl", ProviderTaskID: "accepted", TaskType: "video_generation", Status: model.TaskStatusRunning, SubmittedAt: &old}
	require.NoError(t, database.Create(&task).Error)
	p := NewTaskPoller(TaskPollerConfig{DB: database, Adapters: map[string]adapter.ProviderAdapter{"hl": &recoveredVideo{adapter.NewFakeProviderAdapter("hl")}}, AssetDir: t.TempDir(), VideoTimeout: time.Second, VideoInitialDelay: time.Millisecond, VideoPollInterval: 20 * time.Millisecond})
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	p.ProcessTask(ctx, task.ID)
	var out model.MediaTask
	require.NoError(t, database.Preload("Assets").First(&out).Error)
	require.Equal(t, model.DeliveryComplete, out.DeliveryStatus)
	require.Len(t, out.Assets, 1)
}
func TestDeleteProviderHonorsRemoteSuccessAndOfflineProjectReceipts(t *testing.T) {
	database := setupTestDB(t)
	now := time.Now()
	project := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(project, "saved.png"), []byte("data"), 0600))
	task := model.MediaTask{ID: "sample", ProjectID: "offline", Provider: "removed", ProviderTaskID: "accepted", Status: model.TaskStatusRunning, DeliveryStatus: model.DeliveryPending, ResultActions: []model.ResultAction{{ID: "finalize"}}, Assets: []model.TaskAsset{{ID: "downloaded", LocalPath: "saved.png", Kind: "image_frame", FileSizeBytes: 4, DownloadedAt: &now}}}
	require.NoError(t, database.Create(&task).Error)
	p := NewTaskPoller(TaskPollerConfig{DB: database, AssetDir: t.TempDir(), AssetRoot: func(string) (string, error) { return "", os.ErrPermission }})
	require.Zero(t, p.FailProviderTasks(task.Provider, "ProviderDeleted", "服务商已删除"))
	var out model.MediaTask
	require.NoError(t, database.Preload("Assets").First(&out).Error)
	require.Equal(t, model.TaskStatusSucceeded, out.Status)
	require.Equal(t, model.DeliveryPartial, out.DeliveryStatus)
	require.Len(t, out.Assets, 1)
	require.Len(t, out.ResultActions, 1)
}
func TestMissingReferencedIndexNeverCompletesNano(t *testing.T) {
	idx := 0
	d := mediaDeliverySession{latest: &adapter.PollResult{Delivery: &adapter.MediaDelivery{Expected: 1}}}
	task := model.MediaTask{Contents: []model.MediaContent{{Parts: []model.MediaContentPart{{Type: "image", ArtifactIndex: &idx}}}}, Assets: []model.TaskAsset{{AssetIndex: 1, Kind: "image_base"}}}
	require.False(t, d.complete(&task))
	task.Assets[0].AssetIndex = 0
	require.True(t, d.complete(&task))
}
func TestOfflineProviderDoesNotConsumeBillingBudget(t *testing.T) {
	database := setupTestDB(t)
	task := model.MediaTask{ID: "pending", Provider: "removed", ProviderTaskID: "original", Status: model.TaskStatusSucceeded, BillingDetailsJSON: `{"status":"reserved"}`}
	require.NoError(t, database.Create(&task).Error)
	p := NewTaskPoller(TaskPollerConfig{DB: database})
	p.checkPendingBilling(context.Background(), time.Now())
	require.NoError(t, database.First(&task).Error)
	require.Zero(t, task.BillingChecks)
}

func TestImportWithNoAssetsDirectoryAndDetachedFallback(t *testing.T) {
	dir := t.TempDir()
	dest := filepath.Join(dir, "assets")
	p := NewTaskPoller(TaskPollerConfig{DB: setupTestDB(t), AssetDir: t.TempDir(), AssetRoot: func(id string) (string, error) {
		if id == "detached" {
			return "", nil
		}
		return dest, nil
	}})
	task := model.MediaTask{ID: "id", ProjectID: "imported"}
	r, ok := p.deliveryRoot(&task)
	require.True(t, ok)
	require.DirExists(t, dest)
	require.False(t, r.fallback)
	task.ProjectID = "detached"
	r, ok = p.deliveryRoot(&task)
	require.True(t, ok)
	require.True(t, r.fallback)
	require.Equal(t, p.assetDir, r.path)
}
func TestExpiredDeliveryBudgetSurvivesRestart(t *testing.T) {
	database := setupTestDB(t)
	start := time.Now().Add(-time.Hour)
	task := model.MediaTask{ID: "old", Provider: "hl", Status: model.TaskStatusRunning, ProviderTaskID: "remote", DeliveryStatus: model.DeliveryPending, DeliveryStartedAt: &start}
	require.NoError(t, database.Create(&task).Error)
	p := NewTaskPoller(TaskPollerConfig{DB: database, Adapters: map[string]adapter.ProviderAdapter{"hl": &recoveredVideo{adapter.NewFakeProviderAdapter("hl")}}, AssetDir: t.TempDir()})
	p.ProcessTask(context.Background(), task.ID)
	var out model.MediaTask
	require.NoError(t, database.First(&out).Error)
	require.Equal(t, model.TaskStatusSucceeded, out.Status)
	require.Equal(t, model.DeliveryUnavailable, out.DeliveryStatus)
}
func TestAnotherSameVersionReceiptKeepsNewContentsWhenProviderRemoved(t *testing.T) {
	database := setupTestDB(t)
	task := model.MediaTask{ID: "parts", Provider: "provider", Status: model.TaskStatusRunning, ProviderTaskID: "remote"}
	require.NoError(t, database.Create(&task).Error)
	p := NewTaskPoller(TaskPollerConfig{DB: database, AssetDir: t.TempDir()})
	fixture := &recoveredVideo{adapter.NewFakeProviderAdapter("hl")}
	d := new(mediaDeliverySession)
	a, b := "one", "two"
	parts := []model.MediaContentPart{{Type: "text", Text: &a}, {Type: "text", Text: &b}}
	for n := 1; n <= 2; n++ {
		res := &adapter.PollResult{ResultVersion: 1, Delivery: &adapter.MediaDelivery{Pending: true, Expected: 1}, Contents: []model.MediaContent{{Parts: parts[:n]}}}
		require.False(t, d.advance(context.Background(), p, &task, res, fixture))
	}
	require.Zero(t, p.FailProviderTasks(task.Provider, "removed", "removed"))
	var out model.MediaTask
	require.NoError(t, database.First(&out).Error)
	require.Len(t, out.Contents[0].Parts, 2)
}

func TestLateLayerMetadataUpdatesReceiptWithoutDownloadingAgain(t *testing.T) {
	database := setupTestDB(t)
	p := NewTaskPoller(TaskPollerConfig{DB: database, AssetDir: t.TempDir()})
	fake := &mediaDeliveryFixture{FakeProviderAdapter: adapter.NewFakeProviderAdapter("hl"), calls: map[string]int{}}
	task := model.MediaTask{ID: "layers", TaskType: "image_generation", Status: model.TaskStatusRunning}
	require.NoError(t, database.Create(&task).Error)
	d := new(mediaDeliverySession)
	first := model.TaskAsset{AssetIndex: 0, Kind: "image_base", RemoteURL: "first", LocalPath: "layers/0.png"}
	ctx := context.Background()
	require.False(t, d.advance(ctx, p, &task, &adapter.PollResult{Delivery: &adapter.MediaDelivery{Expected: 2, Pending: true}, Assets: []model.TaskAsset{first}}, fake))
	require.Len(t, task.Assets, 1)
	receipt := task.Assets[0]
	first.Kind, first.ZIndex, first.Name, first.BoundingBoxJSON = "image_layer", 1, "title", "[1,2,3,4]"
	first.ProviderMetadataJSON = `{"volcengine":{"z_index":1,"text_recognition":["title"]}}`
	base := model.TaskAsset{AssetIndex: 1, Kind: "image_base", RemoteURL: "base", LocalPath: "layers/1.png", ProviderMetadataJSON: `{"volcengine":{"z_index":0}}`}
	require.True(t, d.advance(ctx, p, &task, &adapter.PollResult{Delivery: &adapter.MediaDelivery{Expected: 2, Layers: map[int]model.TaskAsset{0: first, 1: base}}, Assets: []model.TaskAsset{first, base}}, fake))
	var got model.MediaTask
	require.NoError(t, database.Preload("Assets").First(&got, "id = ?", task.ID).Error)
	require.Equal(t, model.DeliveryComplete, got.DeliveryStatus)
	require.Len(t, got.Assets, 2)
	byIndex := make(map[int]model.TaskAsset)
	for _, a := range got.Assets {
		byIndex[a.AssetIndex] = a
	}
	layer := byIndex[0]
	require.Equal(t, receipt.ID, layer.ID)
	require.Equal(t, receipt.LocalPath, layer.LocalPath)
	require.True(t, receipt.DownloadedAt.Equal(*layer.DownloadedAt))
	require.Equal(t, first.Kind, layer.Kind)
	require.Equal(t, first.ZIndex, layer.ZIndex)
	require.Equal(t, first.Name, layer.Name)
	require.Equal(t, first.BoundingBoxJSON, layer.BoundingBoxJSON)
	require.JSONEq(t, first.ProviderMetadataJSON, layer.ProviderMetadataJSON)
	require.Equal(t, "image_base", byIndex[1].Kind)
	require.Equal(t, map[string]int{"first": 1, "base": 1}, fake.calls)
}

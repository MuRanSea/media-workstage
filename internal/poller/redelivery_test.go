package poller

import (
	"github.com/stretchr/testify/require"
	"media-workstage/internal/adapter"
	"media-workstage/internal/model"
	"testing"
	"time"
)

func TestRedeliveryOnlyReusesOriginalAcceptedTask(t *testing.T) {
	db := setupTestDB(t)
	old := time.Now().Add(-24 * time.Hour)
	task := model.MediaTask{ID: "old", ProjectID: "p", Provider: "media", ProviderTaskID: "original", Status: model.TaskStatusSucceeded, TaskType: "video_generation", DeliveryStatus: model.DeliveryUnavailable, DeliveryStartedAt: &old}
	require.NoError(t, db.Create(&task).Error)
	p := NewTaskPoller(TaskPollerConfig{DB: db, Adapters: map[string]adapter.ProviderAdapter{"media": &recoveredVideo{adapter.NewFakeProviderAdapter("media")}}, AssetDir: t.TempDir(), VideoInitialDelay: time.Millisecond, VideoPollInterval: time.Millisecond})
	bad := task
	bad.ProjectID = "other"
	require.Error(t, p.RequeueDelivery(t.Context(), &bad))
	require.NoError(t, p.RequeueDelivery(t.Context(), &task))
	require.NoError(t, p.RequeueDelivery(t.Context(), &task))
	require.Len(t, p.taskQueue, 1)
	p.ProcessTask(t.Context(), <-p.taskQueue)
	var got model.MediaTask
	require.NoError(t, db.Preload("Assets").First(&got).Error)
	require.Equal(t, "original", got.ProviderTaskID)
	require.Equal(t, model.DeliveryComplete, got.DeliveryStatus)
	require.Len(t, got.Assets, 1)
	require.NoError(t, p.RequeueDelivery(t.Context(), &task))
	require.Empty(t, p.taskQueue)
}

package poller

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"media-workstage/internal/adapter"
	"media-workstage/internal/model"

	"github.com/stretchr/testify/require"
)

func TestPendingMediaBilling_UsesPersistentBudgetAndDoesNotReplaceGeneration(t *testing.T) {
	var calls atomic.Int32
	gw := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" || r.URL.Path != "/media/v1/tasks/task_original" {
			t.Errorf("unexpected action: %s %s", r.Method, r.URL.Path)
			w.WriteHeader(400)
			return
		}
		status := "release_pending"
		if calls.Add(1) > 1 {
			status = "released"
		}
		fmt.Fprintf(w, `{"id":"task_original","status":"succeeded","artifacts":[{"kind":"image","url":"https://example.test/untrusted"}],"billing":{"status":%q,"amount":null}}`, status)
	}))
	defer gw.Close()
	database := setupTestDB(t)
	reg := adapter.NewAdapterRegistry(map[string]adapter.ProviderAdapter{"fake-media": adapter.NewHeighlinerAdapter(adapter.ChannelConfig{APIKey: "test", BaseURL: gw.URL})})
	start := time.Now()
	task := model.MediaTask{ID: "local", Provider: "fake-media", ProviderTaskID: "task_original", Status: model.TaskStatusFailed, BillingDetailsJSON: `{"status":"reserved","amount":null}`, ErrorCode: "generation_failed", CompletedAt: &start}
	require.NoError(t, database.Create(&task).Error)
	worker := func() *TaskPoller { return NewTaskPoller(TaskPollerConfig{DB: database, Registry: reg}) }
	worker().checkPendingBilling(context.Background(), start)
	require.NoError(t, database.First(&task, "id = ?", task.ID).Error)
	require.Equal(t, 1, task.BillingChecks)
	require.Contains(t, task.BillingDetailsJSON, `"release_pending"`)
	worker().checkPendingBilling(context.Background(), start.Add(1*time.Second))
	require.Equal(t, int32(1), calls.Load(), "restart must honor the saved next attempt time")
	worker().checkPendingBilling(context.Background(), start.Add(10*time.Second))
	require.NoError(t, database.Preload("Assets").First(&task, "id = ?", task.ID).Error)
	require.Equal(t, 2, task.BillingChecks)
	require.Contains(t, task.BillingDetailsJSON, `"released"`)
	require.Equal(t, model.TaskStatusFailed, task.Status)
	require.Equal(t, "generation_failed", task.ErrorCode)
	require.Empty(t, task.Assets)
	worker().checkPendingBilling(context.Background(), start.Add(time.Hour))
	require.Equal(t, int32(2), calls.Load())
}

func TestMediaResult_OrderedContentsSurviveWorkerAndSQLite(t *testing.T) {
	database := setupTestDB(t)
	var polls atomic.Int32
	var gateway *httptest.Server
	gateway = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			t.Error("recovered task must not submit again")
			w.WriteHeader(400)
			return
		}
		switch r.URL.Path {
		case "/media/v1/tasks/task_nano":
			polls.Add(1)
			fmt.Fprintf(w, `{"id":"task_nano","status":"succeeded","billing":{"status":"settled","amount":"1.25"},"result_version":1,
            "contents":[{"candidate_index":0,"parts":[{"type":"text","text":""},{"type":"image","artifact_index":0},{"type":"image","artifact_index":9}]}],
            "artifacts":[{"kind":"image","index":9,"state":"expired"},{"kind":"image","index":0,"state":"available","mime_type":"image/png","url":%q}]}`, gateway.URL+"/image.png")
		case "/image.png":
			if r.Header.Get("Authorization") != "" {
				t.Error("download must not carry gateway secret")
			}
			fmt.Fprint(w, "fixture image")
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer gateway.Close()
	task := model.MediaTask{ID: "local-nano", Provider: "heighliner", ProviderTaskID: "task_nano", TaskType: "image_generation", Model: "gemini-nano-banana-2.1", Status: model.TaskStatusRunning}
	require.NoError(t, database.Create(&task).Error)
	a := adapter.NewHeighlinerAdapter(adapter.ChannelConfig{BaseURL: gateway.URL, APIKey: "test"})
	worker := NewTaskPoller(TaskPollerConfig{DB: database, AssetDir: t.TempDir(), Adapters: map[string]adapter.ProviderAdapter{"heighliner": a}, ImageInitialDelay: time.Minute})
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()
	done := make(chan struct{})
	go func() { defer close(done); worker.ProcessTask(ctx, task.ID) }()
	require.Eventually(t, func() bool { return worker.WakeTask(task.ID) }, time.Second, 10*time.Millisecond)
	select {
	case <-done:
	case <-ctx.Done():
		t.Fatal("verified notification wake did not query the attached ID")
	}
	require.Equal(t, int32(1), polls.Load())
	require.NoError(t, database.Preload("Assets").First(&task, "id = ?", task.ID).Error)
	require.Equal(t, model.TaskStatusSucceeded, task.Status)
	require.Equal(t, model.DeliveryPartial, task.DeliveryStatus)
	require.Equal(t, 1, task.ResultVersion)
	require.Len(t, task.Contents, 1)
	require.Len(t, task.Contents[0].Parts, 3)
	require.NotNil(t, task.Contents[0].Parts[0].Text)
	require.Empty(t, *task.Contents[0].Parts[0].Text)
	require.Equal(t, 0, *task.Contents[0].Parts[1].ArtifactIndex)
	require.Len(t, task.Assets, 1)
	require.Equal(t, 0, task.Assets[0].AssetIndex)
	require.Contains(t, task.BillingDetailsJSON, `"settled"`)
}

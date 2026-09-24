package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"media-workstage/internal/adapter"
	"media-workstage/internal/db"
	"media-workstage/internal/poller"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// e2eTask is the part of GET /api/tasks/:id the Midjourney end-to-end tests check.
type e2eTask struct {
	ID     string `json:"id"`
	Status string `json:"status"`
	Error  string `json:"error_message"`
	Assets []struct {
		LocalPath string `json:"local_path"`
	} `json:"assets"`
	ResultActions []map[string]string `json:"result_actions"`
	ResultText    string              `json:"result_text"`
}

// newMidjourneyE2E wires the real HTTP API, poller and Midjourney adapter to a fake
// midjourney-proxy at proxyURL and returns the router and the asset folder.
func newMidjourneyE2E(t *testing.T, proxyURL string) (*gin.Engine, string) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	database, err := db.InitDB(filepath.Join(t.TempDir(), "e2e.db"))
	require.NoError(t, err)
	sqlDB, _ := database.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	assetDir := t.TempDir()

	mj, ok := adapter.NewProviderAdapter("midjourney", "midjourney", proxyURL, "mj-secret", nil)
	require.True(t, ok)
	registry := adapter.NewAdapterRegistry(map[string]adapter.ProviderAdapter{"midjourney": mj})
	p := poller.NewTaskPoller(poller.TaskPollerConfig{
		DB:                database,
		Registry:          registry,
		AssetDir:          assetDir,
		ImagePollInterval: 50 * time.Millisecond,
		ImageInitialDelay: 10 * time.Millisecond,
	})
	ctx, cancel := context.WithCancel(context.Background())
	p.Start(ctx)
	t.Cleanup(func() { cancel(); p.Stop() })
	return NewServer(database, assetDir, registry, p).SetupRouter(), assetDir
}

// createAndWait posts a task and waits until it succeeds or fails.
func createAndWait(t *testing.T, r *gin.Engine, body map[string]any) e2eTask {
	t.Helper()
	w := postJSON(r, "/api/tasks", body)
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	var task e2eTask
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &task))
	id := task.ID
	require.Eventually(t, func() bool {
		rec := httptest.NewRecorder()
		req, _ := http.NewRequest(http.MethodGet, "/api/tasks/"+id, nil)
		r.ServeHTTP(rec, req)
		_ = json.Unmarshal(rec.Body.Bytes(), &task)
		return task.Status == "succeeded" || task.Status == "failed"
	}, 10*time.Second, 50*time.Millisecond)
	return task
}

func imagineBody(model string, params map[string]any) map[string]any {
	return map[string]any{
		"provider": "midjourney", "model": model, "task_type": "image_generation", "task_mode": "single",
		"prompt": "a red fox", "params": params,
	}
}

// TestMidjourneyTask_EndToEnd runs a Midjourney image card through the HTTP API, poller
// and adapter against a fake midjourney-proxy: submit, poll through progress, then save
// the 2x2 grid the proxy serves from its own host.
func TestMidjourneyTask_EndToEnd(t *testing.T) {
	grid := []byte("mj-grid-png")
	var gotPrompt, gotBot string
	var fetches atomic.Int32
	var proxyURL string
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/mj/submit/imagine":
			assert.Equal(t, "mj-secret", r.Header.Get("mj-api-secret"))
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			gotPrompt, _ = body["prompt"].(string)
			gotBot, _ = body["botType"].(string)
			_ = json.NewEncoder(w).Encode(map[string]any{"code": 1, "description": "提交成功", "result": "1730000000000001"})
		case "/mj/task/1730000000000001/fetch":
			assert.Equal(t, "Bearer mj-secret", r.Header.Get("Authorization"))
			resp := map[string]any{"id": "1730000000000001", "status": "IN_PROGRESS", "progress": "50%"}
			if fetches.Add(1) > 1 {
				resp = map[string]any{"id": "1730000000000001", "status": "SUCCESS", "progress": "100%",
					"imageUrl": proxyURL + "/mj/image/1730000000000001",
					"buttons":  []map[string]any{{"customId": "MJ::JOB::upsample::1::h", "label": "U1", "emoji": ""}}}
			}
			_ = json.NewEncoder(w).Encode(resp)
		case "/mj/image/1730000000000001":
			_, _ = w.Write(grid)
		default:
			http.NotFound(w, r)
		}
	}))
	defer proxy.Close()
	proxyURL = proxy.URL
	r, assetDir := newMidjourneyE2E(t, proxy.URL)

	task := createAndWait(t, r, imagineBody("NIJI_JOURNEY", map[string]any{"aspect_ratio": "3:2", "resolution": "2K"}))

	require.Equal(t, "succeeded", task.Status, task.Error)
	assert.Equal(t, []map[string]string{{"id": "MJ::JOB::upsample::1::h", "label": "U1"}}, task.ResultActions)
	assert.Equal(t, "a red fox --ar 3:2", gotPrompt)
	assert.Equal(t, "NIJI_JOURNEY", gotBot)
	assert.GreaterOrEqual(t, fetches.Load(), int32(2), "the task was polled through its progress")
	require.Len(t, task.Assets, 1)
	data, err := os.ReadFile(filepath.Join(assetDir, task.Assets[0].LocalPath))
	require.NoError(t, err)
	assert.Equal(t, grid, data)
}

// TestMidjourneyAction_EndToEnd runs an imagine, then U1 on its grid as a follow-up task:
// the action is submitted against the grid's provider task and yields its own image and
// the upscale's buttons.
func TestMidjourneyAction_EndToEnd(t *testing.T) {
	var mu sync.Mutex
	var actionBody map[string]any
	var proxyURL string
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/mj/submit/imagine":
			_ = json.NewEncoder(w).Encode(map[string]any{"code": 1, "result": "grid-1"})
		case "/mj/submit/action":
			mu.Lock()
			_ = json.NewDecoder(r.Body).Decode(&actionBody)
			mu.Unlock()
			_ = json.NewEncoder(w).Encode(map[string]any{"code": 1, "result": "up-1"})
		case "/mj/task/grid-1/fetch":
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "grid-1", "action": "IMAGINE", "status": "SUCCESS",
				"imageUrl": proxyURL + "/img/grid-1.png",
				"buttons":  []map[string]any{{"customId": "MJ::JOB::upsample::1::h", "label": "U1"}}})
		case "/mj/task/up-1/fetch":
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "up-1", "action": "UPSCALE", "status": "SUCCESS",
				"imageUrl": proxyURL + "/img/up-1.png",
				"buttons": []map[string]any{
					{"customId": "MJ::JOB::high_variation::1::h::SOLO", "label": "Vary (Strong)", "emoji": "🪄"},
					{"customId": "MJ::CustomZoom::h", "label": "Custom Zoom", "emoji": "🔍"},
				}})
		case "/img/grid-1.png", "/img/up-1.png":
			_, _ = w.Write([]byte(r.URL.Path))
		default:
			http.NotFound(w, r)
		}
	}))
	defer proxy.Close()
	proxyURL = proxy.URL
	r, assetDir := newMidjourneyE2E(t, proxy.URL)

	grid := createAndWait(t, r, imagineBody("mj_imagine", nil))
	require.Equal(t, "succeeded", grid.Status, grid.Error)

	up := createAndWait(t, r, map[string]any{
		"provider": "midjourney", "model": "mj_imagine", "task_type": "image_generation", "task_mode": "action",
		"prompt": "a red fox",
		"params": map[string]any{"source_task_id": grid.ID, "action_id": "MJ::JOB::upsample::1::h"},
	})
	require.Equal(t, "succeeded", up.Status, up.Error)

	mu.Lock()
	assert.Equal(t, map[string]any{"taskId": "grid-1", "customId": "MJ::JOB::upsample::1::h", "chooseSameChannel": true}, actionBody)
	mu.Unlock()
	assert.Equal(t, []map[string]string{{"id": "MJ::JOB::high_variation::1::h::SOLO", "label": "Vary (Strong)", "emoji": "🪄"}},
		up.ResultActions, "the upscale offers its own follow-ups")
	require.Len(t, up.Assets, 1)
	data, err := os.ReadFile(filepath.Join(assetDir, up.Assets[0].LocalPath))
	require.NoError(t, err)
	assert.Equal(t, "/img/up-1.png", string(data), "the upscale is saved as its own image")
}

// TestMidjourneyReferenceImages_EndToEnd sends a reference image through the task API;
// the proxy receives it inline in base64Array.
func TestMidjourneyReferenceImages_EndToEnd(t *testing.T) {
	var mu sync.Mutex
	var images []any
	var proxyURL string
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/mj/submit/imagine":
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			mu.Lock()
			images, _ = body["base64Array"].([]any)
			mu.Unlock()
			_ = json.NewEncoder(w).Encode(map[string]any{"code": 1, "result": "ref-1"})
		case "/mj/task/ref-1/fetch":
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "ref-1", "status": "SUCCESS", "imageUrl": proxyURL + "/img/ref-1.png"})
		case "/img/ref-1.png":
			_, _ = w.Write([]byte("grid"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer proxy.Close()
	proxyURL = proxy.URL
	r, _ := newMidjourneyE2E(t, proxy.URL)

	ref := filepath.Join(t.TempDir(), "fox.png")
	require.NoError(t, os.WriteFile(ref, []byte("\x89PNG-fox"), 0644))
	body := imagineBody("mj_imagine", map[string]any{"aspect_ratio": "1:1"})
	body["reference_assets"] = []map[string]any{{"card_id": "c1", "tag_index": 1, "role": "reference_image", "label": "狐狸", "local_path": ref}}
	task := createAndWait(t, r, body)

	require.Equal(t, "succeeded", task.Status, task.Error)
	mu.Lock()
	defer mu.Unlock()
	require.Len(t, images, 1)
	assert.Equal(t, "data:image/png;base64,iVBORy1mb3g=", images[0])
}

// TestMidjourneyDescribe_EndToEnd runs Describe on an image: the task succeeds with the
// prompts as its text result and no file.
func TestMidjourneyDescribe_EndToEnd(t *testing.T) {
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/mj/submit/describe":
			_ = json.NewEncoder(w).Encode(map[string]any{"code": 1, "result": "desc-1"})
		case "/mj/task/desc-1/fetch":
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "desc-1", "action": "DESCRIBE", "status": "SUCCESS",
				"imageUrl": "https://cdn.example.test/upload.png", "properties": map[string]any{"finalPrompt": "1️⃣ a red fox"}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer proxy.Close()
	r, _ := newMidjourneyE2E(t, proxy.URL)

	img := filepath.Join(t.TempDir(), "fox.png")
	require.NoError(t, os.WriteFile(img, []byte("png"), 0644))
	task := createAndWait(t, r, map[string]any{
		"provider": "midjourney", "model": "mj_imagine", "task_type": "image_generation", "task_mode": "describe",
		"prompt":           "反推提示词",
		"reference_assets": []map[string]any{{"card_id": "c1", "tag_index": 1, "role": "reference_image", "label": "狐狸", "local_path": img}},
	})

	require.Equal(t, "succeeded", task.Status, task.Error)
	assert.Equal(t, "1️⃣ a red fox", task.ResultText)
	assert.Empty(t, task.Assets)
}

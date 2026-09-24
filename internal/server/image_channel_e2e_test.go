package server

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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

// TestImageChannelTask_EndToEnd drives a card-shaped openai task through the real
// HTTP API, poller and OpenAI adapter against a fake provider, down to the file on disk.
func TestImageChannelTask_EndToEnd(t *testing.T) {
	gin.SetMode(gin.TestMode)
	image := []byte("\x89PNG\r\n\x1a\nend-to-end")
	var gotSize string
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		gotSize, _ = body["size"].(string)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": []map[string]string{{"b64_json": base64.StdEncoding.EncodeToString(image)}},
		})
	}))
	defer provider.Close()

	database, err := db.InitDB(filepath.Join(t.TempDir(), "e2e.db"))
	require.NoError(t, err)
	sqlDB, _ := database.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	assetDir := t.TempDir()

	registry := adapter.NewAdapterRegistry(map[string]adapter.ProviderAdapter{
		"openai": adapter.NewOpenAIImageAdapter(adapter.ChannelConfig{BaseURL: provider.URL, APIKey: "sk"}),
	})
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

	r := NewServer(database, assetDir, registry, p).SetupRouter()

	// Same shape the frontend compiler emits for non-Ark image cards.
	w := postJSON(r, "/api/tasks", map[string]any{
		"provider":  "openai",
		"model":     "gpt-image-2",
		"task_type": "image_generation",
		"task_mode": "single",
		"prompt":    "a red fox",
		"params":    map[string]string{"aspect_ratio": "1:1", "resolution": "1K"},
	})
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	var created struct {
		ID string `json:"id"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &created))

	var task struct {
		Status string `json:"status"`
		Error  string `json:"error_message"`
		Assets []struct {
			LocalPath string `json:"local_path"`
		} `json:"assets"`
	}
	require.Eventually(t, func() bool {
		rec := httptest.NewRecorder()
		req, _ := http.NewRequest(http.MethodGet, "/api/tasks/"+created.ID, nil)
		r.ServeHTTP(rec, req)
		_ = json.Unmarshal(rec.Body.Bytes(), &task)
		return task.Status == "succeeded" || task.Status == "failed"
	}, 10*time.Second, 50*time.Millisecond)

	require.Equal(t, "succeeded", task.Status, task.Error)
	assert.Equal(t, "1024x1024", gotSize)
	require.Len(t, task.Assets, 1)
	data, err := os.ReadFile(filepath.Join(assetDir, task.Assets[0].LocalPath))
	require.NoError(t, err)
	assert.Equal(t, image, data)
}

// TestMidjourneyTask_EndToEnd runs a Midjourney image card through the HTTP API, poller
// and adapter against a fake midjourney-proxy: submit, poll through progress, then save
// the 2x2 grid the proxy serves from its own host.
func TestMidjourneyTask_EndToEnd(t *testing.T) {
	gin.SetMode(gin.TestMode)
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
					"imageUrl": proxyURL + "/mj/image/1730000000000001"}
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

	database, err := db.InitDB(filepath.Join(t.TempDir(), "e2e.db"))
	require.NoError(t, err)
	sqlDB, _ := database.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	assetDir := t.TempDir()

	mj, ok := adapter.NewProviderAdapter("midjourney", "midjourney", proxy.URL, "mj-secret", nil)
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

	r := NewServer(database, assetDir, registry, p).SetupRouter()

	w := postJSON(r, "/api/tasks", map[string]any{
		"provider":  "midjourney",
		"model":     "NIJI_JOURNEY",
		"task_type": "image_generation",
		"task_mode": "single",
		"prompt":    "a red fox",
		"params":    map[string]string{"aspect_ratio": "3:2", "resolution": "2K"},
	})
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	var created struct {
		ID string `json:"id"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &created))

	var task struct {
		Status string `json:"status"`
		Error  string `json:"error_message"`
		Assets []struct {
			LocalPath string `json:"local_path"`
		} `json:"assets"`
	}
	require.Eventually(t, func() bool {
		rec := httptest.NewRecorder()
		req, _ := http.NewRequest(http.MethodGet, "/api/tasks/"+created.ID, nil)
		r.ServeHTTP(rec, req)
		_ = json.Unmarshal(rec.Body.Bytes(), &task)
		return task.Status == "succeeded" || task.Status == "failed"
	}, 10*time.Second, 50*time.Millisecond)

	require.Equal(t, "succeeded", task.Status, task.Error)
	assert.Equal(t, "a red fox --ar 3:2", gotPrompt)
	assert.Equal(t, "NIJI_JOURNEY", gotBot)
	assert.GreaterOrEqual(t, fetches.Load(), int32(2), "the task was polled through its progress")
	require.Len(t, task.Assets, 1)
	data, err := os.ReadFile(filepath.Join(assetDir, task.Assets[0].LocalPath))
	require.NoError(t, err)
	assert.Equal(t, grid, data)
}

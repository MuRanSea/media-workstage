package server_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync"
	"testing"
	"testing/fstest"
	"time"
	"media-workstage/internal/adapter"
	"media-workstage/internal/db"
	"media-workstage/internal/model"
	"media-workstage/internal/server"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupTestServer(t *testing.T) (*gin.Engine, *gorm.DB) {
	gin.SetMode(gin.TestMode)
	dbPath := filepath.Join(t.TempDir(), "api_test.db")
	database, err := db.InitDB(dbPath)
	require.NoError(t, err)

	sqlDB, err := database.DB()
	require.NoError(t, err)
	t.Cleanup(func() {
		_ = sqlDB.Close()
	})

	assetDir := t.TempDir()
	fakeAdapter := adapter.NewFakeProviderAdapter("ark")
	adapters := map[string]adapter.ProviderAdapter{
		"ark": fakeAdapter,
	}

	srv := server.NewServer(database, assetDir, adapters)
	r := srv.SetupRouter()

	return r, database
}

func TestServer_HealthAndConfig(t *testing.T) {
	r, _ := setupTestServer(t)

	// 1. GET /health
	w1 := httptest.NewRecorder()
	req1, _ := http.NewRequest(http.MethodGet, "/health", nil)
	r.ServeHTTP(w1, req1)

	assert.Equal(t, http.StatusOK, w1.Code)
	var healthResp map[string]interface{}
	require.NoError(t, json.Unmarshal(w1.Body.Bytes(), &healthResp))
	assert.Equal(t, "ok", healthResp["status"])

	// 2. GET /api/config
	w2 := httptest.NewRecorder()
	req2, _ := http.NewRequest(http.MethodGet, "/api/config", nil)
	r.ServeHTTP(w2, req2)

	assert.Equal(t, http.StatusOK, w2.Code)
	var configResp map[string]interface{}
	require.NoError(t, json.Unmarshal(w2.Body.Bytes(), &configResp))
	assert.NotEmpty(t, configResp["providers"])
}

func TestServer_TaskLifecycleAPI(t *testing.T) {
	r, _ := setupTestServer(t)

	// 1. POST /api/tasks
	createPayload := map[string]interface{}{
		"provider":  "ark",
		"model":     "doubao-seedance-2-5-260628",
		"task_type": "video_generation",
		"task_mode": "all_modal",
		"prompt":    "A cinematic cybernetic warrior in rain",
		"params": map[string]interface{}{
			"duration":   5,
			"resolution": "720p",
			"ratio":      "16:9",
		},
	}
	bodyBytes, _ := json.Marshal(createPayload)

	w1 := httptest.NewRecorder()
	req1, _ := http.NewRequest(http.MethodPost, "/api/tasks", bytes.NewReader(bodyBytes))
	req1.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w1, req1)

	assert.Equal(t, http.StatusCreated, w1.Code)
	var createdTask map[string]interface{}
	require.NoError(t, json.Unmarshal(w1.Body.Bytes(), &createdTask))
	taskID, ok := createdTask["id"].(string)
	require.True(t, ok)
	assert.NotEmpty(t, taskID)

	// 2. GET /api/tasks/:id
	w2 := httptest.NewRecorder()
	req2, _ := http.NewRequest(http.MethodGet, "/api/tasks/"+taskID, nil)
	r.ServeHTTP(w2, req2)

	assert.Equal(t, http.StatusOK, w2.Code)
	var fetchedTask map[string]interface{}
	require.NoError(t, json.Unmarshal(w2.Body.Bytes(), &fetchedTask))
	assert.Equal(t, taskID, fetchedTask["id"])
	assert.Equal(t, "ark", fetchedTask["provider"])

	// 3. GET /api/tasks (list)
	w3 := httptest.NewRecorder()
	req3, _ := http.NewRequest(http.MethodGet, "/api/tasks", nil)
	r.ServeHTTP(w3, req3)

	assert.Equal(t, http.StatusOK, w3.Code)
	var listResp []map[string]interface{}
	require.NoError(t, json.Unmarshal(w3.Body.Bytes(), &listResp))
	assert.GreaterOrEqual(t, len(listResp), 1)
}

func TestServer_SSEEventsHeader(t *testing.T) {
	r, _ := setupTestServer(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	w := httptest.NewRecorder()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, "/api/tasks/events", nil)

	go func() {
		time.Sleep(30 * time.Millisecond)
		cancel()
	}()

	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Header().Get("Content-Type"), "text/event-stream")
	assert.Equal(t, "no-cache", w.Header().Get("Cache-Control"))
	assert.Contains(t, w.Body.String(), "event: ready")
}
func TestServer_MiniMaxTaskCreation(t *testing.T) {
	r, _ := setupTestServer(t)

	createPayload := map[string]interface{}{
		"provider":  "minimax",
		"model":     "MiniMax-H3",
		"task_type": "video_generation",
		"prompt":    "A cinematic landscape in 2K",
		"params": map[string]interface{}{
			"duration":   6,
			"resolution": "2K",
		},
	}
	bodyBytes, _ := json.Marshal(createPayload)

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/tasks", bytes.NewReader(bodyBytes))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusCreated, w.Code)
	var createdTask map[string]interface{}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &createdTask))
	assert.Equal(t, "minimax", createdTask["provider"])
	assert.Equal(t, "MiniMax-H3", createdTask["model"])
}
func TestServer_CardRegenerationMultipleTasks(t *testing.T) {
	r, dbInstance := setupTestServer(t)

	payload := map[string]interface{}{
		"provider":  "ark",
		"model":     "doubao-seedream-5-0-pro-260628",
		"task_type": "image_generation",
		"prompt":    "Card regeneration test prompt",
		"params": map[string]interface{}{
			"size": "2K",
		},
	}
	payloadBytes, _ := json.Marshal(payload)

	// First submission
	w1 := httptest.NewRecorder()
	req1, _ := http.NewRequest(http.MethodPost, "/api/tasks", bytes.NewReader(payloadBytes))
	req1.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w1, req1)
	assert.Equal(t, http.StatusCreated, w1.Code)

	var task1 map[string]interface{}
	require.NoError(t, json.Unmarshal(w1.Body.Bytes(), &task1))
	id1 := task1["id"].(string)
	assert.NotEmpty(t, id1)

	// Second submission (same card payload)
	w2 := httptest.NewRecorder()
	req2, _ := http.NewRequest(http.MethodPost, "/api/tasks", bytes.NewReader(payloadBytes))
	req2.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w2, req2)
	assert.Equal(t, http.StatusCreated, w2.Code)

	var task2 map[string]interface{}
	require.NoError(t, json.Unmarshal(w2.Body.Bytes(), &task2))
	id2 := task2["id"].(string)
	assert.NotEmpty(t, id2)

	// Both IDs must be distinct UUIDs and both exist in DB
	assert.NotEqual(t, id1, id2)

	var count int64
	dbInstance.Table("media_tasks").Where("id IN (?, ?)", id1, id2).Count(&count)
	assert.Equal(t, int64(2), count)
}

func TestServer_EmbeddedSPARoutes(t *testing.T) {
	mockFS := fstest.MapFS{
		"index.html": &fstest.MapFile{
			Data: []byte("<!doctype html><html><head><title>Test SPA</title></head><body><div id='root'></div></body></html>"),
		},
		"static/index-12345.js": &fstest.MapFile{
			Data: []byte("console.log('SPA JS BUNDLE');"),
		},
		"static/index-67890.css": &fstest.MapFile{
			Data: []byte("body { background: #08090f; }"),
		},
	}

	gin.SetMode(gin.TestMode)
	dbPath := filepath.Join(t.TempDir(), "spa_test.db")
	database, err := db.InitDB(dbPath)
	require.NoError(t, err)

	sqlDB, err := database.DB()
	require.NoError(t, err)
	t.Cleanup(func() {
		_ = sqlDB.Close()
	})

	assetDir := t.TempDir()
	adapters := map[string]adapter.ProviderAdapter{
		"ark": adapter.NewFakeProviderAdapter("ark"),
	}

	srv := server.NewServer(database, assetDir, adapters, nil, mockFS)
	r := srv.SetupRouter()

	// 1. GET / -> serves index.html
	w1 := httptest.NewRecorder()
	req1, _ := http.NewRequest(http.MethodGet, "/", nil)
	r.ServeHTTP(w1, req1)
	assert.Equal(t, http.StatusOK, w1.Code)
	assert.Contains(t, w1.Body.String(), "<title>Test SPA</title>")

	// 2. GET /static/index-12345.js -> serves js bundle
	w2 := httptest.NewRecorder()
	req2, _ := http.NewRequest(http.MethodGet, "/static/index-12345.js", nil)
	r.ServeHTTP(w2, req2)
	assert.Equal(t, http.StatusOK, w2.Code)
	assert.Contains(t, w2.Body.String(), "console.log('SPA JS BUNDLE')")

	// 3. GET /static/index-67890.css -> serves css bundle
	w3 := httptest.NewRecorder()
	req3, _ := http.NewRequest(http.MethodGet, "/static/index-67890.css", nil)
	r.ServeHTTP(w3, req3)
	assert.Equal(t, http.StatusOK, w3.Code)
	assert.Contains(t, w3.Body.String(), "background: #08090f")

	// 4. GET /canvas (client-side route) -> SPA fallback to index.html
	w4 := httptest.NewRecorder()
	req4, _ := http.NewRequest(http.MethodGet, "/canvas", nil)
	r.ServeHTTP(w4, req4)
	assert.Equal(t, http.StatusOK, w4.Code)
	assert.Contains(t, w4.Body.String(), "<title>Test SPA</title>")

	// 5. GET /api/nonexistent -> API 404 (does NOT fall back to index.html)
	w5 := httptest.NewRecorder()
	req5, _ := http.NewRequest(http.MethodGet, "/api/nonexistent", nil)
	r.ServeHTTP(w5, req5)
	assert.Equal(t, http.StatusNotFound, w5.Code)
	assert.Contains(t, w5.Body.String(), "API route not found")
}

func TestServer_ConfigEndpoints_MaskingAndPersistence(t *testing.T) {
	r, dbInstance := setupTestServer(t)

	// 1. GET /api/config -> check initial providers structure
	w1 := httptest.NewRecorder()
	req1, _ := http.NewRequest(http.MethodGet, "/api/config", nil)
	r.ServeHTTP(w1, req1)
	assert.Equal(t, http.StatusOK, w1.Code)

	var configResp struct {
		Providers []map[string]interface{} `json:"providers"`
	}
	require.NoError(t, json.Unmarshal(w1.Body.Bytes(), &configResp))
	ids := make([]interface{}, 0, len(configResp.Providers))
	for _, p := range configResp.Providers {
		ids = append(ids, p["id"])
	}
	assert.Equal(t, []interface{}{"ark", "minimax", "kling", "midjourney", "google", "openai", "apimart"}, ids)

	// 2. POST /api/config -> test Cross-Origin rejection (403 Forbidden)
	maliciousPayload := map[string]interface{}{
		"provider": "ark",
		"base_url": "https://ark.cn-beijing.volces.com/api/v3",
		"api_key":  "secret-key",
	}
	maliciousBytes, _ := json.Marshal(maliciousPayload)
	wCross := httptest.NewRecorder()
	reqCross, _ := http.NewRequest(http.MethodPost, "/api/config", bytes.NewReader(maliciousBytes))
	reqCross.Header.Set("Content-Type", "application/json")
	reqCross.Header.Set("Origin", "https://malicious-website.com")
	r.ServeHTTP(wCross, reqCross)
	assert.Equal(t, http.StatusForbidden, wCross.Code)
	assert.Contains(t, wCross.Body.String(), "Cross-origin requests to configuration API are forbidden")

	// 3. POST /api/config -> test SSRF invalid scheme rejection
	invalidPayload := map[string]interface{}{
		"provider": "ark",
		"base_url": "file:///etc/passwd",
		"api_key":  "secret-key-12345",
	}
	invalidBytes, _ := json.Marshal(invalidPayload)
	w2 := httptest.NewRecorder()
	req2, _ := http.NewRequest(http.MethodPost, "/api/config", bytes.NewReader(invalidBytes))
	req2.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w2, req2)
	assert.Equal(t, http.StatusBadRequest, w2.Code)
	assert.Contains(t, w2.Body.String(), "must be http or https")

	// 4. POST /api/config -> link-local (cloud metadata) addresses stay blocked
	ssrfPayload := map[string]interface{}{
		"provider": "ark",
		"base_url": "http://169.254.169.254/latest/meta-data",
		"api_key":  "secret-key-12345",
	}
	ssrfBytes, _ := json.Marshal(ssrfPayload)
	wSSRF := httptest.NewRecorder()
	reqSSRF, _ := http.NewRequest(http.MethodPost, "/api/config", bytes.NewReader(ssrfBytes))
	reqSSRF.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(wSSRF, reqSSRF)
	assert.Equal(t, http.StatusBadRequest, wSSRF.Code)
	assert.Contains(t, wSSRF.Body.String(), "link-local")
	// 3. POST /api/config -> update valid Ark credentials
	validPayload := map[string]interface{}{
		"provider": "ark",
		"base_url": "https://ark.cn-beijing.volces.com/api/v3",
		"api_key":  "ark-abcdef1234567890",
	}
	validBytes, _ := json.Marshal(validPayload)
	w3 := httptest.NewRecorder()
	req3, _ := http.NewRequest(http.MethodPost, "/api/config", bytes.NewReader(validBytes))
	req3.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w3, req3)
	assert.Equal(t, http.StatusOK, w3.Code)

	var updateResp struct {
		Status string                 `json:"status"`
		Config map[string]interface{} `json:"config"`
	}
	require.NoError(t, json.Unmarshal(w3.Body.Bytes(), &updateResp))
	assert.Equal(t, "ok", updateResp.Status)
	// Secret must be masked, not plaintext!
	assert.Equal(t, "ark-****7890", updateResp.Config["masked_key"])

	// 4. Verify persistence in SQLite system_configs table
	var stored model.SystemConfig
	require.NoError(t, dbInstance.First(&stored, "key = ?", "ark_api_key").Error)
	assert.Equal(t, "ark-abcdef1234567890", stored.Value)

	// 5. GET /api/config -> verify masked_key and is_configured status
	w4 := httptest.NewRecorder()
	req4, _ := http.NewRequest(http.MethodGet, "/api/config", nil)
	r.ServeHTTP(w4, req4)
	assert.Equal(t, http.StatusOK, w4.Code)

	var configResp2 struct {
		Providers []map[string]interface{} `json:"providers"`
	}
	require.NoError(t, json.Unmarshal(w4.Body.Bytes(), &configResp2))
	arkP := configResp2.Providers[0]
	assert.Equal(t, true, arkP["is_configured"])
	assert.Equal(t, "ark-****7890", arkP["masked_key"])
}

func TestConcurrent_UpdateConfigAndTaskSubmission(t *testing.T) {
	gin.SetMode(gin.TestMode)
	dbPath := filepath.Join(t.TempDir(), "concurrent_test.db")
	database, err := db.InitDB(dbPath)
	require.NoError(t, err)

	sqlDB, err := database.DB()
	require.NoError(t, err)
	t.Cleanup(func() {
		_ = sqlDB.Close()
	})

	assetDir := t.TempDir()
	fakeArk := adapter.NewFakeProviderAdapter("ark")
	fakeMM := adapter.NewFakeProviderAdapter("minimax")
	adapters := map[string]adapter.ProviderAdapter{
		"ark":     fakeArk,
		"minimax": fakeMM,
	}

	srv := server.NewServer(database, assetDir, adapters)
	r := srv.SetupRouter()

	var wg sync.WaitGroup
	concurrency := 20

	// 1. Concurrent POST /api/config mutations (updating URLs, keys, swapping adapters)
	for i := range concurrency {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			payload := map[string]interface{}{
				"provider": "ark",
				"base_url": "https://ark.cn-beijing.volces.com/api/v3",
				"api_key":  "ark-concurrent-key-12345678",
			}
			b, _ := json.Marshal(payload)
			w := httptest.NewRecorder()
			req, _ := http.NewRequest(http.MethodPost, "/api/config", bytes.NewReader(b))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Origin", "http://localhost:8080")
			r.ServeHTTP(w, req)
			assert.Equal(t, http.StatusOK, w.Code)
		}(i)
	}

	// 2. Concurrent POST /api/tasks submissions and worker processing
	for i := range concurrency {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			payload := map[string]interface{}{
				"provider":  "ark",
				"model":     "doubao-seedance-2-5-260628",
				"task_type": "video_generation",
				"prompt":    "Concurrent video task",
				"params": map[string]interface{}{
					"duration":   5,
					"resolution": "720p",
				},
			}
			b, _ := json.Marshal(payload)
			w := httptest.NewRecorder()
			req, _ := http.NewRequest(http.MethodPost, "/api/tasks", bytes.NewReader(b))
			req.Header.Set("Content-Type", "application/json")
			r.ServeHTTP(w, req)
			assert.Equal(t, http.StatusCreated, w.Code)
		}(i)
	}

	// 3. Concurrent GET /api/config queries
	for i := range concurrency {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			w := httptest.NewRecorder()
			req, _ := http.NewRequest(http.MethodGet, "/api/config", nil)
			r.ServeHTTP(w, req)
			assert.Equal(t, http.StatusOK, w.Code)
		}(i)
	}

	// 4. Concurrent GET /api/tasks queries
	for i := range concurrency {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			w := httptest.NewRecorder()
			req, _ := http.NewRequest(http.MethodGet, "/api/tasks", nil)
			r.ServeHTTP(w, req)
			assert.Equal(t, http.StatusOK, w.Code)
		}(i)
	}

	wg.Wait()
}

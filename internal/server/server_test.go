package server_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"media-workstage/internal/adapter"
	"media-workstage/internal/db"
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

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/tasks/events", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Header().Get("Content-Type"), "text/event-stream")
	assert.Equal(t, "no-cache", w.Header().Get("Cache-Control"))
}

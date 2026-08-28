package server_test

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"media-workstage/internal/server"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupAssetTestEnv(t *testing.T) (string, *gin.Engine) {
	gin.SetMode(gin.TestMode)
	assetDir := t.TempDir()

	// Create sample video file
	videoDir := filepath.Join(assetDir, "videos", "task-123")
	require.NoError(t, os.MkdirAll(videoDir, 0755))
	sampleVideoContent := []byte("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz")
	require.NoError(t, os.WriteFile(filepath.Join(videoDir, "output.mp4"), sampleVideoContent, 0644))

	r := gin.New()
	assetServer := server.NewAssetServer(assetDir)
	assetServer.RegisterRoutes(r)

	return assetDir, r
}

func TestAssetServer_FullAndRangeRequests(t *testing.T) {
	_, r := setupAssetTestEnv(t)

	// 1. Full GET Request (200 OK)
	w1 := httptest.NewRecorder()
	req1, _ := http.NewRequest(http.MethodGet, "/assets/videos/task-123/output.mp4", nil)
	r.ServeHTTP(w1, req1)

	assert.Equal(t, http.StatusOK, w1.Code)
	assert.Equal(t, "bytes", w1.Header().Get("Accept-Ranges"))
	assert.Contains(t, w1.Header().Get("Cache-Control"), "immutable")
	assert.Equal(t, "*", w1.Header().Get("Access-Control-Allow-Origin"))
	assert.Equal(t, "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz", w1.Body.String())

	// 2. Range Request for Video Scrubbing (206 Partial Content)
	w2 := httptest.NewRecorder()
	req2, _ := http.NewRequest(http.MethodGet, "/assets/videos/task-123/output.mp4", nil)
	req2.Header.Set("Range", "bytes=10-19")
	r.ServeHTTP(w2, req2)

	assert.Equal(t, http.StatusPartialContent, w2.Code)
	assert.Equal(t, "bytes 10-19/62", w2.Header().Get("Content-Range"))
	assert.Equal(t, "ABCDEFGHIJ", w2.Body.String())

	// 3. Directory Traversal Attack Guard
	w3 := httptest.NewRecorder()
	req3, _ := http.NewRequest(http.MethodGet, "/assets/../../secret.txt", nil)
	r.ServeHTTP(w3, req3)

	assert.True(t, w3.Code == http.StatusForbidden || w3.Code == http.StatusNotFound)

	// 4. Missing File (404 Not Found)
	w4 := httptest.NewRecorder()
	req4, _ := http.NewRequest(http.MethodGet, "/assets/videos/task-123/missing.mp4", nil)
	r.ServeHTTP(w4, req4)

	assert.Equal(t, http.StatusNotFound, w4.Code)
}

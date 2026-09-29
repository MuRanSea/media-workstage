package server

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"media-workstage/internal/adapter"
	"media-workstage/internal/db"
	"media-workstage/internal/project"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func multipartRequest(t *testing.T, path string, fields map[string]string, fileName string, data []byte) *http.Request {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	for k, v := range fields {
		require.NoError(t, w.WriteField(k, v))
	}
	if fileName != "" {
		part, err := w.CreateFormFile("file", fileName)
		require.NoError(t, err)
		_, _ = part.Write(data)
	}
	require.NoError(t, w.Close())
	req, _ := http.NewRequest(http.MethodPost, path, &buf)
	req.Header.Set("Content-Type", w.FormDataContentType())
	return req
}

func setupUploadServer(t *testing.T) (*gin.Engine, *Server, *project.Store) {
	gin.SetMode(gin.TestMode)
	database, err := db.InitDB(filepath.Join(t.TempDir(), "u.db"))
	require.NoError(t, err)
	sqlDB, _ := database.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	store, err := project.NewStore(t.TempDir())
	require.NoError(t, err)
	srv := NewServer(database, t.TempDir(), adapter.NewAdapterRegistry(nil), store)
	return srv.SetupRouter(), srv, store
}

// fakePlatform mimics the Heighliner asset and file endpoints.
func fakePlatform(t *testing.T) *httptest.Server {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "Bearer sk-test", r.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/volcengine/assets/create":
			require.NoError(t, r.ParseMultipartForm(1<<20))
			assert.Equal(t, "Video", r.FormValue("asset_type"))
			_, _ = w.Write([]byte(`{"success":true,"data":{"id":"asset-1","uri":"asset://asset-1","status":"Processing"}}`))
		case "/api/volcengine/assets/check":
			_, _ = w.Write([]byte(`{"success":true,"data":{"id":"asset-1","uri":"asset://asset-1","status":"Active"}}`))
		case "/api/files/upload":
			_, _ = w.Write([]byte(`{"success":true,"data":{"file_url":"https://tos.example/v.mp4?sig=1","expires_at":1700000000}}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(ts.Close)
	return ts
}

func TestUploads_LocalThenRemote(t *testing.T) {
	r, srv, store := setupUploadServer(t)
	platform := fakePlatform(t)

	// The preset OpenAI provider stands in for "a provider on the platform".
	require.NoError(t, upsertConfigs(srv.db, map[string]string{
		"openai_base_url": platform.URL + "/v1",
		"openai_api_key":  "sk-test",
	}))

	doc, err := store.Create("上传")
	require.NoError(t, err)

	// Save the video into the project.
	w := httptest.NewRecorder()
	r.ServeHTTP(w, multipartRequest(t, "/api/projects/"+doc.ID+"/uploads", map[string]string{"kind": "video"}, "clip.mp4", []byte("video-bytes")))
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	var saved struct {
		LocalPath string `json:"local_path"`
		Mime      string `json:"mime"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &saved))
	assert.True(t, strings.HasPrefix(saved.LocalPath, "/assets/uploads/"), saved.LocalPath)
	assert.Equal(t, "video/mp4", saved.Mime)
	dir, _ := store.Dir(doc.ID)
	onDisk, err := os.ReadFile(filepath.Join(dir, "assets", "uploads", filepath.Base(saved.LocalPath)))
	require.NoError(t, err)
	assert.Equal(t, "video-bytes", string(onDisk))

	fields := map[string]string{"provider": "openai", "project_id": doc.ID, "local_path": saved.LocalPath}

	// Asset library: returns the asset id while review is still pending.
	w = httptest.NewRecorder()
	r.ServeHTTP(w, multipartRequest(t, "/api/uploads/asset", fields, "", nil))
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var asset map[string]any
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &asset))
	assert.Equal(t, "asset-1", asset["asset_id"])
	assert.Equal(t, "asset://asset-1", asset["uri"])
	assert.Equal(t, "Processing", asset["status"])

	w = sendJSON(r, http.MethodPost, "/api/uploads/asset/status", map[string]string{"provider": "openai", "asset_id": "asset-1"})
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.Contains(t, w.Body.String(), `"status":"Active"`)

	// File upload: returns a download URL.
	w = httptest.NewRecorder()
	r.ServeHTTP(w, multipartRequest(t, "/api/uploads/file", fields, "", nil))
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.Contains(t, w.Body.String(), "https://tos.example/v.mp4?sig=1")
}

func TestUploads_Rejections(t *testing.T) {
	r, srv, store := setupUploadServer(t)
	doc, err := store.Create("拒绝")
	require.NoError(t, err)

	// Wrong extension for the declared kind.
	w := httptest.NewRecorder()
	r.ServeHTTP(w, multipartRequest(t, "/api/projects/"+doc.ID+"/uploads", map[string]string{"kind": "image"}, "clip.mp4", []byte("x")))
	assert.Equal(t, http.StatusBadRequest, w.Code)

	// Path traversal out of the project folder.
	require.NoError(t, upsertConfigs(srv.db, map[string]string{"openai_base_url": "http://127.0.0.1:1", "openai_api_key": "sk"}))
	w = httptest.NewRecorder()
	r.ServeHTTP(w, multipartRequest(t, "/api/uploads/file", map[string]string{"provider": "openai", "project_id": doc.ID, "local_path": "/assets/../../x.png"}, "", nil))
	assert.Equal(t, http.StatusBadRequest, w.Code)

	// Provider without a key.
	w = httptest.NewRecorder()
	r.ServeHTTP(w, multipartRequest(t, "/api/uploads/file", map[string]string{"provider": "google"}, "a.png", []byte("x")))
	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "API Key")
}

package server

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"media-workstage/internal/adapter"
	"media-workstage/internal/db"
	"media-workstage/internal/model"
	"media-workstage/internal/poller"
	"media-workstage/internal/project"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func sendJSON(r *gin.Engine, method, path string, body any) *httptest.ResponseRecorder {
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(method, path, &buf)
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	return w
}

func TestProjectsAPI_CreateSaveConflictRenameDelete(t *testing.T) {
	gin.SetMode(gin.TestMode)
	database, err := db.InitDB(filepath.Join(t.TempDir(), "p.db"))
	require.NoError(t, err)
	sqlDB, _ := database.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	store, err := project.NewStore(t.TempDir())
	require.NoError(t, err)
	r := NewServer(database, t.TempDir(), adapter.NewAdapterRegistry(nil), store).SetupRouter()

	w := postJSON(r, "/api/projects", map[string]string{"name": "短片"})
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	var created project.Document
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &created))

	save := map[string]any{
		"revision": created.Revision,
		"viewport": map[string]float64{"zoom": 1.5, "panX": 10, "panY": 20},
		"cards":    []map[string]any{{"id": "c1", "type": "image", "x": 1, "y": 2}},
	}
	w = sendJSON(r, http.MethodPut, "/api/projects/"+created.ID, save)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())

	// Second save from a tab still holding the old revision is rejected.
	w = sendJSON(r, http.MethodPut, "/api/projects/"+created.ID, save)
	require.Equal(t, http.StatusConflict, w.Code)

	w = sendJSON(r, http.MethodGet, "/api/projects/"+created.ID, nil)
	require.Equal(t, http.StatusOK, w.Code)
	var got project.Document
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &got))
	assert.Equal(t, int64(2), got.Revision)
	assert.Equal(t, 1.5, got.Viewport.Zoom)
	assert.JSONEq(t, `[{"id":"c1","type":"image","x":1,"y":2}]`, string(got.Cards))

	w = sendJSON(r, http.MethodPatch, "/api/projects/"+created.ID, map[string]string{"name": "新名字"})
	require.Equal(t, http.StatusOK, w.Code)

	w = sendJSON(r, http.MethodGet, "/api/projects", nil)
	require.Equal(t, http.StatusOK, w.Code)
	var list struct {
		Root     string            `json:"root"`
		Projects []project.Summary `json:"projects"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &list))
	require.Len(t, list.Projects, 1)
	assert.Equal(t, "新名字", list.Projects[0].Name)
	assert.Equal(t, 1, list.Projects[0].CardCounts["image"])

	w = sendJSON(r, http.MethodDelete, "/api/projects/"+created.ID, nil)
	require.Equal(t, http.StatusNoContent, w.Code)
	w = sendJSON(r, http.MethodGet, "/api/projects/"+created.ID, nil)
	require.Equal(t, http.StatusNotFound, w.Code)
}

func TestProjectsAPI_WritesRejectCrossOrigin(t *testing.T) {
	gin.SetMode(gin.TestMode)
	database, err := db.InitDB(filepath.Join(t.TempDir(), "p.db"))
	require.NoError(t, err)
	sqlDB, _ := database.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	store, err := project.NewStore(t.TempDir())
	require.NoError(t, err)
	r := NewServer(database, t.TempDir(), adapter.NewAdapterRegistry(nil), store).SetupRouter()

	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/projects", bytes.NewBufferString(`{"name":"x"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://evil.example")
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusForbidden, w.Code)
}

// TestProjectTask_DownloadsIntoProjectFolder checks that a task created with a
// project_id lands in <project>/assets and is served from the project route.
func TestProjectTask_DownloadsIntoProjectFolder(t *testing.T) {
	gin.SetMode(gin.TestMode)
	image := []byte("\x89PNG\r\n\x1a\nproject")
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data": []map[string]string{{"b64_json": base64.StdEncoding.EncodeToString(image)}},
		})
	}))
	defer provider.Close()

	database, err := db.InitDB(filepath.Join(t.TempDir(), "e2e.db"))
	require.NoError(t, err)
	sqlDB, _ := database.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	globalAssets := t.TempDir()
	store, err := project.NewStore(t.TempDir())
	require.NoError(t, err)

	registry := adapter.NewAdapterRegistry(map[string]adapter.ProviderAdapter{
		"openai": adapter.NewOpenAIImageAdapter(adapter.ChannelConfig{BaseURL: provider.URL, APIKey: "sk"}),
	})
	p := poller.NewTaskPoller(poller.TaskPollerConfig{
		DB:                database,
		Registry:          registry,
		AssetDir:          globalAssets,
		AssetRoot:         func(task *model.MediaTask) string { return store.AssetRoot(task.ProjectID) },
		ImagePollInterval: 50 * time.Millisecond,
		ImageInitialDelay: 10 * time.Millisecond,
	})
	ctx, cancel := context.WithCancel(context.Background())
	p.Start(ctx)
	t.Cleanup(func() { cancel(); p.Stop() })
	r := NewServer(database, globalAssets, registry, p, store).SetupRouter()

	doc, err := store.Create("proj")
	require.NoError(t, err)

	w := postJSON(r, "/api/tasks", map[string]any{
		"project_id": doc.ID,
		"provider":   "openai",
		"model":      "gpt-image-2",
		"task_type":  "image_generation",
		"task_mode":  "single",
		"prompt":     "a red fox",
		"params":     map[string]string{"aspect_ratio": "1:1", "resolution": "1K"},
	})
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	var created model.MediaTask
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &created))
	assert.Equal(t, doc.ID, created.ProjectID)

	var task model.MediaTask
	require.Eventually(t, func() bool {
		rec := sendJSON(r, http.MethodGet, "/api/tasks/"+created.ID, nil)
		_ = json.Unmarshal(rec.Body.Bytes(), &task)
		return task.Status == "succeeded" || task.Status == "failed"
	}, 10*time.Second, 50*time.Millisecond)
	require.Equal(t, "succeeded", task.Status, task.ErrorMessage)
	require.Len(t, task.Assets, 1)

	dir, _ := store.Dir(doc.ID)
	data, err := os.ReadFile(filepath.Join(dir, project.AssetsDir, task.Assets[0].LocalPath))
	require.NoError(t, err)
	assert.Equal(t, image, data)
	_, err = os.Stat(filepath.Join(globalAssets, task.Assets[0].LocalPath))
	assert.True(t, os.IsNotExist(err), "project task must not write into the global asset dir")

	rec := sendJSON(r, http.MethodGet, "/api/projects/"+doc.ID+"/assets/"+task.Assets[0].LocalPath, nil)
	require.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, image, rec.Body.Bytes())
}

func TestProjectTask_UnknownProjectRejected(t *testing.T) {
	gin.SetMode(gin.TestMode)
	database, err := db.InitDB(filepath.Join(t.TempDir(), "p.db"))
	require.NoError(t, err)
	sqlDB, _ := database.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	store, err := project.NewStore(t.TempDir())
	require.NoError(t, err)
	r := NewServer(database, t.TempDir(), adapter.NewAdapterRegistry(nil), store).SetupRouter()

	w := postJSON(r, "/api/tasks", map[string]any{
		"project_id": "nope", "provider": "ark", "model": "m", "task_type": "image_generation", "prompt": "x",
	})
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestResolveProjectReferences(t *testing.T) {
	dir := t.TempDir()
	refs := []model.ReferenceItem{
		{LocalPath: "assets/images/t1/base.png"},
		{LocalPath: "/assets/images/t2/base.png"},
		{URL: "https://example.com/a.png"},
	}
	require.NoError(t, resolveProjectReferences(dir, refs))
	assert.Equal(t, filepath.Join(dir, "assets", "images", "t1", "base.png"), refs[0].LocalPath)
	assert.Equal(t, filepath.Join(dir, "assets", "images", "t2", "base.png"), refs[1].LocalPath)
	assert.Empty(t, refs[2].LocalPath)

	bad := []model.ReferenceItem{{LocalPath: "assets/../../secret.txt"}}
	assert.Error(t, resolveProjectReferences(dir, bad))
}

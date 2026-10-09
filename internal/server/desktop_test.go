package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"media-workstage/internal/adapter"
	"media-workstage/internal/db"
	"media-workstage/internal/desktop"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func newDesktopTestRouter(t *testing.T, mode *desktop.Mode) *gin.Engine {
	gin.SetMode(gin.TestMode)
	database, err := db.InitDB(filepath.Join(t.TempDir(), "d.db"))
	require.NoError(t, err)
	sqlDB, _ := database.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	opts := []interface{}{}
	if mode != nil {
		opts = append(opts, mode)
	}
	return NewServer(database, t.TempDir(), adapter.NewAdapterRegistry(nil), opts...).SetupRouter()
}

func TestDesktopAPI_BrowserModeIsDisabled(t *testing.T) {
	r := newDesktopTestRouter(t, nil)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/desktop", nil))
	require.Equal(t, http.StatusOK, w.Code)
	require.JSONEq(t, `{"enabled":false}`, w.Body.String())

	require.Equal(t, http.StatusNotFound, sendJSON(r, http.MethodPut, "/api/desktop/settings", desktop.Settings{}).Code)
	require.Equal(t, http.StatusNotFound, postJSON(r, "/api/desktop/restart", nil).Code)
}

func TestDesktopAPI_SaveSettingsWritesFileAndRejectsBadDirs(t *testing.T) {
	settingsPath := filepath.Join(t.TempDir(), "settings.json")
	r := newDesktopTestRouter(t, &desktop.Mode{
		SettingsPath: settingsPath,
		DataDir:      `C:\data`,
		ProjectsDir:  `C:\projects`,
		LogsDir:      `C:\data\logs`,
	})

	newProjects := filepath.Join(t.TempDir(), "elsewhere", "projects")
	w := sendJSON(r, http.MethodPut, "/api/desktop/settings", desktop.Settings{ProjectsDir: newProjects})
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())

	saved, err := desktop.Load(settingsPath)
	require.NoError(t, err)
	require.Equal(t, desktop.Settings{ProjectsDir: newProjects}, saved)
	require.DirExists(t, newProjects)

	// The running directories stay as started until the restart.
	w = httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/desktop", nil))
	var got struct {
		Enabled     bool             `json:"enabled"`
		ProjectsDir string           `json:"projects_dir"`
		Settings    desktop.Settings `json:"settings"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &got))
	require.True(t, got.Enabled)
	require.Equal(t, `C:\projects`, got.ProjectsDir)
	require.Equal(t, newProjects, got.Settings.ProjectsDir)

	w = sendJSON(r, http.MethodPut, "/api/desktop/settings", desktop.Settings{DataDir: "relative/dir"})
	require.Equal(t, http.StatusBadRequest, w.Code)
	saved, _ = desktop.Load(settingsPath)
	require.Equal(t, newProjects, saved.ProjectsDir, "a rejected save leaves the file alone")
}

func TestDesktopAPI_RestartCallsTheShellHook(t *testing.T) {
	restarted := make(chan struct{})
	r := newDesktopTestRouter(t, &desktop.Mode{
		SettingsPath: filepath.Join(t.TempDir(), "settings.json"),
		Restart:      func() { close(restarted) },
	})
	require.Equal(t, http.StatusAccepted, postJSON(r, "/api/desktop/restart", nil).Code)
	<-restarted
}

package server

import (
	"net/http"
	"time"

	"media-workstage/internal/desktop"

	"github.com/gin-gonic/gin"
)

// Desktop mode endpoints (ADR 0007). In browser mode GET reports enabled=false and
// the rest answer 404, so the settings UI hides the directory section.
func (s *Server) registerDesktopRoutes(api *gin.RouterGroup) {
	api.GET("/desktop", s.handleGetDesktop)
	api.PUT("/desktop/settings", s.sameOriginOnlyMiddleware(), s.handleSaveDesktopSettings)
	api.POST("/desktop/restart", s.sameOriginOnlyMiddleware(), s.handleDesktopRestart)
	api.POST("/desktop/open-logs", s.sameOriginOnlyMiddleware(), s.handleOpenLogs)
}

func (s *Server) handleGetDesktop(c *gin.Context) {
	if s.desktop == nil {
		c.JSON(http.StatusOK, gin.H{"enabled": false})
		return
	}
	saved, err := desktop.Load(s.desktop.SettingsPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"enabled":      true,
		"data_dir":     s.desktop.DataDir,
		"projects_dir": s.desktop.ProjectsDir,
		"logs_dir":     s.desktop.LogsDir,
		"settings":     saved,
	})
}

func (s *Server) handleSaveDesktopSettings(c *gin.Context) {
	if s.desktop == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not running as the desktop app"})
		return
	}
	var req desktop.Settings
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	for _, dir := range []string{req.DataDir, req.ProjectsDir} {
		if err := desktop.CheckDir(dir); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
	}
	if err := desktop.Save(s.desktop.SettingsPath, req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"settings": req})
}

func (s *Server) handleDesktopRestart(c *gin.Context) {
	if s.desktop == nil || s.desktop.Restart == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not running as the desktop app"})
		return
	}
	c.JSON(http.StatusAccepted, gin.H{"status": "restarting"})
	// Let the response reach the page before the process goes away.
	go func() {
		time.Sleep(200 * time.Millisecond)
		s.desktop.Restart()
	}()
}

func (s *Server) handleOpenLogs(c *gin.Context) {
	if s.desktop == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not running as the desktop app"})
		return
	}
	if err := desktop.OpenFolder(s.desktop.LogsDir); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

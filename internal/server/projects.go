package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"media-workstage/internal/model"
	"media-workstage/internal/project"

	"github.com/gin-gonic/gin"
)

type createProjectPayload struct {
	Name string `json:"name"`
}

type saveProjectPayload struct {
	Revision int64            `json:"revision"`
	Viewport project.Viewport `json:"viewport"`
	Cards    json.RawMessage  `json:"cards" binding:"required"`
}

type renameProjectPayload struct {
	Name string `json:"name" binding:"required"`
}

func (s *Server) registerProjectRoutes(api *gin.RouterGroup) {
	projects := api.Group("/projects")
	projects.Use(s.requireProjects)
	projects.GET("", s.handleListProjects)
	projects.POST("", s.sameOriginOnlyMiddleware(), s.handleCreateProject)
	projects.GET("/:id", s.handleGetProject)
	projects.PUT("/:id", s.sameOriginOnlyMiddleware(), s.handleSaveProject)
	projects.PATCH("/:id", s.sameOriginOnlyMiddleware(), s.handleRenameProject)
	projects.DELETE("/:id", s.sameOriginOnlyMiddleware(), s.handleDeleteProject)
	projects.POST("/:id/reveal", s.sameOriginOnlyMiddleware(), s.handleRevealProject)
	projects.GET("/:id/assets/*filepath", s.handleProjectAsset)
	projects.HEAD("/:id/assets/*filepath", s.handleProjectAsset)
}

func (s *Server) requireProjects(c *gin.Context) {
	if s.projects == nil {
		c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"error": "Project storage is not configured"})
		return
	}
	c.Next()
}

// respondProjectError maps store errors onto HTTP statuses.
func respondProjectError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, project.ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "Project not found"})
	default:
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	}
}

func (s *Server) handleListProjects(c *gin.Context) {
	list, err := s.projects.List()
	if err != nil {
		respondProjectError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"root": s.projects.Root(), "projects": list})
}

func (s *Server) handleCreateProject(c *gin.Context) {
	var payload createProjectPayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	doc, err := s.projects.Create(payload.Name)
	if err != nil {
		respondProjectError(c, err)
		return
	}
	c.JSON(http.StatusCreated, doc)
}

func (s *Server) handleGetProject(c *gin.Context) {
	doc, err := s.projects.Get(c.Param("id"))
	if err != nil {
		respondProjectError(c, err)
		return
	}
	c.JSON(http.StatusOK, doc)
}

func (s *Server) handleSaveProject(c *gin.Context) {
	var payload saveProjectPayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	doc, err := s.projects.Save(c.Param("id"), payload.Revision, payload.Viewport, payload.Cards)
	if errors.Is(err, project.ErrConflict) {
		c.JSON(http.StatusConflict, gin.H{"error": "工程已在其他窗口中被修改", "revision": doc.Revision})
		return
	}
	if err != nil {
		if errors.Is(err, project.ErrNotFound) {
			respondProjectError(c, err)
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"revision": doc.Revision, "updatedAt": doc.UpdatedAt})
}

func (s *Server) handleRenameProject(c *gin.Context) {
	var payload renameProjectPayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	doc, err := s.projects.Rename(c.Param("id"), payload.Name)
	if err != nil {
		respondProjectError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"id": doc.ID, "name": doc.Name, "updatedAt": doc.UpdatedAt})
}

func (s *Server) handleDeleteProject(c *gin.Context) {
	if err := s.projects.Delete(c.Param("id")); err != nil {
		respondProjectError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (s *Server) handleRevealProject(c *gin.Context) {
	dir, err := s.projects.Dir(c.Param("id"))
	if err != nil {
		respondProjectError(c, err)
		return
	}
	if err := revealFolder(dir); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

func (s *Server) handleProjectAsset(c *gin.Context) {
	dir, err := s.projects.Dir(c.Param("id"))
	if err != nil {
		c.AbortWithStatusJSON(http.StatusNotFound, gin.H{"error": "Project not found"})
		return
	}
	serveAssetFile(c, filepath.Join(dir, project.AssetsDir), c.Param("filepath"))
}

// resolveProjectReferences rewrites project-relative reference paths
// ("assets/images/...") to absolute paths inside the project folder, so
// adapters read the right file regardless of the process working directory.
func resolveProjectReferences(projectDir string, refs []model.ReferenceItem) error {
	assetsRoot := filepath.Join(projectDir, project.AssetsDir)
	for i := range refs {
		local := refs[i].LocalPath
		if local == "" {
			continue
		}
		rel := strings.TrimLeft(filepath.ToSlash(local), "/")
		rel = strings.TrimPrefix(rel, project.AssetsDir+"/")
		abs := filepath.Join(assetsRoot, filepath.FromSlash(rel))
		if !strings.HasPrefix(abs, assetsRoot+string(filepath.Separator)) {
			return fmt.Errorf("reference path %q escapes the project folder", local)
		}
		refs[i].LocalPath = abs
	}
	return nil
}

func revealFolder(dir string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("explorer.exe", dir)
	case "darwin":
		cmd = exec.Command("open", dir)
	default:
		cmd = exec.Command("xdg-open", dir)
	}
	return cmd.Start()
}

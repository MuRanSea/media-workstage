package server

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"media-workstage/internal/adapter"
	"media-workstage/internal/model"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Server coordinates HTTP API routing, database persistence, and SSE event streaming.
type Server struct {
	db          *gorm.DB
	assetServer *AssetServer
	adapters    map[string]adapter.ProviderAdapter
}

func NewServer(db *gorm.DB, assetDir string, adapters map[string]adapter.ProviderAdapter) *Server {
	return &Server{
		db:          db,
		assetServer: NewAssetServer(assetDir),
		adapters:    adapters,
	}
}

// SetupRouter configures all Gin middleware, static routes, and REST/SSE endpoints.
func (s *Server) SetupRouter() *gin.Engine {
	r := gin.New()
	r.Use(gin.Recovery())

	// Global CORS middleware
	r.Use(func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization, Range")
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	})

	// Static asset streaming
	s.assetServer.RegisterRoutes(r)

	// Health check
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{
			"status":  "ok",
			"version": "0.1.0",
			"time":    time.Now().UTC(),
		})
	})

	// API Group
	api := r.Group("/api")
	{
		api.GET("/config", s.handleGetConfig)
		api.POST("/tasks", s.handleCreateTask)
		api.GET("/tasks", s.handleListTasks)
		api.GET("/tasks/:id", s.handleGetTask)
		api.GET("/tasks/events", s.handleSSEEvents)
	}

	return r
}

func (s *Server) handleGetConfig(c *gin.Context) {
	providers := []gin.H{
		{
			"id":   "ark",
			"name": "火山方舟 (Volcengine Ark)",
			"models": []string{
				"doubao-seedance-2-5-260628",
				"doubao-seedance-2-0-260128",
				"doubao-seedream-5-0-pro-260628",
				"doubao-seedream-5-0-lite-260128",
			},
		},
		{
			"id":   "minimax",
			"name": "MiniMax 官方海螺",
			"models": []string{
				"MiniMax-H3",
				"video-01",
			},
		},
	}

	c.JSON(http.StatusOK, gin.H{
		"providers": providers,
	})
}

type CreateTaskPayload struct {
	Provider        string                 `json:"provider" binding:"required"`
	Model           string                 `json:"model" binding:"required"`
	TaskType        string                 `json:"task_type" binding:"required"`
	TaskMode        string                 `json:"task_mode"`
	Prompt          string                 `json:"prompt" binding:"required"`
	Params          map[string]interface{} `json:"params"`
	ReferenceAssets []model.ReferenceItem  `json:"reference_assets"`
}

func (s *Server) handleCreateTask(c *gin.Context) {
	var payload CreateTaskPayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	paramsBytes, _ := json.Marshal(payload.Params)
	taskID := uuid.New().String()
	now := time.Now().UTC()

	task := model.MediaTask{
		ID:         taskID,
		Provider:   payload.Provider,
		Model:      payload.Model,
		TaskType:   payload.TaskType,
		TaskMode:   payload.TaskMode,
		Prompt:     payload.Prompt,
		ParamsJSON: string(paramsBytes),
		Status:     model.TaskStatusQueued,
		Progress:   0,
		CreatedAt:  now,
		UpdatedAt:  now,
	}

	if err := s.db.Create(&task).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create task record: " + err.Error()})
		return
	}

	c.JSON(http.StatusCreated, task)
}

func (s *Server) handleListTasks(c *gin.Context) {
	var tasks []model.MediaTask
	if err := s.db.Preload("Assets").Order("created_at desc").Limit(100).Find(&tasks).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list tasks: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, tasks)
}

func (s *Server) handleGetTask(c *gin.Context) {
	id := c.Param("id")
	var task model.MediaTask
	if err := s.db.Preload("Assets").First(&task, "id = ?", id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Task not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get task: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, task)
}

func (s *Server) handleSSEEvents(c *gin.Context) {
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("Access-Control-Allow-Origin", "*")

	// Emit initial connection ready event
	initEvent := fmt.Sprintf("event: ready\ndata: {\"status\":\"connected\",\"time\":\"%s\"}\n\n", time.Now().UTC().Format(time.RFC3339))
	_, _ = io.WriteString(c.Writer, initEvent)
	c.Writer.Flush()
}

package server

import (
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"

	"media-workstage/internal/adapter"
	"media-workstage/internal/model"

	"github.com/gin-gonic/gin"
)

func (s *Server) registerMediaRoutes(api *gin.RouterGroup) {
	guard := s.sameOriginOnlyMiddleware()
	api.POST("/tasks/:id/cancel", guard, s.handleCancelMediaTask)
	api.POST("/tasks/:id/delivery/retry", guard, s.handleRetryMediaDelivery)
	api.POST("/tasks/:id/billing/refresh", guard, s.handleRefreshMediaBilling)
	api.POST("/media/callbacks/:provider", s.handleMediaCallback)
	media := api.Group("/media/:provider", guard)
	media.GET("/files", s.handleMediaFiles)
	media.POST("/files", s.handleMediaFiles)
	media.GET("/files/:file", s.handleMediaFiles)
	media.DELETE("/files/:file", s.handleMediaFiles)
	media.GET("/tasks", s.handleQueryMediaTasks)
	media.POST("/tasks/query", s.handleQueryMediaTasks)
}

func (s *Server) mediaProvider(c *gin.Context, provider string, taskID string) *adapter.HeighlinerAdapter {
	ad, _ := s.registry.GetForTask(provider, taskID)
	media, ok := ad.(*adapter.HeighlinerAdapter)
	if !ok || !media.GetConfig().IsConfigured {
		c.JSON(http.StatusBadRequest, gin.H{"error": "该服务商不是已配置的 Heighliner"})
		return nil
	}
	return media
}

func writeMediaResource(c *gin.Context, raw json.RawMessage, status int, err error) {
	if err != nil {
		var remote *adapter.HeighlinerAPIError
		if status < 400 || status > 599 {
			status = http.StatusBadGateway
		}
		if errors.As(err, &remote) {
			c.JSON(status, gin.H{"error": remote.Error(), "code": remote.Code})
		} else if status == http.StatusBadGateway {
			c.JSON(status, gin.H{"error": "未能读取网关响应，请确认原操作状态后再试"})
		} else {
			c.JSON(status, gin.H{"error": err.Error()})
		}
		return
	}
	if status == http.StatusNoContent {
		c.Status(status)
		return
	}
	c.Data(status, "application/json", raw)
}

func (s *Server) handleCancelMediaTask(c *gin.Context) {
	var task model.MediaTask
	if s.db.First(&task, "id = ?", c.Param("id")).Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "任务不存在"})
		return
	}
	if task.ProjectID != c.Query("project_id") || task.TaskType != "video_generation" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "取消的任务与当前工程或类型不匹配"})
		return
	}
	switch task.Status {
	case model.TaskStatusCancelled:
		c.JSON(http.StatusOK, task)
		return
	case model.TaskStatusRunning:
		if task.ProviderTaskID != "" && task.DeliveryStatus == "" {
			break
		}
		fallthrough
	default:
		c.JSON(http.StatusConflict, gin.H{"error": "任务尚未取得平台 ID 或已结束，不能取消"})
		return
	}
	var capability struct {
		SupportsCancel bool `json:"supports_cancel"`
	}
	raw := storedCapabilities(s.storedConfig(), task.Provider)[task.Model]
	if json.Unmarshal(raw, &capability) != nil || !capability.SupportsCancel {
		c.JSON(http.StatusBadRequest, gin.H{"error": "模型未声明支持取消，请确认服务商模型目录"})
		return
	}
	a := s.mediaProvider(c, task.Provider, task.ProviderTaskID)
	if a == nil {
		return
	}
	// The worker uses its original query to settle status, billing and any race with success.
	reply, status, err := a.CancelMediaTask(c.Request.Context(), task.ProviderTaskID)
	if err == nil {
		s.poller.WakeTask(task.ID)
	}
	writeMediaResource(c, reply, status, err)
}

func selectedMediaQuery(src url.Values, keys ...string) url.Values {
	out := make(url.Values)
	for _, key := range keys {
		if v := src.Get(key); v != "" {
			out.Set(key, v)
		}
	}
	return out
}

func (s *Server) handleMediaFiles(c *gin.Context) {
	a := s.mediaProvider(c, c.Param("provider"), "")
	if a == nil {
		return
	}
	var body io.Reader
	ct := ""
	if c.Request.Method == http.MethodPost {
		ct = c.GetHeader("Content-Type")
		mt, _, err := mime.ParseMediaType(ct)
		if err != nil || !strings.EqualFold(mt, "application/json") && !strings.EqualFold(mt, "multipart/form-data") {
			c.JSON(http.StatusUnsupportedMediaType, gin.H{"error": "上传请使用 multipart/form-data 或 JSON"})
			return
		}
		const maxUpload = 685 << 20 // 500 MiB file or its JSON/Base64 representation with envelope
		if c.Request.ContentLength > maxUpload {
			c.Status(http.StatusRequestEntityTooLarge)
			return
		}
		body = http.MaxBytesReader(c.Writer, c.Request.Body, maxUpload)
	}
	query := selectedMediaQuery(c.Request.URL.Query(), "purpose", "group_id", "page", "page_size")
	reply, status, err := a.MediaFiles(c.Request.Context(), c.Request.Method, c.Param("file"), ct, query, body)
	writeMediaResource(c, reply, status, err)
}

func (s *Server) handleQueryMediaTasks(c *gin.Context) {
	a := s.mediaProvider(c, c.Param("provider"), "")
	if a == nil {
		return
	}
	var body io.Reader
	if c.Request.Method == http.MethodPost {
		body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
	}
	query := selectedMediaQuery(c.Request.URL.Query(), "task_ids", "external_task_ids")
	raw, status, err := a.QueryMediaTasks(c.Request.Context(), query, body)
	writeMediaResource(c, raw, status, err)
}

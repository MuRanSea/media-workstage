package server

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"media-workstage/internal/adapter"
	"media-workstage/internal/model"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (s *Server) handleMediaCallback(c *gin.Context) {
	provider := c.Param("provider")
	// Unlike the local configuration API this endpoint may receive a forwarded HTTPS
	// callback, but only a configured provider and a valid HMAC may wake a task.
	ad, _ := s.registry.Get(provider)
	a, ok := ad.(*adapter.HeighlinerAdapter)
	if !ok || !a.MediaCallbackEnabled() {
		c.Status(http.StatusNotFound)
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10))
	if err != nil {
		c.Status(http.StatusRequestEntityTooLarge)
		return
	}
	var payload struct {
		Object    string `json:"object"`
		ID        string `json:"id"`
		Challenge string `json:"challenge"`
	}
	if json.Unmarshal(body, &payload) != nil {
		c.Status(http.StatusBadRequest)
		return
	}
	if payload.Object == "" && payload.ID == "" && payload.Challenge != "" && len(payload.Challenge) <= 4096 && c.GetHeader("X-Heighliner-Signature") == "" && c.GetHeader("X-Heighliner-Event-Id") == "" && c.GetHeader("X-Heighliner-Event-Sequence") == "" {
		c.JSON(http.StatusOK, gin.H{"challenge": payload.Challenge})
		return
	}
	event, seq, verified := a.VerifyMediaCallback(c.Request.Header, body, time.Now())
	if !verified {
		c.Status(http.StatusUnauthorized)
		return
	}
	if payload.Object != "media.task.event" || payload.ID == "" || len(payload.ID) > 255 {
		c.Status(http.StatusBadRequest)
		return
	}
	var task model.MediaTask
	err = s.db.Where("provider = ? AND provider_task_id = ?", provider, payload.ID).First(&task).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		// The submit reply may not be persisted yet. Normal polling still resumes it.
		c.Status(http.StatusNoContent)
		return
	}
	if err != nil {
		c.Status(http.StatusServiceUnavailable)
		return
	}
	result := s.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "task_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"sequence", "event_id"}),
		Where:     clause.Where{Exprs: []clause.Expression{clause.Expr{SQL: "media_callback_receipts.sequence < excluded.sequence AND media_callback_receipts.event_id <> excluded.event_id"}}},
	}).Create(&model.MediaCallbackReceipt{TaskID: task.ID, Sequence: seq, EventID: event})
	if result.Error != nil {
		c.Status(http.StatusServiceUnavailable)
		return
	}
	if result.RowsAffected != 0 {
		s.poller.WakeTask(task.ID)
	}
	c.Status(http.StatusNoContent)
}

func (s *Server) handleRefreshMediaBilling(c *gin.Context) {
	var task model.MediaTask
	if s.db.First(&task, "id = ? AND project_id = ?", c.Param("id"), c.Query("project_id")).Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "任务不存在"})
		return
	}
	if task.ProviderTaskID == "" || task.Status == model.TaskStatusQueued || task.Status == model.TaskStatusRunning {
		c.JSON(http.StatusConflict, gin.H{"error": "原任务尚未结束，请等待查询结果"})
		return
	}
	if s.mediaProvider(c, task.Provider, task.ProviderTaskID) == nil {
		return
	}
	fresh, err := s.poller.RefreshMediaBilling(c.Request.Context(), &task)
	if err != nil {
		writeMediaResource(c, nil, 0, err)
		return
	}
	c.JSON(http.StatusOK, fresh)
}

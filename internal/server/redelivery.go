package server

import (
	"errors"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"media-workstage/internal/model"
	"media-workstage/internal/poller"
	"net/http"
)

func (s *Server) handleRetryMediaDelivery(c *gin.Context) {
	var task model.MediaTask
	err := s.db.WithContext(c.Request.Context()).First(&task, "id = ? AND project_id = ?", c.Param("id"), c.Query("project_id")).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.Status(http.StatusNotFound)
		return
	}
	if err != nil {
		c.Status(http.StatusServiceUnavailable)
		return
	}
	if task.ProviderTaskID == "" {
		c.Status(http.StatusConflict)
		return
	}
	if s.mediaProvider(c, task.Provider, task.ProviderTaskID) == nil {
		return
	}
	err = s.poller.RequeueDelivery(c.Request.Context(), &task)
	if errors.Is(err, poller.ErrNotRedeliverable) {
		c.JSON(http.StatusConflict, gin.H{"error": "只有已生成且缺少文件的原任务可补下载"})
		return
	}
	if err != nil {
		c.Status(http.StatusServiceUnavailable)
		return
	}
	c.JSON(http.StatusAccepted, gin.H{"id": task.ID})
}

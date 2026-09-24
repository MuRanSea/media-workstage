package server

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"media-workstage/internal/model"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// creatableProtocols are the protocols users can add Custom Providers for. Every
// protocol is modeled as instances (ADR 0004); this list only gates the entry point.
var creatableProtocols = map[model.Protocol]bool{
	model.ProtocolOpenAICompatible: true,
}

// upsertConfigs writes config entries in one transaction.
func upsertConfigs(db *gorm.DB, kv map[string]string) error {
	if len(kv) == 0 {
		return nil
	}
	now := time.Now().UTC()
	return db.Transaction(func(tx *gorm.DB) error {
		for k, v := range kv {
			row := model.SystemConfig{Key: k, Value: v, UpdatedAt: now}
			if err := tx.Clauses(clause.OnConflict{
				Columns:   []clause.Column{{Name: "key"}},
				DoUpdates: clause.AssignmentColumns([]string{"value", "updated_at"}),
			}).Create(&row).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// validateProviderName trims a display name and checks it is non-empty and not used
// by another provider, returning the HTTP status to report when it is not.
func validateProviderName(stored map[string]string, name, exceptID string) (string, int, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", http.StatusBadRequest, errors.New("名称不能为空")
	}
	if len([]rune(name)) > 40 {
		return "", http.StatusBadRequest, errors.New("名称不能超过 40 个字")
	}
	if _, taken := nameTakenBy(stored, name, exceptID); taken {
		return "", http.StatusConflict, errors.New("名称已被其他服务商使用")
	}
	return name, 0, nil
}

func newCustomProviderID(stored map[string]string) string {
	for {
		b := make([]byte, 3)
		_, _ = rand.Read(b)
		id := "custom-" + hex.EncodeToString(b)
		if _, exists := findProvider(stored, id); !exists {
			return id
		}
	}
}

type CreateProviderPayload struct {
	Protocol model.Protocol `json:"protocol" binding:"required"`
	Name     string         `json:"name"`
	BaseURL  string         `json:"base_url" binding:"required"`
	APIKey   string         `json:"api_key"`
}

// handleCreateProvider adds a Custom Provider. Its ID is generated here and never
// changes; the display name can be changed later through POST /api/config.
func (s *Server) handleCreateProvider(c *gin.Context) {
	var payload CreateProviderPayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if !creatableProtocols[payload.Protocol] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "暂不支持新增该接入协议的服务商: " + string(payload.Protocol)})
		return
	}
	if err := validateBaseURL(payload.BaseURL); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid base_url: " + err.Error()})
		return
	}

	s.providersMu.Lock()
	defer s.providersMu.Unlock()

	stored := s.storedConfig()
	name, status, err := validateProviderName(stored, payload.Name, "")
	if err != nil {
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}

	id := newCustomProviderID(stored)
	records := append(customProviderRecords(stored), customProviderRecord{ID: id, Protocol: payload.Protocol})
	recordsJSON, _ := json.Marshal(records)
	configs := map[string]string{
		customProvidersKey: string(recordsJSON),
		id + "_name":       name,
		id + "_base_url":   strings.TrimRight(strings.TrimSpace(payload.BaseURL), "/"),
	}
	if key := strings.TrimSpace(payload.APIKey); key != "" {
		configs[id+"_api_key"] = key
	}
	if err := upsertConfigs(s.db, configs); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save provider: " + err.Error()})
		return
	}

	stored = s.storedConfig()
	spec, _ := findProvider(stored, id)
	if a, ok := liveAdapter(spec, stored); ok {
		s.registry.Set(id, a)
	}
	c.JSON(http.StatusCreated, gin.H{"status": "ok", "config": resolveProvider(spec, stored)})
}

// handleDeleteProvider removes a Custom Provider with its configuration and adapter.
// Preset Providers cannot be deleted, only cleared.
func (s *Server) handleDeleteProvider(c *gin.Context) {
	s.providersMu.Lock()
	defer s.providersMu.Unlock()

	stored := s.storedConfig()
	spec, ok := findProvider(stored, c.Param("id"))
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "服务商不存在: " + c.Param("id")})
		return
	}
	if !spec.Custom {
		c.JSON(http.StatusBadRequest, gin.H{"error": "预置服务商不能删除，可以清除它的配置"})
		return
	}

	var records []customProviderRecord
	for _, r := range customProviderRecords(stored) {
		if r.ID != spec.ID {
			records = append(records, r)
		}
	}
	recordsJSON, _ := json.Marshal(records)
	keys := []string{spec.ID + "_name", spec.ID + "_api_key", spec.ID + "_base_url", spec.ID + "_models"}
	err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("key IN ?", keys).Delete(&model.SystemConfig{}).Error; err != nil {
			return err
		}
		return upsertConfigs(tx, map[string]string{customProvidersKey: string(recordsJSON)})
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete provider: " + err.Error()})
		return
	}

	// Drop the adapter first so no poll starts on it, then fail what was still pending.
	s.registry.Delete(spec.ID)
	failed := s.poller.FailProviderTasks(spec.ID, "ProviderDeleted", "服务商已删除")
	c.JSON(http.StatusOK, gin.H{"status": "ok", "failed_tasks": failed})
}

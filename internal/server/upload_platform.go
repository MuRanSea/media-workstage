package server

import (
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"media-workstage/internal/adapter"
	"media-workstage/internal/model"

	"github.com/gin-gonic/gin"
)

// The Upload Platform is where upload cards send files: the Heighliner platform's own
// business API (asset library /api/volcengine/assets/*, file store /api/files/upload).
// It is configured on its own, not borrowed from a Provider: uploads are not a model
// vendor's feature, and any Provider pointing elsewhere would only offer a dead end.
// See docs/adr/0008-upload-platform.md and https://platform.sgt.site/docs/.
const (
	uploadBaseURLKey      = "upload_base_url"
	uploadAPIKeyKey       = "upload_api_key"
	defaultUploadBaseURL  = "https://platform.sgt.site"
	uploadPlatformDocsURL = "https://platform.sgt.site/docs/"
)

// uploadPlatformCredentials resolves the platform's base URL and key: saved settings
// first, then UPLOAD_BASE_URL / UPLOAD_API_KEY, then the default host.
func uploadPlatformCredentials(stored map[string]string) (baseURL, apiKey string) {
	baseURL = strings.TrimSpace(stored[uploadBaseURLKey])
	if baseURL == "" {
		baseURL = strings.TrimSpace(os.Getenv("UPLOAD_BASE_URL"))
	}
	if baseURL == "" {
		baseURL = defaultUploadBaseURL
	}
	apiKey = strings.TrimSpace(stored[uploadAPIKeyKey])
	if apiKey == "" {
		apiKey = strings.TrimSpace(os.Getenv("UPLOAD_API_KEY"))
	}
	return strings.TrimRight(baseURL, "/"), apiKey
}

// newPlatformClient talks to the platform's root: the business API lives at /api/...,
// so any path on the configured URL is dropped.
func newPlatformClient(baseURL, apiKey string) (*platformClient, error) {
	if apiKey == "" {
		return nil, errors.New("还没有配置上传平台的 API Key：请在「设置 → 上传平台」里填写")
	}
	if err := validateBaseURL(baseURL); err != nil {
		return nil, fmt.Errorf("上传平台地址无效: %w", err)
	}
	u, err := url.Parse(baseURL)
	if err != nil {
		return nil, err
	}
	return &platformClient{
		origin: u.Scheme + "://" + u.Host,
		apiKey: apiKey,
		http:   newSafeClient(10 * time.Minute),
	}, nil
}

func (s *Server) uploadPlatform() (*platformClient, error) {
	return newPlatformClient(uploadPlatformCredentials(s.storedConfig()))
}

func (s *Server) registerUploadPlatformRoutes(api *gin.RouterGroup) {
	api.GET("/uploads/config", s.handleGetUploadConfig)
	api.POST("/uploads/config", s.sameOriginOnlyMiddleware(), s.handleSaveUploadConfig)
	api.POST("/uploads/config/test", s.sameOriginOnlyMiddleware(), s.handleTestUploadConfig)
}

func (s *Server) uploadConfigView() gin.H {
	baseURL, apiKey := uploadPlatformCredentials(s.storedConfig())
	return gin.H{
		"base_url":      baseURL,
		"is_configured": apiKey != "",
		"masked_key":    adapter.MaskSecret(apiKey),
		"docs_url":      uploadPlatformDocsURL,
	}
}

func (s *Server) handleGetUploadConfig(c *gin.Context) {
	c.JSON(http.StatusOK, s.uploadConfigView())
}

type uploadConfigPayload struct {
	BaseURL string `json:"base_url"`
	APIKey  string `json:"api_key"`
	// Clear removes the saved key and address (environment variables still apply).
	Clear bool `json:"clear"`
}

func (s *Server) handleSaveUploadConfig(c *gin.Context) {
	var payload uploadConfigPayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if payload.Clear {
		if err := s.db.Where("key IN ?", []string{uploadBaseURLKey, uploadAPIKeyKey}).Delete(&model.SystemConfig{}).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, s.uploadConfigView())
		return
	}

	toSave := map[string]string{}
	if baseURL := strings.TrimRight(strings.TrimSpace(payload.BaseURL), "/"); baseURL != "" {
		if err := validateBaseURL(baseURL); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "上传平台地址无效: " + err.Error()})
			return
		}
		toSave[uploadBaseURLKey] = baseURL
	}
	if apiKey := strings.TrimSpace(payload.APIKey); apiKey != "" {
		toSave[uploadAPIKeyKey] = apiKey
	}
	if err := upsertConfigs(s.db, toSave); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, s.uploadConfigView())
}

// handleTestUploadConfig checks the address and key with a read-only call: listing one
// asset (POST /api/volcengine/assets/list). It uploads nothing and spends no quota.
// A blank key or address tests the saved one.
func (s *Server) handleTestUploadConfig(c *gin.Context) {
	var payload uploadConfigPayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	savedURL, savedKey := uploadPlatformCredentials(s.storedConfig())
	baseURL, apiKey := strings.TrimSpace(payload.BaseURL), strings.TrimSpace(payload.APIKey)
	if baseURL == "" {
		baseURL = savedURL
	}
	if apiKey == "" {
		apiKey = savedKey
	}
	platform, err := newPlatformClient(baseURL, apiKey)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"ok": false, "message": err.Error()})
		return
	}
	if _, err := platform.postJSON(c.Request.Context(), "/api/volcengine/assets/list", map[string]int{"page": 1, "page_size": 1}); err != nil {
		c.JSON(http.StatusOK, gin.H{"ok": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "message": "连接成功，可以上传素材和文件"})
}

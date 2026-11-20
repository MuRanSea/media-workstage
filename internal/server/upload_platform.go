package server

import (
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

// uploadTarget keeps resolution, settings writes and requests scoped to one operation.
type uploadTarget struct {
	label, baseURLKey, apiKeyKey, envPrefix string
}

var (
	assetUploadTarget = uploadTarget{"上传素材库", uploadBaseURLKey, uploadAPIKeyKey, "UPLOAD"}
	fileUploadTarget  = uploadTarget{"获取链接", "file_upload_base_url", "file_upload_api_key", "FILE_UPLOAD"}
)

func (target uploadTarget) credentials(stored map[string]string) (baseURL, apiKey string) {
	baseURL = strings.TrimSpace(stored[target.baseURLKey])
	if baseURL == "" {
		baseURL = strings.TrimSpace(os.Getenv(target.envPrefix + "_BASE_URL"))
	}
	if baseURL == "" {
		baseURL = defaultUploadBaseURL
	}
	apiKey = strings.TrimSpace(stored[target.apiKeyKey])
	if apiKey == "" {
		apiKey = strings.TrimSpace(os.Getenv(target.envPrefix + "_API_KEY"))
	}
	return strings.TrimRight(baseURL, "/"), apiKey
}

// The business API lives at /api/..., so only the configured origin is used.
func uploadOrigin(baseURL string) string {
	u, err := url.Parse(baseURL)
	if err != nil || u.Host == "" {
		return ""
	}
	return u.Scheme + "://" + u.Host
}

func (target uploadTarget) client(baseURL, apiKey string) (*platformClient, error) {
	if apiKey == "" {
		return nil, fmt.Errorf("还没有配置「%s」的 API Key：请在「设置 → 上传平台」里填写", target.label)
	}
	if err := validateBaseURL(baseURL); err != nil {
		return nil, fmt.Errorf("上传平台地址无效: %w", err)
	}
	return &platformClient{
		origin: uploadOrigin(baseURL),
		apiKey: apiKey,
		http:   newSafeClient(10 * time.Minute),
	}, nil
}

func (s *Server) uploadPlatform(target uploadTarget) (*platformClient, error) {
	return target.client(target.credentials(s.storedConfig()))
}

func (s *Server) registerUploadPlatformRoutes(api *gin.RouterGroup) {
	// Keep the existing endpoints for the asset library.
	s.registerUploadConfig(api, "/uploads/config", assetUploadTarget)
	s.registerUploadConfig(api, "/uploads/config/file", fileUploadTarget)
	api.POST("/uploads/config/test", s.sameOriginOnlyMiddleware(), s.handleTestUploadConfig)
}

func (s *Server) registerUploadConfig(api *gin.RouterGroup, path string, target uploadTarget) {
	api.GET(path, func(c *gin.Context) { c.JSON(http.StatusOK, s.uploadConfigView(target)) })
	api.POST(path, s.sameOriginOnlyMiddleware(), func(c *gin.Context) { s.saveUploadConfig(c, target) })
}

func (s *Server) uploadConfigView(target uploadTarget) gin.H {
	baseURL, apiKey := target.credentials(s.storedConfig())
	return gin.H{
		"base_url":      baseURL,
		"is_configured": apiKey != "",
		"masked_key":    adapter.MaskSecret(apiKey),
		"docs_url":      uploadPlatformDocsURL,
	}
}

// Do not carry an existing secret over to a new origin implicitly.
const uploadOriginChangedMessage = "更换平台地址时，请同时填写该地址的 API Key"

type uploadConfigPayload struct {
	BaseURL string `json:"base_url"`
	APIKey  string `json:"api_key"`
	// Clear removes the saved key and address (environment variables still apply).
	Clear bool `json:"clear"`
}

func (s *Server) saveUploadConfig(c *gin.Context, target uploadTarget) {
	var payload uploadConfigPayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if payload.Clear {
		if err := s.db.Where("key IN ?", []string{target.baseURLKey, target.apiKeyKey}).Delete(&model.SystemConfig{}).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, s.uploadConfigView(target))
		return
	}

	toSave := map[string]string{}
	apiKey := strings.TrimSpace(payload.APIKey)
	if baseURL := strings.TrimRight(strings.TrimSpace(payload.BaseURL), "/"); baseURL != "" {
		if err := validateBaseURL(baseURL); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "上传平台地址无效: " + err.Error()})
			return
		}
		savedURL, savedKey := target.credentials(s.storedConfig())
		if apiKey == "" && savedKey != "" && uploadOrigin(baseURL) != uploadOrigin(savedURL) {
			c.JSON(http.StatusBadRequest, gin.H{"error": uploadOriginChangedMessage})
			return
		}
		toSave[target.baseURLKey] = baseURL
	}
	if apiKey != "" {
		toSave[target.apiKeyKey] = apiKey
	}
	if err := upsertConfigs(s.db, toSave); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, s.uploadConfigView(target))
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
	savedURL, savedKey := assetUploadTarget.credentials(s.storedConfig())
	baseURL, apiKey := strings.TrimSpace(payload.BaseURL), strings.TrimSpace(payload.APIKey)
	if baseURL == "" {
		baseURL = savedURL
	}
	if apiKey == "" {
		if savedKey != "" && uploadOrigin(baseURL) != uploadOrigin(savedURL) {
			c.JSON(http.StatusOK, gin.H{"ok": false, "message": uploadOriginChangedMessage})
			return
		}
		apiKey = savedKey
	}
	platform, err := assetUploadTarget.client(baseURL, apiKey)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"ok": false, "message": err.Error()})
		return
	}
	if _, err := platform.postJSON(c.Request.Context(), "/api/volcengine/assets/list", map[string]int{"page": 1, "page_size": 1}); err != nil {
		c.JSON(http.StatusOK, gin.H{"ok": false, "message": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "message": "连接成功，可以访问素材库"})
}

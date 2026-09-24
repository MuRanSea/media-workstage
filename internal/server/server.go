package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"media-workstage/internal/adapter"
	"media-workstage/internal/llm"
	"media-workstage/internal/model"
	"media-workstage/internal/poller"
	"media-workstage/internal/project"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// Server coordinates HTTP API routing, database persistence, static assets, and SSE event streaming.
type Server struct {
	db          *gorm.DB
	assetServer *AssetServer
	registry    *adapter.AdapterRegistry
	poller      *poller.TaskPoller
	projects    *project.Store
	staticFS    fs.FS

	// providersMu serializes provider list and name changes, which read-check-write
	// the config table (creating, deleting and renaming providers).
	providersMu sync.Mutex
}

func NewServer(
	db *gorm.DB,
	assetDir string,
	adapters interface{}, // map[string]adapter.ProviderAdapter or *adapter.AdapterRegistry
	opts ...interface{},
) *Server {
	var reg *adapter.AdapterRegistry
	switch a := adapters.(type) {
	case *adapter.AdapterRegistry:
		reg = a
	case map[string]adapter.ProviderAdapter:
		reg = adapter.NewAdapterRegistry(a)
	default:
		reg = adapter.NewAdapterRegistry(nil)
	}

	var p *poller.TaskPoller
	var staticFS fs.FS
	var projects *project.Store
	explicitRegistry := false

	for _, opt := range opts {
		switch v := opt.(type) {
		case *poller.TaskPoller:
			p = v
		case *adapter.AdapterRegistry:
			reg = v
			explicitRegistry = true
		case fs.FS:
			staticFS = v
		case *project.Store:
			projects = v
		}
	}

	// Share the poller's registry so adapters hot-swapped by config saves are the
	// ones the poller dispatches to (a registry built from the map would be a copy).
	if p != nil && !explicitRegistry {
		if _, isMap := adapters.(map[string]adapter.ProviderAdapter); isMap {
			reg = p.Registry()
		}
	}

	if p == nil {
		cfg := poller.TaskPollerConfig{
			DB:       db,
			Registry: reg,
			AssetDir: assetDir,
		}
		if projects != nil {
			cfg.AssetRoot = func(task *model.MediaTask) string { return projects.AssetRoot(task.ProjectID) }
		}
		p = poller.NewTaskPoller(cfg)
	}

	return &Server{
		db:          db,
		assetServer: NewAssetServer(assetDir),
		registry:    reg,
		poller:      p,
		projects:    projects,
		staticFS:    staticFS,
	}
}

// Poller returns the TaskPoller instance.
func (s *Server) Poller() *poller.TaskPoller {
	return s.poller
}

// SetStaticFS sets the embedded static filesystem.
func (s *Server) SetStaticFS(staticFS fs.FS) {
	s.staticFS = staticFS
}

func isAllowedOrigin(origin string, reqHost string) bool {
	if origin == "" {
		return true
	}
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	hostname := u.Hostname()
	if hostname == "localhost" || hostname == "127.0.0.1" || hostname == "::1" {
		return true
	}
	reqHostname := strings.Split(reqHost, ":")[0]
	if hostname == reqHostname || u.Host == reqHost {
		return true
	}
	return false
}

func (s *Server) sameOriginOnlyMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if origin != "" && !isAllowedOrigin(origin, c.Request.Host) {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Cross-origin requests to configuration API are forbidden"})
			return
		}
		referer := c.GetHeader("Referer")
		if referer != "" && !isAllowedOrigin(referer, c.Request.Host) {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Cross-origin requests to configuration API are forbidden"})
			return
		}
		c.Next()
	}
}

// SetupRouter configures all Gin middleware, static routes, and REST/SSE endpoints.
func (s *Server) SetupRouter() *gin.Engine {
	r := gin.New()
	r.Use(gin.Recovery())

	// Dynamic CORS middleware respecting same-origin security on local endpoints
	r.Use(func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if origin != "" {
			if isAllowedOrigin(origin, c.Request.Host) {
				c.Header("Access-Control-Allow-Origin", origin)
				c.Header("Vary", "Origin")
			}
		} else {
			c.Header("Access-Control-Allow-Origin", "*")
		}
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization, Range")
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	})

	// Dynamic media asset streaming (/assets/*filepath)
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
		// Secret and config mutations protected by same-origin enforcement
		api.POST("/config", s.sameOriginOnlyMiddleware(), s.handleUpdateConfig)
		api.POST("/config/test", s.sameOriginOnlyMiddleware(), s.handleTestConfig)
		api.POST("/config/models", s.sameOriginOnlyMiddleware(), s.handleListModels)
		api.POST("/providers", s.sameOriginOnlyMiddleware(), s.handleCreateProvider)
		api.DELETE("/providers/:id", s.sameOriginOnlyMiddleware(), s.handleDeleteProvider)
		// Spends the user's tokens with stored keys, so same-origin only as well.
		api.POST("/llm/generate", s.sameOriginOnlyMiddleware(), s.handleGenerateText)
		api.POST("/tasks", s.handleCreateTask)
		api.GET("/tasks", s.handleListTasks)
		api.GET("/tasks/:id", s.handleGetTask)
		api.GET("/tasks/events", s.handleSSEEvents)
		s.registerProjectRoutes(api)
	}

	// Embedded SPA Static File Server & Fallback handler
	if s.staticFS != nil {
		fileServer := http.FileServer(http.FS(s.staticFS))

		r.NoRoute(func(c *gin.Context) {
			path := c.Request.URL.Path

			// Do not fallback API routes or dynamic generated assets
			if strings.HasPrefix(path, "/api/") {
				c.JSON(http.StatusNotFound, gin.H{"error": "API route not found"})
				return
			}
			if strings.HasPrefix(path, "/assets/images/") || strings.HasPrefix(path, "/assets/videos/") || strings.HasPrefix(path, "/assets/uploads/") {
				c.JSON(http.StatusNotFound, gin.H{"error": "Asset not found"})
				return
			}

			// Clean path for file lookup
			cleanPath := strings.TrimPrefix(path, "/")
			if cleanPath == "" {
				cleanPath = "index.html"
			}

			// Try serving exact static asset (e.g. static/index-*.js, favicon.svg)
			if f, err := s.staticFS.Open(cleanPath); err == nil {
				_ = f.Close()
				fileServer.ServeHTTP(c.Writer, c.Request)
				return
			}

			// SPA Fallback: serve index.html for client-side routing
			indexFile, err := s.staticFS.Open("index.html")
			if err == nil {
				defer indexFile.Close()
				indexBytes, err := io.ReadAll(indexFile)
				if err == nil {
					c.Data(http.StatusOK, "text/html; charset=utf-8", indexBytes)
					return
				}
			}

			c.String(http.StatusNotFound, "index.html not found in embedded assets")
		})
	}

	return r
}

func isOfficialProviderHost(host string) bool {
	h := strings.ToLower(strings.Split(host, ":")[0])
	officialDomains := []string{
		"volces.com",
		"volcengineapi.com",
		"minimax.chat",
		"minimaxi.chat",
		"minimaxi.com",
		"minimax.io",
		"klingai.com",
		"kling.ai",
		"googleapis.com",
		"openai.com",
		"apimart.ai",
	}
	for _, domain := range officialDomains {
		// Match the domain itself or a true subdomain, never a lookalike such as "evilvolces.com".
		if h == domain || strings.HasSuffix(h, "."+domain) {
			return true
		}
	}
	return false
}

func validateBaseURL(rawURL string) error {
	raw := strings.TrimSpace(rawURL)
	if raw == "" {
		return errors.New("base_url cannot be empty")
	}
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("invalid URL format: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("invalid URL scheme %q, must be http or https", u.Scheme)
	}
	if u.Host == "" {
		return errors.New("URL host cannot be empty")
	}

	hostname := u.Hostname()

	// Private (10/8, 172.16/12, 192.168/16) and loopback hosts are allowed: self-hosted
	// relays and proxies commonly live there, and config writes are same-origin only.
	// Link-local (169.254/16, incl. cloud metadata) and unspecified addresses never
	// host a provider API, so they stay blocked.
	if !isOfficialProviderHost(hostname) {
		ips, err := net.LookupIP(hostname)
		if err != nil {
			return fmt.Errorf("could not resolve hostname %q: %w", hostname, err)
		}
		if len(ips) == 0 {
			return fmt.Errorf("no IP addresses found for hostname %q", hostname)
		}
		for _, ip := range ips {
			if ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsInterfaceLocalMulticast() || ip.IsUnspecified() {
				return fmt.Errorf("access to link-local or unspecified IP address %s is forbidden", ip.String())
			}
		}
	}

	return nil
}

// storedConfig loads the system_configs table as a key/value map.
func (s *Server) storedConfig() map[string]string {
	stored := make(map[string]string)
	if s.db == nil {
		return stored
	}
	var rows []model.SystemConfig
	if err := s.db.Find(&rows).Error; err == nil {
		for _, row := range rows {
			stored[row.Key] = row.Value
		}
	}
	return stored
}

func (s *Server) handleGetConfig(c *gin.Context) {
	stored := s.storedConfig()
	specs := allProviders(stored)
	providers := make([]providerView, 0, len(specs))
	for _, spec := range specs {
		providers = append(providers, resolveProvider(spec, stored))
	}

	c.JSON(http.StatusOK, gin.H{
		"providers": providers,
	})
}

type UpdateConfigPayload struct {
	Provider string `json:"provider" binding:"required"`
	// Name renames the provider when present; it must stay unique across providers.
	Name    *string           `json:"name"`
	BaseURL string            `json:"base_url"`
	APIKey  string            `json:"api_key"`
	Extra   map[string]string `json:"extra"`
	// Models replaces the provider's bound models when present (nil leaves them as is).
	Models *[]boundModel `json:"models"`
	// Clear wipes the provider's saved key, base URL, extras and bindings.
	Clear bool `json:"clear"`
}

func (s *Server) handleUpdateConfig(c *gin.Context) {
	var payload UpdateConfigPayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	s.providersMu.Lock()
	defer s.providersMu.Unlock()

	stored := s.storedConfig()
	provider := strings.ToLower(strings.TrimSpace(payload.Provider))
	spec, ok := findProvider(stored, provider)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported provider: " + payload.Provider})
		return
	}

	if payload.Clear {
		s.clearProvider(c, spec)
		return
	}

	if strings.TrimSpace(payload.BaseURL) != "" {
		if err := validateBaseURL(payload.BaseURL); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid base_url: " + err.Error()})
			return
		}
	}

	// Persist to system_configs table
	configsToSave := make(map[string]string)
	if payload.Name != nil {
		name, status, err := validateProviderName(stored, *payload.Name, spec.ID)
		if err != nil {
			c.JSON(status, gin.H{"error": err.Error()})
			return
		}
		configsToSave[provider+"_name"] = name
	}
	if strings.TrimSpace(payload.BaseURL) != "" {
		configsToSave[provider+"_base_url"] = strings.TrimRight(strings.TrimSpace(payload.BaseURL), "/")
	}
	if strings.TrimSpace(payload.APIKey) != "" {
		configsToSave[provider+"_api_key"] = strings.TrimSpace(payload.APIKey)
	}
	for key := range spec.ExtraEnv {
		if val, ok := payload.Extra[key]; ok {
			configsToSave[provider+"_"+key] = strings.TrimSpace(val)
		}
	}
	if payload.Models != nil {
		modelsJSON, _ := json.Marshal(sanitizeBoundModels(*payload.Models))
		configsToSave[provider+"_models"] = string(modelsJSON)
	}

	if err := upsertConfigs(s.db, configsToSave); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save configuration: " + err.Error()})
		return
	}

	s.hotReloadAdapter(spec, payload)

	c.JSON(http.StatusOK, gin.H{
		"status": "ok",
		"config": resolveProvider(spec, s.storedConfig()),
	})
}

// clearProvider deletes a provider's saved configuration and its live adapter, so a
// misconfigured provider stops being offered on cards. Providers that run mocked fall
// back to the mock; keys set through environment variables still apply.
func (s *Server) clearProvider(c *gin.Context, spec providerSpec) {
	keys := []string{spec.ID + "_api_key", spec.ID + "_base_url", spec.ID + "_models"}
	for extra := range spec.ExtraEnv {
		keys = append(keys, spec.ID+"_"+extra)
	}
	if err := s.db.Where("key IN ?", keys).Delete(&model.SystemConfig{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to clear configuration: " + err.Error()})
		return
	}

	stored := s.storedConfig()
	if a, ok := liveAdapter(spec, stored); ok {
		s.registry.Set(spec.ID, a)
	} else {
		s.registry.Delete(spec.ID)
	}

	c.JSON(http.StatusOK, gin.H{
		"status": "ok",
		"config": resolveProvider(spec, stored),
	})
}

// hotReloadAdapter keeps the live adapter in step with saved credentials: a new key
// replaces a missing or mock adapter, otherwise the existing adapter is updated in place.
// Protocols without generation support (kling) only persist configuration.
func (s *Server) hotReloadAdapter(spec providerSpec, payload UpdateConfigPayload) {
	provAdapter, ok := s.registry.Get(spec.ID)
	_, isFake := provAdapter.(*adapter.FakeProviderAdapter)

	if (!ok || isFake) && strings.TrimSpace(payload.APIKey) != "" {
		if real, built := liveAdapter(spec, s.storedConfig()); built {
			s.registry.Set(spec.ID, real)
		}
		return
	}

	if cfgAdapter, ok := provAdapter.(adapter.ConfigurableAdapter); ok {
		_ = cfgAdapter.UpdateConfig(payload.BaseURL, payload.APIKey, payload.Extra)
	}
}

type ListModelsPayload struct {
	Provider string `json:"provider" binding:"required"`
	BaseURL  string `json:"base_url"`
	APIKey   string `json:"api_key"`
}

// handleListModels returns a provider's model catalog: fetched live where its protocol
// has a list endpoint (using the typed key, or the saved one), otherwise its presets.
func (s *Server) handleListModels(c *gin.Context) {
	var payload ListModelsPayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	spec, ok := findProvider(s.storedConfig(), strings.ToLower(strings.TrimSpace(payload.Provider)))
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported provider: " + payload.Provider})
		return
	}
	if spec.protocol().listModels == nil {
		c.JSON(http.StatusOK, gin.H{"models": spec.Presets, "source": "preset"})
		return
	}

	baseURL, apiKey := ProviderCredentials(s.storedConfig(), spec.ID)
	if v := strings.TrimSpace(payload.BaseURL); v != "" {
		baseURL = v
	}
	if v := strings.TrimSpace(payload.APIKey); v != "" {
		apiKey = v
	}
	if apiKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请先填写 API Key"})
		return
	}
	if err := validateBaseURL(baseURL); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid base_url: " + err.Error()})
		return
	}

	models, err := spec.protocol().listModels(c.Request.Context(), newSafeClient(20*time.Second), strings.TrimRight(baseURL, "/"), apiKey)
	if err != nil {
		// A provider without a list endpoint still offers its presets, or manual entry.
		var statusErr *httpStatusError
		if errors.As(err, &statusErr) && (statusErr.Status == http.StatusNotFound || statusErr.Status == http.StatusMethodNotAllowed) {
			if len(spec.Presets) > 0 {
				c.JSON(http.StatusOK, gin.H{"models": spec.Presets, "source": "preset"})
				return
			}
			c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("无法获取模型列表：服务没有提供 /models 接口 (HTTP %d)，请在下方手动添加模型 ID", statusErr.Status)})
			return
		}
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"models": models, "source": "remote"})
}

func isHTMLResponse(resp *http.Response) bool {
	return strings.Contains(strings.ToLower(resp.Header.Get("Content-Type")), "text/html")
}

// newSafeClient builds an HTTP client that re-validates every redirect target,
// so user-supplied base URLs cannot pivot into internal addresses.
func newSafeClient(timeout time.Duration) *http.Client {
	return &http.Client{
		Timeout: timeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return errors.New("stopped after 5 redirects")
			}
			return validateBaseURL(req.URL.String())
		},
	}
}

type TestConfigPayload struct {
	Provider string            `json:"provider" binding:"required"`
	BaseURL  string            `json:"base_url" binding:"required"`
	APIKey   string            `json:"api_key" binding:"required"`
	Extra    map[string]string `json:"extra"`
}

func (s *Server) handleTestConfig(c *gin.Context) {
	var payload TestConfigPayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := validateBaseURL(payload.BaseURL); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "Invalid base_url: " + err.Error()})
		return
	}

	spec, ok := findProvider(s.storedConfig(), strings.ToLower(strings.TrimSpace(payload.Provider)))
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "unsupported provider: " + payload.Provider})
		return
	}

	safeClient := newSafeClient(10 * time.Second)

	req, err := spec.protocol().newProbe(c.Request.Context(), strings.TrimRight(strings.TrimSpace(payload.BaseURL), "/"), payload.APIKey, payload.Extra)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"ok": false, "error": err.Error()})
		return
	}

	resp, err := safeClient.Do(req)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"ok": false, "error": "网络连接失败: " + err.Error()})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode == 401 || resp.StatusCode == 403 {
		c.JSON(http.StatusOK, gin.H{
			"ok":    false,
			"error": fmt.Sprintf("API Key 鉴权失败 (HTTP %d)，请检查密钥是否正确或已过期", resp.StatusCode),
		})
		return
	}

	if resp.StatusCode >= 500 {
		c.JSON(http.StatusOK, gin.H{
			"ok":    false,
			"error": fmt.Sprintf("服务商服务端返回错误 (HTTP %d)", resp.StatusCode),
		})
		return
	}

	// 404 always means a wrong path, even for probes that query a dummy task
	// (e.g. the MiniMax provider pointed at an APIMart relay).
	if resp.StatusCode == http.StatusNotFound {
		if hint := spec.protocol().notFoundHint; hint != "" {
			c.JSON(http.StatusOK, gin.H{"ok": false, "error": fmt.Sprintf(hint, req.URL.Path)})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"ok":    false,
			"error": fmt.Sprintf("接口路径不存在 (HTTP 404: %s)，请确认 Base URL 的路径部分是否正确", req.URL.Path),
		})
		return
	}

	if spec.protocol().probeNeeds2xx && (resp.StatusCode < 200 || resp.StatusCode >= 300) {
		c.JSON(http.StatusOK, gin.H{
			"ok":    false,
			"error": fmt.Sprintf("服务商返回 HTTP %d，请检查 Base URL 与 API Key", resp.StatusCode),
		})
		return
	}

	// Relay front-ends (new-api, one-api) answer unknown paths with their web UI and a 200.
	if isHTMLResponse(resp) {
		c.JSON(http.StatusOK, gin.H{
			"ok":    false,
			"error": fmt.Sprintf("%s 返回的是网页而不是 API，Base URL 的路径可能不对（通常以 /v1 或 /v1beta 结尾）", req.URL.Path),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"ok":      true,
		"message": "服务商 API 连接与鉴权成功！",
	})
}

type GenerateTextPayload struct {
	Provider string `json:"provider" binding:"required"`
	Model    string `json:"model" binding:"required"`
	System   string `json:"system"`
	Prompt   string `json:"prompt" binding:"required"`
}

// handleGenerateText runs a text card: one system + user turn against the provider's LLM.
func (s *Server) handleGenerateText(c *gin.Context) {
	var payload GenerateTextPayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	stored := s.storedConfig()
	spec, ok := findProvider(stored, strings.ToLower(strings.TrimSpace(payload.Provider)))
	if !ok || !llm.Supported(spec.Protocol) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "服务商 " + payload.Provider + " 不支持文本生成"})
		return
	}
	baseURL, apiKey := ProviderCredentials(stored, spec.ID)
	if apiKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "服务商 " + providerName(spec, stored) + " 未配置 API Key"})
		return
	}

	client := &http.Client{Timeout: 3 * time.Minute}
	text, err := llm.Generate(c.Request.Context(), client, spec.Protocol, baseURL, apiKey, llm.Request{
		Model:  payload.Model,
		System: payload.System,
		Prompt: payload.Prompt,
	})
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"text": text})
}

type CreateTaskPayload struct {
	ProjectID       string                 `json:"project_id"`
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

	if payload.ProjectID != "" {
		if s.projects == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Project storage is not configured"})
			return
		}
		projectDir, err := s.projects.Dir(payload.ProjectID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Unknown project: " + payload.ProjectID})
			return
		}
		if err := resolveProjectReferences(projectDir, payload.ReferenceAssets); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
	}

	params := payload.Params
	if params == nil {
		params = make(map[string]interface{})
	}
	if len(payload.ReferenceAssets) > 0 {
		params["reference_assets"] = payload.ReferenceAssets
	}
	if err := resolveSourceTask(s.db, payload.Provider, params); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	paramsBytes, _ := json.Marshal(params)
	taskID := uuid.New().String()
	now := time.Now().UTC()

	task := model.MediaTask{
		ID:         taskID,
		ProjectID:  payload.ProjectID,
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

	if s.poller != nil {
		s.poller.Enqueue(task.ID)
		if s.poller.Broadcaster() != nil {
			s.poller.Broadcaster().Broadcast("task.created", task)
		}
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

	if s.poller == nil || s.poller.Broadcaster() == nil {
		return
	}

	eventsCh := s.poller.Broadcaster().Subscribe(c.Request.Context())
	for {
		select {
		case <-c.Request.Context().Done():
			return
		case evt, ok := <-eventsCh:
			if !ok {
				return
			}
			msg := fmt.Sprintf("event: %s\ndata: %s\n\n", evt.Type, evt.Data)
			if _, err := io.WriteString(c.Writer, msg); err != nil {
				return
			}
			c.Writer.Flush()
		}
	}
}

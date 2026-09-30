package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"media-workstage/internal/project"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// Upload limits mirror the platform's: images 10 MiB, videos 200 MiB.
const (
	maxLocalImageBytes = 10 << 20
	maxLocalVideoBytes = 200 << 20
	uploadsSubdir      = "uploads"
)

// Extensions accepted per media kind; the kind is what the upload card asked for.
var uploadExtensions = map[string]map[string]string{
	"image": {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"},
	"video": {".mp4": "video/mp4", ".mov": "video/quicktime"},
}

func (s *Server) registerUploadRoutes(api *gin.RouterGroup) {
	// Saving a file into a project is local; the remote calls spend the provider's key.
	api.POST("/projects/:id/uploads", s.requireProjects, s.sameOriginOnlyMiddleware(), s.handleLocalUpload)
	uploads := api.Group("/uploads", s.sameOriginOnlyMiddleware())
	uploads.POST("/asset", s.handleUploadAsset)
	uploads.POST("/asset/status", s.handleAssetStatus)
	uploads.POST("/file", s.handleUploadFile)
}

// handleLocalUpload stores a picked file under the project's assets/uploads folder and
// returns its project-relative path, so the card can preview it and reference it locally.
func (s *Server) handleLocalUpload(c *gin.Context) {
	kind := strings.ToLower(c.PostForm("kind"))
	exts, ok := uploadExtensions[kind]
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "kind 必须是 image 或 video"})
		return
	}
	header, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少 file 字段"})
		return
	}
	ext := strings.ToLower(filepath.Ext(header.Filename))
	mimeType, ok := exts[ext]
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("不支持的%s格式 %q", kindLabel(kind), ext)})
		return
	}
	limit := int64(maxLocalImageBytes)
	if kind == "video" {
		limit = maxLocalVideoBytes
	}
	if header.Size > limit {
		c.JSON(http.StatusRequestEntityTooLarge, gin.H{"error": fmt.Sprintf("%s不能超过 %d MiB", kindLabel(kind), limit>>20)})
		return
	}

	dir, err := s.projects.Dir(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Project not found"})
		return
	}
	targetDir := filepath.Join(dir, project.AssetsDir, uploadsSubdir)
	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	name := uuid.New().String() + ext
	if err := saveFormFile(header, filepath.Join(targetDir, name)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{
		"kind":       kind,
		"name":       header.Filename,
		"mime":       mimeType,
		"size":       header.Size,
		"local_path": "/" + project.AssetsDir + "/" + uploadsSubdir + "/" + name,
	})
}

func kindLabel(kind string) string {
	if kind == "video" {
		return "视频"
	}
	return "图片"
}

func saveFormFile(header *multipart.FileHeader, target string) error {
	src, err := header.Open()
	if err != nil {
		return err
	}
	defer src.Close()
	dst, err := os.Create(target)
	if err != nil {
		return err
	}
	defer dst.Close()
	_, err = io.Copy(dst, src)
	return err
}

// platformClient is a Provider's platform: the origin of its base URL plus its key.
// The upload endpoints live at the origin's root (/api/...), not under /v1.
type platformClient struct {
	origin string
	apiKey string
	http   *http.Client
}

func (s *Server) platformFor(providerID string) (*platformClient, error) {
	stored := s.storedConfig()
	spec, ok := findProvider(stored, strings.ToLower(strings.TrimSpace(providerID)))
	if !ok {
		return nil, fmt.Errorf("未知的服务商 %q", providerID)
	}
	baseURL, apiKey := ProviderCredentials(stored, spec.ID)
	if apiKey == "" {
		return nil, fmt.Errorf("服务商 %s 未配置 API Key", providerName(spec, stored))
	}
	if err := validateBaseURL(baseURL); err != nil {
		return nil, fmt.Errorf("服务商 Base URL 无效: %w", err)
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

// uploadSource is the file being sent: bytes from a multipart upload, or a file
// already saved in the project by handleLocalUpload.
type uploadSource struct {
	name string
	data []byte
	mime string
	kind string
}

func (s *Server) readUploadSource(c *gin.Context) (*uploadSource, error) {
	if projectID, localPath := c.PostForm("project_id"), c.PostForm("local_path"); projectID != "" && localPath != "" {
		if s.projects == nil {
			return nil, errors.New("Project storage is not configured")
		}
		dir, err := s.projects.Dir(projectID)
		if err != nil {
			return nil, errors.New("Unknown project: " + projectID)
		}
		rel := strings.TrimPrefix(strings.TrimLeft(filepath.ToSlash(localPath), "/"), project.AssetsDir+"/")
		root := filepath.Join(dir, project.AssetsDir)
		abs := filepath.Join(root, filepath.FromSlash(rel))
		if !strings.HasPrefix(abs, root+string(filepath.Separator)) {
			return nil, fmt.Errorf("path %q escapes the project folder", localPath)
		}
		data, err := os.ReadFile(abs)
		if err != nil {
			return nil, fmt.Errorf("读取本地文件失败: %w", err)
		}
		return newUploadSource(filepath.Base(abs), data)
	}
	header, err := c.FormFile("file")
	if err != nil {
		return nil, errors.New("需要 file 字段，或 project_id + local_path")
	}
	f, err := header.Open()
	if err != nil {
		return nil, err
	}
	defer f.Close()
	data, err := io.ReadAll(f)
	if err != nil {
		return nil, err
	}
	return newUploadSource(header.Filename, data)
}

func newUploadSource(name string, data []byte) (*uploadSource, error) {
	ext := strings.ToLower(filepath.Ext(name))
	for kind, exts := range uploadExtensions {
		if m, ok := exts[ext]; ok {
			return &uploadSource{name: name, data: data, mime: m, kind: kind}, nil
		}
	}
	return nil, fmt.Errorf("不支持的文件格式 %q", ext)
}

// post sends the source as a multipart "file" form together with extra text fields.
func (p *platformClient) postFile(ctx context.Context, path string, src *uploadSource, fields map[string]string) (json.RawMessage, error) {
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	header := make(map[string][]string)
	header["Content-Disposition"] = []string{fmt.Sprintf(`form-data; name="file"; filename=%q`, src.name)}
	header["Content-Type"] = []string{src.mime}
	part, err := w.CreatePart(header)
	if err != nil {
		return nil, err
	}
	if _, err := part.Write(src.data); err != nil {
		return nil, err
	}
	for k, v := range fields {
		if v != "" {
			_ = w.WriteField(k, v)
		}
	}
	if err := w.Close(); err != nil {
		return nil, err
	}
	return p.do(ctx, path, w.FormDataContentType(), &body)
}

func (p *platformClient) postJSON(ctx context.Context, path string, payload any) (json.RawMessage, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	return p.do(ctx, path, "application/json", bytes.NewReader(raw))
}

// do performs the call and unwraps the platform's {success, data, error} envelope.
func (p *platformClient) do(ctx context.Context, path, contentType string, body io.Reader) (json.RawMessage, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.origin+path, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+p.apiKey)
	req.Header.Set("Content-Type", contentType)
	resp, err := p.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))

	var env struct {
		Success bool            `json:"success"`
		Data    json.RawMessage `json:"data"`
		Error   json.RawMessage `json:"error"`
		Message string          `json:"message"`
	}
	if jsonErr := json.Unmarshal(raw, &env); jsonErr != nil || resp.StatusCode >= 300 || !env.Success {
		msg := providerMessage(raw)
		if msg == "" {
			msg = strings.TrimSpace(string(raw))
		}
		if len(msg) > 300 {
			msg = msg[:300]
		}
		if isHTMLResponse(resp) {
			msg = "返回的是网页而不是 API，这个服务商可能没有素材/文件上传接口"
		}
		return nil, fmt.Errorf("上传服务返回 HTTP %d: %s", resp.StatusCode, msg)
	}
	return env.Data, nil
}

// assetResult is the slice of the platform's asset record the cards need.
type assetResult struct {
	ID           string `json:"id"`
	URI          string `json:"uri"`
	Status       string `json:"status"`
	Name         string `json:"name,omitempty"`
	AssetType    string `json:"asset_type,omitempty"`
	ErrorCode    string `json:"error_code,omitempty"`
	ErrorMessage string `json:"error_message,omitempty"`
	CheckPending bool   `json:"check_pending,omitempty"`
}

// handleUploadAsset puts an image or video into the platform's asset library and
// returns its asset id (usable as asset://<id>). Review can still be pending: poll
// /uploads/asset/status until status is Active.
func (s *Server) handleUploadAsset(c *gin.Context) {
	platform, err := s.platformFor(c.PostForm("provider"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	src, err := s.readUploadSource(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	waitSeconds := c.DefaultPostForm("wait_seconds", "0")
	data, err := platform.postFile(c.Request.Context(), "/api/volcengine/assets/create", src, map[string]string{
		"name":         c.PostForm("name"),
		"asset_type":   strings.ToUpper(src.kind[:1]) + src.kind[1:],
		"wait_seconds": waitSeconds,
	})
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	var asset assetResult
	if err := json.Unmarshal(data, &asset); err != nil || asset.ID == "" {
		c.JSON(http.StatusBadGateway, gin.H{"error": "上传服务没有返回素材 ID"})
		return
	}
	c.JSON(http.StatusOK, respondAsset(asset))
}

func respondAsset(a assetResult) gin.H {
	uri := a.URI
	if uri == "" {
		uri = "asset://" + a.ID
	}
	return gin.H{
		"asset_id":      a.ID,
		"uri":           uri,
		"status":        a.Status,
		"error_code":    a.ErrorCode,
		"error_message": a.ErrorMessage,
	}
}

type assetStatusPayload struct {
	Provider string `json:"provider" binding:"required"`
	AssetID  string `json:"asset_id" binding:"required"`
}

func (s *Server) handleAssetStatus(c *gin.Context) {
	var payload assetStatusPayload
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	platform, err := s.platformFor(payload.Provider)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	data, err := platform.postJSON(c.Request.Context(), "/api/volcengine/assets/check", map[string]string{"id": payload.AssetID})
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	var asset assetResult
	if err := json.Unmarshal(data, &asset); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "无法解析素材状态"})
		return
	}
	if asset.ID == "" {
		asset.ID = payload.AssetID
	}
	c.JSON(http.StatusOK, respondAsset(asset))
}

// handleUploadFile stores the file on the platform and returns a download URL that stays
// valid for 7 days: the way to hand a video to a model that only takes URLs.
func (s *Server) handleUploadFile(c *gin.Context) {
	platform, err := s.platformFor(c.PostForm("provider"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	src, err := s.readUploadSource(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	data, err := platform.postFile(c.Request.Context(), "/api/files/upload", src, nil)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	var file struct {
		FileURL   string `json:"file_url"`
		ExpiresAt int64  `json:"expires_at"`
	}
	if err := json.Unmarshal(data, &file); err != nil || file.FileURL == "" {
		c.JSON(http.StatusBadGateway, gin.H{"error": "上传服务没有返回文件地址"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"file_url":   file.FileURL,
		"expires_at": file.ExpiresAt,
		"mime":       mime.TypeByExtension(strings.ToLower(filepath.Ext(src.name))),
	})
}

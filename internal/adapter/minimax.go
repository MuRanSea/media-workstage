package adapter

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"media-workstage/internal/model"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// MiniMaxConfig holds configuration for the MiniMax adapter.
type MiniMaxConfig struct {
	BaseURL    string
	APIKey     string
	GroupID    string
	HTTPClient *http.Client
}

// MiniMaxAdapter implements ProviderAdapter and ConfigurableAdapter for MiniMax video generation APIs.
type MiniMaxAdapter struct {
	mu      sync.RWMutex
	baseURL string
	apiKey  string
	groupID string
	client  *http.Client
}

// NewMiniMaxAdapter creates a new MiniMaxAdapter instance.
func NewMiniMaxAdapter(cfg MiniMaxConfig) *MiniMaxAdapter {
	baseURL := strings.TrimRight(cfg.BaseURL, "/")
	if baseURL == "" {
		baseURL = "https://api.minimax.chat/v1"
	}

	client := cfg.HTTPClient
	if client == nil {
		client = &http.Client{
			Timeout: 120 * time.Second,
		}
	}

	return &MiniMaxAdapter{
		baseURL: baseURL,
		apiKey:  cfg.APIKey,
		groupID: cfg.GroupID,
		client:  client,
	}
}

func (m *MiniMaxAdapter) GetConfig() ProviderConfigInfo {
	m.mu.RLock()
	defer m.mu.RUnlock()
	extra := make(map[string]string)
	if m.groupID != "" {
		extra["group_id"] = m.groupID
	}
	return ProviderConfigInfo{
		ProviderName: "minimax",
		BaseURL:      m.baseURL,
		IsConfigured: m.apiKey != "",
		MaskedKey:    MaskSecret(m.apiKey),
		Extra:        extra,
	}
}

type MiniMaxCredentials struct {
	BaseURL string
	APIKey  string
	GroupID string
}

func (m *MiniMaxAdapter) getCredentials() MiniMaxCredentials {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return MiniMaxCredentials{
		BaseURL: m.baseURL,
		APIKey:  m.apiKey,
		GroupID: m.groupID,
	}
}

func (m *MiniMaxAdapter) UpdateConfig(baseURL string, apiKey string, extra map[string]string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if strings.TrimSpace(baseURL) != "" {
		m.baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	}
	if apiKey != "" {
		m.apiKey = strings.TrimSpace(apiKey)
	}
	if extra != nil {
		if gid, ok := extra["group_id"]; ok {
			m.groupID = strings.TrimSpace(gid)
		}
	}
	return nil
}
func (m *MiniMaxAdapter) ProviderName() string {
	return "minimax"
}

// isMiniMaxV2Model reports whether a model is served by MiniMax's V2 video API
// (POST /v2/video_generation, multimodal "content" array): MiniMax-H3 and H3-Max.
// Video-01 and the Hailuo models stay on the V1 API (POST /v1/video_generation).
func isMiniMaxV2Model(modelID string) bool {
	return strings.Contains(strings.ToLower(modelID), "h3")
}

// miniMaxV2Base turns a configured Base URL into the V2 API root. The V2 API lives
// under /v2 while the V1 default Base URL ends in /v1, so a trailing /v1 or /v2 is
// swapped for /v2 and a bare host gets /v2 appended.
func miniMaxV2Base(baseURL string) string {
	b := strings.TrimRight(baseURL, "/")
	b = strings.TrimSuffix(b, "/v1")
	b = strings.TrimSuffix(b, "/v2")
	return b + "/v2"
}

// miniMaxV2Resolution maps a card's resolution onto the V2 tiers (480P, 768P, 2K).
// Cards saved before V2 may carry the V1 tiers: 720P becomes 768P and 1080P becomes 2K.
func miniMaxV2Resolution(resolution string) (string, bool) {
	switch strings.ToUpper(strings.TrimSpace(resolution)) {
	case "":
		return "768P", true
	case "480P":
		return "480P", true
	case "720P", "768P":
		return "768P", true
	case "1080P", "2K":
		return "2K", true
	}
	return "", false
}

// MiniMaxParams represents parsed parameters for MiniMax task requests.
type MiniMaxParams struct {
	Resolution      string                `json:"resolution"`
	Ratio           string                `json:"ratio"`
	Duration        int                   `json:"duration"`
	PromptOptimizer *bool                 `json:"prompt_optimizer"`
	FirstFrameImage string                `json:"first_frame_image,omitempty"`
	LastFrameImage  string                `json:"last_frame_image,omitempty"`
	ReferenceAssets []model.ReferenceItem `json:"reference_assets,omitempty"`
}

func parseMiniMaxParams(paramsJSON string) (MiniMaxParams, error) {
	var p MiniMaxParams
	if strings.TrimSpace(paramsJSON) == "" {
		return p, nil
	}
	if err := json.Unmarshal([]byte(paramsJSON), &p); err != nil {
		return p, fmt.Errorf("invalid params_json for minimax: %w", err)
	}
	return p, nil
}

// ValidateTask validates the task constraints before submission to MiniMax.
func (m *MiniMaxAdapter) ValidateTask(task *model.MediaTask) (*MiniMaxParams, error) {
	if task == nil {
		return nil, errors.New("task is nil")
	}

	if task.TaskType != "video_generation" {
		return nil, fmt.Errorf("minimax provider only supports video_generation, got %s", task.TaskType)
	}

	if strings.TrimSpace(task.Prompt) == "" {
		return nil, errors.New("prompt is required for minimax video generation")
	}

	params, err := parseMiniMaxParams(task.ParamsJSON)
	if err != nil {
		return nil, err
	}

	isV2 := isMiniMaxV2Model(task.Model)
	isH3Max := strings.Contains(strings.ToLower(task.Model), "h3-max")
	isH3 := isV2 || strings.Contains(strings.ToLower(task.Model), "hailuo")
	isVideo01 := strings.EqualFold(task.Model, "video-01") || strings.Contains(strings.ToLower(task.Model), "video-01")

	// Validate reference assets
	var imageRefs []model.ReferenceItem
	for _, ref := range params.ReferenceAssets {
		switch ref.Role {
		case "reference_video", "video", "reference_audio", "audio":
			return nil, fmt.Errorf("minimax does not support reference %s inputs", ref.Role)
		default:
			imageRefs = append(imageRefs, ref)
		}
	}

	if len(imageRefs) > 2 {
		return nil, fmt.Errorf("minimax supports at most 2 reference images (first_frame, last_frame), got %d", len(imageRefs))
	}

	// Validate resolution if given
	if params.Resolution != "" {
		resUpper := strings.ToUpper(params.Resolution)
		if isVideo01 {
			if resUpper != "720P" && resUpper != "1080P" {
				return nil, fmt.Errorf("video-01 resolution must be 720P or 1080P, got %s", params.Resolution)
			}
		} else if isV2 {
			v2Res, ok := miniMaxV2Resolution(params.Resolution)
			if !ok {
				return nil, fmt.Errorf("%s resolution must be 768P or 2K, got %s", task.Model, params.Resolution)
			}
			if isH3Max && v2Res == "2K" {
				return nil, fmt.Errorf("%s does not support 2K, use 480P or 768P", task.Model)
			}
		} else if isH3 {
			if resUpper != "720P" && resUpper != "1080P" && resUpper != "2K" {
				return nil, fmt.Errorf("MiniMax-H3 resolution must be 720P, 1080P, or 2K, got %s", params.Resolution)
			}
		}
	}

	// Validate duration if given
	if params.Duration != 0 {
		if isVideo01 && params.Duration != 6 {
			return nil, fmt.Errorf("video-01 only supports 6s duration, got %ds", params.Duration)
		}
		if isV2 {
			minDuration := 4
			if isH3Max {
				minDuration = 5
			}
			if params.Duration < minDuration || params.Duration > 15 {
				return nil, fmt.Errorf("%s duration must be %d to 15s, got %ds", task.Model, minDuration, params.Duration)
			}
		} else if isH3 && params.Duration != 5 && params.Duration != 6 && params.Duration != 10 && params.Duration != 15 {
			return nil, fmt.Errorf("MiniMax-H3 duration must be 5, 6, 10, or 15s, got %ds", params.Duration)
		}
	}

	return &params, nil
}

type miniMaxCreateTaskRequest struct {
	Model           string `json:"model"`
	Prompt          string `json:"prompt"`
	FirstFrameImage string `json:"first_frame_image,omitempty"`
	LastFrameImage  string `json:"last_frame_image,omitempty"`
	PromptOptimizer *bool  `json:"prompt_optimizer,omitempty"`
	Duration        int    `json:"duration,omitempty"`
	Resolution      string `json:"resolution,omitempty"`
}

type miniMaxBaseResp struct {
	StatusCode int    `json:"status_code"`
	StatusMsg  string `json:"status_msg"`
}

type miniMaxCreateTaskResponse struct {
	TaskID   string          `json:"task_id"`
	BaseResp miniMaxBaseResp `json:"base_resp"`
}

func (m *MiniMaxAdapter) SubmitTask(ctx context.Context, task *model.MediaTask) (string, error) {
	params, err := m.ValidateTask(task)
	if err != nil {
		return "", fmt.Errorf("minimax task validation failed: %w", err)
	}

	reqBody := miniMaxCreateTaskRequest{
		Model:           task.Model,
		Prompt:          task.Prompt,
		PromptOptimizer: params.PromptOptimizer,
		Duration:        params.Duration,
		Resolution:      params.Resolution,
	}

	// Resolve first_frame_image and last_frame_image
	if params.FirstFrameImage != "" {
		reqBody.FirstFrameImage = params.FirstFrameImage
	}
	if params.LastFrameImage != "" {
		reqBody.LastFrameImage = params.LastFrameImage
	}

	for _, ref := range params.ReferenceAssets {
		refURL, err := resolveAssetURL(ref)
		if err != nil {
			return "", fmt.Errorf("failed to resolve asset for %s: %w", ref.Label, err)
		}

		if ref.Role == "last_frame" {
			reqBody.LastFrameImage = refURL
		} else if ref.Role == "first_frame" || reqBody.FirstFrameImage == "" {
			reqBody.FirstFrameImage = refURL
		} else if reqBody.LastFrameImage == "" {
			reqBody.LastFrameImage = refURL
		}
	}

	if isMiniMaxV2Model(task.Model) {
		return m.submitV2(ctx, task, params, reqBody.FirstFrameImage, reqBody.LastFrameImage)
	}

	jsonBytes, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("failed to marshal minimax request: %w", err)
	}

	creds := m.getCredentials()
	endpoint := fmt.Sprintf("%s/video_generation", creds.BaseURL)
	if creds.GroupID != "" {
		endpoint += "?GroupId=" + url.QueryEscape(creds.GroupID)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(jsonBytes))
	if err != nil {
		return "", fmt.Errorf("failed to create http request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	if creds.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+creds.APIKey)
	}
	if creds.GroupID != "" {
		req.Header.Set("GroupId", creds.GroupID)
	}
	resp, err := m.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("minimax video task submission request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read minimax response: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("minimax returned HTTP %d: %s", resp.StatusCode, string(respBody))
	}

	var createResp miniMaxCreateTaskResponse
	if err := json.Unmarshal(respBody, &createResp); err != nil {
		return "", fmt.Errorf("failed to parse minimax response: %w", err)
	}

	if createResp.BaseResp.StatusCode != 0 {
		return "", fmt.Errorf("minimax error [%d]: %s", createResp.BaseResp.StatusCode, createResp.BaseResp.StatusMsg)
	}

	if createResp.TaskID == "" {
		return "", errors.New("minimax response missing task_id")
	}

	return createResp.TaskID, nil
}

type miniMaxV2MediaURL struct {
	URL string `json:"url"`
}

// miniMaxV2Content is one element of the V2 "content" array: a text prompt or an
// image, tagged with the role it plays.
type miniMaxV2Content struct {
	Type     string             `json:"type"`
	Text     string             `json:"text,omitempty"`
	ImageURL *miniMaxV2MediaURL `json:"image_url,omitempty"`
	Role     string             `json:"role,omitempty"`
}

type miniMaxV2CreateRequest struct {
	Model      string             `json:"model"`
	Content    []miniMaxV2Content `json:"content"`
	Resolution string             `json:"resolution"`
	Duration   int                `json:"duration"`
	Ratio      string             `json:"ratio,omitempty"`
}

// submitV2 creates a task on MiniMax's V2 video API (MiniMax-H3 / H3-Max), where the
// prompt and images travel in a multimodal "content" array instead of top-level fields.
func (m *MiniMaxAdapter) submitV2(ctx context.Context, task *model.MediaTask, params *MiniMaxParams, firstFrame, lastFrame string) (string, error) {
	resolution, ok := miniMaxV2Resolution(params.Resolution)
	if !ok {
		return "", fmt.Errorf("unsupported minimax resolution %q", params.Resolution)
	}
	duration := params.Duration
	if duration == 0 {
		duration = 5
	}

	content := []miniMaxV2Content{{Type: "text", Text: task.Prompt}}
	if firstFrame != "" {
		content = append(content, miniMaxV2Content{Type: "image_url", ImageURL: &miniMaxV2MediaURL{URL: firstFrame}, Role: "first_frame"})
	}
	if lastFrame != "" {
		content = append(content, miniMaxV2Content{Type: "image_url", ImageURL: &miniMaxV2MediaURL{URL: lastFrame}, Role: "last_frame"})
	}

	// Text-to-video needs a concrete ratio; with images the ratio follows the first frame.
	ratio := params.Ratio
	if len(content) == 1 {
		if ratio == "" || strings.EqualFold(ratio, "adaptive") || strings.EqualFold(ratio, "auto") {
			ratio = "16:9"
		}
	} else {
		ratio = "adaptive"
	}

	jsonBytes, err := json.Marshal(miniMaxV2CreateRequest{
		Model:      task.Model,
		Content:    content,
		Resolution: resolution,
		Duration:   duration,
		Ratio:      ratio,
	})
	if err != nil {
		return "", fmt.Errorf("failed to marshal minimax request: %w", err)
	}

	creds := m.getCredentials()
	endpoint := miniMaxV2Base(creds.BaseURL) + "/video_generation"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(jsonBytes))
	if err != nil {
		return "", fmt.Errorf("failed to create http request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if creds.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+creds.APIKey)
	}

	resp, err := m.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("minimax video task submission request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read minimax response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("minimax returned HTTP %d: %s", resp.StatusCode, string(respBody))
	}

	var createResp miniMaxCreateTaskResponse
	if err := json.Unmarshal(respBody, &createResp); err != nil {
		return "", fmt.Errorf("failed to parse minimax response: %w", err)
	}
	if createResp.BaseResp.StatusCode != 0 {
		return "", fmt.Errorf("minimax error [%d]: %s", createResp.BaseResp.StatusCode, createResp.BaseResp.StatusMsg)
	}
	if createResp.TaskID == "" {
		return "", errors.New("minimax response missing task_id")
	}
	return createResp.TaskID, nil
}

type miniMaxV2PollResponse struct {
	Task struct {
		ID     string `json:"id"`
		Status string `json:"status"` // queued | running | succeeded | failed | cancelled
		Error  *struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error,omitempty"`
		Content *struct {
			URL string `json:"url"`
		} `json:"content,omitempty"`
		Resolution string `json:"resolution"`
		Duration   int    `json:"duration"`
	} `json:"task"`
}

// pollV2 queries a V2 task (GET /v2/query/video_generation/{task_id}).
func (m *MiniMaxAdapter) pollV2(ctx context.Context, task *model.MediaTask) (*PollResult, error) {
	creds := m.getCredentials()
	endpoint := fmt.Sprintf("%s/query/video_generation/%s", miniMaxV2Base(creds.BaseURL), url.PathEscape(task.ProviderTaskID))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create minimax poll request: %w", err)
	}
	if creds.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+creds.APIKey)
	}

	resp, err := m.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("minimax poll request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read minimax poll response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("minimax poll returned HTTP %d: %s", resp.StatusCode, string(respBody))
	}

	var pollResp miniMaxV2PollResponse
	if err := json.Unmarshal(respBody, &pollResp); err != nil {
		return nil, fmt.Errorf("failed to parse minimax poll response: %w", err)
	}
	t := pollResp.Task

	result := &PollResult{}
	switch strings.ToLower(t.Status) {
	case "queued":
		result.Status = model.TaskStatusQueued
		result.Progress = 15

	case "running":
		result.Status = model.TaskStatusRunning
		result.Progress = 60

	case "failed", "cancelled":
		result.Status = model.TaskStatusFailed
		result.ErrorCode = "MiniMax_" + t.Status
		if t.Error != nil {
			result.ErrorCode = "MiniMax_" + t.Error.Code
			result.ErrorMessage = t.Error.Message
		}
		if result.ErrorMessage == "" {
			result.ErrorMessage = "MiniMax task " + t.Status
		}

	case "succeeded":
		if t.Content == nil || t.Content.URL == "" {
			return nil, errors.New("minimax task succeeded without a video url")
		}
		result.Status = model.TaskStatusSucceeded
		result.Progress = 100
		result.ResultURL = t.Content.URL

		duration := float64(t.Duration)
		if duration == 0 {
			var p MiniMaxParams
			_ = json.Unmarshal([]byte(task.ParamsJSON), &p)
			duration = float64(p.Duration)
		}
		result.OutputDurationSec = duration

		billingMap := map[string]interface{}{
			"model":               task.Model,
			"resolution":          t.Resolution,
			"output_duration_sec": duration,
		}
		bJSON, _ := json.Marshal(billingMap)
		result.BillingDetailsJSON = string(bJSON)

		result.Assets = []model.TaskAsset{
			{
				AssetIndex: 0,
				Kind:       "video",
				Name:       "output.mp4",
				RemoteURL:  t.Content.URL,
				LocalPath:  fmt.Sprintf("videos/%s/output.mp4", task.ID),
			},
		}

	default:
		result.Status = model.TaskStatusRunning
		result.Progress = 30
	}
	return result, nil
}

type miniMaxPollResponse struct {
	TaskID      string          `json:"task_id"`
	Status      string          `json:"status"` // Preparing | Queueing | Processing | Success | Fail
	FileID      string          `json:"file_id"`
	VideoWidth  int             `json:"video_width"`
	VideoHeight int             `json:"video_height"`
	BaseResp    miniMaxBaseResp `json:"base_resp"`
	Content     *struct {
		URL string `json:"url"`
	} `json:"content,omitempty"`
}

func (m *MiniMaxAdapter) PollTask(ctx context.Context, task *model.MediaTask) (*PollResult, error) {
	if isMiniMaxV2Model(task.Model) {
		return m.pollV2(ctx, task)
	}
	creds := m.getCredentials()
	endpoint := fmt.Sprintf("%s/query/video_generation?task_id=%s", creds.BaseURL, url.QueryEscape(task.ProviderTaskID))
	if creds.GroupID != "" {
		endpoint += "&GroupId=" + url.QueryEscape(creds.GroupID)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create minimax poll request: %w", err)
	}

	if creds.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+creds.APIKey)
	}
	if creds.GroupID != "" {
		req.Header.Set("GroupId", creds.GroupID)
	}

	resp, err := m.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("minimax poll request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read minimax poll response: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("minimax poll returned HTTP %d: %s", resp.StatusCode, string(respBody))
	}

	var pollResp miniMaxPollResponse
	if err := json.Unmarshal(respBody, &pollResp); err != nil {
		return nil, fmt.Errorf("failed to parse minimax poll response: %w", err)
	}

	result := &PollResult{}
	switch strings.ToLower(pollResp.Status) {
	case "preparing", "queueing":
		result.Status = model.TaskStatusQueued
		result.Progress = 15

	case "processing":
		result.Status = model.TaskStatusRunning
		result.Progress = 60

	case "fail":
		result.Status = model.TaskStatusFailed
		result.ErrorCode = fmt.Sprintf("MiniMax_%d", pollResp.BaseResp.StatusCode)
		result.ErrorMessage = pollResp.BaseResp.StatusMsg
		if result.ErrorMessage == "" {
			result.ErrorMessage = "MiniMax task failed during processing"
		}

	case "success":
		result.Status = model.TaskStatusSucceeded
		result.Progress = 100

		downloadURL := ""
		if pollResp.Content != nil && pollResp.Content.URL != "" {
			downloadURL = pollResp.Content.URL
		} else if pollResp.FileID != "" {
			// Construct internal fallback protocol URL containing file_id
			downloadURL = fmt.Sprintf("minimax-file://%s", pollResp.FileID)
		}

		result.ResultURL = downloadURL

		// Output duration
		duration := 6.0
		var p MiniMaxParams
		_ = json.Unmarshal([]byte(task.ParamsJSON), &p)
		if p.Duration > 0 {
			duration = float64(p.Duration)
		}
		result.OutputDurationSec = duration

		// Billing details
		billingMap := map[string]interface{}{
			"file_id":             pollResp.FileID,
			"video_width":         pollResp.VideoWidth,
			"video_height":        pollResp.VideoHeight,
			"model":               task.Model,
			"output_duration_sec": duration,
		}
		bJSON, _ := json.Marshal(billingMap)
		result.BillingDetailsJSON = string(bJSON)

		result.Assets = []model.TaskAsset{
			{
				AssetIndex: 0,
				Kind:       "video",
				Name:       "output.mp4",
				RemoteURL:  downloadURL,
				LocalPath:  fmt.Sprintf("videos/%s/output.mp4", task.ID),
			},
		}

	default:
		result.Status = model.TaskStatusRunning
		result.Progress = 30
	}

	return result, nil
}

type miniMaxFileRetrieveResponse struct {
	File struct {
		FileID      string `json:"file_id"`
		Bytes       int64  `json:"bytes"`
		CreatedAt   int64  `json:"created_at"`
		Filename    string `json:"filename"`
		DownloadURL string `json:"download_url"`
	} `json:"file"`
	BaseResp miniMaxBaseResp `json:"base_resp"`
}

// RetrieveFileURL queries MiniMax GET /v1/files/retrieve to refresh an expired or missing download URL.
func (m *MiniMaxAdapter) RetrieveFileURL(ctx context.Context, fileID string) (string, error) {
	creds := m.getCredentials()
	endpoint := fmt.Sprintf("%s/files/retrieve?file_id=%s", creds.BaseURL, url.QueryEscape(fileID))
	if creds.GroupID != "" {
		endpoint += "&GroupId=" + url.QueryEscape(creds.GroupID)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return "", fmt.Errorf("failed to create file retrieve request: %w", err)
	}

	if creds.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+creds.APIKey)
	}
	if creds.GroupID != "" {
		req.Header.Set("GroupId", creds.GroupID)
	}

	resp, err := m.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("minimax file retrieve request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read file retrieve response: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("minimax file retrieve returned HTTP %d: %s", resp.StatusCode, string(respBody))
	}

	var fileResp miniMaxFileRetrieveResponse
	if err := json.Unmarshal(respBody, &fileResp); err != nil {
		return "", fmt.Errorf("failed to parse file retrieve response: %w", err)
	}

	if fileResp.BaseResp.StatusCode != 0 {
		return "", fmt.Errorf("minimax file retrieve error [%d]: %s", fileResp.BaseResp.StatusCode, fileResp.BaseResp.StatusMsg)
	}

	if fileResp.File.DownloadURL == "" {
		return "", errors.New("minimax file retrieve returned empty download_url")
	}

	return fileResp.File.DownloadURL, nil
}

// DownloadAsset implements double download flow:
// 1. Attempts direct streaming download from remoteURL.
// 2. If remoteURL fails (HTTP 4xx/5xx or expired token) or is minimax-file://<file_id>, queries GET /v1/files/retrieve?file_id=<id> to refresh download_url.
func (m *MiniMaxAdapter) DownloadAsset(ctx context.Context, remoteURL string, targetLocalPath string) error {
	dir := filepath.Dir(targetLocalPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create directory %s: %w", dir, err)
	}

	downloadURL := remoteURL
	fileID := ""

	// Check if URL is minimax-file://<file_id>
	if strings.HasPrefix(remoteURL, "minimax-file://") {
		fileID = strings.TrimPrefix(remoteURL, "minimax-file://")
		freshURL, err := m.RetrieveFileURL(ctx, fileID)
		if err != nil {
			return fmt.Errorf("failed to retrieve download url for file_id %s: %w", fileID, err)
		}
		downloadURL = freshURL
	}

	// Try downloading with primary URL
	err := m.downloadFromURL(ctx, downloadURL, targetLocalPath)
	if err == nil {
		return nil
	}

	// If primary download failed and we can extract fileID or query retrieve
	if fileID == "" {
		// Attempt to extract file_id from URL query params or path if present
		if u, parseErr := url.Parse(remoteURL); parseErr == nil {
			fileID = u.Query().Get("file_id")
		}
	}

	if fileID != "" && downloadURL != remoteURL {
		return err
	}

	if fileID != "" {
		// Fallback: refresh download URL via /files/retrieve
		freshURL, retrieveErr := m.RetrieveFileURL(ctx, fileID)
		if retrieveErr == nil && freshURL != downloadURL {
			return m.downloadFromURL(ctx, freshURL, targetLocalPath)
		}
	}

	return err
}

func (m *MiniMaxAdapter) downloadFromURL(ctx context.Context, downloadURL string, targetLocalPath string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, downloadURL, nil)
	if err != nil {
		return fmt.Errorf("failed to create download request: %w", err)
	}

	resp, err := downloadClient(m.client).Do(req)
	if err != nil {
		return fmt.Errorf("download request failed from %s: %w", downloadURL, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("download returned HTTP %d for %s", resp.StatusCode, downloadURL)
	}

	file, err := os.Create(targetLocalPath)
	if err != nil {
		return fmt.Errorf("failed to create file %s: %w", targetLocalPath, err)
	}
	defer file.Close()

	if _, err := io.Copy(file, resp.Body); err != nil {
		return fmt.Errorf("failed to stream media content: %w", err)
	}

	return file.Sync()
}

// Helper to extract duration or fallback
func parseDurationSec(durStr string) float64 {
	if v, err := strconv.ParseFloat(durStr, 64); err == nil {
		return v
	}
	return 6.0
}

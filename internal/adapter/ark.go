package adapter

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"media-workstage/internal/model"

	"github.com/google/uuid"
)

// ArkConfig holds configuration for the Ark API adapter.
type ArkConfig struct {
	BaseURL    string
	APIKey     string
	HTTPClient *http.Client
}

// ArkAdapter implements ProviderAdapter and ConfigurableAdapter for Volcengine Ark APIs.
type ArkAdapter struct {
	mu         sync.RWMutex
	baseURL    string
	apiKey     string
	client     *http.Client
	imageCache sync.Map // map[string]*PollResult: caches sync image generation results by providerTaskID
}

// NewArkAdapter creates a new ArkAdapter instance.
func NewArkAdapter(cfg ArkConfig) *ArkAdapter {
	baseURL := strings.TrimRight(cfg.BaseURL, "/")
	if baseURL == "" {
		baseURL = "https://ark.cn-beijing.volces.com/api/v3"
	}

	client := cfg.HTTPClient
	if client == nil {
		client = &http.Client{
			Timeout: 120 * time.Second,
		}
	}

	return &ArkAdapter{
		baseURL: baseURL,
		apiKey:  cfg.APIKey,
		client:  client,
	}
}

func (a *ArkAdapter) ProviderName() string {
	return "ark"
}
func (a *ArkAdapter) GetConfig() ProviderConfigInfo {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return ProviderConfigInfo{
		ProviderName: "ark",
		BaseURL:      a.baseURL,
		IsConfigured: a.apiKey != "",
		MaskedKey:    MaskSecret(a.apiKey),
	}
}
type ArkCredentials struct {
	BaseURL string
	APIKey  string
}

func (a *ArkAdapter) getCredentials() ArkCredentials {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return ArkCredentials{
		BaseURL: a.baseURL,
		APIKey:  a.apiKey,
	}
}

func (a *ArkAdapter) UpdateConfig(baseURL string, apiKey string, extra map[string]string) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if strings.TrimSpace(baseURL) != "" {
		a.baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	}
	if apiKey != "" {
		a.apiKey = strings.TrimSpace(apiKey)
	}
	return nil
}

// ParsedParams holds common parameters parsed from MediaTask.ParamsJSON.
type ParsedParams struct {
	Resolution                       string                `json:"resolution"`
	Ratio                            string                `json:"ratio"`
	Duration                         int                   `json:"duration"`
	GenerateAudio                    *bool                 `json:"generate_audio"`
	OutputFormat                     string                `json:"output_format"`
	Watermark                        *bool                 `json:"watermark"`
	ReturnLastFrame                  *bool                 `json:"return_last_frame"`
	Seed                             *int                  `json:"seed"`
	CameraFixed                      *bool                 `json:"camera_fixed"`
	Size                             string                `json:"size"`
	Width                            int                   `json:"width"`
	Height                           int                   `json:"height"`
	ResponseFormat                   string                `json:"response_format"`
	Background                       string                `json:"background"`
	LayerDecomposition               bool                  `json:"layer_decomposition"`
	SequentialImageGeneration        string                `json:"sequential_image_generation"`
	SequentialImageGenerationOptions *SequentialOptions    `json:"sequential_image_generation_options"`
	OptimizePromptOptions            *OptimizePromptOption `json:"optimize_prompt_options"`
	ReferenceAssets                  []model.ReferenceItem `json:"reference_assets"`
}

type SequentialOptions struct {
	MaxImages int `json:"max_images"`
}

type OptimizePromptOption struct {
	Mode string `json:"mode"`
}

// parseParams parses task.ParamsJSON into ParsedParams.
func parseParams(paramsJSON string) (ParsedParams, error) {
	var p ParsedParams
	if strings.TrimSpace(paramsJSON) == "" {
		return p, nil
	}
	if err := json.Unmarshal([]byte(paramsJSON), &p); err != nil {
		return p, fmt.Errorf("invalid params_json: %w", err)
	}
	return p, nil
}

// ValidateTask validates the task constraints before submission.
func (a *ArkAdapter) ValidateTask(task *model.MediaTask) (*ParsedParams, error) {
	if task == nil {
		return nil, errors.New("task is nil")
	}

	params, err := parseParams(task.ParamsJSON)
	if err != nil {
		return nil, err
	}

	switch task.TaskType {
	case "video_generation":
		if err := a.validateVideoTask(task, &params); err != nil {
			return nil, err
		}
	case "image_generation":
		if err := a.validateImageTask(task, &params); err != nil {
			return nil, err
		}
	default:
		return nil, fmt.Errorf("unsupported task_type: %s", task.TaskType)
	}

	return &params, nil
}

// validateVideoTask validates video generation parameters and 3 mutually exclusive modes.
func (a *ArkAdapter) validateVideoTask(task *model.MediaTask, params *ParsedParams) error {
	if strings.TrimSpace(task.Prompt) == "" && task.TaskMode != "first_last_frame" && task.TaskMode != "all_modal" {
		return errors.New("prompt is required for video generation")
	}

	isSeedance25 := strings.Contains(task.Model, "seedance-2-5") || strings.Contains(task.Model, "seedance-2.5")
	isSeedance20 := strings.Contains(task.Model, "seedance-2-0") || strings.Contains(task.Model, "seedance-2.0")

	// Count reference types
	var imageRefs, videoRefs, audioRefs []model.ReferenceItem
	hasFirstFrame := false
	hasLastFrame := false

	for _, ref := range params.ReferenceAssets {
		switch ref.Role {
		case "first_frame":
			hasFirstFrame = true
			imageRefs = append(imageRefs, ref)
		case "last_frame":
			hasLastFrame = true
			imageRefs = append(imageRefs, ref)
		case "reference_image", "image", "":
			imageRefs = append(imageRefs, ref)
		case "reference_video", "video":
			videoRefs = append(videoRefs, ref)
		case "reference_audio", "audio":
			audioRefs = append(audioRefs, ref)
		default:
			return fmt.Errorf("unsupported reference role: %s", ref.Role)
		}
	}

	// Validate the 3 mutually exclusive modes
	mode := task.TaskMode
	if mode == "" {
		if hasFirstFrame || hasLastFrame {
			mode = "first_last_frame"
		} else if len(imageRefs)+len(videoRefs)+len(audioRefs) > 0 {
			mode = "all_modal"
		} else {
			mode = "text_to_video"
		}
	}

	switch mode {
	case "text_to_video":
		if len(params.ReferenceAssets) > 0 {
			return errors.New("text_to_video mode cannot contain reference assets")
		}
		if strings.TrimSpace(task.Prompt) == "" {
			return errors.New("prompt is required for text_to_video mode")
		}

	case "first_last_frame":
		if len(videoRefs) > 0 || len(audioRefs) > 0 {
			return errors.New("first_last_frame mode does not support reference video or audio")
		}
		if len(imageRefs) < 1 || len(imageRefs) > 2 {
			return fmt.Errorf("first_last_frame mode requires strictly 1 or 2 images, got %d", len(imageRefs))
		}
		if len(imageRefs) == 1 && !hasFirstFrame && params.ReferenceAssets[0].Role != "" {
			// Single image implicitly acts as first_frame
		}
		// In first_last_frame mode, ratio is forced to adaptive
		params.Ratio = "adaptive"

	case "all_modal":
		if hasFirstFrame || hasLastFrame {
			return errors.New("all_modal mode cannot contain first_frame or last_frame roles (use role 'reference_image')")
		}
		maxImages := 30
		maxVideos := 10
		maxAudios := 10
		if !isSeedance25 {
			maxImages = 9
			maxVideos = 3
			maxAudios = 3
		}

		if len(imageRefs) > maxImages {
			return fmt.Errorf("reference images exceed max allowed (%d, got %d)", maxImages, len(imageRefs))
		}
		if len(videoRefs) > maxVideos {
			return fmt.Errorf("reference videos exceed max allowed (%d, got %d)", maxVideos, len(videoRefs))
		}
		if len(audioRefs) > maxAudios {
			return fmt.Errorf("reference audios exceed max allowed (%d, got %d)", maxAudios, len(audioRefs))
		}

		// Seedance 2.0 forbids standalone audio without at least 1 image or video
		if isSeedance20 && len(audioRefs) > 0 && len(imageRefs) == 0 && len(videoRefs) == 0 {
			return errors.New("Seedance 2.0 does not support standalone audio reference without image or video")
		}

	default:
		return fmt.Errorf("unsupported task_mode for video: %s", mode)
	}

	// Validate resolution if provided
	if params.Resolution != "" {
		validResolutions := map[string]bool{"480p": true, "720p": true, "1080p": true, "4k": true}
		if !validResolutions[strings.ToLower(params.Resolution)] {
			return fmt.Errorf("invalid video resolution: %s", params.Resolution)
		}
		if strings.ToLower(params.Resolution) == "4k" && !isSeedance20 && !isSeedance25 {
			return fmt.Errorf("4k resolution is only supported by Seedance 2.0/2.5")
		}
	}

	// Validate duration if provided
	if params.Duration != 0 && params.Duration != -1 {
		maxDur := 30
		if !isSeedance25 {
			maxDur = 15
		}
		if params.Duration < 4 || params.Duration > maxDur {
			return fmt.Errorf("video duration must be between 4 and %ds or -1 (adaptive), got %d", maxDur, params.Duration)
		}
	}

	return nil
}

// validateImageTask validates image generation parameters and size mutual exclusivity.
func (a *ArkAdapter) validateImageTask(task *model.MediaTask, params *ParsedParams) error {
	if strings.TrimSpace(task.Prompt) == "" {
		return errors.New("prompt is required for image generation")
	}

	isPro := strings.Contains(task.Model, "5-0-pro") || strings.Contains(task.Model, "5.0-pro") || strings.Contains(task.Model, "5.0_pro")
	isLite := strings.Contains(task.Model, "5-0-lite") || strings.Contains(task.Model, "5.0-lite") || strings.Contains(task.Model, "5.0_lite")

	// Feature exclusivity
	if params.LayerDecomposition && !isPro {
		return errors.New("layer_decomposition is only supported on Seedream 5.0 Pro")
	}
	if params.SequentialImageGeneration == "auto" && isPro {
		return errors.New("sequential_image_generation is not supported on Seedream 5.0 Pro")
	}

	// Validate reference image count
	maxRefs := 14
	if isPro {
		maxRefs = 10
	}
	if len(params.ReferenceAssets) > maxRefs {
		return fmt.Errorf("reference assets exceed maximum limit of %d for model %s", maxRefs, task.Model)
	}

	// Size validation (Preset tier vs Explicit WxH)
	sizeStr := strings.TrimSpace(params.Size)
	if sizeStr == "" && params.Width > 0 && params.Height > 0 {
		sizeStr = fmt.Sprintf("%dx%d", params.Width, params.Height)
	}

	if sizeStr != "" {
		if strings.Contains(sizeStr, "x") || strings.Contains(sizeStr, "X") {
			// Method 2: Explicit width x height
			parts := strings.FieldsFunc(sizeStr, func(r rune) bool { return r == 'x' || r == 'X' })
			if len(parts) != 2 {
				return fmt.Errorf("invalid explicit size format: %s, expected <width>x<height>", sizeStr)
			}
			w, err1 := strconv.Atoi(strings.TrimSpace(parts[0]))
			h, err2 := strconv.Atoi(strings.TrimSpace(parts[1]))
			if err1 != nil || err2 != nil || w <= 0 || h <= 0 {
				return fmt.Errorf("invalid explicit dimensions in size: %s", sizeStr)
			}

			ratio := float64(w) / float64(h)
			if ratio < 1.0/16.0 || ratio > 16.0 {
				return fmt.Errorf("image aspect ratio (%.4f) out of range [1/16, 16]", ratio)
			}

			totalPixels := int64(w) * int64(h)
			if isPro {
				// Seedream 5.0 Pro: [921600, 4624220]
				if totalPixels < 921600 || totalPixels > 4624220 {
					return fmt.Errorf("Seedream 5.0 Pro total pixels (%d) must be within [921600, 4624220]", totalPixels)
				}
			} else if isLite {
				// Seedream 5.0 Lite: [3686400, 16777216]
				if totalPixels < 3686400 || totalPixels > 16777216 {
					return fmt.Errorf("Seedream 5.0 Lite total pixels (%d) must be within [3686400, 16777216]", totalPixels)
				}
			}
		} else {
			// Method 1: Preset Tier
			upperSize := strings.ToUpper(sizeStr)
			if isPro {
				validTiers := map[string]bool{"1K": true, "1.5K": true, "2K": true, "AUTO": true}
				if !validTiers[upperSize] {
					return fmt.Errorf("Seedream 5.0 Pro size tier must be 1K, 1.5K, 2K, or auto, got %s", sizeStr)
				}
			} else if isLite {
				validTiers := map[string]bool{"2K": true, "3K": true, "4K": true}
				if !validTiers[upperSize] {
					return fmt.Errorf("Seedream 5.0 Lite size tier must be 2K, 3K, or 4K, got %s", sizeStr)
				}
			}
		}
	}

	return nil
}

// EncodeLocalAssetToBase64 converts a local image or audio file into a data URI.
func EncodeLocalAssetToBase64(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("failed to read local file %s: %w", path, err)
	}

	ext := strings.ToLower(filepath.Ext(path))
	mimeType := "image/png"
	switch ext {
	case ".png":
		mimeType = "image/png"
	case ".jpg", ".jpeg":
		mimeType = "image/jpeg"
	case ".webp":
		mimeType = "image/webp"
	case ".bmp":
		mimeType = "image/bmp"
	case ".tiff", ".tif":
		mimeType = "image/tiff"
	case ".gif":
		mimeType = "image/gif"
	case ".heic":
		mimeType = "image/heic"
	case ".heif":
		mimeType = "image/heif"
	case ".mp3":
		mimeType = "audio/mp3"
	case ".wav":
		mimeType = "audio/wav"
	case ".mp4":
		mimeType = "video/mp4"
	case ".mov":
		mimeType = "video/quicktime"
	}

	encoded := base64.StdEncoding.EncodeToString(data)
	return fmt.Sprintf("data:%s;base64,%s", mimeType, encoded), nil
}

// resolveAssetURL returns a remote URL or data URI from ReferenceItem.
func resolveAssetURL(ref model.ReferenceItem) (string, error) {
	if ref.URL != "" {
		return ref.URL, nil
	}
	if ref.LocalPath != "" {
		return EncodeLocalAssetToBase64(ref.LocalPath)
	}
	return "", errors.New("reference item has neither URL nor LocalPath")
}

// SubmitTask submits a video or image generation task to Ark native API.
func (a *ArkAdapter) SubmitTask(ctx context.Context, task *model.MediaTask) (string, error) {
	params, err := a.ValidateTask(task)
	if err != nil {
		return "", fmt.Errorf("task validation failed: %w", err)
	}

	if task.TaskType == "video_generation" {
		return a.submitVideoTask(ctx, task, params)
	}
	return a.submitImageTask(ctx, task, params)
}

type videoContentItem struct {
	Type     string         `json:"type"`
	Text     string         `json:"text,omitempty"`
	ImageURL *mediaURLField `json:"image_url,omitempty"`
	VideoURL *mediaURLField `json:"video_url,omitempty"`
	AudioURL *mediaURLField `json:"audio_url,omitempty"`
	Role     string         `json:"role,omitempty"`
}

type mediaURLField struct {
	URL string `json:"url"`
}

type arkVideoTaskRequest struct {
	Model                 string             `json:"model"`
	Content               []videoContentItem `json:"content"`
	Resolution            string             `json:"resolution,omitempty"`
	Ratio                 string             `json:"ratio,omitempty"`
	Duration              int                `json:"duration,omitempty"`
	GenerateAudio         *bool              `json:"generate_audio,omitempty"`
	OutputFormat          string             `json:"output_format,omitempty"`
	Watermark             *bool              `json:"watermark,omitempty"`
	ReturnLastFrame       *bool              `json:"return_last_frame,omitempty"`
	Seed                  *int               `json:"seed,omitempty"`
	CameraFixed           *bool              `json:"camera_fixed,omitempty"`
	ExecutionExpiresAfter int                `json:"execution_expires_after,omitempty"`
}

type arkVideoTaskResponse struct {
	ID    string         `json:"id"`
	Error *arkErrorField `json:"error,omitempty"`
}

type arkErrorField struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (a *ArkAdapter) submitVideoTask(ctx context.Context, task *model.MediaTask, params *ParsedParams) (string, error) {
	content := make([]videoContentItem, 0, len(params.ReferenceAssets)+1)
	if strings.TrimSpace(task.Prompt) != "" {
		content = append(content, videoContentItem{
			Type: "text",
			Text: task.Prompt,
		})
	}

	for _, ref := range params.ReferenceAssets {
		url, err := resolveAssetURL(ref)
		if err != nil {
			return "", fmt.Errorf("failed to resolve asset URL for %s: %w", ref.Label, err)
		}

		role := ref.Role
		if task.TaskMode == "first_last_frame" && role == "" {
			if len(content) == 1 {
				role = "first_frame"
			} else {
				role = "last_frame"
			}
		}

		switch role {
		case "reference_video", "video":
			content = append(content, videoContentItem{
				Type:     "video_url",
				VideoURL: &mediaURLField{URL: url},
				Role:     "reference_video",
			})
		case "reference_audio", "audio":
			content = append(content, videoContentItem{
				Type:     "audio_url",
				AudioURL: &mediaURLField{URL: url},
				Role:     "reference_audio",
			})
		default:
			// Image reference
			content = append(content, videoContentItem{
				Type:     "image_url",
				ImageURL: &mediaURLField{URL: url},
				Role:     role,
			})
		}
	}

	reqBody := arkVideoTaskRequest{
		Model:                 task.Model,
		Content:               content,
		Resolution:            params.Resolution,
		Ratio:                 params.Ratio,
		Duration:              params.Duration,
		GenerateAudio:         params.GenerateAudio,
		OutputFormat:          params.OutputFormat,
		Watermark:             params.Watermark,
		ReturnLastFrame:       params.ReturnLastFrame,
		Seed:                  params.Seed,
		CameraFixed:           params.CameraFixed,
		ExecutionExpiresAfter: 172800,
	}

	jsonBytes, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("failed to marshal video request: %w", err)
	}

	creds := a.getCredentials()
	endpoint := fmt.Sprintf("%s/contents/generations/tasks", creds.BaseURL)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(jsonBytes))
	if err != nil {
		return "", fmt.Errorf("failed to create http request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	if creds.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+creds.APIKey)
	}
	resp, err := a.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("ark video task submission request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read ark video response: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var errResp struct {
			Error arkErrorField `json:"error"`
		}
		_ = json.Unmarshal(respBody, &errResp)
		if errResp.Error.Message != "" {
			return "", fmt.Errorf("ark error [%s]: %s (HTTP %d)", errResp.Error.Code, errResp.Error.Message, resp.StatusCode)
		}
		return "", fmt.Errorf("ark api returned error HTTP %d: %s", resp.StatusCode, string(respBody))
	}

	var taskResp arkVideoTaskResponse
	if err := json.Unmarshal(respBody, &taskResp); err != nil {
		return "", fmt.Errorf("failed to parse ark task response: %w", err)
	}

	if taskResp.Error != nil && taskResp.Error.Code != "" {
		return "", fmt.Errorf("ark error [%s]: %s", taskResp.Error.Code, taskResp.Error.Message)
	}

	if taskResp.ID == "" {
		return "", errors.New("ark response missing task id")
	}

	return taskResp.ID, nil
}

type arkImageRequest struct {
	Model                            string                `json:"model"`
	Prompt                           string                `json:"prompt"`
	Image                            []string              `json:"image,omitempty"`
	Size                             string                `json:"size,omitempty"`
	ResponseFormat                   string                `json:"response_format,omitempty"`
	OutputFormat                     string                `json:"output_format,omitempty"`
	Watermark                        *bool                 `json:"watermark,omitempty"`
	Background                       string                `json:"background,omitempty"`
	LayerDecomposition               bool                  `json:"layer_decomposition,omitempty"`
	SequentialImageGeneration        string                `json:"sequential_image_generation,omitempty"`
	SequentialImageGenerationOptions *SequentialOptions    `json:"sequential_image_generation_options,omitempty"`
	OptimizePromptOptions            *OptimizePromptOption `json:"optimize_prompt_options,omitempty"`
}

type arkImageResponse struct {
	Created int                 `json:"created"`
	Model   string              `json:"model"`
	Data    []arkImageDataBlock `json:"data"`
	Usage   *arkImageUsage      `json:"usage,omitempty"`
	Error   *arkErrorField      `json:"error,omitempty"`
}

type arkImageDataBlock struct {
	URL          string                 `json:"url"`
	B64JSON      string                 `json:"b64_json"`
	Size         string                 `json:"size"`
	OutputFormat string                 `json:"output_format"`
	ZIndex       *int                   `json:"z_index,omitempty"`
	Name         string                 `json:"name,omitempty"`
	Description  string                 `json:"description,omitempty"`
	BoundingBox  interface{}            `json:"bounding_box,omitempty"`
	Error        *arkErrorField         `json:"error,omitempty"`
}
type arkImageUsage struct {
	GeneratedImages int `json:"generated_images"`
	InputImages     int `json:"input_images"`
	OutputTokens    int `json:"output_tokens"`
	TotalTokens     int `json:"total_tokens"`
}

func (a *ArkAdapter) submitImageTask(ctx context.Context, task *model.MediaTask, params *ParsedParams) (string, error) {
	images := make([]string, 0, len(params.ReferenceAssets))
	for _, ref := range params.ReferenceAssets {
		url, err := resolveAssetURL(ref)
		if err != nil {
			return "", fmt.Errorf("failed to resolve image reference URL for %s: %w", ref.Label, err)
		}
		images = append(images, url)
	}

	size := params.Size
	if size == "" && params.Width > 0 && params.Height > 0 {
		size = fmt.Sprintf("%dx%d", params.Width, params.Height)
	}

	reqBody := arkImageRequest{
		Model:                            task.Model,
		Prompt:                           task.Prompt,
		Image:                            images,
		Size:                             size,
		ResponseFormat:                   params.ResponseFormat,
		OutputFormat:                     params.OutputFormat,
		Watermark:                        params.Watermark,
		Background:                       params.Background,
		LayerDecomposition:               params.LayerDecomposition,
		SequentialImageGeneration:        params.SequentialImageGeneration,
		SequentialImageGenerationOptions: params.SequentialImageGenerationOptions,
		OptimizePromptOptions:            params.OptimizePromptOptions,
	}

	jsonBytes, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("failed to marshal image request: %w", err)
	}

	creds := a.getCredentials()
	endpoint := fmt.Sprintf("%s/images/generations", creds.BaseURL)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(jsonBytes))
	if err != nil {
		return "", fmt.Errorf("failed to create http request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	if creds.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+creds.APIKey)
	}
	resp, err := a.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("ark image generation request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read ark image response: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var errResp struct {
			Error arkErrorField `json:"error"`
		}
		_ = json.Unmarshal(respBody, &errResp)
		if errResp.Error.Message != "" {
			return "", fmt.Errorf("ark error [%s]: %s (HTTP %d)", errResp.Error.Code, errResp.Error.Message, resp.StatusCode)
		}
		return "", fmt.Errorf("ark api returned error HTTP %d: %s", resp.StatusCode, string(respBody))
	}

	var imgResp arkImageResponse
	if err := json.Unmarshal(respBody, &imgResp); err != nil {
		return "", fmt.Errorf("failed to parse ark image response: %w", err)
	}

	if imgResp.Error != nil && imgResp.Error.Code != "" {
		return "", fmt.Errorf("ark error [%s]: %s", imgResp.Error.Code, imgResp.Error.Message)
	}

	if len(imgResp.Data) == 0 {
		return "", errors.New("ark response returned empty image data")
	}

	// Build PollResult and cache it for Poller
	providerTaskID := fmt.Sprintf("ark-img-%s", uuid.New().String()[:12])

	pollResult := &PollResult{
		Status:   model.TaskStatusSucceeded,
		Progress: 100,
		Assets:   make([]model.TaskAsset, 0),
	}

	billingMap := map[string]interface{}{
		"generated_images": 1,
		"input_images":     0,
		"output_tokens":    0,
		"total_tokens":     0,
	}
	if imgResp.Usage != nil {
		pollResult.UsageTokens = imgResp.Usage.TotalTokens
		billingMap["generated_images"] = imgResp.Usage.GeneratedImages
		billingMap["input_images"] = imgResp.Usage.InputImages
		billingMap["output_tokens"] = imgResp.Usage.OutputTokens
		billingMap["total_tokens"] = imgResp.Usage.TotalTokens
	}

	assetIndex := 0
	hasLayerDecomp := params.LayerDecomposition
	if !hasLayerDecomp {
		for _, item := range imgResp.Data {
			if item.ZIndex != nil || item.BoundingBox != nil {
				hasLayerDecomp = true
				break
			}
		}
	}
	if hasLayerDecomp {
		layerCount := 0
		for i, item := range imgResp.Data {
			mainURL := item.URL
			if mainURL == "" && item.B64JSON != "" {
				mainURL = "data:image/png;base64," + item.B64JSON
			}

			if i == 0 {
				pollResult.ResultURL = mainURL
			}

			isBase := (item.ZIndex != nil && *item.ZIndex == 0) || (item.ZIndex == nil && i == 0 && item.BoundingBox == nil)
			if isBase {
				name := item.Name
				if name == "" {
					name = "base.png"
				}
				pollResult.Assets = append(pollResult.Assets, model.TaskAsset{
					AssetIndex:  assetIndex,
					Kind:        "image_base",
					Name:        name,
					Description: item.Description,
					RemoteURL:   mainURL,
					LocalPath:   fmt.Sprintf("images/%s/base.png", task.ID),
					ZIndex:      0,
				})
				assetIndex++
			} else {
				zIndex := i
				if item.ZIndex != nil {
					zIndex = *item.ZIndex
				}
				name := item.Name
				if name == "" {
					name = fmt.Sprintf("layer_%02d.png", layerCount)
				}

				var bboxJSON string
				if item.BoundingBox != nil {
					bBytes, _ := json.Marshal(item.BoundingBox)
					bboxJSON = string(bBytes)
				}

				pollResult.Assets = append(pollResult.Assets, model.TaskAsset{
					AssetIndex:      assetIndex,
					Kind:            "image_layer",
					Name:            name,
					Description:     item.Description,
					RemoteURL:       layerURLOrMain(item),
					LocalPath:       fmt.Sprintf("images/%s/layer_%02d.png", task.ID, layerCount),
					ZIndex:          zIndex,
					BoundingBoxJSON: bboxJSON,
				})
				layerCount++
				assetIndex++
			}
		}
	} else if len(imgResp.Data) > 1 {
		for i, item := range imgResp.Data {
			mainURL := item.URL
			if mainURL == "" && item.B64JSON != "" {
				mainURL = "data:image/png;base64," + item.B64JSON
			}
			if i == 0 {
				pollResult.ResultURL = mainURL
			}
			name := item.Name
			if name == "" {
				name = fmt.Sprintf("storyboard_%02d.png", i)
			}
			pollResult.Assets = append(pollResult.Assets, model.TaskAsset{
				AssetIndex: assetIndex,
				Kind:       "image_frame",
				Name:       name,
				RemoteURL:  mainURL,
				LocalPath:  fmt.Sprintf("images/%s/storyboard_%02d.png", task.ID, i),
				ZIndex:     i,
			})
			assetIndex++
		}
	} else {
		item := imgResp.Data[0]
		mainURL := item.URL
		if mainURL == "" && item.B64JSON != "" {
			mainURL = "data:image/png;base64," + item.B64JSON
		}
		pollResult.ResultURL = mainURL
		name := item.Name
		if name == "" {
			name = "base.png"
		}
		pollResult.Assets = append(pollResult.Assets, model.TaskAsset{
			AssetIndex:  0,
			Kind:        "image_base",
			Name:        name,
			Description: item.Description,
			RemoteURL:   mainURL,
			LocalPath:   fmt.Sprintf("images/%s/base.png", task.ID),
			ZIndex:      0,
		})
	}
	billingMap["poll_result"] = pollResult
	bJSON, _ := json.Marshal(billingMap)
	pollResult.BillingDetailsJSON = string(bJSON)
	task.BillingDetailsJSON = string(bJSON)

	a.imageCache.Store(providerTaskID, pollResult)
	return providerTaskID, nil
}
func layerURLOrMain(item arkImageDataBlock) string {
	if item.URL != "" {
		return item.URL
	}
	if item.B64JSON != "" {
		return "data:image/png;base64," + item.B64JSON
	}
	return ""
}


type arkVideoPollResponse struct {
	ID        string `json:"id"`
	Model     string `json:"model"`
	Status    string `json:"status"` // queued | running | succeeded | failed | cancelled | expired
	CreatedAt int64  `json:"created_at"`
	UpdatedAt int64  `json:"updated_at"`
	Content   *struct {
		VideoURL     string `json:"video_url"`
		LastFrameURL string `json:"last_frame_url,omitempty"`
	} `json:"content,omitempty"`
	Resolution string `json:"resolution,omitempty"`
	Ratio      string `json:"ratio,omitempty"`
	Duration   int    `json:"duration,omitempty"`
	Frames     int    `json:"frames,omitempty"`
	Usage      *struct {
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage,omitempty"`
	Error *arkErrorField `json:"error,omitempty"`
}

// PollTask queries the status of a video generation task or returns cached image generation result.
func (a *ArkAdapter) PollTask(ctx context.Context, task *model.MediaTask) (*PollResult, error) {
	if task.TaskType == "image_generation" {
		if val, ok := a.imageCache.Load(task.ProviderTaskID); ok {
			return val.(*PollResult), nil
		}
		// Recover from task.BillingDetailsJSON if cache missed (e.g. after restart)
		if strings.TrimSpace(task.BillingDetailsJSON) != "" {
			var bMap map[string]json.RawMessage
			if err := json.Unmarshal([]byte(task.BillingDetailsJSON), &bMap); err == nil {
				if resJSON, ok := bMap["poll_result"]; ok {
					var restored PollResult
					if err := json.Unmarshal(resJSON, &restored); err == nil && len(restored.Assets) > 0 {
						a.imageCache.Store(task.ProviderTaskID, &restored)
						return &restored, nil
					}
				}
			}
		}
		return nil, fmt.Errorf("image task %s (%s) poll result not found in cache or billing metadata", task.ID, task.ProviderTaskID)
	}
	// Video task query via GET /contents/generations/tasks/{id}
	creds := a.getCredentials()
	endpoint := fmt.Sprintf("%s/contents/generations/tasks/%s", creds.BaseURL, task.ProviderTaskID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create poll request: %w", err)
	}

	if creds.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+creds.APIKey)
	}
	resp, err := a.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("ark poll request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read ark poll response: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("ark poll returned HTTP %d: %s", resp.StatusCode, string(respBody))
	}

	var pollResp arkVideoPollResponse
	if err := json.Unmarshal(respBody, &pollResp); err != nil {
		return nil, fmt.Errorf("failed to parse ark poll response: %w", err)
	}

	result := &PollResult{
		Status: strings.ToLower(pollResp.Status),
	}

	switch result.Status {
	case "succeeded":
		result.Progress = 100
		if pollResp.Content != nil {
			result.ResultURL = pollResp.Content.VideoURL

			// Main video asset
			result.Assets = append(result.Assets, model.TaskAsset{
				AssetIndex: 0,
				Kind:       "video",
				Name:       "output.mp4",
				RemoteURL:  pollResp.Content.VideoURL,
				LocalPath:  fmt.Sprintf("videos/%s/output.mp4", task.ID),
			})

			// Optional last frame
			if pollResp.Content.LastFrameURL != "" {
				result.Assets = append(result.Assets, model.TaskAsset{
					AssetIndex: 1,
					Kind:       "image_frame",
					Name:       "last_frame.png",
					RemoteURL:  pollResp.Content.LastFrameURL,
					LocalPath:  fmt.Sprintf("videos/%s/last_frame.png", task.ID),
				})
			}
		}

		durationSec := float64(pollResp.Duration)
		if durationSec == 0 && pollResp.Frames > 0 {
			durationSec = float64(pollResp.Frames) / 24.0
		}
		result.OutputDurationSec = durationSec

		if pollResp.Usage != nil {
			result.UsageTokens = pollResp.Usage.CompletionTokens
			billingMap := map[string]interface{}{
				"completion_tokens":   pollResp.Usage.CompletionTokens,
				"total_tokens":        pollResp.Usage.TotalTokens,
				"output_duration_sec": durationSec,
				"frames":              pollResp.Frames,
				"resolution":          pollResp.Resolution,
				"ratio":               pollResp.Ratio,
			}
			bJSON, _ := json.Marshal(billingMap)
			result.BillingDetailsJSON = string(bJSON)
		}

	case "failed", "cancelled", "expired":
		if pollResp.Error != nil {
			result.ErrorCode = pollResp.Error.Code
			result.ErrorMessage = pollResp.Error.Message
		}

	case "running":
		result.Progress = 50
	case "queued":
		result.Progress = 10
	default:
		result.Status = model.TaskStatusRunning
		result.Progress = 25
	}

	return result, nil
}

// DownloadAsset downloads an asset from a remote URL or data URI and saves it locally.
func (a *ArkAdapter) DownloadAsset(ctx context.Context, remoteURL string, targetLocalPath string) error {
	dir := filepath.Dir(targetLocalPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create directory %s: %w", dir, err)
	}

	// Case 1: Data URI (base64)
	if strings.HasPrefix(remoteURL, "data:") {
		parts := strings.SplitN(remoteURL, ",", 2)
		if len(parts) != 2 {
			return errors.New("invalid data URI format")
		}
		decoded, err := base64.StdEncoding.DecodeString(parts[1])
		if err != nil {
			return fmt.Errorf("failed to decode base64 data URI: %w", err)
		}
		return os.WriteFile(targetLocalPath, decoded, 0644)
	}

	// Case 2: HTTP / HTTPS URL
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, remoteURL, nil)
	if err != nil {
		return fmt.Errorf("failed to create download request: %w", err)
	}

	resp, err := a.client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to download remote asset from %s: %w", remoteURL, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("asset download returned HTTP %d for %s", resp.StatusCode, remoteURL)
	}

	file, err := os.Create(targetLocalPath)
	if err != nil {
		return fmt.Errorf("failed to create target file %s: %w", targetLocalPath, err)
	}
	defer file.Close()

	if _, err := io.Copy(file, resp.Body); err != nil {
		return fmt.Errorf("failed to stream asset to file: %w", err)
	}

	return file.Sync()
}

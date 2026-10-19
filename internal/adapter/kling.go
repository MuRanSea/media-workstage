package adapter

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"media-workstage/internal/model"
)

// KlingAdapter generates videos and images through Kling's own API (api-beijing.klingai.com),
// authenticated with a single API key as a Bearer token. Videos use the path-versioned
// endpoints (POST /text-to-video/{model}, /image-to-video/{model}, /omni-video/{model}) and
// are polled with GET /tasks?task_ids=; images use the older /v1/images/* endpoints, which
// are polled at their own /{id} path.
type KlingAdapter struct {
	channelImageBase
}

func NewKlingAdapter(cfg ChannelConfig) *KlingAdapter {
	return &KlingAdapter{channelImageBase: newChannelImageBase("kling", "https://api-beijing.klingai.com", cfg)}
}

// klingImageInlineLimit keeps one inlined reference image under Kling's 10 MB image limit.
const klingImageInlineLimit = 8 << 20

var (
	// Prompts reach the adapter with mentions compiled to 图1 / 视频1; Omni wants @image_1 / @video_1.
	klingVideoImageRef = regexp.MustCompile(`图(\d+)`)
	klingVideoVideoRef = regexp.MustCompile(`视频(\d+)`)
	// "镜头 1, 3, words" is Kling 3.0's multi-shot prompt syntax.
	klingShotSyntax = regexp.MustCompile(`镜头\s*\d+\s*[,，]\s*\d+`)
)

// klingEnvelope is the {code, message, data} wrapper every Kling response carries.
type klingEnvelope struct {
	Code      int             `json:"code"`
	Message   string          `json:"message"`
	RequestID string          `json:"request_id"`
	Data      json.RawMessage `json:"data"`
}

// call sends a JSON request and returns the envelope's data; a non-zero code is an error
// even on HTTP 200.
func (k *KlingAdapter) call(ctx context.Context, method, path string, body any) (json.RawMessage, error) {
	baseURL, apiKey := k.credentials()
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal kling request: %w", err)
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, baseURL+path, reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	var env klingEnvelope
	if err := k.doJSON(req, &env); err != nil {
		return nil, err
	}
	if env.Code != 0 {
		return nil, fmt.Errorf("kling error [%d]: %s", env.Code, env.Message)
	}
	return env.Data, nil
}

func (k *KlingAdapter) SubmitTask(ctx context.Context, task *model.MediaTask) (string, error) {
	switch task.TaskType {
	case "video_generation":
		return k.submitVideo(ctx, task)
	case "image_generation":
		return k.submitImage(ctx, task)
	}
	return "", fmt.Errorf("kling 服务商不支持 %s 任务", task.TaskType)
}

func (k *KlingAdapter) PollTask(ctx context.Context, task *model.MediaTask) (*PollResult, error) {
	if task.TaskType == "image_generation" {
		return k.pollImage(ctx, task)
	}
	return k.pollVideo(ctx, task)
}

// PollTimeout gives image jobs more than the poller's image default; videos already get
// the poller's long video default.
func (k *KlingAdapter) PollTimeout(task *model.MediaTask) time.Duration {
	if task.TaskType == "video_generation" {
		return 0
	}
	return 10 * time.Minute
}

// ---- video ----

// klingVideoTraits describes what a Kling video model accepts.
type klingVideoTraits struct {
	omni       bool // /omni-video: multi-image references and reference videos
	turbo      bool // 3.0 Turbo: first frame only, no audio, no multi-shot
	audio      bool
	multiShot  bool
	maxQuality string // highest resolution: "4k" or "1080p"
}

func klingTraitsFor(modelID string) klingVideoTraits {
	m := strings.ToLower(modelID)
	t := klingVideoTraits{maxQuality: "1080p"}
	t.omni = strings.Contains(m, "omni")
	t.turbo = strings.Contains(m, "turbo")
	t.audio = !t.turbo
	if strings.HasPrefix(m, "kling-3.0") && !t.turbo {
		t.multiShot = true
		t.maxQuality = "4k"
	}
	return t
}

// klingResolution clamps the card's resolution to what the model offers.
func klingResolution(resolution string, t klingVideoTraits) string {
	switch r := strings.ToLower(strings.TrimSpace(resolution)); r {
	case "1080p":
		return "1080p"
	case "4k":
		if t.maxQuality == "4k" {
			return "4k"
		}
		return "1080p"
	}
	return "720p"
}

// klingImageData returns a reference image the way Kling takes it: a public URL as-is,
// otherwise bare Base64 (Kling rejects a data: prefix).
func klingImageData(ref model.ReferenceItem) (string, error) {
	if strings.HasPrefix(ref.URL, "http://") || strings.HasPrefix(ref.URL, "https://") {
		return ref.URL, nil
	}
	if ref.LocalPath != "" {
		uri, err := EncodeImageWithin(ref.LocalPath, klingImageInlineLimit)
		if err != nil {
			return "", fmt.Errorf("参考图 %s 无法读取: %w", ref.Label, err)
		}
		return stripDataURIPrefix(uri), nil
	}
	if strings.HasPrefix(ref.URL, "data:") {
		return stripDataURIPrefix(ref.URL), nil
	}
	if strings.HasPrefix(ref.RemoteURL, "http://") || strings.HasPrefix(ref.RemoteURL, "https://") {
		return ref.RemoteURL, nil
	}
	return "", fmt.Errorf("参考图 %s 没有可用的图片文件", ref.Label)
}

func stripDataURIPrefix(uri string) string {
	if strings.HasPrefix(uri, "data:") {
		if _, payload, found := strings.Cut(uri, ","); found {
			return payload
		}
	}
	return uri
}

type klingContent struct {
	Type string `json:"type"`
	Text string `json:"text,omitempty"`
	URL  string `json:"url,omitempty"`
	ID   string `json:"id,omitempty"`
}

func (k *KlingAdapter) submitVideo(ctx context.Context, task *model.MediaTask) (string, error) {
	var params apimartVideoParams
	if err := json.Unmarshal([]byte(task.ParamsJSON), &params); err != nil {
		return "", fmt.Errorf("invalid video params: %w", err)
	}
	if strings.TrimSpace(task.Prompt) == "" {
		return "", errors.New("kling 视频生成需要提示词")
	}
	traits := klingTraitsFor(task.Model)

	var images, videos []model.ReferenceItem
	for _, r := range params.ReferenceAssets {
		switch r.Role {
		case "reference_video":
			videos = append(videos, r)
		case "reference_audio":
			return "", fmt.Errorf("%s 不支持参考音频", task.Model)
		default:
			images = append(images, r)
		}
	}

	if !traits.omni {
		if len(videos) > 0 {
			return "", fmt.Errorf("%s 不支持参考视频，请换用 Kling 3.0 Omni", task.Model)
		}
		for _, r := range images {
			if r.Role == "reference_image" {
				return "", fmt.Errorf("%s 不支持多图参考，请改用首尾帧或纯文生模式", task.Model)
			}
		}
		// First frame before last frame, whatever order the card listed them in.
		sort.SliceStable(images, func(i, j int) bool { return images[i].Role == "first_frame" && images[j].Role != "first_frame" })
		if traits.turbo && len(images) > 1 {
			return "", fmt.Errorf("%s 只支持首帧图，不支持尾帧", task.Model)
		}
		if len(images) > 2 {
			return "", fmt.Errorf("%s 最多 2 张图（首帧、尾帧），得到 %d 张", task.Model, len(images))
		}
	} else {
		if len(videos) > 1 {
			return "", fmt.Errorf("%s 最多 1 个参考视频", task.Model)
		}
		limit := 7
		if len(videos) > 0 {
			limit = 4
		}
		if len(images) > limit {
			return "", fmt.Errorf("%s 最多 %d 张参考图，得到 %d 张", task.Model, limit, len(images))
		}
	}

	imageData := make([]string, len(images))
	for i, ref := range images {
		data, err := klingImageData(ref)
		if err != nil {
			return "", err
		}
		imageData[i] = data
	}
	hasLast, hasFirst := false, false
	for _, r := range images {
		hasFirst = hasFirst || r.Role == "first_frame"
		hasLast = hasLast || r.Role == "last_frame"
	}
	if hasLast && !hasFirst {
		return "", errors.New("可灵不支持仅尾帧，请同时提供首帧图")
	}

	// A reference video that is edited (base_video) keeps its own length and shape.
	editsVideo := traits.omni && len(videos) > 0 && params.VideoReferType != "feature"

	settings := map[string]any{"resolution": klingResolution(params.Resolution, traits)}
	if params.Duration > 0 && !editsVideo {
		settings["duration"] = params.Duration
	}
	aspect := params.Ratio
	if aspect == "adaptive" || aspect == "auto" {
		aspect = ""
	}
	textOnly := len(images) == 0 && len(videos) == 0
	if aspect != "" && !editsVideo && (traits.omni || textOnly) {
		settings["aspect_ratio"] = aspect
	}
	if traits.audio {
		audio := "off"
		if params.GenerateAudio != nil && *params.GenerateAudio {
			audio = "native"
		}
		settings["audio"] = audio
	}
	if traits.multiShot {
		settings["multi_shot"] = klingShotSyntax.MatchString(task.Prompt)
	}

	var path string
	var body map[string]any
	switch {
	case traits.omni:
		prompt := klingVideoImageRef.ReplaceAllString(task.Prompt, "@image_$1")
		prompt = klingVideoVideoRef.ReplaceAllString(prompt, "@video_$1")
		contents := []klingContent{{Type: "prompt", Text: prompt}}
		for i, ref := range images {
			typ := "refer_image"
			if ref.Role == "first_frame" || ref.Role == "last_frame" {
				typ = ref.Role
			}
			contents = append(contents, klingContent{Type: typ, URL: imageData[i], ID: "image_" + strconv.Itoa(i+1)})
		}
		for i, ref := range videos {
			u, err := referenceVideoURL(ref)
			if err != nil {
				return "", err
			}
			typ := "base_video"
			if params.VideoReferType == "feature" {
				typ = "feature_video"
			}
			contents = append(contents, klingContent{Type: typ, URL: u, ID: "video_" + strconv.Itoa(i+1)})
		}
		path = "/omni-video/" + task.Model
		body = map[string]any{"contents": contents, "settings": settings}

	case len(images) > 0:
		contents := []klingContent{{Type: "prompt", Text: task.Prompt}}
		for i, ref := range images {
			contents = append(contents, klingContent{Type: ref.Role, URL: imageData[i]})
		}
		path = "/image-to-video/" + task.Model
		body = map[string]any{"contents": contents, "settings": settings}

	default:
		path = "/text-to-video/" + task.Model
		body = map[string]any{"prompt": task.Prompt, "settings": settings}
	}

	data, err := k.call(ctx, http.MethodPost, path, body)
	if err != nil {
		return "", err
	}
	var created struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(data, &created); err != nil || created.ID == "" {
		return "", errors.New("kling did not return a task id")
	}
	return created.ID, nil
}

type klingTaskOutput struct {
	Type     string `json:"type"`
	URL      string `json:"url"`
	Duration string `json:"duration"`
}

type klingTask struct {
	ID      string            `json:"id"`
	Status  string            `json:"status"`
	Message string            `json:"message"`
	Outputs []klingTaskOutput `json:"outputs"`
}

func (k *KlingAdapter) pollVideo(ctx context.Context, task *model.MediaTask) (*PollResult, error) {
	data, err := k.call(ctx, http.MethodGet, "/tasks?task_ids="+url.QueryEscape(task.ProviderTaskID), nil)
	if err != nil {
		return nil, err
	}
	var tasks []klingTask
	if err := json.Unmarshal(data, &tasks); err != nil {
		return nil, fmt.Errorf("failed to parse kling task response: %w", err)
	}
	var t *klingTask
	for i := range tasks {
		if tasks[i].ID == task.ProviderTaskID {
			t = &tasks[i]
		}
	}
	if t == nil {
		if len(tasks) == 0 {
			return nil, errors.New("kling task not found")
		}
		t = &tasks[0]
	}

	switch strings.ToLower(t.Status) {
	case "submitted":
		return &PollResult{Status: model.TaskStatusQueued, Progress: 15}, nil

	case "succeeded", "succeed":
		res := &PollResult{Status: model.TaskStatusSucceeded, Progress: 100}
		for _, o := range t.Outputs {
			if o.Type == "video" && o.URL != "" {
				res.Assets = append(res.Assets, videoAsset(task.ID, len(res.Assets), o.URL))
				if res.OutputDurationSec == 0 {
					res.OutputDurationSec = parseDurationSec(o.Duration)
				}
			}
		}
		if len(res.Assets) == 0 {
			return &PollResult{Status: model.TaskStatusFailed, ErrorCode: "EmptyResult", ErrorMessage: "kling 任务完成但没有返回视频"}, nil
		}
		res.ResultURL = res.Assets[0].RemoteURL
		billing, _ := json.Marshal(map[string]any{
			"model":               task.Model,
			"output_duration_sec": res.OutputDurationSec,
		})
		res.BillingDetailsJSON = string(billing)
		return res, nil

	case "failed":
		msg := t.Message
		if msg == "" {
			msg = "kling 任务失败"
		}
		return &PollResult{Status: model.TaskStatusFailed, ErrorCode: "Kling_failed", ErrorMessage: msg}, nil

	default: // processing
		return &PollResult{Status: model.TaskStatusRunning, Progress: 50}, nil
	}
}

// ---- image ----

// klingOmniImage reports whether an image model goes through /v1/images/omni-image.
func klingOmniImage(modelID string) bool {
	m := strings.ToLower(modelID)
	return strings.Contains(m, "omni") || strings.Contains(m, "image-o1")
}

func klingImagePath(modelID string) string {
	if klingOmniImage(modelID) {
		return "/v1/images/omni-image"
	}
	return "/v1/images/generations"
}

var klingImagePromptRef = regexp.MustCompile(`图(\d+)`)

func (k *KlingAdapter) submitImage(ctx context.Context, task *model.MediaTask) (string, error) {
	if strings.TrimSpace(task.Prompt) == "" {
		return "", errors.New("kling 生图需要提示词")
	}
	params := parseGenericImageParams(task.ParamsJSON)
	refs := parseReferenceAssets(task.ParamsJSON)
	omni := klingOmniImage(task.Model)

	resolution := ""
	switch params.Resolution {
	case "1K":
		resolution = "1k"
	case "2K":
		resolution = "2k"
	case "4K":
		resolution = "4k"
		if !omni {
			resolution = "2k" // kling-v3 tops out at 2k
		}
	}

	body := map[string]any{"model_name": task.Model, "prompt": task.Prompt, "n": 1}
	if resolution != "" {
		body["resolution"] = resolution
	}
	if params.AspectRatio != "" {
		body["aspect_ratio"] = params.AspectRatio
	}

	if omni {
		if len(refs) > 10 {
			return "", fmt.Errorf("%s 最多 10 张参考图，得到 %d 张", task.Model, len(refs))
		}
		if len(refs) > 0 {
			list := make([]map[string]string, len(refs))
			for i, ref := range refs {
				data, err := klingImageData(ref)
				if err != nil {
					return "", err
				}
				list[i] = map[string]string{"image": data}
			}
			body["image_list"] = list
			body["prompt"] = klingImagePromptRef.ReplaceAllString(task.Prompt, "<<<image_$1>>>")
		}
	} else if len(refs) > 0 {
		if len(refs) > 1 {
			return "", fmt.Errorf("%s 只支持 1 张参考图，多图参考请改用 kling-v3-omni", task.Model)
		}
		data, err := klingImageData(refs[0])
		if err != nil {
			return "", err
		}
		body["image"] = data
	}

	data, err := k.call(ctx, http.MethodPost, klingImagePath(task.Model), body)
	if err != nil {
		return "", err
	}
	var created struct {
		TaskID string `json:"task_id"`
	}
	if err := json.Unmarshal(data, &created); err != nil || created.TaskID == "" {
		return "", errors.New("kling did not return a task_id")
	}
	return created.TaskID, nil
}

func (k *KlingAdapter) pollImage(ctx context.Context, task *model.MediaTask) (*PollResult, error) {
	data, err := k.call(ctx, http.MethodGet, klingImagePath(task.Model)+"/"+url.PathEscape(task.ProviderTaskID), nil)
	if err != nil {
		return nil, err
	}
	var t struct {
		Status  string `json:"task_status"`
		Message string `json:"task_status_msg"`
		Result  struct {
			Images []struct {
				URL string `json:"url"`
			} `json:"images"`
			SeriesImages []struct {
				URL string `json:"url"`
			} `json:"series_images"`
		} `json:"task_result"`
	}
	if err := json.Unmarshal(data, &t); err != nil {
		return nil, fmt.Errorf("failed to parse kling image response: %w", err)
	}

	switch strings.ToLower(t.Status) {
	case "submitted":
		return &PollResult{Status: model.TaskStatusQueued, Progress: 15}, nil

	case "succeed", "succeeded":
		res := &PollResult{Status: model.TaskStatusSucceeded, Progress: 100}
		for _, img := range t.Result.Images {
			if img.URL != "" {
				res.Assets = append(res.Assets, imageAsset(task.ID, len(res.Assets), img.URL, imageExt("", img.URL)))
			}
		}
		for _, img := range t.Result.SeriesImages {
			if img.URL != "" {
				res.Assets = append(res.Assets, imageAsset(task.ID, len(res.Assets), img.URL, imageExt("", img.URL)))
			}
		}
		if len(res.Assets) == 0 {
			return &PollResult{Status: model.TaskStatusFailed, ErrorCode: "EmptyResult", ErrorMessage: "kling 任务完成但没有返回图片"}, nil
		}
		res.ResultURL = res.Assets[0].RemoteURL
		return res, nil

	case "failed":
		msg := t.Message
		if msg == "" {
			msg = "kling 任务失败"
		}
		return &PollResult{Status: model.TaskStatusFailed, ErrorCode: "Kling_failed", ErrorMessage: msg}, nil

	default: // processing
		return &PollResult{Status: model.TaskStatusRunning, Progress: 50}, nil
	}
}

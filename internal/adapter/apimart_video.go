package adapter

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"media-workstage/internal/model"
)

// apimartVideoParams is what the video card compiles into task params for APIMart.
type apimartVideoParams struct {
	Resolution      string                `json:"resolution"` // 720p | 1080p | 4k
	Duration        int                   `json:"duration"`
	Ratio           string                `json:"ratio"` // "adaptive" lets the first frame decide
	GenerateAudio   *bool                 `json:"generate_audio"`
	Watermark       *bool                 `json:"watermark"`
	ReferenceAssets []model.ReferenceItem `json:"reference_assets"`
}

// videoFamily groups APIMart video models by how they take their parameters and images.
type videoFamily int

const (
	klingFrames videoFamily = iota // kling-v3, kling-v2-6: image_urls = [first, last]
	klingTurbo                     // kling-3.0-turbo: single first_frame_image
	klingOmni                      // kling-v3-omni, kling-video-o1: image_with_roles + <<<image_N>>>
	minimaxH3                      // MiniMax-H3: image_with_roles, resolution 2K / 768P
)

// apimartVideoFamily reports how to call an APIMart video model, or false for models
// the APIMart video path does not support yet.
func apimartVideoFamily(modelID string) (videoFamily, bool) {
	m := strings.ToLower(modelID)
	switch {
	case strings.HasPrefix(m, "minimax-h3"):
		return minimaxH3, true
	case !strings.HasPrefix(m, "kling"):
		return 0, false
	case strings.Contains(m, "omni") || strings.Contains(m, "-o1"):
		return klingOmni, true
	case strings.Contains(m, "turbo"):
		return klingTurbo, true
	default:
		return klingFrames, true
	}
}

// klingMode maps the card's resolution onto Kling's quality mode.
func klingMode(resolution string) string {
	switch strings.ToLower(resolution) {
	case "1080p":
		return "pro"
	case "4k":
		return "4k"
	default:
		return "std"
	}
}

var promptImageRef = regexp.MustCompile(`图(\d+)`)

type apimartRoleImage struct {
	URL  string `json:"url"`
	Role string `json:"role"`
}

func (a *APIMartAdapter) submitVideo(ctx context.Context, task *model.MediaTask) (string, error) {
	family, ok := apimartVideoFamily(task.Model)
	if !ok {
		return "", fmt.Errorf("APIMart 视频目前只接入了可灵 (kling-*) 和 MiniMax-H3，不支持 %s", task.Model)
	}
	var params apimartVideoParams
	if err := json.Unmarshal([]byte(task.ParamsJSON), &params); err != nil {
		return "", fmt.Errorf("invalid video params: %w", err)
	}

	refs := params.ReferenceAssets
	if family != klingOmni && family != minimaxH3 {
		for _, r := range refs {
			if r.Role == "reference_image" {
				return "", fmt.Errorf("%s 不支持多图参考，请改用首尾帧或纯文生模式", task.Model)
			}
		}
		// First frame before last frame, whatever order the card listed them in.
		sort.SliceStable(refs, func(i, j int) bool { return refs[i].Role == "first_frame" && refs[j].Role != "first_frame" })
	}
	if family == klingTurbo && len(refs) > 1 {
		return "", fmt.Errorf("%s 只支持首帧图，不支持尾帧", task.Model)
	}

	urls := make([]string, len(refs))
	for i, ref := range refs {
		u, err := a.referenceURL(ctx, ref)
		if err != nil {
			return "", err
		}
		urls[i] = u
	}

	body := map[string]any{"model": task.Model, "prompt": task.Prompt}
	if params.Duration > 0 {
		body["duration"] = params.Duration
	}
	aspect := params.Ratio
	if aspect == "adaptive" {
		aspect = ""
	}
	audio := params.GenerateAudio != nil && *params.GenerateAudio

	switch family {
	case klingTurbo:
		if res := strings.ToLower(params.Resolution); res == "720p" || res == "1080p" {
			body["resolution"] = res
		}
		if len(urls) > 0 {
			body["first_frame_image"] = urls[0]
		} else if aspect != "" {
			body["aspect_ratio"] = aspect
		}

	case klingFrames:
		body["mode"] = klingMode(params.Resolution)
		if aspect != "" {
			body["aspect_ratio"] = aspect
		}
		if len(urls) > 0 {
			body["image_urls"] = urls
		}
		if audio {
			body["audio"] = true
		}

	case klingOmni:
		body["mode"] = klingMode(params.Resolution)
		if aspect != "" {
			body["aspect_ratio"] = aspect
		}
		if len(urls) > 0 {
			images := make([]apimartRoleImage, len(urls))
			for i, u := range urls {
				role := "reference"
				switch refs[i].Role {
				case "first_frame", "last_frame":
					role = refs[i].Role
				}
				images[i] = apimartRoleImage{URL: u, Role: role}
			}
			body["image_with_roles"] = images
			// The card compiles mentions to 图1, 图2… in reference order; Omni wants <<<image_N>>>.
			body["prompt"] = promptImageRef.ReplaceAllString(task.Prompt, "<<<image_$1>>>")
		}
		// kling-video-o1 has no audio switch.
		if audio && !strings.Contains(strings.ToLower(task.Model), "-o1") {
			body["audio"] = true
		}

	case minimaxH3:
		if res := strings.ToUpper(params.Resolution); res == "2K" || res == "768P" {
			body["resolution"] = res
		}
		// With first/last frames the images decide the ratio; otherwise send it
		// (text-only without one falls back to 16:9 on APIMart's side).
		hasFrames := false
		for _, r := range refs {
			if r.Role == "first_frame" || r.Role == "last_frame" {
				hasFrames = true
			}
		}
		if aspect != "" && !hasFrames {
			body["aspect_ratio"] = aspect
		}
		if len(urls) > 0 {
			images := make([]apimartRoleImage, len(urls))
			for i, u := range urls {
				role := "reference_image"
				switch refs[i].Role {
				case "first_frame", "last_frame":
					role = refs[i].Role
				}
				images[i] = apimartRoleImage{URL: u, Role: role}
			}
			body["image_with_roles"] = images
		}
	}
	if params.Watermark != nil {
		body["watermark"] = *params.Watermark
	}

	raw, err := json.Marshal(body)
	if err != nil {
		return "", fmt.Errorf("failed to marshal apimart video request: %w", err)
	}
	return a.postTask(ctx, "/videos/generations", raw)
}

// referenceURL turns a reference image into something APIMart accepts. APIMart wants
// public URLs, so local files are uploaded; relays that do not forward the upload
// endpoint fall back to the image's original public URL, then to base64.
func (a *APIMartAdapter) referenceURL(ctx context.Context, ref model.ReferenceItem) (string, error) {
	if strings.HasPrefix(ref.URL, "http://") || strings.HasPrefix(ref.URL, "https://") || strings.HasPrefix(ref.URL, "data:") {
		return ref.URL, nil
	}
	publicURL := ""
	if strings.HasPrefix(ref.RemoteURL, "https://") || strings.HasPrefix(ref.RemoteURL, "http://") {
		publicURL = ref.RemoteURL
	}
	if ref.LocalPath == "" {
		if publicURL != "" {
			return publicURL, nil
		}
		return "", fmt.Errorf("参考图 %s 没有可用的图片文件", ref.Label)
	}

	if !a.uploadUnsupported.Load() {
		u, err := a.uploadImage(ctx, ref.LocalPath)
		if err == nil {
			return u, nil
		}
		var httpErr *ProviderHTTPError
		if !errors.As(err, &httpErr) || (httpErr.Status != http.StatusNotFound && httpErr.Status != http.StatusMethodNotAllowed) {
			return "", fmt.Errorf("上传参考图 %s 失败: %w", ref.Label, err)
		}
		a.uploadUnsupported.Store(true)
	}
	if publicURL != "" {
		return publicURL, nil
	}
	return EncodeLocalAssetToBase64(ref.LocalPath)
}

// uploadImage sends a local image to POST /uploads/images and returns its public URL.
func (a *APIMartAdapter) uploadImage(ctx context.Context, localPath string) (string, error) {
	f, err := os.Open(localPath)
	if err != nil {
		return "", fmt.Errorf("failed to open %s: %w", localPath, err)
	}
	defer f.Close()

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	header := make(textproto.MIMEHeader)
	header.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename=%q`, filepath.Base(localPath)))
	header.Set("Content-Type", mimeForExt(filepath.Ext(localPath)))
	part, err := w.CreatePart(header)
	if err != nil {
		return "", err
	}
	if _, err := io.Copy(part, f); err != nil {
		return "", err
	}
	if err := w.Close(); err != nil {
		return "", err
	}

	baseURL, apiKey := a.credentials()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/uploads/images", &buf)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+apiKey)

	var resp struct {
		URL  string `json:"url"`
		Data *struct {
			URL string `json:"url"`
		} `json:"data"`
	}
	if err := a.doJSON(req, &resp); err != nil {
		return "", err
	}
	if resp.URL == "" && resp.Data != nil {
		resp.URL = resp.Data.URL
	}
	if resp.URL == "" {
		return "", errors.New("apimart upload returned no url")
	}
	return resp.URL, nil
}

func mimeForExt(ext string) string {
	switch strings.ToLower(ext) {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".webp":
		return "image/webp"
	default:
		return "image/png"
	}
}

// flexURLs accepts a URL given either as a string or as an array of strings.
type flexURLs []string

func (f *flexURLs) UnmarshalJSON(data []byte) error {
	var one string
	if err := json.Unmarshal(data, &one); err == nil {
		if one != "" {
			*f = flexURLs{one}
		}
		return nil
	}
	var many []string
	if err := json.Unmarshal(data, &many); err != nil {
		return err
	}
	*f = many
	return nil
}

// apimartMedia is one generated file in result.images / result.videos.
type apimartMedia struct {
	URL      flexURLs `json:"url"`
	VideoURL string   `json:"video_url"`
}

func (m apimartMedia) urls() []string {
	if len(m.URL) > 0 {
		return m.URL
	}
	if m.VideoURL != "" {
		return []string{m.VideoURL}
	}
	return nil
}

// videoAsset lays out outputs like the Ark adapter: videos/<task>/output.mp4.
func videoAsset(taskID string, index int, remoteURL string) model.TaskAsset {
	name := "output"
	if index > 0 {
		name = fmt.Sprintf("output_%02d", index)
	}
	return model.TaskAsset{
		AssetIndex: index,
		Kind:       "video",
		RemoteURL:  remoteURL,
		LocalPath:  fmt.Sprintf("videos/%s/%s.mp4", taskID, name),
	}
}

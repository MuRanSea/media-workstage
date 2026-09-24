package adapter

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"media-workstage/internal/model"
)

// genericImageParams is the provider-neutral image spec that non-Ark image cards
// submit in task params. Each channel adapter maps it onto its own API.
type genericImageParams struct {
	AspectRatio  string `json:"aspect_ratio"` // "16:9", "1:1", ... or "" / "auto"
	Resolution   string `json:"resolution"`   // "1K" | "2K" | "4K"
	OutputFormat string `json:"output_format"`
}

func parseGenericImageParams(paramsJSON string) genericImageParams {
	var p genericImageParams
	_ = json.Unmarshal([]byte(paramsJSON), &p)
	p.AspectRatio = strings.TrimSpace(p.AspectRatio)
	if strings.EqualFold(p.AspectRatio, "auto") {
		p.AspectRatio = ""
	}
	p.Resolution = strings.ToUpper(strings.TrimSpace(p.Resolution))
	return p
}

// ratioValue parses "16:9" into 16/9; ok is false for empty or malformed ratios.
func ratioValue(ratio string) (float64, bool) {
	w, h, found := strings.Cut(ratio, ":")
	if !found {
		return 0, false
	}
	wf, err1 := strconv.ParseFloat(w, 64)
	hf, err2 := strconv.ParseFloat(h, 64)
	if err1 != nil || err2 != nil || wf <= 0 || hf <= 0 {
		return 0, false
	}
	return wf / hf, true
}

// channelImageBase carries the credentials, HTTP client and hot-reload plumbing
// shared by the image-only channel adapters (OpenAI, Gemini, APIMart, Midjourney).
type channelImageBase struct {
	name       string
	defaultURL string

	mu      sync.RWMutex
	baseURL string
	apiKey  string
	client  *http.Client
	// keyHeader carries the API key: "Authorization" (Bearer) unless the provider uses its own header.
	keyHeader string

	// Synchronous providers finish inside SubmitTask; results wait here for the poller.
	results sync.Map // providerTaskID -> *PollResult
	blobs   sync.Map // inline:// URL -> []byte
}

func newChannelImageBase(name, defaultURL string, cfg ChannelConfig) channelImageBase {
	if cfg.ProviderID != "" {
		name = cfg.ProviderID
	}
	baseURL := strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL == "" {
		baseURL = defaultURL
	}
	client := cfg.HTTPClient
	if client == nil {
		// Image models can take minutes (gpt-image at high quality, 4K Gemini).
		client = &http.Client{Timeout: 5 * time.Minute}
	}
	return channelImageBase{
		name:       name,
		defaultURL: defaultURL,
		baseURL:    baseURL,
		apiKey:     strings.TrimSpace(cfg.APIKey),
		client:     client,
	}
}

func (b *channelImageBase) ProviderName() string {
	return b.name
}

func (b *channelImageBase) GetConfig() ProviderConfigInfo {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return ProviderConfigInfo{
		ProviderName: b.name,
		BaseURL:      b.baseURL,
		IsConfigured: b.apiKey != "",
		MaskedKey:    MaskSecret(b.apiKey),
	}
}

func (b *channelImageBase) UpdateConfig(baseURL string, apiKey string, _ map[string]string) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if strings.TrimSpace(baseURL) != "" {
		b.baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	}
	if strings.TrimSpace(apiKey) != "" {
		b.apiKey = strings.TrimSpace(apiKey)
	}
	return nil
}

func (b *channelImageBase) credentials() (baseURL, apiKey string) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.baseURL, b.apiKey
}

// doJSON sends a JSON request and decodes a 2xx response into out, leaving out untouched
// for an empty body; non-2xx bodies are surfaced through errMessage so provider error
// text reaches the card.
func (b *channelImageBase) doJSON(req *http.Request, out any) error {
	resp, err := b.client.Do(req)
	if err != nil {
		return fmt.Errorf("%s request failed: %w", b.name, err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("failed to read %s response: %w", b.name, err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return &ProviderHTTPError{Provider: b.name, Status: resp.StatusCode, Message: errMessage(body)}
	}
	if len(bytes.TrimSpace(body)) == 0 {
		return nil
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("failed to parse %s response: %w", b.name, err)
	}
	return nil
}

// ProviderHTTPError is a non-2xx provider response, typed so callers can branch on status.
type ProviderHTTPError struct {
	Provider string
	Status   int
	Message  string
}

func (e *ProviderHTTPError) Error() string {
	return fmt.Sprintf("%s error (HTTP %d): %s", e.Provider, e.Status, e.Message)
}

// errMessage extracts a human-readable message from common error envelopes.
func errMessage(body []byte) string {
	var env struct {
		Error       json.RawMessage `json:"error"`
		Message     string          `json:"message"`
		Description string          `json:"description"` // midjourney-proxy
	}
	if json.Unmarshal(body, &env) == nil {
		var obj struct {
			Message string `json:"message"`
		}
		if len(env.Error) > 0 && json.Unmarshal(env.Error, &obj) == nil && obj.Message != "" {
			return obj.Message
		}
		var s string
		if len(env.Error) > 0 && json.Unmarshal(env.Error, &s) == nil && s != "" {
			return s
		}
		if env.Message != "" {
			return env.Message
		}
		if env.Description != "" {
			return env.Description
		}
	}
	text := strings.TrimSpace(string(body))
	if len(text) > 300 {
		text = text[:300] + "..."
	}
	return text
}

// inlineImage is one generated image held in memory (sync providers) or a remote URL.
type inlineImage struct {
	data      []byte
	mimeType  string
	remoteURL string
}

// storeResult builds the PollResult for a finished synchronous generation and parks
// it until the poller collects it. Image bytes stay in memory under inline:// URLs
// rather than being written into SQLite as base64.
func (b *channelImageBase) storeResult(task *model.MediaTask, providerTaskID string, images []inlineImage, usageTokens int) {
	res := &PollResult{
		Status:      model.TaskStatusSucceeded,
		Progress:    100,
		UsageTokens: usageTokens,
	}
	for i, img := range images {
		remote := img.remoteURL
		ext := imageExt(img.mimeType, img.remoteURL)
		if img.data != nil {
			remote = fmt.Sprintf("inline://%s/%d", providerTaskID, i)
			b.blobs.Store(remote, img.data)
		}
		res.Assets = append(res.Assets, imageAsset(task.ID, i, remote, ext))
	}
	if len(res.Assets) > 0 {
		res.ResultURL = res.Assets[0].RemoteURL
	}
	b.results.Store(providerTaskID, res)
}

func (b *channelImageBase) pollStored(task *model.MediaTask) (*PollResult, error) {
	if val, ok := b.results.Load(task.ProviderTaskID); ok {
		b.results.Delete(task.ProviderTaskID)
		return val.(*PollResult), nil
	}
	// The result only lives in memory, so a restart between submit and poll loses it.
	return &PollResult{
		Status:       model.TaskStatusFailed,
		ErrorCode:    "ResultLost",
		ErrorMessage: "生成结果已丢失（服务在出图后重启），请重新生成",
	}, nil
}

// imageAsset lays out outputs like the Ark adapter: images/<task>/base.<ext>, then extra frames.
func imageAsset(taskID string, index int, remoteURL, ext string) model.TaskAsset {
	kind, name := "image_base", "base"
	if index > 0 {
		kind, name = "image_frame", fmt.Sprintf("image_%02d", index)
	}
	return model.TaskAsset{
		AssetIndex: index,
		Kind:       kind,
		RemoteURL:  remoteURL,
		LocalPath:  fmt.Sprintf("images/%s/%s.%s", taskID, name, ext),
	}
}

func imageExt(mimeType, remoteURL string) string {
	if mimeType != "" {
		if exts, _ := mime.ExtensionsByType(mimeType); len(exts) > 0 {
			for _, e := range exts {
				switch e {
				case ".png", ".jpg", ".jpeg", ".webp":
					return strings.TrimPrefix(strings.Replace(e, ".jpeg", ".jpg", 1), ".")
				}
			}
		}
	}
	if u, err := url.Parse(remoteURL); err == nil {
		switch e := strings.ToLower(path.Ext(u.Path)); e {
		case ".png", ".jpg", ".jpeg", ".webp":
			return strings.TrimPrefix(strings.Replace(e, ".jpeg", ".jpg", 1), ".")
		}
	}
	return "png"
}

// DownloadAsset writes inline results, data URIs or remote URLs to targetLocalPath.
func (b *channelImageBase) DownloadAsset(ctx context.Context, remoteURL string, targetLocalPath string) error {
	if err := os.MkdirAll(filepath.Dir(targetLocalPath), 0755); err != nil {
		return fmt.Errorf("failed to create directory for %s: %w", targetLocalPath, err)
	}

	switch {
	case strings.HasPrefix(remoteURL, "inline://"):
		val, ok := b.blobs.LoadAndDelete(remoteURL)
		if !ok {
			return fmt.Errorf("inline image %s is no longer in memory", remoteURL)
		}
		return os.WriteFile(targetLocalPath, val.([]byte), 0644)

	case strings.HasPrefix(remoteURL, "data:"):
		_, payload, found := strings.Cut(remoteURL, ",")
		if !found {
			return errors.New("invalid data URI format")
		}
		decoded, err := base64.StdEncoding.DecodeString(payload)
		if err != nil {
			return fmt.Errorf("failed to decode base64 data URI: %w", err)
		}
		return os.WriteFile(targetLocalPath, decoded, 0644)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, remoteURL, nil)
	if err != nil {
		return fmt.Errorf("failed to create download request: %w", err)
	}
	// Relays often serve results from their own host behind the same key
	// (".../tasks/<id>/content/0"); any other host, such as a CDN, never gets the key.
	if baseURL, apiKey := b.credentials(); apiKey != "" && sameOrigin(baseURL, req.URL) {
		b.setKey(req, apiKey)
	}
	resp, err := b.client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to download %s: %w", remoteURL, err)
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

func (b *channelImageBase) setKey(req *http.Request, apiKey string) {
	if b.keyHeader != "" && b.keyHeader != "Authorization" {
		req.Header.Set(b.keyHeader, apiKey)
		return
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
}

// sameOrigin reports whether target has the same scheme and host (incl. port) as baseURL.
func sameOrigin(baseURL string, target *url.URL) bool {
	base, err := url.Parse(baseURL)
	if err != nil {
		return false
	}
	return strings.EqualFold(base.Scheme, target.Scheme) && strings.EqualFold(base.Host, target.Host)
}

// requireImageTask rejects task types an image adapter cannot run yet.
func requireImageTask(provider string, task *model.MediaTask) error {
	if task.TaskType != "image_generation" {
		return fmt.Errorf("%s 服务商目前只支持生图任务，不支持 %s", provider, task.TaskType)
	}
	return nil
}

// fitPixels returns a WxH for the given ratio whose area is close to targetArea,
// snapped down to multiples of step and capped at maxEdge.
func fitPixels(ratio float64, targetArea float64, step int, maxEdge int) (int, int) {
	w := math.Sqrt(targetArea * ratio)
	h := w / ratio
	if w > float64(maxEdge) {
		w, h = float64(maxEdge), float64(maxEdge)/ratio
	}
	if h > float64(maxEdge) {
		h, w = float64(maxEdge), float64(maxEdge)*ratio
	}
	snap := func(v float64) int { return int(v) / step * step }
	return snap(w), snap(h)
}

package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"time"

	"media-workstage/internal/adapter"
)

// channelModel is a model ID a channel exposes, tagged by what it generates.
type channelModel struct {
	ID   string `json:"id"`
	Type string `json:"type"` // image | video | chat | audio | other
}

func img(id string) channelModel  { return channelModel{ID: id, Type: "image"} }
func vid(id string) channelModel  { return channelModel{ID: id, Type: "video"} }
func chat(id string) channelModel { return channelModel{ID: id, Type: "chat"} }

// channelSpec declares one provider channel: where its credentials live
// (system_configs keys "<id>_api_key" / "<id>_base_url" / "<id>_<extra>", then env),
// how it is listed by GET /api/config, and how POST /api/config/test probes it.
// Bound models are stored under "<id>_models". Until the user saves a binding, channels
// without a live catalog bind their Presets; channels with one (listModels) bind nothing,
// so the binding is exactly what the user ticked.
type channelSpec struct {
	ID             string
	Name           string
	DefaultBaseURL string
	APIKeyEnv      string
	BaseURLEnv     string
	ExtraEnv       map[string]string // extra field key -> env var fallback
	Presets        []channelModel    // catalog for channels without listModels

	// newProbe builds a cheap, authenticated, read-only request used by the connection test.
	newProbe func(ctx context.Context, baseURL, apiKey string, extra map[string]string) (*http.Request, error)
	// probeNeeds2xx requires the probe to succeed outright. Probes that look up a dummy
	// task ID leave it unset, so any response that is not an auth or server error passes.
	probeNeeds2xx bool

	// listModels fetches the channel's live model catalog; nil means presets only.
	listModels func(ctx context.Context, client *http.Client, baseURL, apiKey string) ([]channelModel, error)
}

var channelSpecs = []channelSpec{
	{
		ID:             "ark",
		Name:           "火山方舟 (Volcengine Ark)",
		DefaultBaseURL: "https://ark.cn-beijing.volces.com/api/v3",
		APIKeyEnv:      "ARK_API_KEY",
		BaseURLEnv:     "ARK_BASE_URL",
		Presets: []channelModel{
			img("doubao-seedream-5-0-pro-260628"),
			img("doubao-seedream-5-0-lite-260128"),
			vid("doubao-seedance-2-5-260628"),
			vid("doubao-seedance-2-0-260128"),
			chat("doubao-seed-2-1-pro-260915"),
			chat("doubao-seed-2-1-lite-260915"),
			chat("doubao-seed-2-1-turbo-260628"),
			chat("doubao-seed-2-0-mini-260428"),
		},
		newProbe: func(ctx context.Context, baseURL, apiKey string, _ map[string]string) (*http.Request, error) {
			return newBearerRequest(ctx, http.MethodGet, baseURL+"/contents/generations/tasks?limit=1", apiKey)
		},
		// Ark's documented model list (ListFoundationModels) needs AK/SK signing, so try the
		// OpenAI-style /models with the API key; handleListModels falls back to presets if absent.
		listModels: listOpenAIModels,
	},
	{
		ID:             "minimax",
		Name:           "MiniMax 官方海螺",
		DefaultBaseURL: "https://api.minimax.chat/v1",
		APIKeyEnv:      "MINIMAX_API_KEY",
		BaseURLEnv:     "MINIMAX_BASE_URL",
		ExtraEnv:       map[string]string{"group_id": "MINIMAX_GROUP_ID"},
		Presets: []channelModel{
			vid("MiniMax-H3"),
			vid("video-01"),
		},
		newProbe: func(ctx context.Context, baseURL, apiKey string, extra map[string]string) (*http.Request, error) {
			testURL := baseURL + "/query/video_generation?task_id=test_ping"
			if gid := extra["group_id"]; gid != "" {
				testURL += "&GroupId=" + url.QueryEscape(gid)
			}
			return newBearerRequest(ctx, http.MethodGet, testURL, apiKey)
		},
	},
	{
		ID:             "kling",
		Name:           "可灵 (Kling AI)",
		DefaultBaseURL: "https://api-beijing.klingai.com",
		APIKeyEnv:      "KLING_API_KEY",
		BaseURLEnv:     "KLING_BASE_URL",
		Presets: []channelModel{
			img("kling-v3-omni"),
			img("kling-v3"),
			img("kling-image-o1"),
			vid("kling-3.0-omni"),
			vid("kling-3.0"),
			vid("kling-3.0-turbo"),
			vid("kling-2.6"),
		},
		// Free resource-pack query (QPS <= 1); rejects bad keys with HTTP 401.
		newProbe: func(ctx context.Context, baseURL, apiKey string, _ map[string]string) (*http.Request, error) {
			now := time.Now()
			testURL := fmt.Sprintf("%s/account/costs?start_time=%d&end_time=%d",
				baseURL, now.Add(-24*time.Hour).UnixMilli(), now.UnixMilli())
			return newBearerRequest(ctx, http.MethodGet, testURL, apiKey)
		},
		probeNeeds2xx: true,
	},
	{
		// Midjourney has no official API; this targets the midjourney-proxy protocol
		// (/mj/...), which self-hosted proxies and new-api style relays both speak.
		// There is no official host, so DefaultBaseURL stays empty.
		ID:         "midjourney",
		Name:       "Midjourney (MJ Proxy)",
		APIKeyEnv:  "MIDJOURNEY_API_KEY",
		BaseURLEnv: "MIDJOURNEY_BASE_URL",
		Presets: []channelModel{
			img("MID_JOURNEY"),
			img("NIJI_JOURNEY"),
		},
		newProbe: func(ctx context.Context, baseURL, apiKey string, _ map[string]string) (*http.Request, error) {
			req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/mj/task/list-by-condition",
				strings.NewReader(`{"ids":["media-workstage-ping"]}`))
			if err != nil {
				return nil, err
			}
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(apiKey))
			// midjourney-proxy reads mj-api-secret; relays read the Bearer token.
			req.Header.Set("mj-api-secret", strings.TrimSpace(apiKey))
			return req, nil
		},
		probeNeeds2xx: true,
	},
	{
		ID:             "google",
		Name:           "Google Gemini 生图",
		DefaultBaseURL: "https://generativelanguage.googleapis.com/v1beta",
		APIKeyEnv:      "GEMINI_API_KEY",
		BaseURLEnv:     "GEMINI_BASE_URL",
		// Invalid Gemini keys come back as HTTP 400, so only a 2xx counts as success.
		newProbe: func(ctx context.Context, baseURL, apiKey string, _ map[string]string) (*http.Request, error) {
			return newGoogleRequest(ctx, baseURL+"/models?pageSize=1", apiKey)
		},
		probeNeeds2xx: true,
		listModels:    listGoogleModels,
	},
	{
		ID:             "openai",
		Name:           "OpenAI GPT 生图",
		DefaultBaseURL: "https://api.openai.com/v1",
		APIKeyEnv:      "OPENAI_API_KEY",
		BaseURLEnv:     "OPENAI_BASE_URL",
		newProbe: func(ctx context.Context, baseURL, apiKey string, _ map[string]string) (*http.Request, error) {
			return newBearerRequest(ctx, http.MethodGet, baseURL+"/models", apiKey)
		},
		probeNeeds2xx: true,
		listModels:    listOpenAIModels,
	},
	{
		// APIMart aggregates many vendors behind one OpenAI-style key.
		ID:             "apimart",
		Name:           "APIMart 聚合",
		DefaultBaseURL: "https://api.apimart.ai/v1",
		APIKeyEnv:      "APIMART_API_KEY",
		BaseURLEnv:     "APIMART_BASE_URL",
		// Model list rather than /balance: relays (e.g. new-api style ".../apimart/v1")
		// forward /models, /images and /tasks but not the balance endpoint.
		newProbe: func(ctx context.Context, baseURL, apiKey string, _ map[string]string) (*http.Request, error) {
			return newBearerRequest(ctx, http.MethodGet, baseURL+"/models", apiKey)
		},
		probeNeeds2xx: true,
		listModels:    listAPIMartModels,
	},
}

func findChannel(id string) (channelSpec, bool) {
	for _, spec := range channelSpecs {
		if spec.ID == id {
			return spec, true
		}
	}
	return channelSpec{}, false
}

// channelView is the masked, client-safe state of one channel.
type channelView struct {
	ID            string            `json:"id"`
	Name          string            `json:"name"`
	BaseURL       string            `json:"base_url"`
	IsConfigured  bool              `json:"is_configured"`
	MaskedKey     string            `json:"masked_key"`
	Extra         map[string]string `json:"extra,omitempty"`
	Models        []channelModel    `json:"models"`
	CanListModels bool              `json:"can_list_models"`
	// Presets are the channel's built-in models, offered as "恢复默认" in the binding panel.
	Presets []channelModel `json:"presets,omitempty"`
}

// channelValue reads one setting, preferring the stored config over the env var,
// matching the DB -> ENV precedence main.go uses when constructing adapters.
func channelValue(spec channelSpec, stored map[string]string, key, env string) string {
	if v := strings.TrimSpace(stored[spec.ID+"_"+key]); v != "" {
		return v
	}
	if env != "" {
		return strings.TrimSpace(os.Getenv(env))
	}
	return ""
}

// ChannelCredentials resolves a channel's base URL and API key from stored config
// and env, falling back to the channel's default base URL.
func ChannelCredentials(stored map[string]string, id string) (baseURL, apiKey string) {
	spec, ok := findChannel(id)
	if !ok {
		return "", ""
	}
	baseURL = channelValue(spec, stored, "base_url", spec.BaseURLEnv)
	if baseURL == "" {
		baseURL = spec.DefaultBaseURL
	}
	return baseURL, channelValue(spec, stored, "api_key", spec.APIKeyEnv)
}

func resolveChannel(spec channelSpec, stored map[string]string) channelView {
	baseURL, apiKey := ChannelCredentials(stored, spec.ID)
	v := channelView{
		ID:            spec.ID,
		Name:          spec.Name,
		BaseURL:       baseURL,
		IsConfigured:  apiKey != "",
		MaskedKey:     adapter.MaskSecret(apiKey),
		Models:        boundModels(spec, stored),
		CanListModels: spec.listModels != nil,
		Presets:       spec.Presets,
	}
	for key, env := range spec.ExtraEnv {
		if val := channelValue(spec, stored, key, env); val != "" {
			if v.Extra == nil {
				v.Extra = make(map[string]string)
			}
			v.Extra[key] = val
		}
	}
	return v
}

// boundModels returns the user's saved binding, else the channel's presets (empty
// for channels with a live catalog). An explicitly saved empty list stays empty.
func boundModels(spec channelSpec, stored map[string]string) []channelModel {
	models := spec.Presets
	if raw, ok := stored[spec.ID+"_models"]; ok {
		var saved []channelModel
		if err := json.Unmarshal([]byte(raw), &saved); err == nil {
			models = saved
		}
	}
	if models == nil {
		models = []channelModel{}
	}
	return models
}

// sanitizeBoundModels trims, dedupes and keeps only bindable types: image, video and
// chat (LLMs for text cards).
func sanitizeBoundModels(in []channelModel) []channelModel {
	out := make([]channelModel, 0, len(in))
	seen := make(map[string]bool)
	for _, m := range in {
		id := strings.TrimSpace(m.ID)
		if id == "" || seen[id] || (m.Type != "image" && m.Type != "video" && m.Type != "chat") {
			continue
		}
		seen[id] = true
		out = append(out, channelModel{ID: id, Type: m.Type})
	}
	return out
}

func newBearerRequest(ctx context.Context, method, target, apiKey string) (*http.Request, error) {
	req, err := http.NewRequestWithContext(ctx, method, target, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(apiKey))
	return req, nil
}

func newGoogleRequest(ctx context.Context, target, apiKey string) (*http.Request, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("x-goog-api-key", strings.TrimSpace(apiKey))
	return req, nil
}

// httpStatusError is a non-2xx provider response, kept typed so callers can retry
// on specific statuses.
type httpStatusError struct {
	Status  int
	Message string
}

func (e *httpStatusError) Error() string {
	prefix := fmt.Sprintf("服务商返回 HTTP %d", e.Status)
	if e.Status == 401 || e.Status == 403 {
		prefix = fmt.Sprintf("API Key 鉴权失败 (HTTP %d)", e.Status)
	}
	if e.Message != "" {
		return prefix + ": " + e.Message
	}
	return prefix
}

// providerMessage pulls a short error message out of common error envelopes.
func providerMessage(body []byte) string {
	var env struct {
		Error   json.RawMessage `json:"error"`
		Message string          `json:"message"`
	}
	if json.Unmarshal(body, &env) == nil {
		var obj struct {
			Message string `json:"message"`
		}
		if len(env.Error) > 0 && json.Unmarshal(env.Error, &obj) == nil && obj.Message != "" {
			return obj.Message
		}
		if env.Message != "" {
			return env.Message
		}
	}
	text := strings.TrimSpace(string(body))
	if len(text) > 200 {
		text = text[:200] + "..."
	}
	return text
}

// fetchJSON performs req and decodes a 2xx JSON body into out.
func fetchJSON(client *http.Client, req *http.Request, out any) error {
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("网络连接失败: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return &httpStatusError{Status: resp.StatusCode, Message: providerMessage(body)}
	}
	if isHTMLResponse(resp) {
		return fmt.Errorf("%s 返回的是网页而不是 API，Base URL 的路径可能不对（通常以 /v1 或 /v1beta 结尾）", req.URL.Path)
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("无法解析模型列表: %w", err)
	}
	return nil
}

// inferModelType guesses what a model generates from its ID, for catalogs that
// do not say (OpenAI, Gemini).
func inferModelType(id string) string {
	s := strings.ToLower(id)
	// Image keywords are checked first so e.g. "wan2.7-image" is not taken for a "wan" video model.
	for _, k := range []string{"image", "dall-e", "imagen", "seedream", "midjourney", "flux", "banana",
		"ideogram", "recraft", "sdxl", "stable-diffusion"} {
		if strings.Contains(s, k) {
			return "image"
		}
	}
	for _, k := range []string{"sora", "veo", "seedance", "video", "hailuo", "kling", "minimax-h", "vidu",
		"wan2", "wan3", "skyreels", "happyhorse", "pixverse", "t2v", "i2v", "r2v"} {
		if strings.Contains(s, k) {
			return "video"
		}
	}
	for _, k := range []string{"tts", "audio", "whisper", "speech", "music", "suno"} {
		if strings.Contains(s, k) {
			return "audio"
		}
	}
	if strings.Contains(s, "embedding") || strings.Contains(s, "moderation") {
		return "other"
	}
	return "chat"
}

// sortModels puts image models first, then video, then the rest, each alphabetically.
func sortModels(models []channelModel) []channelModel {
	rank := map[string]int{"image": 0, "video": 1, "chat": 2, "audio": 3}
	sort.SliceStable(models, func(i, j int) bool {
		ri, ok := rank[models[i].Type]
		if !ok {
			ri = 4
		}
		rj, ok := rank[models[j].Type]
		if !ok {
			rj = 4
		}
		if ri != rj {
			return ri < rj
		}
		return models[i].ID < models[j].ID
	})
	return models
}

func listOpenAIModels(ctx context.Context, client *http.Client, baseURL, apiKey string) ([]channelModel, error) {
	req, err := newBearerRequest(ctx, http.MethodGet, baseURL+"/models", apiKey)
	if err != nil {
		return nil, err
	}
	var resp struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := fetchJSON(client, req, &resp); err != nil {
		return nil, err
	}
	models := make([]channelModel, 0, len(resp.Data))
	for _, m := range resp.Data {
		models = append(models, channelModel{ID: m.ID, Type: inferModelType(m.ID)})
	}
	return sortModels(models), nil
}

func listGoogleModels(ctx context.Context, client *http.Client, baseURL, apiKey string) ([]channelModel, error) {
	var models []channelModel
	pageToken := ""
	for range 5 {
		target := baseURL + "/models?pageSize=1000"
		if pageToken != "" {
			target += "&pageToken=" + url.QueryEscape(pageToken)
		}
		req, err := newGoogleRequest(ctx, target, apiKey)
		if err != nil {
			return nil, err
		}
		var resp struct {
			Models []struct {
				Name string `json:"name"`
			} `json:"models"`
			NextPageToken string `json:"nextPageToken"`
			// Some relays (new-api) answer /v1beta/models in OpenAI's shape instead.
			Data []struct {
				ID string `json:"id"`
			} `json:"data"`
		}
		if err := fetchJSON(client, req, &resp); err != nil {
			return nil, err
		}
		for _, m := range resp.Models {
			id := strings.TrimPrefix(m.Name, "models/")
			models = append(models, channelModel{ID: id, Type: inferModelType(id)})
		}
		for _, m := range resp.Data {
			id := strings.TrimPrefix(m.ID, "models/")
			models = append(models, channelModel{ID: id, Type: inferModelType(id)})
		}
		if resp.NextPageToken == "" {
			break
		}
		pageToken = resp.NextPageToken
	}
	return sortModels(models), nil
}

func listAPIMartModels(ctx context.Context, client *http.Client, baseURL, apiKey string) ([]channelModel, error) {
	var resp struct {
		Data []struct {
			ID       string `json:"id"`
			Category string `json:"category"`
		} `json:"data"`
	}
	// expand=category tags each model image/video, but relays that forward APIMart
	// (e.g. ".../apimart/v1") may reject the parameter; retry the plain list and
	// infer types from IDs instead.
	fetch := func(target string) error {
		req, err := newBearerRequest(ctx, http.MethodGet, target, apiKey)
		if err != nil {
			return err
		}
		return fetchJSON(client, req, &resp)
	}
	if err := fetch(baseURL + "/models?expand=category"); err != nil {
		var statusErr *httpStatusError
		if !errors.As(err, &statusErr) || statusErr.Status == 401 || statusErr.Status == 403 {
			return nil, err
		}
		if err := fetch(baseURL + "/models"); err != nil {
			return nil, err
		}
	}
	models := make([]channelModel, 0, len(resp.Data))
	for _, m := range resp.Data {
		typ := m.Category
		switch typ {
		case "image", "video", "chat", "audio":
		default:
			typ = inferModelType(m.ID)
		}
		models = append(models, channelModel{ID: m.ID, Type: typ})
	}
	return sortModels(models), nil
}

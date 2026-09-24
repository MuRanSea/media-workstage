package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"time"

	"media-workstage/internal/adapter"
	"media-workstage/internal/model"
)

// boundModel is a model ID a provider offers, tagged by what it generates.
type boundModel struct {
	ID   string `json:"id"`
	Type string `json:"type"` // image | video | chat | audio | other
}

func img(id string) boundModel  { return boundModel{ID: id, Type: "image"} }
func vid(id string) boundModel  { return boundModel{ID: id, Type: "video"} }
func chat(id string) boundModel { return boundModel{ID: id, Type: "chat"} }

// protocolSpec is what a Protocol contributes to every Provider speaking it: how
// POST /api/config/test probes the connection and how its live model catalog is fetched.
type protocolSpec struct {
	// newProbe builds a cheap, authenticated, read-only request used by the connection test.
	newProbe func(ctx context.Context, baseURL, apiKey string, extra map[string]string) (*http.Request, error)
	// probeNeeds2xx requires the probe to succeed outright. Probes that look up a dummy
	// task ID leave it unset, so any response that is not an auth or server error passes.
	probeNeeds2xx bool

	// listModels fetches the provider's live model catalog; nil means presets only.
	listModels func(ctx context.Context, client *http.Client, baseURL, apiKey string) ([]boundModel, error)
}

var protocolSpecs = map[model.Protocol]protocolSpec{
	model.ProtocolArk: {
		newProbe: func(ctx context.Context, baseURL, apiKey string, _ map[string]string) (*http.Request, error) {
			return newBearerRequest(ctx, http.MethodGet, baseURL+"/contents/generations/tasks?limit=1", apiKey)
		},
		// Ark's documented model list (ListFoundationModels) needs AK/SK signing, so try the
		// OpenAI-style /models with the API key; handleListModels falls back to presets if absent.
		listModels: listOpenAIModels,
	},
	model.ProtocolMiniMax: {
		newProbe: func(ctx context.Context, baseURL, apiKey string, extra map[string]string) (*http.Request, error) {
			testURL := baseURL + "/query/video_generation?task_id=test_ping"
			if gid := extra["group_id"]; gid != "" {
				testURL += "&GroupId=" + url.QueryEscape(gid)
			}
			return newBearerRequest(ctx, http.MethodGet, testURL, apiKey)
		},
	},
	model.ProtocolKling: {
		// Free resource-pack query (QPS <= 1); rejects bad keys with HTTP 401.
		newProbe: func(ctx context.Context, baseURL, apiKey string, _ map[string]string) (*http.Request, error) {
			now := time.Now()
			testURL := fmt.Sprintf("%s/account/costs?start_time=%d&end_time=%d",
				baseURL, now.Add(-24*time.Hour).UnixMilli(), now.UnixMilli())
			return newBearerRequest(ctx, http.MethodGet, testURL, apiKey)
		},
		probeNeeds2xx: true,
	},
	model.ProtocolMidjourney: {
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
	model.ProtocolGemini: {
		// Invalid Gemini keys come back as HTTP 400, so only a 2xx counts as success.
		newProbe: func(ctx context.Context, baseURL, apiKey string, _ map[string]string) (*http.Request, error) {
			return newGoogleRequest(ctx, baseURL+"/models?pageSize=1", apiKey)
		},
		probeNeeds2xx: true,
		listModels:    listGoogleModels,
	},
	model.ProtocolOpenAICompatible: {
		newProbe: func(ctx context.Context, baseURL, apiKey string, _ map[string]string) (*http.Request, error) {
			return newBearerRequest(ctx, http.MethodGet, baseURL+"/models", apiKey)
		},
		probeNeeds2xx: true,
		listModels:    listOpenAIModels,
	},
	model.ProtocolAPIMart: {
		// Model list rather than /balance: relays (e.g. new-api style ".../apimart/v1")
		// forward /models, /images and /tasks but not the balance endpoint.
		newProbe: func(ctx context.Context, baseURL, apiKey string, _ map[string]string) (*http.Request, error) {
			return newBearerRequest(ctx, http.MethodGet, baseURL+"/models", apiKey)
		},
		probeNeeds2xx: true,
		listModels:    listAPIMartModels,
	},
}

// providerSpec declares a Preset Provider: its Protocol, where its credentials live
// (system_configs keys "<id>_api_key" / "<id>_base_url" / "<id>_<extra>", then env)
// and how it is listed by GET /api/config.
// Bound models are stored under "<id>_models". Until the user saves a binding, providers
// without a live catalog bind their Presets; providers with one (listModels) bind nothing,
// so the binding is exactly what the user ticked.
type providerSpec struct {
	ID             string
	Name           string
	Protocol       model.Protocol
	DefaultBaseURL string
	APIKeyEnv      string
	BaseURLEnv     string
	ExtraEnv       map[string]string // extra field key -> env var fallback
	Presets        []boundModel      // catalog for providers without listModels
	// MockWhenUnset runs the provider on the mock adapter until it has a key.
	MockWhenUnset bool
}

func (s providerSpec) protocol() protocolSpec { return protocolSpecs[s.Protocol] }

var presetProviders = []providerSpec{
	{
		ID:             "ark",
		Name:           "火山方舟",
		Protocol:       model.ProtocolArk,
		DefaultBaseURL: "https://ark.cn-beijing.volces.com/api/v3",
		APIKeyEnv:      "ARK_API_KEY",
		BaseURLEnv:     "ARK_BASE_URL",
		Presets: []boundModel{
			img("doubao-seedream-5-0-pro-260628"),
			img("doubao-seedream-5-0-lite-260128"),
			vid("doubao-seedance-2-5-260628"),
			vid("doubao-seedance-2-0-260128"),
			chat("doubao-seed-2-1-pro-260915"),
			chat("doubao-seed-2-1-lite-260915"),
			chat("doubao-seed-2-1-turbo-260628"),
			chat("doubao-seed-2-0-mini-260428"),
		},
		MockWhenUnset: true,
	},
	{
		ID: "minimax",
		// "官方" tells it apart from MiniMax models offered through APIMart.
		Name:           "MiniMax 官方",
		Protocol:       model.ProtocolMiniMax,
		DefaultBaseURL: "https://api.minimax.chat/v1",
		APIKeyEnv:      "MINIMAX_API_KEY",
		BaseURLEnv:     "MINIMAX_BASE_URL",
		ExtraEnv:       map[string]string{"group_id": "MINIMAX_GROUP_ID"},
		Presets: []boundModel{
			vid("MiniMax-H3"),
			vid("video-01"),
		},
		MockWhenUnset: true,
	},
	{
		ID:             "kling",
		Name:           "可灵",
		Protocol:       model.ProtocolKling,
		DefaultBaseURL: "https://api-beijing.klingai.com",
		APIKeyEnv:      "KLING_API_KEY",
		BaseURLEnv:     "KLING_BASE_URL",
		Presets: []boundModel{
			img("kling-v3-omni"),
			img("kling-v3"),
			img("kling-image-o1"),
			vid("kling-3.0-omni"),
			vid("kling-3.0"),
			vid("kling-3.0-turbo"),
			vid("kling-2.6"),
		},
	},
	{
		// Midjourney has no official API; this targets the midjourney-proxy protocol
		// (/mj/...), which self-hosted proxies and new-api style relays both speak.
		// There is no official host, so DefaultBaseURL stays empty.
		ID:         "midjourney",
		Name:       "Midjourney",
		Protocol:   model.ProtocolMidjourney,
		APIKeyEnv:  "MIDJOURNEY_API_KEY",
		BaseURLEnv: "MIDJOURNEY_BASE_URL",
		Presets: []boundModel{
			img("MID_JOURNEY"),
			img("NIJI_JOURNEY"),
		},
	},
	{
		ID:             "google",
		Name:           "Google",
		Protocol:       model.ProtocolGemini,
		DefaultBaseURL: "https://generativelanguage.googleapis.com/v1beta",
		APIKeyEnv:      "GEMINI_API_KEY",
		BaseURLEnv:     "GEMINI_BASE_URL",
	},
	{
		ID:             "openai",
		Name:           "OpenAI",
		Protocol:       model.ProtocolOpenAICompatible,
		DefaultBaseURL: "https://api.openai.com/v1",
		APIKeyEnv:      "OPENAI_API_KEY",
		BaseURLEnv:     "OPENAI_BASE_URL",
	},
	{
		// APIMart aggregates many vendors behind one OpenAI-style key.
		ID:             "apimart",
		Name:           "APIMart",
		Protocol:       model.ProtocolAPIMart,
		DefaultBaseURL: "https://api.apimart.ai/v1",
		APIKeyEnv:      "APIMART_API_KEY",
		BaseURLEnv:     "APIMART_BASE_URL",
	},
}

func findProvider(id string) (providerSpec, bool) {
	for _, spec := range presetProviders {
		if spec.ID == id {
			return spec, true
		}
	}
	return providerSpec{}, false
}

// providerView is the masked, client-safe state of one provider.
type providerView struct {
	ID            string            `json:"id"`
	Name          string            `json:"name"`
	Protocol      model.Protocol    `json:"protocol"`
	Preset        bool              `json:"preset"`
	BaseURL       string            `json:"base_url"`
	IsConfigured  bool              `json:"is_configured"`
	MaskedKey     string            `json:"masked_key"`
	Extra         map[string]string `json:"extra,omitempty"`
	Models        []boundModel      `json:"models"`
	CanListModels bool              `json:"can_list_models"`
	// Presets are the provider's built-in models, offered as "恢复默认" in the binding panel.
	Presets []boundModel `json:"presets,omitempty"`
}

// providerValue reads one setting, preferring the stored config over the env var,
// the DB -> ENV precedence adapters are built with.
func providerValue(spec providerSpec, stored map[string]string, key, env string) string {
	if v := strings.TrimSpace(stored[spec.ID+"_"+key]); v != "" {
		return v
	}
	if env != "" {
		return strings.TrimSpace(os.Getenv(env))
	}
	return ""
}

// ProviderCredentials resolves a provider's base URL and API key from stored config
// and env, falling back to the provider's default base URL.
func ProviderCredentials(stored map[string]string, id string) (baseURL, apiKey string) {
	spec, ok := findProvider(id)
	if !ok {
		return "", ""
	}
	baseURL = providerValue(spec, stored, "base_url", spec.BaseURLEnv)
	if baseURL == "" {
		baseURL = spec.DefaultBaseURL
	}
	return baseURL, providerValue(spec, stored, "api_key", spec.APIKeyEnv)
}

// providerExtras resolves a provider's extra fields (e.g. MiniMax group_id) from stored config and env.
func providerExtras(spec providerSpec, stored map[string]string) map[string]string {
	var extra map[string]string
	for key, env := range spec.ExtraEnv {
		if val := providerValue(spec, stored, key, env); val != "" {
			if extra == nil {
				extra = make(map[string]string)
			}
			extra[key] = val
		}
	}
	return extra
}

func resolveProvider(spec providerSpec, stored map[string]string) providerView {
	baseURL, apiKey := ProviderCredentials(stored, spec.ID)
	return providerView{
		ID:            spec.ID,
		Name:          spec.Name,
		Protocol:      spec.Protocol,
		Preset:        true,
		BaseURL:       baseURL,
		IsConfigured:  apiKey != "",
		MaskedKey:     adapter.MaskSecret(apiKey),
		Extra:         providerExtras(spec, stored),
		Models:        boundModels(spec, stored),
		CanListModels: spec.protocol().listModels != nil,
		Presets:       spec.Presets,
	}
}

// liveAdapter builds the adapter a provider runs on with its current credentials: the
// real one once it has a key, the mock for providers that run mocked without one, else none
// (including protocols that only store configuration so far).
func liveAdapter(spec providerSpec, stored map[string]string) (adapter.ProviderAdapter, bool) {
	baseURL, apiKey := ProviderCredentials(stored, spec.ID)
	if apiKey != "" {
		return adapter.NewProviderAdapter(spec.Protocol, spec.ID, baseURL, apiKey, providerExtras(spec, stored))
	}
	if spec.MockWhenUnset {
		return adapter.NewFakeProviderAdapter(spec.ID), true
	}
	return nil, false
}

// PresetAdapters builds the startup adapter set for every preset provider from stored
// config and env (DB -> ENV precedence).
func PresetAdapters(stored map[string]string) map[string]adapter.ProviderAdapter {
	adapters := make(map[string]adapter.ProviderAdapter)
	for _, spec := range presetProviders {
		if a, ok := liveAdapter(spec, stored); ok {
			if _, isFake := a.(*adapter.FakeProviderAdapter); isFake {
				log.Printf("[INFO] %s has no API key; using the mock adapter", spec.ID)
			}
			adapters[spec.ID] = a
		}
	}
	return adapters
}

// boundModels returns the user's saved binding, else the provider's presets (empty
// for providers with a live catalog). An explicitly saved empty list stays empty.
func boundModels(spec providerSpec, stored map[string]string) []boundModel {
	models := spec.Presets
	if raw, ok := stored[spec.ID+"_models"]; ok {
		var saved []boundModel
		if err := json.Unmarshal([]byte(raw), &saved); err == nil {
			models = saved
		}
	}
	if models == nil {
		models = []boundModel{}
	}
	return models
}

// sanitizeBoundModels trims, dedupes and keeps only bindable types: image, video and
// chat (LLMs for text cards).
func sanitizeBoundModels(in []boundModel) []boundModel {
	out := make([]boundModel, 0, len(in))
	seen := make(map[string]bool)
	for _, m := range in {
		id := strings.TrimSpace(m.ID)
		if id == "" || seen[id] || (m.Type != "image" && m.Type != "video" && m.Type != "chat") {
			continue
		}
		seen[id] = true
		out = append(out, boundModel{ID: id, Type: m.Type})
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
func sortModels(models []boundModel) []boundModel {
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

func listOpenAIModels(ctx context.Context, client *http.Client, baseURL, apiKey string) ([]boundModel, error) {
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
	models := make([]boundModel, 0, len(resp.Data))
	for _, m := range resp.Data {
		models = append(models, boundModel{ID: m.ID, Type: inferModelType(m.ID)})
	}
	return sortModels(models), nil
}

func listGoogleModels(ctx context.Context, client *http.Client, baseURL, apiKey string) ([]boundModel, error) {
	var models []boundModel
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
			models = append(models, boundModel{ID: id, Type: inferModelType(id)})
		}
		for _, m := range resp.Data {
			id := strings.TrimPrefix(m.ID, "models/")
			models = append(models, boundModel{ID: id, Type: inferModelType(id)})
		}
		if resp.NextPageToken == "" {
			break
		}
		pageToken = resp.NextPageToken
	}
	return sortModels(models), nil
}

func listAPIMartModels(ctx context.Context, client *http.Client, baseURL, apiKey string) ([]boundModel, error) {
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
	models := make([]boundModel, 0, len(resp.Data))
	for _, m := range resp.Data {
		typ := m.Category
		switch typ {
		case "image", "video", "chat", "audio":
		default:
			typ = inferModelType(m.ID)
		}
		models = append(models, boundModel{ID: m.ID, Type: typ})
	}
	return sortModels(models), nil
}

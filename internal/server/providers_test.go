package server

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"media-workstage/internal/adapter"
	"media-workstage/internal/db"
	"media-workstage/internal/model"
	"media-workstage/internal/poller"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestProtocolProbes_BuildAuthenticatedRequests(t *testing.T) {
	cases := []struct {
		id         string
		method     string
		urlPrefix  string
		authHeader string
		authValue  string
	}{
		{"ark", http.MethodGet, "https://base/contents/generations/tasks", "Authorization", "Bearer k"},
		{"minimax", http.MethodGet, "https://base/query/video_generation", "Authorization", "Bearer k"},
		{"kling", http.MethodGet, "https://base/account/costs?start_time=", "Authorization", "Bearer k"},
		{"midjourney", http.MethodPost, "https://base/mj/task/list-by-condition", "mj-api-secret", "k"},
		{"google", http.MethodGet, "https://base/models", "x-goog-api-key", "k"},
		{"openai", http.MethodGet, "https://base/models", "Authorization", "Bearer k"},
		{"apimart", http.MethodGet, "https://base/models", "Authorization", "Bearer k"},
	}
	for _, tc := range cases {
		t.Run(tc.id, func(t *testing.T) {
			spec, ok := findProvider(nil, tc.id)
			require.True(t, ok)
			req, err := spec.protocol().newProbe(context.Background(), "https://base", " k ", nil)
			require.NoError(t, err)
			assert.Equal(t, tc.method, req.Method)
			assert.Contains(t, req.URL.String(), tc.urlPrefix)
			assert.Equal(t, tc.authValue, req.Header.Get(tc.authHeader))
		})
	}
}

func TestProtocolProbes_MidjourneySendsQueryBody(t *testing.T) {
	spec, _ := findProvider(nil, "midjourney")
	req, err := spec.protocol().newProbe(context.Background(), "https://base", "k", nil)
	require.NoError(t, err)
	body, err := io.ReadAll(req.Body)
	require.NoError(t, err)
	assert.JSONEq(t, `{"ids":["media-workstage-ping"]}`, string(body))
	assert.Equal(t, "Bearer k", req.Header.Get("Authorization"))
	assert.Equal(t, "application/json", req.Header.Get("Content-Type"))
}

func TestResolveProvider_StoredOverridesEnvOverridesDefault(t *testing.T) {
	spec, _ := findProvider(nil, "openai")

	t.Setenv("OPENAI_API_KEY", "")
	t.Setenv("OPENAI_BASE_URL", "")
	v := resolveProvider(spec, nil)
	assert.False(t, v.IsConfigured)
	assert.Equal(t, "https://api.openai.com/v1", v.BaseURL)

	t.Setenv("OPENAI_API_KEY", "sk-env-1234567890")
	t.Setenv("OPENAI_BASE_URL", "https://relay.example.com/v1")
	v = resolveProvider(spec, nil)
	assert.True(t, v.IsConfigured)
	assert.Equal(t, "sk-e****7890", v.MaskedKey)
	assert.Equal(t, "https://relay.example.com/v1", v.BaseURL)

	v = resolveProvider(spec, map[string]string{
		"openai_api_key":  "sk-db-abcdefghij",
		"openai_base_url": "https://api.openai.com/v1",
	})
	assert.Equal(t, "sk-d****ghij", v.MaskedKey)
	assert.Equal(t, "https://api.openai.com/v1", v.BaseURL)
}

func TestIsOfficialProviderHost_RejectsLookalikes(t *testing.T) {
	assert.True(t, isOfficialProviderHost("api-beijing.klingai.com"))
	assert.True(t, isOfficialProviderHost("generativelanguage.googleapis.com:443"))
	assert.True(t, isOfficialProviderHost("api.openai.com"))
	assert.True(t, isOfficialProviderHost("volces.com"))
	assert.False(t, isOfficialProviderHost("evilvolces.com"))
	assert.False(t, isOfficialProviderHost("notopenai.com"))
}

func TestUpdateConfig_ConfigOnlyProviderPersistsWithoutAdapter(t *testing.T) {
	gin.SetMode(gin.TestMode)
	t.Setenv("KLING_API_KEY", "")
	database, err := db.InitDB(filepath.Join(t.TempDir(), "channels.db"))
	require.NoError(t, err)
	sqlDB, err := database.DB()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })

	srv := NewServer(database, t.TempDir(), map[string]adapter.ProviderAdapter{
		"ark": adapter.NewFakeProviderAdapter("ark"),
	})
	r := srv.SetupRouter()

	body, _ := json.Marshal(map[string]interface{}{
		"provider": "kling",
		"base_url": "https://api-beijing.klingai.com/",
		"api_key":  "kling-secret-abcdef123456",
		"extra":    map[string]string{"unexpected": "ignored"},
	})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/config", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.NotContains(t, w.Body.String(), "kling-secret-abcdef123456")

	var stored model.SystemConfig
	require.NoError(t, database.First(&stored, "key = ?", "kling_api_key").Error)
	assert.Equal(t, "kling-secret-abcdef123456", stored.Value)
	var storedURL model.SystemConfig
	require.NoError(t, database.First(&storedURL, "key = ?", "kling_base_url").Error)
	assert.Equal(t, "https://api-beijing.klingai.com", storedURL.Value)
	var extraCount int64
	database.Model(&model.SystemConfig{}).Where("key = ?", "kling_unexpected").Count(&extraCount)
	assert.Zero(t, extraCount)

	w2 := httptest.NewRecorder()
	req2, _ := http.NewRequest(http.MethodGet, "/api/config", nil)
	r.ServeHTTP(w2, req2)
	var resp struct {
		Providers []providerView `json:"providers"`
	}
	require.NoError(t, json.Unmarshal(w2.Body.Bytes(), &resp))
	var kling providerView
	for _, p := range resp.Providers {
		if p.ID == "kling" {
			kling = p
		}
	}
	assert.True(t, kling.IsConfigured)
	assert.Equal(t, "klin****3456", kling.MaskedKey)
	assert.NotContains(t, w2.Body.String(), "kling-secret-abcdef123456")
}

func TestUpdateConfig_RejectsUnknownProvider(t *testing.T) {
	gin.SetMode(gin.TestMode)
	srv := NewServer(nil, t.TempDir(), nil)
	r := srv.SetupRouter()

	body, _ := json.Marshal(map[string]string{"provider": "dalle", "api_key": "x"})
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, "/api/config", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "unsupported provider")
}

func newProviderTestServer(t *testing.T) (*Server, *gin.Engine) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	for _, spec := range presetProviders {
		t.Setenv(spec.APIKeyEnv, "")
	}
	database, err := db.InitDB(filepath.Join(t.TempDir(), "models.db"))
	require.NoError(t, err)
	sqlDB, err := database.DB()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })
	srv := NewServer(database, t.TempDir(), map[string]adapter.ProviderAdapter{
		"ark": adapter.NewFakeProviderAdapter("ark"),
	})
	return srv, srv.SetupRouter()
}

func postJSON(r *gin.Engine, path string, body any) *httptest.ResponseRecorder {
	b, _ := json.Marshal(body)
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodPost, path, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(w, req)
	return w
}

func TestListModels_PresetOnlyProvidersReturnPresets(t *testing.T) {
	_, r := newProviderTestServer(t)
	w := postJSON(r, "/api/config/models", map[string]string{"provider": "kling"})
	require.Equal(t, http.StatusOK, w.Code)
	var resp struct {
		Models []boundModel `json:"models"`
		Source string       `json:"source"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.Equal(t, "preset", resp.Source)
	assert.Contains(t, resp.Models, boundModel{ID: "kling-v3", Type: "image"})
}

func TestListModels_RemoteCatalogNeedsKey(t *testing.T) {
	_, r := newProviderTestServer(t)
	w := postJSON(r, "/api/config/models", map[string]string{"provider": "openai"})
	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "请先填写 API Key")
}

func TestListModelsFetchers_ParseCatalogs(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/oa/models":
			_, _ = io.WriteString(w, `{"data":[{"id":"gpt-5"},{"id":"gpt-image-2"},{"id":"sora-2"}]}`)
		case "/g/models":
			if r.URL.Query().Get("pageToken") == "" {
				_, _ = io.WriteString(w, `{"models":[{"name":"models/gemini-3-pro"}],"nextPageToken":"p2"}`)
			} else {
				_, _ = io.WriteString(w, `{"models":[{"name":"models/gemini-3-pro-image"},{"name":"models/veo-3.1"}]}`)
			}
		case "/am/models":
			assert.Equal(t, "category", r.URL.Query().Get("expand"))
			_, _ = io.WriteString(w, `{"data":[{"id":"seedream-5-0-pro","category":"image"},{"id":"mystery","category":"unknown"}]}`)
		}
	}))
	defer srv.Close()
	ctx := context.Background()

	oa, err := listOpenAIModels(ctx, srv.Client(), srv.URL+"/oa", "k")
	require.NoError(t, err)
	assert.Equal(t, []boundModel{img("gpt-image-2"), vid("sora-2"), {ID: "gpt-5", Type: "chat"}}, oa)

	g, err := listGoogleModels(ctx, srv.Client(), srv.URL+"/g", "k")
	require.NoError(t, err)
	assert.Equal(t, []boundModel{img("gemini-3-pro-image"), vid("veo-3.1"), {ID: "gemini-3-pro", Type: "chat"}}, g)

	am, err := listAPIMartModels(ctx, srv.Client(), srv.URL+"/am", "k")
	require.NoError(t, err)
	assert.Equal(t, []boundModel{img("seedream-5-0-pro"), {ID: "mystery", Type: "chat"}}, am)
}

func TestUpdateConfig_BindsModelsAndRegistersImageAdapter(t *testing.T) {
	srv, r := newProviderTestServer(t)
	_, ok := srv.registry.Get("openai")
	require.False(t, ok, "unconfigured channel has no adapter")

	w := postJSON(r, "/api/config", map[string]any{
		"provider": "openai",
		"api_key":  "sk-live-1234567890",
		"models": []map[string]string{
			{"id": " gpt-image-2 ", "type": "image"},
			{"id": "gpt-image-2", "type": "image"},
			{"id": "gpt-5", "type": "chat"},
			{"id": "", "type": "image"},
		},
	})
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())

	a, ok := srv.registry.Get("openai")
	require.True(t, ok)
	assert.IsType(t, &adapter.OpenAIImageAdapter{}, a)

	openaiSpec, _ := findProvider(nil, "openai")
	assert.Equal(t, []boundModel{img("gpt-image-2"), {ID: "gpt-5", Type: "chat"}}, resolveProvider(openaiSpec, srv.storedConfig()).Models,
		"image and chat bindings are kept; blanks and duplicates dropped")

	// An explicit empty list unbinds everything instead of reverting to presets.
	w = postJSON(r, "/api/config", map[string]any{"provider": "openai", "models": []any{}})
	require.Equal(t, http.StatusOK, w.Code)
	assert.Empty(t, resolveProvider(openaiSpec, srv.storedConfig()).Models)
}

func TestUpdateConfig_KeepsPresetsUntilModelsSent(t *testing.T) {
	srv, r := newProviderTestServer(t)
	w := postJSON(r, "/api/config", map[string]any{"provider": "kling", "api_key": "kling-key-123456"})
	require.Equal(t, http.StatusOK, w.Code)
	spec, _ := findProvider(nil, "kling")
	assert.Equal(t, spec.Presets, resolveProvider(spec, srv.storedConfig()).Models)
	_, ok := srv.registry.Get("kling")
	assert.False(t, ok, "kling only stores configuration for now")
}

// main.go hands the same adapter map to both the poller and the server; a key saved
// at runtime must reach the registry the poller dispatches from.
func TestHotReload_ReachesPollerRegistry(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, spec := range presetProviders {
		t.Setenv(spec.APIKeyEnv, "")
	}
	database, err := db.InitDB(filepath.Join(t.TempDir(), "wiring.db"))
	require.NoError(t, err)
	sqlDB, _ := database.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })

	adapters := map[string]adapter.ProviderAdapter{
		"ark": adapter.NewFakeProviderAdapter("ark"),
	}
	p := poller.NewTaskPoller(poller.TaskPollerConfig{DB: database, Adapters: adapters})
	r := NewServer(database, t.TempDir(), adapters, p).SetupRouter()

	require.Equal(t, http.StatusOK, postJSON(r, "/api/config", map[string]any{
		"provider": "openai", "api_key": "sk-runtime-123456",
	}).Code)
	require.Equal(t, http.StatusOK, postJSON(r, "/api/config", map[string]any{
		"provider": "ark", "api_key": "ark-runtime-123456",
	}).Code)

	openai, ok := p.Registry().Get("openai")
	require.True(t, ok, "poller must see channels configured at runtime")
	assert.IsType(t, &adapter.OpenAIImageAdapter{}, openai)
	ark, _ := p.Registry().Get("ark")
	assert.IsType(t, &adapter.ArkAdapter{}, ark, "poller must stop using the mock once a key is saved")
}

// Relays forwarding APIMart can reject ?expand=category with 400; the plain list
// must still work, with types inferred from model IDs.
func TestListAPIMartModels_FallsBackWhenExpandRejected(t *testing.T) {
	var calls []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls = append(calls, r.URL.RequestURI())
		if r.URL.Query().Has("expand") {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = io.WriteString(w, `{"error":{"message":"unknown parameter expand"}}`)
			return
		}
		_, _ = io.WriteString(w, `{"data":[{"id":"gpt-image-2.5-flare"},{"id":"veo3.1-fast"},{"id":"gpt-5"}]}`)
	}))
	defer srv.Close()

	models, err := listAPIMartModels(context.Background(), srv.Client(), srv.URL+"/apimart/v1", "k")
	require.NoError(t, err)
	assert.Equal(t, []string{"/apimart/v1/models?expand=category", "/apimart/v1/models"}, calls)
	assert.Equal(t, []boundModel{img("gpt-image-2.5-flare"), vid("veo3.1-fast"), {ID: "gpt-5", Type: "chat"}}, models)
}

func TestListAPIMartModels_AuthErrorIsNotRetried(t *testing.T) {
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = io.WriteString(w, `{"error":{"message":"Invalid token"}}`)
	}))
	defer srv.Close()

	_, err := listAPIMartModels(context.Background(), srv.Client(), srv.URL, "bad")
	require.Error(t, err)
	assert.Equal(t, 1, calls)
	assert.Contains(t, err.Error(), "API Key 鉴权失败 (HTTP 401): Invalid token")
}

func TestInferModelType_CoversAggregatorFamilies(t *testing.T) {
	cases := map[string]string{
		"nano-banana-pro":        "image",
		"wan2.7-image":           "image",
		"z-image-turbo":          "image",
		"wan2.6":                 "video",
		"MiniMax-H3":             "video",
		"vidu-q3-pro":            "video",
		"skyreels-v4":            "video",
		"wan2.6-i2v-flash":       "video",
		"suno-v6":                "audio",
		"gpt-5":                  "chat",
		"text-embedding-3-large": "other",
	}
	for id, want := range cases {
		assert.Equal(t, want, inferModelType(id), id)
	}
}

// Channels with a live catalog must not bind anything the user did not tick.
func TestBoundModels_ListableProvidersStartEmpty(t *testing.T) {
	for _, id := range []string{"openai", "google", "apimart"} {
		spec, _ := findProvider(nil, id)
		models := resolveProvider(spec, nil).Models
		assert.NotNil(t, models, id)
		assert.Empty(t, models, id)
	}
	ark, _ := findProvider(nil, "ark")
	assert.NotEmpty(t, resolveProvider(ark, nil).Models, "channels with presets bind them until the user saves a binding")
}

// Self-hosted relays and proxies on the LAN or this machine must be configurable.
func TestValidateBaseURL_AllowsIntranetAndLocalhost(t *testing.T) {
	for _, u := range []string{
		"http://172.16.116.14:3000/v1beta",
		"http://10.0.0.8:8080",
		"http://192.168.1.20/mj",
		"http://127.0.0.1:8081",
		"http://localhost:3000/v1",
	} {
		assert.NoError(t, validateBaseURL(u), u)
	}
	for _, u := range []string{"http://169.254.169.254/latest", "http://0.0.0.0:80", "ftp://10.0.0.8"} {
		assert.Error(t, validateBaseURL(u), u)
	}
}

// new-api style relays serve their web UI (HTML, 200) on unknown paths such as /models
// at the root; a missing /v1beta must not look like a working model list.
func TestListModels_HTMLPageMeansWrongPath(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = io.WriteString(w, "<!doctype html><html></html>")
	}))
	defer srv.Close()
	_, err := listGoogleModels(context.Background(), srv.Client(), srv.URL, "k")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "返回的是网页而不是 API")
}

func TestListGoogleModels_AcceptsOpenAIShapedRelayList(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, `{"object":"list","data":[{"id":"gemini-3-pro-image-preview"},{"id":"gemini-3-pro"}]}`)
	}))
	defer srv.Close()
	models, err := listGoogleModels(context.Background(), srv.Client(), srv.URL+"/v1beta", "k")
	require.NoError(t, err)
	assert.Equal(t, []boundModel{img("gemini-3-pro-image-preview"), {ID: "gemini-3-pro", Type: "chat"}}, models)
}

func TestGenerateText_UsesStoredProviderCredentials(t *testing.T) {
	var gotAuth string
	var gotBody map[string]any
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		_, _ = io.WriteString(w, `{"choices":[{"message":{"content":"电影感，雨夜霓虹街道，低机位仰拍"}}]}`)
	}))
	defer upstream.Close()

	srv, r := newProviderTestServer(t)
	require.Equal(t, http.StatusBadRequest, postJSON(r, "/api/llm/generate", map[string]string{
		"provider": "openai", "model": "gpt-5", "prompt": "写提示词",
	}).Code, "no key configured yet")

	require.NoError(t, srv.db.Create(&model.SystemConfig{Key: "openai_api_key", Value: "sk-text"}).Error)
	require.NoError(t, srv.db.Create(&model.SystemConfig{Key: "openai_base_url", Value: upstream.URL + "/v1"}).Error)

	w := postJSON(r, "/api/llm/generate", map[string]string{
		"provider": "openai", "model": "gpt-5", "system": "你是提示词助手", "prompt": "雨夜街道",
	})
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.JSONEq(t, `{"text":"电影感，雨夜霓虹街道，低机位仰拍"}`, w.Body.String())
	assert.Equal(t, "Bearer sk-text", gotAuth)
	assert.Equal(t, "gpt-5", gotBody["model"])

	assert.Equal(t, http.StatusBadRequest, postJSON(r, "/api/llm/generate", map[string]string{
		"provider": "kling", "model": "x", "prompt": "p",
	}).Code)
}

// Ark binds its Doubao chat presets by default and, when its /models is absent,
// "获取模型" falls back to those presets instead of failing.
func TestArkChatPresetsAndListFallback(t *testing.T) {
	ark, _ := findProvider(nil, "ark")
	var chats []string
	for _, m := range resolveProvider(ark, nil).Models {
		if m.Type == "chat" {
			chats = append(chats, m.ID)
		}
	}
	assert.Contains(t, chats, "doubao-seed-2-1-pro-260915")

	upstream := httptest.NewServer(http.NotFoundHandler())
	defer upstream.Close()
	srv, r := newProviderTestServer(t)
	require.NoError(t, srv.db.Create(&model.SystemConfig{Key: "ark_api_key", Value: "ark-key"}).Error)
	require.NoError(t, srv.db.Create(&model.SystemConfig{Key: "ark_base_url", Value: upstream.URL + "/api/v3"}).Error)

	w := postJSON(r, "/api/config/models", map[string]string{"provider": "ark"})
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	var resp struct {
		Models []boundModel `json:"models"`
		Source string       `json:"source"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	assert.Equal(t, "preset", resp.Source)
	assert.Equal(t, ark.Presets, resp.Models)
}

// A channel pointed at the wrong API (the MiniMax channel at an APIMart relay) answers
// its dummy-task probe with 404; that must fail the connection test.
func TestConnectionTest_404FailsEvenForDummyTaskProbes(t *testing.T) {
	relay := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = io.WriteString(w, `{"error":{"message":"Invalid URL (GET /apimart/v1/query/video_generation)"}}`)
	}))
	defer relay.Close()

	_, r := newProviderTestServer(t)
	w := postJSON(r, "/api/config/test", map[string]string{
		"provider": "minimax", "base_url": relay.URL + "/apimart/v1", "api_key": "sk-relay",
	})
	require.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), `"ok":false`)
	assert.Contains(t, w.Body.String(), "接口路径不存在")
}

// A channel filled in by mistake (e.g. MiniMax pointed at an APIMart relay) can be
// cleared, which removes its adapter so cards stop offering it.
func TestUpdateConfig_ClearRemovesProvider(t *testing.T) {
	srv, r := newProviderTestServer(t)
	require.Equal(t, http.StatusOK, postJSON(r, "/api/config", map[string]any{
		"provider": "openai", "api_key": "sk-wrong-123456", "base_url": "http://127.0.0.1:9/v1",
		"models": []map[string]string{{"id": "gpt-image-2", "type": "image"}},
	}).Code)
	require.Equal(t, http.StatusOK, postJSON(r, "/api/config", map[string]any{
		"provider": "minimax", "api_key": "sk-wrong-123456", "extra": map[string]string{"group_id": "g1"},
	}).Code)

	for _, id := range []string{"openai", "minimax"} {
		w := postJSON(r, "/api/config", map[string]any{"provider": id, "clear": true})
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		spec, _ := findProvider(nil, id)
		view := resolveProvider(spec, srv.storedConfig())
		assert.False(t, view.IsConfigured, id)
		assert.Equal(t, spec.DefaultBaseURL, view.BaseURL, id)
		assert.Empty(t, view.Extra, id)
	}
	var left int64
	srv.db.Model(&model.SystemConfig{}).Where("key LIKE ? OR key LIKE ?", "openai_%", "minimax_%").Count(&left)
	assert.Zero(t, left)

	_, ok := srv.registry.Get("openai")
	assert.False(t, ok, "cleared image channel has no adapter")
	mm, _ := srv.registry.Get("minimax")
	assert.IsType(t, &adapter.FakeProviderAdapter{}, mm, "MiniMax falls back to its mock")
}

// Every preset provider speaks a protocol; the openai preset is an OpenAI-compatible
// instance and google a Gemini one.
func TestGetConfig_ListsProtocolAndPresetFlag(t *testing.T) {
	_, r := newProviderTestServer(t)
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/config", nil)
	r.ServeHTTP(w, req)
	require.Equal(t, http.StatusOK, w.Code)
	var resp struct {
		Providers []providerView `json:"providers"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	got := make(map[string]model.Protocol)
	for _, p := range resp.Providers {
		assert.True(t, p.Preset, p.ID)
		assert.NotEmpty(t, p.Name, p.ID)
		got[p.ID] = p.Protocol
	}
	assert.Equal(t, map[string]model.Protocol{
		"ark":        model.ProtocolArk,
		"minimax":    model.ProtocolMiniMax,
		"kling":      model.ProtocolKling,
		"midjourney": model.ProtocolMidjourney,
		"google":     model.ProtocolGemini,
		"openai":     model.ProtocolOpenAICompatible,
		"apimart":    model.ProtocolAPIMart,
	}, got)
	for _, spec := range presetProviders {
		_, ok := protocolSpecs[spec.Protocol]
		assert.True(t, ok, "protocol %s of %s has a spec", spec.Protocol, spec.ID)
	}
}

func TestProviderAdapters_MockOnlyWhereTheProviderRunsMocked(t *testing.T) {
	for _, spec := range presetProviders {
		t.Setenv(spec.APIKeyEnv, "")
	}
	adapters := ProviderAdapters(nil)
	assert.Len(t, adapters, 2)
	assert.IsType(t, &adapter.FakeProviderAdapter{}, adapters["ark"])
	assert.IsType(t, &adapter.FakeProviderAdapter{}, adapters["minimax"])

	adapters = ProviderAdapters(map[string]string{
		"openai_api_key":      "sk-db",
		"kling_api_key":       "kling-db",
		"minimax_api_key":     "mm-db",
		"minimax_group_id":    "g1",
		"midjourney_api_key":  "mj-db",
		"midjourney_base_url": "http://mj-proxy:8080",
	})
	assert.IsType(t, &adapter.OpenAIImageAdapter{}, adapters["openai"])
	require.IsType(t, &adapter.MidjourneyAdapter{}, adapters["midjourney"])
	assert.Equal(t, "http://mj-proxy:8080", adapters["midjourney"].(adapter.ConfigurableAdapter).GetConfig().BaseURL)
	assert.Equal(t, "openai", adapters["openai"].ProviderName())
	assert.IsType(t, &adapter.MiniMaxAdapter{}, adapters["minimax"])
	assert.Equal(t, "g1", adapters["minimax"].(adapter.ConfigurableAdapter).GetConfig().Extra["group_id"])
	_, hasKling := adapters["kling"]
	assert.False(t, hasKling, "kling only stores configuration for now")
}

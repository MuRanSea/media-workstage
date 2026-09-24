package server

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"media-workstage/internal/adapter"
	"media-workstage/internal/db"
	"media-workstage/internal/model"
	"media-workstage/internal/poller"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func getProviders(t *testing.T, r *gin.Engine) []providerView {
	t.Helper()
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodGet, "/api/config", nil)
	r.ServeHTTP(w, req)
	require.Equal(t, http.StatusOK, w.Code)
	var resp struct {
		Providers []providerView `json:"providers"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	return resp.Providers
}

func createProvider(t *testing.T, r *gin.Engine, name, baseURL string) providerView {
	t.Helper()
	w := postJSON(r, "/api/providers", map[string]string{
		"protocol": "openai_compatible", "name": name, "base_url": baseURL, "api_key": "sk-" + name,
	})
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	var resp struct {
		Config providerView `json:"config"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	return resp.Config
}

func deleteProvider(r *gin.Engine, id string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	req, _ := http.NewRequest(http.MethodDelete, "/api/providers/"+id, nil)
	r.ServeHTTP(w, req)
	return w
}

func TestCreateProvider_ListedAfterPresetsWithAdapter(t *testing.T) {
	srv, r := newProviderTestServer(t)
	created := createProvider(t, r, "中转 A", "http://127.0.0.1:9/v1/")

	assert.True(t, strings.HasPrefix(created.ID, "custom-"), created.ID)
	assert.Equal(t, "中转 A", created.Name)
	assert.Equal(t, model.ProtocolOpenAICompatible, created.Protocol)
	assert.False(t, created.Preset)
	assert.True(t, created.IsConfigured)
	assert.Equal(t, "http://127.0.0.1:9/v1", created.BaseURL)
	assert.Empty(t, created.Models, "a live catalog binds nothing until the user ticks models")
	assert.True(t, created.CanListModels)

	providers := getProviders(t, r)
	require.Len(t, providers, len(presetProviders)+1)
	assert.Equal(t, created.ID, providers[len(providers)-1].ID)

	a, ok := srv.registry.Get(created.ID)
	require.True(t, ok)
	assert.IsType(t, &adapter.OpenAIImageAdapter{}, a)
	assert.Equal(t, created.ID, a.ProviderName())

	// A restart rebuilds the custom provider's adapter from stored config.
	restarted := ProviderAdapters(srv.storedConfig())
	assert.IsType(t, &adapter.OpenAIImageAdapter{}, restarted[created.ID])
}

func TestCreateProvider_Validation(t *testing.T) {
	_, r := newProviderTestServer(t)
	cases := []struct {
		body   map[string]string
		status int
		msg    string
	}{
		{map[string]string{"protocol": "ark", "name": "方舟 B", "base_url": "http://127.0.0.1:9"}, http.StatusBadRequest, "暂不支持"},
		{map[string]string{"protocol": "openai_compatible", "name": "  ", "base_url": "http://127.0.0.1:9"}, http.StatusBadRequest, "名称不能为空"},
		{map[string]string{"protocol": "openai_compatible", "name": " openai ", "base_url": "http://127.0.0.1:9"}, http.StatusConflict, "名称已被其他服务商使用"},
		{map[string]string{"protocol": "openai_compatible", "name": "中转", "base_url": "ftp://x"}, http.StatusBadRequest, "base_url"},
	}
	for _, tc := range cases {
		w := postJSON(r, "/api/providers", tc.body)
		assert.Equal(t, tc.status, w.Code, tc.body)
		assert.Contains(t, w.Body.String(), tc.msg)
	}
	assert.Len(t, getProviders(t, r), len(presetProviders), "rejected providers are not saved")
}

func TestRenameProvider_PresetAndCustomStayUnique(t *testing.T) {
	_, r := newProviderTestServer(t)
	relay := createProvider(t, r, "中转 A", "http://127.0.0.1:9/v1")

	w := postJSON(r, "/api/config", map[string]any{"provider": "ark", "name": " 方舟主号 "})
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())

	w = postJSON(r, "/api/config", map[string]any{"provider": relay.ID, "name": "方舟主号"})
	assert.Equal(t, http.StatusConflict, w.Code)
	assert.Contains(t, w.Body.String(), "名称已被其他服务商使用")

	// Keeping its own name (e.g. saving other fields) is not a conflict.
	w = postJSON(r, "/api/config", map[string]any{"provider": relay.ID, "name": "中转 A", "api_key": "sk-new-123456"})
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())

	names := map[string]string{}
	for _, p := range getProviders(t, r) {
		names[p.ID] = p.Name
	}
	assert.Equal(t, "方舟主号", names["ark"])
	assert.Equal(t, "中转 A", names[relay.ID])
}

func TestDeleteProvider_OnlyCustom(t *testing.T) {
	srv, r := newProviderTestServer(t)
	relay := createProvider(t, r, "中转 A", "http://127.0.0.1:9/v1")
	require.Equal(t, http.StatusOK, postJSON(r, "/api/config", map[string]any{
		"provider": relay.ID, "models": []map[string]string{{"id": "gpt-5", "type": "chat"}},
	}).Code)

	w := deleteProvider(r, "openai")
	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "预置服务商不能删除")
	assert.Equal(t, http.StatusNotFound, deleteProvider(r, "custom-nope").Code)

	require.Equal(t, http.StatusOK, deleteProvider(r, relay.ID).Code)
	assert.Len(t, getProviders(t, r), len(presetProviders))
	_, ok := srv.registry.Get(relay.ID)
	assert.False(t, ok)
	var left int64
	srv.db.Model(&model.SystemConfig{}).Where("key LIKE ?", relay.ID+"%").Count(&left)
	assert.Zero(t, left, "the provider's config keys are removed")

	// Its name is free again.
	createProvider(t, r, "中转 A", "http://127.0.0.1:9/v1")
}

// OpenAI-compatible services without GET /models still work; the connection test and
// model list say so and point to manual entry instead of calling the base URL wrong.
func TestOpenAICompatible_MissingModelList(t *testing.T) {
	upstream := httptest.NewServer(http.NotFoundHandler())
	defer upstream.Close()
	_, r := newProviderTestServer(t)
	relay := createProvider(t, r, "无列表中转", upstream.URL+"/v1")

	w := postJSON(r, "/api/config/test", map[string]string{"provider": relay.ID, "base_url": upstream.URL + "/v1", "api_key": "k"})
	require.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), `"ok":false`)
	assert.Contains(t, w.Body.String(), "手动添加模型 ID")

	w = postJSON(r, "/api/config/models", map[string]string{"provider": relay.ID})
	assert.Equal(t, http.StatusBadGateway, w.Code)
	assert.Contains(t, w.Body.String(), "手动添加模型 ID")
}

// Two custom providers bind the same model; text and image cards run through each
// one's own upstream, via the real HTTP API, poller and adapters.
func TestCustomProviders_SameModelOnTwoRelays_EndToEnd(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, spec := range presetProviders {
		t.Setenv(spec.APIKeyEnv, "")
	}
	type hit struct{ path, auth, model string }
	newRelay := func(tag string, hits *[]hit) *httptest.Server {
		return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var body map[string]any
			raw, _ := io.ReadAll(r.Body)
			_ = json.Unmarshal(raw, &body)
			m, _ := body["model"].(string)
			*hits = append(*hits, hit{r.URL.Path, r.Header.Get("Authorization"), m})
			switch r.URL.Path {
			case "/v1/chat/completions":
				_, _ = io.WriteString(w, `{"choices":[{"message":{"content":"来自`+tag+`"}}]}`)
			case "/v1/images/generations":
				_ = json.NewEncoder(w).Encode(map[string]any{
					"data": []map[string]string{{"b64_json": base64.StdEncoding.EncodeToString([]byte("png-" + tag))}},
				})
			default:
				http.NotFound(w, r)
			}
		}))
	}
	var hitsA, hitsB []hit
	relayA, relayB := newRelay("A", &hitsA), newRelay("B", &hitsB)
	defer relayA.Close()
	defer relayB.Close()

	database, err := db.InitDB(filepath.Join(t.TempDir(), "custom-e2e.db"))
	require.NoError(t, err)
	sqlDB, _ := database.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	assetDir := t.TempDir()
	registry := adapter.NewAdapterRegistry(nil)
	p := poller.NewTaskPoller(poller.TaskPollerConfig{
		DB: database, Registry: registry, AssetDir: assetDir,
		ImagePollInterval: 50 * time.Millisecond, ImageInitialDelay: 10 * time.Millisecond,
	})
	ctx, cancel := context.WithCancel(context.Background())
	p.Start(ctx)
	t.Cleanup(func() { cancel(); p.Stop() })
	r := NewServer(database, assetDir, registry, p).SetupRouter()

	a := createProvider(t, r, "中转 A", relayA.URL+"/v1")
	b := createProvider(t, r, "中转 B", relayB.URL+"/v1")
	bind := []map[string]string{{"id": "gpt-image-2", "type": "image"}, {"id": "gpt-5", "type": "chat"}}
	for _, id := range []string{a.ID, b.ID} {
		require.Equal(t, http.StatusOK, postJSON(r, "/api/config", map[string]any{"provider": id, "models": bind}).Code)
	}

	for _, tc := range []struct {
		provider providerView
		tag      string
	}{{a, "A"}, {b, "B"}} {
		w := postJSON(r, "/api/llm/generate", map[string]string{"provider": tc.provider.ID, "model": "gpt-5", "prompt": "写提示词"})
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		assert.JSONEq(t, `{"text":"来自`+tc.tag+`"}`, w.Body.String())

		w = postJSON(r, "/api/tasks", map[string]any{
			"provider": tc.provider.ID, "model": "gpt-image-2", "task_type": "image_generation", "task_mode": "single",
			"prompt": "a red fox", "params": map[string]string{"aspect_ratio": "1:1", "resolution": "1K"},
		})
		require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
		var created struct {
			ID string `json:"id"`
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &created))
		var task struct {
			Status string `json:"status"`
			Error  string `json:"error_message"`
			Assets []struct {
				LocalPath string `json:"local_path"`
			} `json:"assets"`
		}
		require.Eventually(t, func() bool {
			rec := httptest.NewRecorder()
			req, _ := http.NewRequest(http.MethodGet, "/api/tasks/"+created.ID, nil)
			r.ServeHTTP(rec, req)
			_ = json.Unmarshal(rec.Body.Bytes(), &task)
			return task.Status == "succeeded" || task.Status == "failed"
		}, 10*time.Second, 50*time.Millisecond)
		require.Equal(t, "succeeded", task.Status, task.Error)
		require.Len(t, task.Assets, 1)
		data, err := os.ReadFile(filepath.Join(assetDir, task.Assets[0].LocalPath))
		require.NoError(t, err)
		assert.Equal(t, "png-"+tc.tag, string(data))
	}

	for _, tc := range []struct {
		hits []hit
		key  string
	}{{hitsA, "Bearer sk-中转 A"}, {hitsB, "Bearer sk-中转 B"}} {
		require.Len(t, tc.hits, 2)
		assert.Equal(t, hit{"/v1/chat/completions", tc.key, "gpt-5"}, tc.hits[0])
		assert.Equal(t, hit{"/v1/images/generations", tc.key, "gpt-image-2"}, tc.hits[1])
	}
}

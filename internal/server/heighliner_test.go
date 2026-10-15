package server

import (
	"context"
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

// newHeighlinerGateway serves the two catalogs a real gateway returned (testdata), with
// mediaCatalog overriding the media one when non-empty.
func newHeighlinerGateway(t *testing.T, mediaCatalog string) *httptest.Server {
	t.Helper()
	media, err := os.ReadFile("testdata/heighliner-media-models.json")
	require.NoError(t, err)
	if mediaCatalog != "" {
		media = []byte(mediaCatalog)
	}
	text, err := os.ReadFile("testdata/heighliner-text-models.json")
	require.NoError(t, err)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer hl-key" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch r.URL.Path {
		case "/media/v1/models":
			_, _ = w.Write(media)
		case "/v1/models":
			_, _ = w.Write(text)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func typesByID(models []boundModel) map[string]string {
	out := make(map[string]string, len(models))
	for _, m := range models {
		out[m.ID] = m.Type
	}
	return out
}

func TestListHeighlinerModels_SortsBothCatalogsIntoCardKinds(t *testing.T) {
	gw := newHeighlinerGateway(t, "")
	models, err := listHeighlinerModels(context.Background(), gw.Client(), gw.URL, "hl-key")
	require.NoError(t, err)

	types := typesByID(models)
	assert.Equal(t, "image", types["doubao-seedream-5-0-lite-260128"])
	assert.Equal(t, "video", types["doubao-seedance-2-5-260628"])
	assert.Equal(t, "video", types["kling-3.0-omni"])
	assert.Equal(t, "video", types["MiniMax-H3"])
	assert.Equal(t, "3d", types["hy-3d-3.0"])
	assert.Equal(t, "3d", types["tripo-3d-p1"])
	assert.Equal(t, "chat", types["deepseek-flash"])
	assert.Equal(t, "chat", types["doubao-seed-2-1-pro-260628"])

	counts := map[string]int{}
	for _, m := range models {
		counts[m.Type]++
		if m.Type == "chat" {
			assert.Empty(t, m.Capability, m.ID)
		} else {
			require.NotEmpty(t, m.Capability, m.ID)
			var desc struct {
				ID         string         `json:"id"`
				Parameters map[string]any `json:"parameters"`
			}
			require.NoError(t, json.Unmarshal(m.Capability, &desc))
			assert.Equal(t, m.ID, desc.ID)
			assert.NotEmpty(t, desc.Parameters, m.ID)
		}
	}
	assert.Equal(t, map[string]int{"image": 3, "video": 8, "3d": 5, "chat": 18}, counts,
		"Seedream lists \"openai\" in /v1/models too but stays an image model")
}

func TestListHeighlinerModels_TextModelsAreThoseWithNativeEndpointTypes(t *testing.T) {
	// With no media catalog, Seedream's "openai" in supported_endpoint_types must still not
	// make it a chat model: only native_endpoint_types (an array, null for media) decides.
	gw := newHeighlinerGateway(t, `{"data":[]}`)
	models, err := listHeighlinerModels(context.Background(), gw.Client(), gw.URL, "hl-key")
	require.NoError(t, err)
	types := typesByID(models)
	assert.NotContains(t, types, "doubao-seedream-5-0-lite-260128")
	assert.NotContains(t, types, "doubao-seedream-5-0-pro-260628")
	assert.NotContains(t, types, "kling-3.0-omni")
	assert.Equal(t, "chat", types["deepseek-flash"])
	assert.Len(t, models, 18)
}

func TestListHeighlinerModels_SkipsUnknownMediaTypes(t *testing.T) {
	gw := newHeighlinerGateway(t, `{"data":[{"id":"some-tts","type":"audio"},{"id":"img-1","type":"image","parameters":{}}]}`)
	models, err := listHeighlinerModels(context.Background(), gw.Client(), gw.URL, "hl-key")
	require.NoError(t, err)
	types := typesByID(models)
	assert.Equal(t, "image", types["img-1"])
	_, listed := types["some-tts"]
	assert.False(t, listed, "a media kind no card runs is not offered")
}

func createHeighlinerProvider(t *testing.T, gwURL string) (*Server, providerView, func(path string, body any) *httptest.ResponseRecorder) {
	t.Helper()
	srv, r := newProviderTestServer(t)
	w := postJSON(r, "/api/providers", map[string]string{
		"protocol": "heighliner", "name": "Heighliner", "base_url": gwURL + "/", "api_key": "hl-key",
	})
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	var resp struct {
		Config providerView `json:"config"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &resp))
	post := func(path string, body any) *httptest.ResponseRecorder { return postJSON(r, path, body) }
	return srv, resp.Config, post
}

func TestHeighlinerProvider_FetchStoresDescriptorsForBoundModels(t *testing.T) {
	gw := newHeighlinerGateway(t, "")
	srv, created, post := createHeighlinerProvider(t, gw.URL)
	assert.Equal(t, model.ProtocolHeighliner, created.Protocol)
	assert.Equal(t, gw.URL, created.BaseURL)
	assert.True(t, created.CanListModels)
	assert.Empty(t, created.Models)

	w := post("/api/config/models", map[string]string{"provider": created.ID})
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())

	// Bind three models; the client never sends descriptors back.
	w = post("/api/config", map[string]any{
		"provider": created.ID,
		"models": []map[string]string{
			{"id": "doubao-seedream-5-0-lite-260128", "type": "image"},
			{"id": "hy-3d-express", "type": "3d"},
			{"id": "deepseek-flash", "type": "chat"},
		},
	})
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())

	spec, ok := findProvider(srv.storedConfig(), created.ID)
	require.True(t, ok)
	bound := resolveProvider(spec, srv.storedConfig()).Models
	require.Len(t, bound, 3)
	assert.Equal(t, "3d", bound[1].Type, "3d is a bindable type")
	assert.Contains(t, string(bound[0].Capability), `"2K"`)
	assert.Contains(t, string(bound[1].Capability), `"enable_geometry"`)
	assert.Empty(t, bound[2].Capability)

	// A restart reads them from stored config.
	again := resolveProvider(spec, srv.storedConfig()).Models
	assert.Equal(t, bound, again)
}

func TestHeighlinerProvider_RefetchReplacesDescriptors(t *testing.T) {
	gw := newHeighlinerGateway(t, "")
	srv, created, post := createHeighlinerProvider(t, gw.URL)
	require.Equal(t, http.StatusOK, post("/api/config/models", map[string]string{"provider": created.ID}).Code)
	require.Equal(t, http.StatusOK, post("/api/config", map[string]any{
		"provider": created.ID, "models": []map[string]string{{"id": "doubao-seedream-5-0-lite-260128", "type": "image"}},
	}).Code)

	// The gateway narrows the model; fetching again refreshes the saved descriptor.
	gw2 := newHeighlinerGateway(t, `{"data":[{"id":"doubao-seedream-5-0-lite-260128","type":"image","parameters":{"resolution":{"type":"string","enum":["2K"]}}}]}`)
	require.Equal(t, http.StatusOK, post("/api/config/models", map[string]string{"provider": created.ID, "base_url": gw2.URL}).Code)

	spec, _ := findProvider(srv.storedConfig(), created.ID)
	bound := resolveProvider(spec, srv.storedConfig()).Models
	require.Len(t, bound, 1)
	assert.NotContains(t, string(bound[0].Capability), `"4K"`)
	assert.Contains(t, string(bound[0].Capability), `"2K"`)
}

func TestHeighlinerProvider_ClearAndDeleteDropDescriptors(t *testing.T) {
	gw := newHeighlinerGateway(t, "")
	srv, created, post := createHeighlinerProvider(t, gw.URL)
	require.Equal(t, http.StatusOK, post("/api/config/models", map[string]string{"provider": created.ID}).Code)
	_, saved := srv.storedConfig()[capabilitiesKey(created.ID)]
	require.True(t, saved)

	require.Equal(t, http.StatusOK, post("/api/config", map[string]any{"provider": created.ID, "clear": true}).Code)
	_, saved = srv.storedConfig()[capabilitiesKey(created.ID)]
	assert.False(t, saved, "clearing a provider drops its descriptors")

	require.Equal(t, http.StatusOK, post("/api/config/models", map[string]string{"provider": created.ID, "base_url": gw.URL, "api_key": "hl-key"}).Code)
	_, r := srv, srv.SetupRouter()
	require.Equal(t, http.StatusOK, deleteProvider(r, created.ID).Code)
	_, saved = srv.storedConfig()[capabilitiesKey(created.ID)]
	assert.False(t, saved, "deleting a provider drops its descriptors")
}

func TestHeighlinerProbe_ReadsMediaCatalogAtRoot(t *testing.T) {
	req, err := protocolSpecs[model.ProtocolHeighliner].newProbe(context.Background(), "https://platform.sgt.site", "hl-key", nil)
	require.NoError(t, err)
	assert.Equal(t, "https://platform.sgt.site/media/v1/models", req.URL.String())
	assert.Equal(t, "Bearer hl-key", req.Header.Get("Authorization"))
}

// TestHeighliner3DTask_EndToEnd runs a 3D card with images only (no prompt) through the
// HTTP API, poller and Heighliner adapter against a fake gateway, down to the files on disk.
func TestHeighliner3DTask_EndToEnd(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var submitted map[string]any
	var gw *httptest.Server
	gw = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.Contains(r.URL.Path, "/artifacts/"):
			assert.Empty(t, r.Header.Get("Authorization"))
			_, _ = io.WriteString(w, "file "+r.URL.Path)
		case r.URL.Path == "/media/v1/3d/generations":
			_ = json.NewDecoder(r.Body).Decode(&submitted)
			w.WriteHeader(http.StatusAccepted)
			_, _ = io.WriteString(w, `{"id":"task_3d","status":"queued"}`)
		case r.URL.Path == "/media/v1/tasks/task_3d":
			_, _ = io.WriteString(w, `{"id":"task_3d","status":"succeeded","artifacts":[
				{"index":0,"kind":"model3d","mime_type":"model/gltf-binary","state":"available","url":"/media/v1/tasks/task_3d/artifacts/0?sig=a","url_type":"signed"},
				{"index":1,"kind":"cover","mime_type":"image/png","state":"available","url":"/media/v1/tasks/task_3d/artifacts/1?sig=b","url_type":"signed"}],
				"billing":{"status":"settled","currency":"CNY","amount":"0.800000"}}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer gw.Close()

	database, err := db.InitDB(filepath.Join(t.TempDir(), "e2e.db"))
	require.NoError(t, err)
	sqlDB, _ := database.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	assetDir := t.TempDir()
	registry := adapter.NewAdapterRegistry(map[string]adapter.ProviderAdapter{})
	p := poller.NewTaskPoller(poller.TaskPollerConfig{
		DB: database, Registry: registry, AssetDir: assetDir,
		VideoPollInterval: 50 * time.Millisecond, VideoInitialDelay: 10 * time.Millisecond,
	})
	ctx, cancel := context.WithCancel(context.Background())
	p.Start(ctx)
	t.Cleanup(func() { cancel(); p.Stop() })
	r := NewServer(database, assetDir, registry, p).SetupRouter()

	w := postJSON(r, "/api/providers", map[string]string{"protocol": "heighliner", "name": "HL", "base_url": gw.URL, "api_key": "hl"})
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	var created struct {
		Config providerView `json:"config"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &created))

	w = postJSON(r, "/api/tasks", map[string]any{
		"provider": created.Config.ID, "model": "hy-3d-3.0", "task_type": "3d_generation", "prompt": "",
		"params": map[string]any{
			"parameters":       map[string]any{"output_format": "fbx"},
			"provider_options": map[string]any{"tencent": map[string]any{"enable_pbr": true}},
		},
		"reference_assets": []map[string]any{{"role": "multi_view_front", "type": "image", "url": "https://files.example.com/front.png"}},
	})
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	var task struct {
		ID      string `json:"id"`
		Status  string `json:"status"`
		Error   string `json:"error_message"`
		Billing string `json:"billing_details_json"`
		Assets  []struct {
			Kind      string `json:"kind"`
			LocalPath string `json:"local_path"`
		} `json:"assets"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &task))
	id := task.ID
	require.Eventually(t, func() bool {
		rec := httptest.NewRecorder()
		req, _ := http.NewRequest(http.MethodGet, "/api/tasks/"+id, nil)
		r.ServeHTTP(rec, req)
		_ = json.Unmarshal(rec.Body.Bytes(), &task)
		return task.Status == "succeeded" || task.Status == "failed"
	}, 10*time.Second, 50*time.Millisecond)

	require.Equal(t, "succeeded", task.Status, task.Error)
	assert.Equal(t, map[string]any{
		"model": "hy-3d-3.0", "output_format": "fbx", "wait": float64(0),
		"provider_options": map[string]any{"tencent": map[string]any{"enable_pbr": true}},
		"references":       []any{map[string]any{"role": "multi_view_front", "type": "image", "url": "https://files.example.com/front.png"}},
	}, submitted)
	assert.Contains(t, task.Billing, `"settled"`)
	require.Len(t, task.Assets, 2)
	assert.Equal(t, "model3d", task.Assets[0].Kind)
	data, err := os.ReadFile(filepath.Join(assetDir, task.Assets[0].LocalPath))
	require.NoError(t, err)
	assert.Equal(t, "file /media/v1/tasks/task_3d/artifacts/0", string(data))
}

func TestCreateTask_PromptRequiredOutsideHeighliner(t *testing.T) {
	_, r := newProviderTestServer(t)
	w := postJSON(r, "/api/tasks", map[string]any{"provider": "ark", "model": "m", "task_type": "image_generation", "prompt": "  "})
	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "prompt is required")
}

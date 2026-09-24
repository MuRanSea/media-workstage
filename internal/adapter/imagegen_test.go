package adapter

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"

	"media-workstage/internal/model"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var pngBytes = []byte("\x89PNG\r\n\x1a\nfake-image")

func imageTask(provider, modelID, params string) *model.MediaTask {
	return &model.MediaTask{
		ID:         "task-1",
		Provider:   provider,
		Model:      modelID,
		TaskType:   "image_generation",
		Prompt:     "a red fox",
		ParamsJSON: params,
	}
}

// collect runs submit -> poll -> download the way the poller does and returns the files.
func collect(t *testing.T, a ProviderAdapter, task *model.MediaTask) (*PollResult, []string) {
	t.Helper()
	id, err := a.SubmitTask(context.Background(), task)
	require.NoError(t, err)
	task.ProviderTaskID = id
	res, err := a.PollTask(context.Background(), task)
	require.NoError(t, err)
	var files []string
	dir := t.TempDir()
	for _, asset := range res.Assets {
		target := filepath.Join(dir, asset.LocalPath)
		require.NoError(t, a.DownloadAsset(context.Background(), asset.RemoteURL, target))
		files = append(files, target)
	}
	return res, files
}

func TestOpenAIImageAdapter_GeneratesAndSavesInlineImage(t *testing.T) {
	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/v1/images/generations", r.URL.Path)
		assert.Equal(t, "Bearer sk-test", r.Header.Get("Authorization"))
		_ = json.NewDecoder(r.Body).Decode(&got)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data":          []map[string]string{{"b64_json": base64.StdEncoding.EncodeToString(pngBytes)}},
			"output_format": "png",
			"usage":         map[string]int{"total_tokens": 42},
		})
	}))
	defer srv.Close()

	a := NewOpenAIImageAdapter(ChannelConfig{BaseURL: srv.URL + "/v1", APIKey: "sk-test"})
	res, files := collect(t, a, imageTask("openai", "gpt-image-2", `{"aspect_ratio":"16:9","resolution":"2K","output_format":"png"}`))

	assert.Equal(t, "gpt-image-2", got["model"])
	assert.Equal(t, "2720x1536", got["size"])
	assert.Equal(t, "png", got["output_format"])
	assert.Equal(t, model.TaskStatusSucceeded, res.Status)
	assert.Equal(t, 42, res.UsageTokens)
	require.Len(t, files, 1)
	assert.Equal(t, "images/task-1/base.png", filepath.ToSlash(res.Assets[0].LocalPath))
	data, _ := os.ReadFile(files[0])
	assert.Equal(t, pngBytes, data)
	assert.NotContains(t, res.Assets[0].RemoteURL, "base64", "image bytes must not be stored as a data URI")
}

func TestOpenAIImageAdapter_SurfacesProviderError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = io.WriteString(w, `{"error":{"message":"Your request was rejected by the safety system."}}`)
	}))
	defer srv.Close()

	a := NewOpenAIImageAdapter(ChannelConfig{BaseURL: srv.URL, APIKey: "sk"})
	_, err := a.SubmitTask(context.Background(), imageTask("openai", "gpt-image-2", `{}`))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "rejected by the safety system")
}

func TestOpenAIImageSize(t *testing.T) {
	cases := []struct{ model, ratio, res, want string }{
		{"gpt-image-1", "16:9", "4K", "1536x1024"},
		{"gpt-image-1.5", "9:16", "1K", "1024x1536"},
		{"gpt-image-2", "1:1", "1K", "1024x1024"},
		{"gpt-image-2", "1:1", "4K", "2880x2880"},
		{"gpt-image-2.5-flare", "16:9", "4K", "3840x2160"},
		{"gpt-image-2.5-flare", "21:9", "4K", "3840x1632"},
		{"gpt-image-2", "", "2K", "auto"},
	}
	for _, tc := range cases {
		assert.Equal(t, tc.want, openAIImageSize(tc.model, tc.ratio, tc.res), "%s %s %s", tc.model, tc.ratio, tc.res)
	}
}

func TestGeminiImageAdapter_ReadsInlineData(t *testing.T) {
	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/v1beta/models/gemini-3-pro-image:generateContent", r.URL.Path)
		assert.Equal(t, "g-key", r.Header.Get("x-goog-api-key"))
		_ = json.NewDecoder(r.Body).Decode(&got)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"candidates": []any{map[string]any{
				"content": map[string]any{"parts": []any{
					map[string]any{"text": "Here is your fox"},
					map[string]any{"inlineData": map[string]string{
						"mimeType": "image/jpeg",
						"data":     base64.StdEncoding.EncodeToString(pngBytes),
					}},
				}},
			}},
			"usageMetadata": map[string]int{"totalTokenCount": 7},
		})
	}))
	defer srv.Close()

	a := NewGeminiImageAdapter(ChannelConfig{BaseURL: srv.URL + "/v1beta", APIKey: "g-key"})
	res, files := collect(t, a, imageTask("google", "models/gemini-3-pro-image", `{"aspect_ratio":"4:3","resolution":"4K"}`))

	imageConfig := got["generationConfig"].(map[string]any)["imageConfig"].(map[string]any)
	assert.Equal(t, "4:3", imageConfig["aspectRatio"])
	assert.Equal(t, "4K", imageConfig["imageSize"])
	assert.Equal(t, 7, res.UsageTokens)
	assert.Equal(t, "images/task-1/base.jpg", filepath.ToSlash(res.Assets[0].LocalPath))
	data, _ := os.ReadFile(files[0])
	assert.Equal(t, pngBytes, data)
}

func TestGeminiImageAdapter_NoImageReportsReason(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, `{"candidates":[{"content":{"parts":[{"text":"I can't draw that."}]},"finishReason":"IMAGE_SAFETY"}]}`)
	}))
	defer srv.Close()

	a := NewGeminiImageAdapter(ChannelConfig{BaseURL: srv.URL, APIKey: "k"})
	_, err := a.SubmitTask(context.Background(), imageTask("google", "gemini-2.5-flash-image", `{}`))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "IMAGE_SAFETY")
	assert.Contains(t, err.Error(), "I can't draw that.")
}

func TestGeminiImageSize_SkipsModelsWithoutSizeControl(t *testing.T) {
	assert.Equal(t, "", geminiImageSize("gemini-2.5-flash-image", "2K"))
	assert.Equal(t, "", geminiImageSize("gemini-3.1-flash-lite-image", "2K"))
	assert.Equal(t, "2K", geminiImageSize("gemini-3.1-flash-image", "2K"))
}

func TestAPIMartAdapter_SubmitThenPollLifecycle(t *testing.T) {
	var submitted map[string]any
	status := "processing"
	// Results on a different host (a CDN) must never receive the API key.
	cdn := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Empty(t, r.Header.Get("Authorization"), "the API key must not leak to result file hosts")
		_, _ = w.Write(pngBytes)
	}))
	defer cdn.Close()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "Bearer am-key", r.Header.Get("Authorization"))
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/images/generations":
			_ = json.NewDecoder(r.Body).Decode(&submitted)
			_, _ = io.WriteString(w, `{"code":200,"data":[{"status":"submitted","task_id":"task_abc"}]}`)
		case r.URL.Path == "/v1/tasks/task_abc":
			resp := map[string]any{"code": 200, "data": map[string]any{"id": "task_abc", "status": status, "progress": 40}}
			if status == "completed" {
				resp["data"].(map[string]any)["result"] = map[string]any{
					"images": []any{map[string]any{"url": []string{cdn.URL + "/files/out.webp"}}},
				}
			}
			_ = json.NewEncoder(w).Encode(resp)
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	a := NewAPIMartAdapter(ChannelConfig{BaseURL: srv.URL + "/v1", APIKey: "am-key"})
	task := imageTask("apimart", "gpt-image-2.5-flare", `{"aspect_ratio":"16:9","resolution":"2K"}`)
	id, err := a.SubmitTask(context.Background(), task)
	require.NoError(t, err)
	assert.Equal(t, "task_abc", id)
	assert.Equal(t, "16:9", submitted["size"])
	assert.Equal(t, "2k", submitted["resolution"], "gpt image models take lowercase tiers")
	task.ProviderTaskID = id

	res, err := a.PollTask(context.Background(), task)
	require.NoError(t, err)
	assert.Equal(t, model.TaskStatusRunning, res.Status)
	assert.Equal(t, 40, res.Progress)

	status = "completed"
	res, err = a.PollTask(context.Background(), task)
	require.NoError(t, err)
	require.Equal(t, model.TaskStatusSucceeded, res.Status)
	assert.Equal(t, "images/task-1/base.webp", filepath.ToSlash(res.Assets[0].LocalPath))
	target := filepath.Join(t.TempDir(), res.Assets[0].LocalPath)
	require.NoError(t, a.DownloadAsset(context.Background(), res.Assets[0].RemoteURL, target))
	data, _ := os.ReadFile(target)
	assert.Equal(t, pngBytes, data)
}

func TestAPIMartAdapter_FailedTaskCarriesMessage(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, `{"code":200,"data":{"id":"t","status":"failed","error":{"code":400,"message":"内容违规"}}}`)
	}))
	defer srv.Close()

	a := NewAPIMartAdapter(ChannelConfig{BaseURL: srv.URL, APIKey: "k"})
	task := imageTask("apimart", "seedream-5-0-pro", `{}`)
	task.ProviderTaskID = "t"
	res, err := a.PollTask(context.Background(), task)
	require.NoError(t, err)
	assert.Equal(t, model.TaskStatusFailed, res.Status)
	assert.Equal(t, "内容违规", res.ErrorMessage)
	assert.Equal(t, 10*60, int(a.PollTimeout(task).Seconds()))
}

func TestChannelImageAdapters_RejectVideoTasks(t *testing.T) {
	task := imageTask("openai", "sora-2", `{}`)
	task.TaskType = "video_generation"
	for _, a := range []ProviderAdapter{
		NewOpenAIImageAdapter(ChannelConfig{APIKey: "k"}),
		NewGeminiImageAdapter(ChannelConfig{APIKey: "k"}),
	} {
		_, err := a.SubmitTask(context.Background(), task)
		assert.ErrorContains(t, err, "只支持生图任务", a.ProviderName())
	}
	// APIMart runs video, but only the Kling family so far.
	_, err := NewAPIMartAdapter(ChannelConfig{APIKey: "k"}).SubmitTask(context.Background(), task)
	assert.ErrorContains(t, err, "只接入了可灵")
}

func TestSyncResultLostAfterRestartFailsCleanly(t *testing.T) {
	a := NewOpenAIImageAdapter(ChannelConfig{APIKey: "k"})
	task := imageTask("openai", "gpt-image-2", `{}`)
	task.ProviderTaskID = "openai-img-missing"
	res, err := a.PollTask(context.Background(), task)
	require.NoError(t, err)
	assert.Equal(t, model.TaskStatusFailed, res.Status)
	assert.Equal(t, "ResultLost", res.ErrorCode)
}

// Relays (e.g. new-api) rewrite result links to their own host, e.g.
// https://relay/apimart/v1/tasks/<id>/content/0, and require the same key there.
func TestDownloadAsset_SendsKeyOnlyToChannelOrigin(t *testing.T) {
	relay := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer relay-key" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_, _ = w.Write(pngBytes)
	}))
	defer relay.Close()

	a := NewAPIMartAdapter(ChannelConfig{BaseURL: relay.URL + "/apimart/v1", APIKey: "relay-key"})
	target := filepath.Join(t.TempDir(), "base.png")
	require.NoError(t, a.DownloadAsset(context.Background(), relay.URL+"/apimart/v1/tasks/task_x/content/0", target))
	data, _ := os.ReadFile(target)
	assert.Equal(t, pngBytes, data)

	u, _ := url.Parse(relay.URL)
	assert.False(t, sameOrigin(relay.URL+"/v1", &url.URL{Scheme: u.Scheme, Host: "other.example.com"}))
	assert.False(t, sameOrigin("https://relay.example.com/v1", &url.URL{Scheme: "http", Host: "relay.example.com"}),
		"a scheme downgrade is not the same origin")
}

func TestNewProviderAdapter_BuildsByProtocolAndNamesInstance(t *testing.T) {
	a, ok := NewProviderAdapter(model.ProtocolOpenAICompatible, "relay-a", "http://relay/v1", "k", nil)
	require.True(t, ok)
	assert.IsType(t, &OpenAIImageAdapter{}, a)
	assert.Equal(t, "relay-a", a.ProviderName(), "the adapter is named after the provider it serves")

	task := imageTask("relay-a", "sora-2", `{}`)
	task.TaskType = "video_generation"
	_, err := a.SubmitTask(context.Background(), task)
	assert.ErrorContains(t, err, "relay-a 服务商目前只支持生图任务")

	g, ok := NewProviderAdapter(model.ProtocolGemini, "google", "", "k", nil)
	require.True(t, ok)
	assert.IsType(t, &GeminiImageAdapter{}, g)

	mj, ok := NewProviderAdapter(model.ProtocolMidjourney, "mj-relay", "http://relay", "k", nil)
	require.True(t, ok)
	assert.IsType(t, &MidjourneyAdapter{}, mj)
	assert.Equal(t, "mj-relay", mj.ProviderName())

	for _, p := range []model.Protocol{model.ProtocolKling, "unknown"} {
		_, ok := NewProviderAdapter(p, "x", "", "k", nil)
		assert.False(t, ok, p)
	}
}

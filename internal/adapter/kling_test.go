package adapter

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"media-workstage/internal/model"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fakeKling records the last submission and serves task lookups like api-beijing.klingai.com.
type fakeKling struct {
	srv       *httptest.Server
	path      string
	auth      string
	body      map[string]any
	tasksJSON string // data of GET /tasks
	imageJSON string // data of GET /v1/images/**/{id}
	imagePath string
}

func newFakeKling(t *testing.T) *fakeKling {
	f := &fakeKling{}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.auth = r.Header.Get("Authorization")
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/images/generations",
			r.Method == http.MethodPost && r.URL.Path == "/v1/images/omni-image":
			f.path = r.URL.Path
			f.body = map[string]any{}
			_ = json.NewDecoder(r.Body).Decode(&f.body)
			_, _ = io.WriteString(w, `{"code":0,"message":"SUCCEED","data":{"task_id":"img-1","task_status":"submitted"}}`)
		case r.Method == http.MethodPost:
			f.path = r.URL.Path
			f.body = map[string]any{}
			_ = json.NewDecoder(r.Body).Decode(&f.body)
			_, _ = io.WriteString(w, `{"code":0,"message":"","data":{"id":"vid-1","status":"submitted"}}`)
		case r.URL.Path == "/tasks":
			assert.Equal(t, "vid-1", r.URL.Query().Get("task_ids"))
			_, _ = io.WriteString(w, `{"code":0,"data":`+f.tasksJSON+`}`)
		default:
			f.imagePath = r.URL.Path
			_, _ = io.WriteString(w, `{"code":0,"data":`+f.imageJSON+`}`)
		}
	}))
	t.Cleanup(f.srv.Close)
	return f
}

func newKlingTask(taskType, modelID string, params map[string]any) *model.MediaTask {
	raw, _ := json.Marshal(params)
	return &model.MediaTask{ID: "t-1", Provider: "kling", Model: modelID, TaskType: taskType, Prompt: "a cat", ParamsJSON: string(raw)}
}

func settingsOf(t *testing.T, body map[string]any) map[string]any {
	t.Helper()
	s, ok := body["settings"].(map[string]any)
	require.True(t, ok, "body has no settings: %v", body)
	return s
}

func TestKlingTextToVideo(t *testing.T) {
	f := newFakeKling(t)
	a := NewKlingAdapter(ChannelConfig{BaseURL: f.srv.URL, APIKey: "key-1"})

	id, err := a.SubmitTask(context.Background(), newKlingTask("video_generation", "kling-3.0", map[string]any{
		"resolution": "4k", "duration": 10, "ratio": "9:16", "generate_audio": true,
	}))
	require.NoError(t, err)
	assert.Equal(t, "vid-1", id)
	assert.Equal(t, "/text-to-video/kling-3.0", f.path)
	assert.Equal(t, "Bearer key-1", f.auth)
	assert.Equal(t, "a cat", f.body["prompt"])
	s := settingsOf(t, f.body)
	assert.Equal(t, "4k", s["resolution"])
	assert.EqualValues(t, 10, s["duration"])
	assert.Equal(t, "9:16", s["aspect_ratio"])
	assert.Equal(t, "native", s["audio"])
	assert.Equal(t, false, s["multi_shot"])
}

func TestKlingMultiShotPromptSwitchesMultiShotOn(t *testing.T) {
	f := newFakeKling(t)
	a := NewKlingAdapter(ChannelConfig{BaseURL: f.srv.URL, APIKey: "k"})
	task := newKlingTask("video_generation", "kling-3.0", map[string]any{"duration": 6})
	task.Prompt = "镜头 1, 3, 海边; 镜头 2, 3, 日落;"
	_, err := a.SubmitTask(context.Background(), task)
	require.NoError(t, err)
	assert.Equal(t, true, settingsOf(t, f.body)["multi_shot"])
}

func TestKlingResolutionIsClampedPerModel(t *testing.T) {
	f := newFakeKling(t)
	a := NewKlingAdapter(ChannelConfig{BaseURL: f.srv.URL, APIKey: "k"})

	_, err := a.SubmitTask(context.Background(), newKlingTask("video_generation", "kling-2.6", map[string]any{"resolution": "4k"}))
	require.NoError(t, err)
	assert.Equal(t, "1080p", settingsOf(t, f.body)["resolution"])

	_, err = a.SubmitTask(context.Background(), newKlingTask("video_generation", "kling-3.0-turbo", map[string]any{"resolution": "4k", "generate_audio": true}))
	require.NoError(t, err)
	s := settingsOf(t, f.body)
	assert.Equal(t, "1080p", s["resolution"])
	assert.NotContains(t, s, "audio", "Turbo has no audio switch")
	assert.NotContains(t, s, "multi_shot")
}

func TestKlingImageToVideoUsesContents(t *testing.T) {
	f := newFakeKling(t)
	a := NewKlingAdapter(ChannelConfig{BaseURL: f.srv.URL, APIKey: "k"})

	_, err := a.SubmitTask(context.Background(), newKlingTask("video_generation", "kling-3.0", map[string]any{
		"ratio": "16:9",
		"reference_assets": []map[string]any{
			{"role": "last_frame", "url": "https://x/last.png"},
			{"role": "first_frame", "url": "https://x/first.png"},
		},
	}))
	require.NoError(t, err)
	assert.Equal(t, "/image-to-video/kling-3.0", f.path)
	contents := f.body["contents"].([]any)
	require.Len(t, contents, 3)
	assert.Equal(t, map[string]any{"type": "prompt", "text": "a cat"}, contents[0])
	assert.Equal(t, "first_frame", contents[1].(map[string]any)["type"])
	assert.Equal(t, "https://x/first.png", contents[1].(map[string]any)["url"])
	assert.Equal(t, "last_frame", contents[2].(map[string]any)["type"])
	assert.NotContains(t, settingsOf(t, f.body), "aspect_ratio", "the first frame decides the ratio")
}

func TestKlingLocalFrameIsSentAsBareBase64(t *testing.T) {
	f := newFakeKling(t)
	a := NewKlingAdapter(ChannelConfig{BaseURL: f.srv.URL, APIKey: "k"})
	path := filepath.Join(t.TempDir(), "frame.png")
	require.NoError(t, os.WriteFile(path, tinyPNG(), 0o644))

	_, err := a.SubmitTask(context.Background(), newKlingTask("video_generation", "kling-2.6", map[string]any{
		"reference_assets": []map[string]any{{"role": "first_frame", "local_path": path}},
	}))
	require.NoError(t, err)
	data := f.body["contents"].([]any)[1].(map[string]any)["url"].(string)
	assert.NotContains(t, data, "data:")
	assert.NotEmpty(t, data)
}

func TestKlingVideoRejectsUnsupportedInputs(t *testing.T) {
	a := NewKlingAdapter(ChannelConfig{BaseURL: "http://unused", APIKey: "k"})
	ctx := context.Background()

	_, err := a.SubmitTask(ctx, newKlingTask("video_generation", "kling-3.0", map[string]any{
		"reference_assets": []map[string]any{{"role": "reference_image", "url": "https://x/a.png"}},
	}))
	assert.ErrorContains(t, err, "多图参考")

	_, err = a.SubmitTask(ctx, newKlingTask("video_generation", "kling-3.0-turbo", map[string]any{
		"reference_assets": []map[string]any{
			{"role": "first_frame", "url": "https://x/a.png"}, {"role": "last_frame", "url": "https://x/b.png"},
		},
	}))
	assert.ErrorContains(t, err, "首帧")

	_, err = a.SubmitTask(ctx, newKlingTask("video_generation", "kling-3.0", map[string]any{
		"reference_assets": []map[string]any{{"role": "last_frame", "url": "https://x/b.png"}},
	}))
	assert.ErrorContains(t, err, "尾帧")

	_, err = a.SubmitTask(ctx, newKlingTask("video_generation", "kling-3.0", map[string]any{
		"reference_assets": []map[string]any{{"role": "reference_video", "url": "https://x/v.mp4"}},
	}))
	assert.ErrorContains(t, err, "参考视频")
}

func TestKlingOmniVideoReferences(t *testing.T) {
	f := newFakeKling(t)
	a := NewKlingAdapter(ChannelConfig{BaseURL: f.srv.URL, APIKey: "k"})
	task := newKlingTask("video_generation", "kling-3.0-omni", map[string]any{
		"resolution": "1080p", "duration": 5, "ratio": "16:9",
		"reference_assets": []map[string]any{
			{"role": "reference_image", "url": "https://x/a.png"},
			{"role": "reference_image", "url": "https://x/b.png"},
		},
	})
	task.Prompt = "图1 的人走向 图2"
	_, err := a.SubmitTask(context.Background(), task)
	require.NoError(t, err)

	assert.Equal(t, "/omni-video/kling-3.0-omni", f.path)
	contents := f.body["contents"].([]any)
	require.Len(t, contents, 3)
	assert.Equal(t, "@image_1 的人走向 @image_2", contents[0].(map[string]any)["text"])
	assert.Equal(t, "refer_image", contents[1].(map[string]any)["type"])
	assert.Equal(t, "image_2", contents[2].(map[string]any)["id"])
	s := settingsOf(t, f.body)
	assert.Equal(t, "16:9", s["aspect_ratio"], "Omni takes an aspect ratio alongside images")
	assert.Equal(t, "1080p", s["resolution"])
}

func TestKlingOmniReferenceVideo(t *testing.T) {
	f := newFakeKling(t)
	a := NewKlingAdapter(ChannelConfig{BaseURL: f.srv.URL, APIKey: "k"})
	run := func(referType string) {
		t.Helper()
		_, err := a.SubmitTask(context.Background(), newKlingTask("video_generation", "kling-3.0-omni", map[string]any{
			"duration": 5, "ratio": "16:9", "video_refer_type": referType,
			"reference_assets": []map[string]any{{"role": "reference_video", "url": "https://x/v.mp4"}},
		}))
		require.NoError(t, err)
	}

	run("") // default: the video is edited
	c := f.body["contents"].([]any)[1].(map[string]any)
	assert.Equal(t, "base_video", c["type"])
	s := settingsOf(t, f.body)
	assert.NotContains(t, s, "duration", "an edited video keeps its own length")
	assert.NotContains(t, s, "aspect_ratio")

	run("feature")
	assert.Equal(t, "feature_video", f.body["contents"].([]any)[1].(map[string]any)["type"])
	assert.EqualValues(t, 5, settingsOf(t, f.body)["duration"])

	_, err := a.SubmitTask(context.Background(), newKlingTask("video_generation", "kling-3.0-omni", map[string]any{
		"reference_assets": []map[string]any{{"role": "reference_video", "local_path": "x.mp4"}},
	}))
	assert.ErrorContains(t, err, "公网链接")
}

func TestKlingSubmitSurfacesBusinessErrors(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, `{"code":1301,"message":"content policy"}`)
	}))
	defer srv.Close()
	a := NewKlingAdapter(ChannelConfig{BaseURL: srv.URL, APIKey: "k"})
	_, err := a.SubmitTask(context.Background(), newKlingTask("video_generation", "kling-3.0", nil))
	assert.ErrorContains(t, err, "1301")
	assert.ErrorContains(t, err, "content policy")

	httpErr := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = io.WriteString(w, `{"code":1002,"message":"Authorization is invalid"}`)
	}))
	defer httpErr.Close()
	a = NewKlingAdapter(ChannelConfig{BaseURL: httpErr.URL, APIKey: "bad"})
	_, err = a.SubmitTask(context.Background(), newKlingTask("video_generation", "kling-3.0", nil))
	assert.ErrorContains(t, err, "Authorization is invalid")
}

func TestKlingPollVideo(t *testing.T) {
	f := newFakeKling(t)
	a := NewKlingAdapter(ChannelConfig{BaseURL: f.srv.URL, APIKey: "k"})
	task := newKlingTask("video_generation", "kling-3.0", nil)
	task.ProviderTaskID = "vid-1"

	f.tasksJSON = `[{"id":"vid-1","status":"submitted"}]`
	res, err := a.PollTask(context.Background(), task)
	require.NoError(t, err)
	assert.Equal(t, model.TaskStatusQueued, res.Status)

	f.tasksJSON = `[{"id":"vid-1","status":"processing"}]`
	res, _ = a.PollTask(context.Background(), task)
	assert.Equal(t, model.TaskStatusRunning, res.Status)

	f.tasksJSON = `[{"id":"vid-1","status":"succeeded","outputs":[{"type":"video","url":"https://cdn/v.mp4","duration":"5.1"}]}]`
	res, err = a.PollTask(context.Background(), task)
	require.NoError(t, err)
	assert.Equal(t, model.TaskStatusSucceeded, res.Status)
	assert.Equal(t, "https://cdn/v.mp4", res.ResultURL)
	assert.InDelta(t, 5.1, res.OutputDurationSec, 0.001)
	require.Len(t, res.Assets, 1)
	assert.Equal(t, "video", res.Assets[0].Kind)
	assert.Equal(t, "videos/t-1/output.mp4", res.Assets[0].LocalPath)

	f.tasksJSON = `[{"id":"vid-1","status":"failed","message":"触发内容安全"}]`
	res, _ = a.PollTask(context.Background(), task)
	assert.Equal(t, model.TaskStatusFailed, res.Status)
	assert.Equal(t, "触发内容安全", res.ErrorMessage)

	f.tasksJSON = `[{"id":"vid-1","status":"succeeded","outputs":[]}]`
	res, _ = a.PollTask(context.Background(), task)
	assert.Equal(t, model.TaskStatusFailed, res.Status)
	assert.Equal(t, "EmptyResult", res.ErrorCode)
}

func TestKlingImageV3(t *testing.T) {
	f := newFakeKling(t)
	a := NewKlingAdapter(ChannelConfig{BaseURL: f.srv.URL, APIKey: "k"})

	id, err := a.SubmitTask(context.Background(), newKlingTask("image_generation", "kling-v3", map[string]any{
		"aspect_ratio": "3:4", "resolution": "4K",
		"reference_assets": []map[string]any{{"role": "reference_image", "url": "https://x/ref.png"}},
	}))
	require.NoError(t, err)
	assert.Equal(t, "img-1", id)
	assert.Equal(t, "/v1/images/generations", f.path)
	assert.Equal(t, "kling-v3", f.body["model_name"])
	assert.Equal(t, "3:4", f.body["aspect_ratio"])
	assert.Equal(t, "2k", f.body["resolution"], "kling-v3 tops out at 2k")
	assert.Equal(t, "https://x/ref.png", f.body["image"])

	_, err = a.SubmitTask(context.Background(), newKlingTask("image_generation", "kling-v3", map[string]any{
		"reference_assets": []map[string]any{{"url": "https://x/1.png"}, {"url": "https://x/2.png"}},
	}))
	assert.ErrorContains(t, err, "kling-v3-omni")
}

func TestKlingImageOmni(t *testing.T) {
	f := newFakeKling(t)
	a := NewKlingAdapter(ChannelConfig{BaseURL: f.srv.URL, APIKey: "k"})

	task := newKlingTask("image_generation", "kling-v3-omni", map[string]any{
		"resolution":       "4K",
		"reference_assets": []map[string]any{{"url": "https://x/1.png"}, {"url": "https://x/2.png"}},
	})
	task.Prompt = "把图1 的人放进 图2"
	_, err := a.SubmitTask(context.Background(), task)
	require.NoError(t, err)
	assert.Equal(t, "/v1/images/omni-image", f.path)
	assert.Equal(t, "4k", f.body["resolution"])
	assert.Equal(t, "把<<<image_1>>> 的人放进 <<<image_2>>>", f.body["prompt"])
	assert.Equal(t, []any{map[string]any{"image": "https://x/1.png"}, map[string]any{"image": "https://x/2.png"}}, f.body["image_list"])

	_, err = a.SubmitTask(context.Background(), newKlingTask("image_generation", "kling-image-o1", nil))
	require.NoError(t, err)
	assert.Equal(t, "/v1/images/omni-image", f.path)
}

func TestKlingPollImage(t *testing.T) {
	f := newFakeKling(t)
	a := NewKlingAdapter(ChannelConfig{BaseURL: f.srv.URL, APIKey: "k"})
	task := newKlingTask("image_generation", "kling-v3", nil)
	task.ProviderTaskID = "img-1"

	f.imageJSON = `{"task_status":"processing"}`
	res, err := a.PollTask(context.Background(), task)
	require.NoError(t, err)
	assert.Equal(t, model.TaskStatusRunning, res.Status)
	assert.Equal(t, "/v1/images/generations/img-1", f.imagePath)

	f.imageJSON = `{"task_status":"succeed","task_result":{"images":[{"url":"https://cdn/a.png"},{"url":"https://cdn/b.png"}]}}`
	res, err = a.PollTask(context.Background(), task)
	require.NoError(t, err)
	assert.Equal(t, model.TaskStatusSucceeded, res.Status)
	require.Len(t, res.Assets, 2)
	assert.Equal(t, "image_base", res.Assets[0].Kind)
	assert.Equal(t, "image_frame", res.Assets[1].Kind)

	omni := newKlingTask("image_generation", "kling-v3-omni", nil)
	omni.ProviderTaskID = "img-1"
	f.imageJSON = `{"task_status":"failed","task_status_msg":"blocked"}`
	res, _ = a.PollTask(context.Background(), omni)
	assert.Equal(t, "/v1/images/omni-image/img-1", f.imagePath)
	assert.Equal(t, model.TaskStatusFailed, res.Status)
	assert.Equal(t, "blocked", res.ErrorMessage)
}

func TestKlingAdapterIsBuiltForKlingProtocol(t *testing.T) {
	a, ok := NewProviderAdapter(model.ProtocolKling, "kling", "", "key", nil)
	require.True(t, ok)
	cfg, ok := a.(ConfigurableAdapter)
	require.True(t, ok)
	assert.Equal(t, "https://api-beijing.klingai.com", cfg.GetConfig().BaseURL)
	assert.True(t, cfg.GetConfig().IsConfigured)
}

func tinyPNG() []byte {
	var buf bytes.Buffer
	img := image.NewRGBA(image.Rect(0, 0, 2, 2))
	_ = png.Encode(&buf, img)
	return buf.Bytes()
}

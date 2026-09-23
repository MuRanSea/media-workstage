package adapter

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

	"media-workstage/internal/model"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fakeAPIMart records video submissions and serves uploads/tasks like APIMart or a relay.
type fakeAPIMart struct {
	srv          *httptest.Server
	submitted    map[string]any
	uploadStatus int // 0 accepts uploads; e.g. 404 mimics a relay without the endpoint
	videoBody    string
}

func newFakeAPIMart(t *testing.T) *fakeAPIMart {
	f := &fakeAPIMart{}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/uploads/images":
			if f.uploadStatus != 0 {
				w.WriteHeader(f.uploadStatus)
				_, _ = io.WriteString(w, `{"error":{"message":"Invalid URL (POST /v1/uploads/images)"}}`)
				return
			}
			require.NoError(t, r.ParseMultipartForm(1<<20))
			_, hdr, err := r.FormFile("file")
			require.NoError(t, err)
			assert.Equal(t, "image/png", hdr.Header.Get("Content-Type"))
			_, _ = io.WriteString(w, `{"url":"https://upload.apimart.ai/f/image/`+hdr.Filename+`"}`)
		case "/v1/videos/generations":
			f.submitted = map[string]any{}
			_ = json.NewDecoder(r.Body).Decode(&f.submitted)
			_, _ = io.WriteString(w, `{"code":200,"data":[{"status":"submitted","task_id":"task_vid"}]}`)
		case "/v1/tasks/task_vid":
			_, _ = io.WriteString(w, f.videoBody)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(f.srv.Close)
	return f
}

func videoTask(modelID string, params map[string]any) *model.MediaTask {
	raw, _ := json.Marshal(params)
	return &model.MediaTask{
		ID:         "vt-1",
		Provider:   "apimart",
		Model:      modelID,
		TaskType:   "video_generation",
		Prompt:     "图1 里的猫转身看向镜头",
		ParamsJSON: string(raw),
	}
}

func localPNG(t *testing.T, name string) string {
	p := filepath.Join(t.TempDir(), name)
	require.NoError(t, os.WriteFile(p, pngBytes, 0644))
	return p
}

func TestAPIMartKling_FamiliesMapCardParams(t *testing.T) {
	first := localPNG(t, "first.png")
	last := localPNG(t, "last.png")
	frames := []model.ReferenceItem{
		{Role: "last_frame", Label: "图2", LocalPath: last},
		{Role: "first_frame", Label: "图1", LocalPath: first},
	}

	cases := []struct {
		name  string
		model string
		refs  []model.ReferenceItem
		res   string
		check func(t *testing.T, body map[string]any)
	}{
		{"v3 first+last frames", "kling-v3", frames, "1080p", func(t *testing.T, b map[string]any) {
			assert.Equal(t, "pro", b["mode"])
			assert.Equal(t, []any{
				"https://upload.apimart.ai/f/image/first.png",
				"https://upload.apimart.ai/f/image/last.png",
			}, b["image_urls"], "first frame must come first")
			assert.NotContains(t, b, "aspect_ratio", "adaptive ratio is left to the frames")
			assert.Equal(t, true, b["audio"])
		}},
		{"3.0 turbo first frame", "kling-3.0-turbo", frames[1:], "1080p", func(t *testing.T, b map[string]any) {
			assert.Equal(t, "1080p", b["resolution"])
			assert.Equal(t, "https://upload.apimart.ai/f/image/first.png", b["first_frame_image"])
			assert.NotContains(t, b, "mode")
			assert.NotContains(t, b, "audio")
		}},
		{"v3 omni reference", "kling-v3-omni", []model.ReferenceItem{
			{Role: "reference_image", Label: "图1", LocalPath: first},
		}, "4k", func(t *testing.T, b map[string]any) {
			assert.Equal(t, "4k", b["mode"])
			assert.Equal(t, []any{map[string]any{"url": "https://upload.apimart.ai/f/image/first.png", "role": "reference"}}, b["image_with_roles"])
			assert.Equal(t, "<<<image_1>>> 里的猫转身看向镜头", b["prompt"])
		}},
		{"text to video", "kling-v2-6", nil, "720p", func(t *testing.T, b map[string]any) {
			assert.Equal(t, "std", b["mode"])
			assert.Equal(t, "16:9", b["aspect_ratio"])
			assert.NotContains(t, b, "image_urls")
		}},
		{"MiniMax-H3 reference image", "MiniMax-H3", []model.ReferenceItem{
			{Role: "reference_image", Label: "图1", LocalPath: first},
		}, "2K", func(t *testing.T, b map[string]any) {
			assert.Equal(t, "2K", b["resolution"])
			assert.Equal(t, "16:9", b["aspect_ratio"], "reference mode may keep an explicit ratio")
			assert.Equal(t, []any{map[string]any{"url": "https://upload.apimart.ai/f/image/first.png", "role": "reference_image"}}, b["image_with_roles"])
			assert.Equal(t, "图1 里的猫转身看向镜头", b["prompt"], "H3 takes the prompt as written")
			assert.NotContains(t, b, "mode")
			assert.NotContains(t, b, "audio")
		}},
		{"MiniMax-H3 first+last frames", "MiniMax-H3", frames, "768P", func(t *testing.T, b map[string]any) {
			assert.Equal(t, "768P", b["resolution"])
			assert.NotContains(t, b, "aspect_ratio", "frames decide the ratio")
			roles := []string{}
			for _, img := range b["image_with_roles"].([]any) {
				roles = append(roles, img.(map[string]any)["role"].(string))
			}
			assert.ElementsMatch(t, []string{"first_frame", "last_frame"}, roles)
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newFakeAPIMart(t)
			a := NewAPIMartAdapter(ChannelConfig{BaseURL: f.srv.URL + "/v1", APIKey: "k"})
			ratio := "16:9"
			if len(tc.refs) > 0 && tc.refs[0].Role != "reference_image" {
				ratio = "adaptive"
			}
			id, err := a.SubmitTask(context.Background(), videoTask(tc.model, map[string]any{
				"resolution": tc.res, "duration": 5, "ratio": ratio, "generate_audio": true,
				"reference_assets": tc.refs,
			}))
			require.NoError(t, err)
			assert.Equal(t, "task_vid", id)
			assert.Equal(t, tc.model, f.submitted["model"])
			assert.EqualValues(t, 5, f.submitted["duration"])
			tc.check(t, f.submitted)
		})
	}
}

func TestAPIMartKling_RejectsUnsupportedReferenceModes(t *testing.T) {
	a := NewAPIMartAdapter(ChannelConfig{BaseURL: "http://unused", APIKey: "k"})
	_, err := a.SubmitTask(context.Background(), videoTask("kling-v3", map[string]any{
		"reference_assets": []model.ReferenceItem{{Role: "reference_image", LocalPath: "x.png"}},
	}))
	assert.ErrorContains(t, err, "不支持多图参考")

	_, err = a.SubmitTask(context.Background(), videoTask("kling-3.0-turbo", map[string]any{
		"reference_assets": []model.ReferenceItem{{Role: "first_frame"}, {Role: "last_frame"}},
	}))
	assert.ErrorContains(t, err, "只支持首帧图")
}

// Relays that do not forward /uploads/images: fall back to the image's original public
// URL, then base64, and stop retrying the upload endpoint.
func TestAPIMartReferenceFallbackWhenUploadUnsupported(t *testing.T) {
	f := newFakeAPIMart(t)
	f.uploadStatus = http.StatusNotFound
	a := NewAPIMartAdapter(ChannelConfig{BaseURL: f.srv.URL + "/v1", APIKey: "k"})
	img := localPNG(t, "ref.png")

	_, err := a.SubmitTask(context.Background(), videoTask("kling-v3", map[string]any{
		"ratio": "adaptive",
		"reference_assets": []model.ReferenceItem{
			{Role: "first_frame", LocalPath: img, RemoteURL: "https://ark-cdn.example.com/signed/base.png"},
			{Role: "last_frame", LocalPath: img},
		},
	}))
	require.NoError(t, err)
	urls := f.submitted["image_urls"].([]any)
	assert.Equal(t, "https://ark-cdn.example.com/signed/base.png", urls[0])
	assert.True(t, strings.HasPrefix(urls[1].(string), "data:image/png;base64,"))
	assert.True(t, a.uploadUnsupported.Load())
}

func TestAPIMartReferenceUploadAuthErrorIsReported(t *testing.T) {
	f := newFakeAPIMart(t)
	f.uploadStatus = http.StatusUnauthorized
	a := NewAPIMartAdapter(ChannelConfig{BaseURL: f.srv.URL + "/v1", APIKey: "k"})
	_, err := a.SubmitTask(context.Background(), videoTask("kling-v3", map[string]any{
		"reference_assets": []model.ReferenceItem{{Role: "first_frame", Label: "图1", LocalPath: localPNG(t, "a.png")}},
	}))
	assert.ErrorContains(t, err, "上传参考图 图1 失败")
}

func TestAPIMartVideoPoll_ReadsVideosInEitherURLShape(t *testing.T) {
	for _, body := range []string{
		`{"code":200,"data":{"status":"completed","result":{"videos":[{"url":["https://cdn/v.mp4"]}]}}}`,
		`{"code":200,"data":{"status":"completed","result":{"videos":[{"url":"https://cdn/v.mp4"}]}}}`,
	} {
		f := newFakeAPIMart(t)
		f.videoBody = body
		a := NewAPIMartAdapter(ChannelConfig{BaseURL: f.srv.URL + "/v1", APIKey: "k"})
		task := videoTask("kling-v3", nil)
		task.ProviderTaskID = "task_vid"
		res, err := a.PollTask(context.Background(), task)
		require.NoError(t, err)
		require.Equal(t, model.TaskStatusSucceeded, res.Status, body)
		require.Len(t, res.Assets, 1)
		assert.Equal(t, "video", res.Assets[0].Kind)
		assert.Equal(t, "https://cdn/v.mp4", res.Assets[0].RemoteURL)
		assert.Equal(t, "videos/vt-1/output.mp4", res.Assets[0].LocalPath)
	}
	assert.Equal(t, 30*60, int(NewAPIMartAdapter(ChannelConfig{}).PollTimeout(videoTask("kling-v3", nil)).Seconds()))
}

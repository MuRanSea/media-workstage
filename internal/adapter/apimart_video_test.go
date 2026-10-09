package adapter

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"image"
	"image/color"
	"image/png"
	"math/rand/v2"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

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
	// The relay platform's file store (/api/files/upload): 0 serves 404 like a plain APIMart
	// origin; 200 hands out links.
	filesStatus  int
	filesUploads int
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
		case "/api/files/upload":
			if f.filesStatus == 0 {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			if f.filesStatus != http.StatusOK {
				w.WriteHeader(f.filesStatus)
				_, _ = io.WriteString(w, `{"success":false,"error":{"code":"GatewayAccessDenied","message":"Asset access denied"}}`)
				return
			}
			require.NoError(t, r.ParseMultipartForm(32<<20))
			_, hdr, err := r.FormFile("file")
			require.NoError(t, err)
			f.filesUploads++
			_, _ = io.WriteString(w, `{"success":true,"data":{"file_url":"https://tos.example.com/`+hdr.Filename+`","expires_at":`+
				strconv.FormatInt(time.Now().Add(7*24*time.Hour).Unix(), 10)+`}}`)
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

// Kling Omni takes its reference video in video_list (default: the video to edit, never
// keeping its sound, which relays reject); MiniMax-H3 takes plain URLs in video_urls.
// Neither puts it in the image list.
func TestAPIMartVideo_ReferenceVideo(t *testing.T) {
	f := newFakeAPIMart(t)
	a := NewAPIMartAdapter(ChannelConfig{BaseURL: f.srv.URL + "/v1", APIKey: "k"})
	video := model.ReferenceItem{Role: "reference_video", Label: "动作", URL: "https://tos.example/m.mp4?sig=1"}

	edit := videoTask("kling-v3-omni", map[string]any{
		"generate_audio":   true,
		"duration":         5,
		"ratio":            "16:9",
		"reference_assets": []model.ReferenceItem{{Role: "reference_image", URL: "https://x/a.png"}, video},
	})
	edit.Prompt = "视频1 里的猫换成 图1"
	_, err := a.SubmitTask(context.Background(), edit)
	require.NoError(t, err)
	assert.Equal(t, []any{map[string]any{
		"video_url":           "https://tos.example/m.mp4?sig=1",
		"refer_type":          "base",
		"keep_original_sound": "no",
	}}, f.submitted["video_list"])
	assert.NotContains(t, f.submitted, "video_urls")
	// Only <<<image_N>>> is a prompt reference; the one video is named in words.
	assert.Equal(t, "参考视频 里的猫换成 <<<image_1>>>", f.submitted["prompt"])
	assert.Equal(t, []any{map[string]any{"url": "https://x/a.png", "role": "reference"}}, f.submitted["image_with_roles"])
	assert.NotContains(t, f.submitted, "audio", "a reference video rules out any audio field")
	assert.NotContains(t, f.submitted, "multi_shot", "base and feature each need their own default")
	// An edited video keeps the source's length and shape.
	assert.NotContains(t, f.submitted, "duration")
	assert.NotContains(t, f.submitted, "aspect_ratio")

	// A feature reference takes at most one image, as the first frame in image_urls.
	feature := videoTask("kling-v3-omni", map[string]any{
		"duration":         5,
		"ratio":            "9:16",
		"video_refer_type": "feature",
		"reference_assets": []model.ReferenceItem{{Role: "reference_image", URL: "https://x/a.png"}, video},
	})
	feature.Prompt = "图1 里的人按 视频1 的动作走路"
	_, err = a.SubmitTask(context.Background(), feature)
	require.NoError(t, err)
	assert.Equal(t, []any{map[string]any{
		"video_url":           "https://tos.example/m.mp4?sig=1",
		"refer_type":          "feature",
		"keep_original_sound": "no",
	}}, f.submitted["video_list"])
	assert.Equal(t, []any{"https://x/a.png"}, f.submitted["image_urls"])
	assert.NotContains(t, f.submitted, "image_with_roles")
	assert.Equal(t, "<<<image_1>>> 里的人按 参考视频 的动作走路", f.submitted["prompt"])
	assert.EqualValues(t, 5, f.submitted["duration"])
	assert.Equal(t, "9:16", f.submitted["aspect_ratio"])

	_, err = a.SubmitTask(context.Background(), videoTask("MiniMax-H3", map[string]any{
		"reference_assets": []model.ReferenceItem{video},
	}))
	require.NoError(t, err)
	assert.Equal(t, []any{"https://tos.example/m.mp4?sig=1"}, f.submitted["video_urls"])
	assert.NotContains(t, f.submitted, "image_with_roles")
}

func TestAPIMartVideo_ReferenceVideoRules(t *testing.T) {
	a := NewAPIMartAdapter(ChannelConfig{BaseURL: "http://unused", APIKey: "k"})
	video := model.ReferenceItem{Role: "reference_video", Label: "动作", URL: "https://tos.example/m.mp4"}
	images := func(n int) []model.ReferenceItem {
		refs := []model.ReferenceItem{video}
		for i := range n {
			refs = append(refs, model.ReferenceItem{Role: "reference_image", URL: fmt.Sprintf("https://x/%d.png", i)})
		}
		return refs
	}

	_, err := a.SubmitTask(context.Background(), videoTask("kling-v3", map[string]any{"reference_assets": []model.ReferenceItem{video}}))
	assert.ErrorContains(t, err, "不支持参考视频")

	_, err = a.SubmitTask(context.Background(), videoTask("kling-v3-omni", map[string]any{"reference_assets": []model.ReferenceItem{video, video}}))
	assert.ErrorContains(t, err, "最多 1 个参考视频")

	_, err = a.SubmitTask(context.Background(), videoTask("kling-v3-omni", map[string]any{"reference_assets": images(5)}))
	assert.ErrorContains(t, err, "最多 4 张参考图")

	_, err = a.SubmitTask(context.Background(), videoTask("kling-v3-omni", map[string]any{"video_refer_type": "feature", "reference_assets": images(2)}))
	assert.ErrorContains(t, err, "最多带 1 张图")

	local := model.ReferenceItem{Role: "reference_video", Label: "动作", LocalPath: "m.mp4"}
	_, err = a.SubmitTask(context.Background(), videoTask("kling-v3-omni", map[string]any{"reference_assets": []model.ReferenceItem{local}}))
	assert.ErrorContains(t, err, "公网链接")
}

// A relay without /uploads/images but with its own file store (「获取链接」) gets links
// from the store, and a second run reuses them instead of uploading again.
func TestAPIMartReferenceUsesPlatformFileStore(t *testing.T) {
	f := newFakeAPIMart(t)
	f.uploadStatus = http.StatusNotFound
	f.filesStatus = http.StatusOK
	a := NewAPIMartAdapter(ChannelConfig{BaseURL: f.srv.URL + "/apimart/v1", APIKey: "k"})
	img := localPNG(t, "gemini.png")
	task := videoTask("kling-v3", map[string]any{
		"ratio":            "adaptive",
		"reference_assets": []model.ReferenceItem{{Role: "first_frame", LocalPath: img}},
	})
	f.srv.Config.Handler = rewritePrefix("/apimart", f.srv.Config.Handler)

	for range 2 {
		_, err := a.SubmitTask(context.Background(), task)
		require.NoError(t, err)
		assert.Equal(t, []any{"https://tos.example.com/gemini.png"}, f.submitted["image_urls"])
	}
	assert.Equal(t, 1, f.filesUploads, "the link is reused while it is valid")
}

// When nothing can host the image, a big one is shrunk to fit APIMart's inline limit
// instead of failing with "media request exceeds 4 MiB".
func TestAPIMartReferenceShrinksLargeInlineImage(t *testing.T) {
	f := newFakeAPIMart(t)
	f.uploadStatus = http.StatusNotFound
	a := NewAPIMartAdapter(ChannelConfig{BaseURL: f.srv.URL + "/v1", APIKey: "k"})
	big := noisePNG(t, 1600, 1200)
	info, err := os.Stat(big)
	require.NoError(t, err)
	require.Greater(t, info.Size(), int64(apimartInlineLimit), "the fixture must be over the limit")

	_, err = a.SubmitTask(context.Background(), videoTask("kling-v3", map[string]any{
		"ratio":            "adaptive",
		"reference_assets": []model.ReferenceItem{{Role: "first_frame", LocalPath: big}},
	}))
	require.NoError(t, err)
	u := f.submitted["image_urls"].([]any)[0].(string)
	assert.True(t, strings.HasPrefix(u, "data:image/jpeg;base64,"))
	assert.LessOrEqual(t, len(u), apimartInlineLimit)
}

// A file store that refuses the key does not block generation when the image fits inline.
func TestAPIMartReferenceFileStoreErrorFallsBackToInline(t *testing.T) {
	f := newFakeAPIMart(t)
	f.uploadStatus = http.StatusNotFound
	f.filesStatus = http.StatusForbidden
	a := NewAPIMartAdapter(ChannelConfig{BaseURL: f.srv.URL + "/v1", APIKey: "k"})
	_, err := a.SubmitTask(context.Background(), videoTask("kling-v3", map[string]any{
		"ratio":            "adaptive",
		"reference_assets": []model.ReferenceItem{{Role: "first_frame", LocalPath: localPNG(t, "s.png")}},
	}))
	require.NoError(t, err)
	assert.True(t, strings.HasPrefix(f.submitted["image_urls"].([]any)[0].(string), "data:image/png;base64,"))
}

func TestEncodeImageWithinKeepsSmallFilesUntouched(t *testing.T) {
	p := localPNG(t, "small.png")
	uri, err := EncodeImageWithin(p, 1<<20)
	require.NoError(t, err)
	assert.Equal(t, dataURI("image/png", pngBytes), uri)
}

// noisePNG writes an incompressible PNG, so it is several MiB.
func noisePNG(t *testing.T, w, h int) string {
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	rng := rand.New(rand.NewPCG(1, 2))
	for i := range img.Pix {
		img.Pix[i] = uint8(rng.UintN(256))
	}
	for y := range h {
		for x := range w {
			c := img.NRGBAAt(x, y)
			img.SetNRGBA(x, y, color.NRGBA{R: c.R, G: c.G, B: c.B, A: 255})
		}
	}
	p := filepath.Join(t.TempDir(), "big.png")
	out, err := os.Create(p)
	require.NoError(t, err)
	require.NoError(t, png.Encode(out, img))
	require.NoError(t, out.Close())
	return p
}

// rewritePrefix serves /<prefix>/v1/... like /v1/..., for relays that mount APIMart under a path.
func rewritePrefix(prefix string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.URL.Path = strings.TrimPrefix(r.URL.Path, prefix)
		next.ServeHTTP(w, r)
	})
}

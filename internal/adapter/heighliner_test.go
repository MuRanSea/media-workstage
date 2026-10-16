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
	"sync"
	"testing"
	"time"

	"media-workstage/internal/model"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fakeGateway records what a Heighliner client sends and answers from per-test handlers.
type fakeGateway struct {
	t   *testing.T
	srv *httptest.Server

	mu          sync.Mutex
	submits     []map[string]any
	idemKeys    []string
	submitPaths []string
	uploads     int
	uploadForms []string
	downloads   []string // Authorization header seen per artifact download

	onSubmit func(w http.ResponseWriter, n int)
	onTask   func(w http.ResponseWriter, n int)
	polls    int
}

func newFakeGateway(t *testing.T) *fakeGateway {
	g := &fakeGateway{t: t}
	g.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		g.mu.Lock()
		defer g.mu.Unlock()
		switch {
		case strings.HasPrefix(r.URL.Path, "/media/v1/tasks/") && strings.Contains(r.URL.Path, "/artifacts/"):
			g.downloads = append(g.downloads, r.Header.Get("Authorization"))
			_, _ = io.WriteString(w, "artifact:"+r.URL.Path)
			return
		case r.URL.Path == "/upstream/video.mp4":
			g.downloads = append(g.downloads, r.Header.Get("Authorization"))
			_, _ = io.WriteString(w, "mp4")
			return
		}
		if r.Header.Get("Authorization") != "Bearer hl" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch {
		case r.URL.Path == "/media/v1/files":
			require.NoError(t, r.ParseMultipartForm(1<<20))
			g.uploads++
			g.uploadForms = append(g.uploadForms, r.FormValue("purpose"))
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"id": "file_" + string(rune('0'+g.uploads)), "object": "media.file", "status": "ready",
				"expires_at": time.Now().Add(7 * 24 * time.Hour).Unix(),
			})
		case strings.HasSuffix(r.URL.Path, "/generations"):
			var body map[string]any
			require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
			g.submits = append(g.submits, body)
			g.idemKeys = append(g.idemKeys, r.Header.Get("Idempotency-Key"))
			g.submitPaths = append(g.submitPaths, r.URL.Path)
			if g.onSubmit != nil {
				g.onSubmit(w, len(g.submits))
				return
			}
			w.WriteHeader(http.StatusAccepted)
			_, _ = io.WriteString(w, `{"id":"task_1","object":"media.task","status":"queued"}`)
		case strings.HasPrefix(r.URL.Path, "/media/v1/tasks/"):
			g.polls++
			g.onTask(w, g.polls)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(g.srv.Close)
	return g
}

func (g *fakeGateway) adapter() *HeighlinerAdapter {
	a := NewHeighlinerAdapter(ChannelConfig{ProviderID: "hl-1", BaseURL: g.srv.URL + "/", APIKey: "hl"})
	a.sleep = func(context.Context, time.Duration) error { return nil }
	return a
}

func paramsJSON(t *testing.T, v any) string {
	b, err := json.Marshal(v)
	require.NoError(t, err)
	return string(b)
}

func TestHeighliner_SubmitSendsCompiledFieldsWithIdempotencyKey(t *testing.T) {
	g := newFakeGateway(t)
	a := g.adapter()
	task := &model.MediaTask{
		ID: "local-1", Model: "doubao-seedream-5-0-lite-260128", TaskType: "image_generation", Prompt: "蓝色陶瓷杯",
		ParamsJSON: paramsJSON(t, map[string]any{
			"parameters":       map[string]any{"n": 2, "resolution": "2K", "aspect_ratio": "1:1", "seed": nil},
			"provider_options": map[string]any{"volcengine": map[string]any{"watermark": false}},
		}),
	}
	id, err := a.SubmitTask(context.Background(), task)
	require.NoError(t, err)
	assert.Equal(t, "task_1", id)

	require.Len(t, g.submits, 1)
	assert.Equal(t, "/media/v1/images/generations", g.submitPaths[0])
	assert.Equal(t, "local-1", g.idemKeys[0])
	assert.Equal(t, map[string]any{
		"model": "doubao-seedream-5-0-lite-260128", "prompt": "蓝色陶瓷杯",
		"n": float64(2), "resolution": "2K", "aspect_ratio": "1:1",
		"provider_options": map[string]any{"volcengine": map[string]any{"watermark": false}},
		"wait":             float64(0),
	}, g.submits[0], "only compiled fields, no nulls, no references")

	// A restart resubmits with the same key, so the gateway replays the original task.
	_, err = a.SubmitTask(context.Background(), task)
	require.NoError(t, err)
	assert.Equal(t, []string{"local-1", "local-1"}, g.idemKeys)
}

func TestHeighliner_SubmitPathsAndEmptyPrompt(t *testing.T) {
	g := newFakeGateway(t)
	a := g.adapter()
	for _, tc := range []struct{ taskType, path string }{
		{"video_generation", "/media/v1/videos/generations"},
		{"3d_generation", "/media/v1/3d/generations"},
	} {
		_, err := a.SubmitTask(context.Background(), &model.MediaTask{ID: "t", Model: "m", TaskType: tc.taskType,
			ParamsJSON: paramsJSON(t, map[string]any{"reference_assets": []map[string]any{
				{"role": "reference", "type": "image", "url": "https://files.example.com/cat.png"},
			}})})
		require.NoError(t, err)
		assert.Equal(t, tc.path, g.submitPaths[len(g.submitPaths)-1])
		body := g.submits[len(g.submits)-1]
		assert.NotContains(t, body, "prompt", "an empty prompt is left out")
		assert.Equal(t, []any{map[string]any{"role": "reference", "type": "image", "url": "https://files.example.com/cat.png"}}, body["references"])
	}
	_, err := a.SubmitTask(context.Background(), &model.MediaTask{ID: "t", Model: "m", TaskType: "audio_generation"})
	assert.Error(t, err)
}

func TestHeighliner_ReferencesUploadOnceAndUseAssetIDs(t *testing.T) {
	g := newFakeGateway(t)
	a := g.adapter()
	dir := t.TempDir()
	img := filepath.Join(dir, "front.png")
	vid := filepath.Join(dir, "clip.mp4")
	require.NoError(t, os.WriteFile(img, []byte("png"), 0644))
	require.NoError(t, os.WriteFile(vid, []byte("mp4"), 0644))

	task := &model.MediaTask{ID: "v1", Model: "doubao-seedance-2-5-260628", TaskType: "video_generation", Prompt: "p",
		ParamsJSON: paramsJSON(t, map[string]any{"reference_assets": []model.ReferenceItem{
			{Role: "reference", Type: "image", LocalPath: img, Label: "图1"},
			{Role: "reference", LocalPath: vid, Label: "视频1"},
			{Role: "voice", Type: "audio", URL: "asset://asset-voice-9", Label: "voice"},
		}})}
	_, err := a.SubmitTask(context.Background(), task)
	require.NoError(t, err)
	assert.Equal(t, []any{
		map[string]any{"role": "reference", "type": "image", "file_id": "file_1"},
		map[string]any{"role": "reference", "type": "video", "file_id": "file_2"},
		map[string]any{"role": "voice", "type": "audio", "asset_id": "asset-voice-9"},
	}, g.submits[0]["references"])
	assert.Equal(t, []string{"reference", "reference"}, g.uploadForms)

	// Same files again: no new uploads.
	_, err = a.SubmitTask(context.Background(), task)
	require.NoError(t, err)
	assert.Equal(t, 2, g.uploads)

	// Once a cached file is near expiry it is uploaded again.
	a.filesMu.Lock()
	for k, f := range a.files {
		f.expires = time.Now().Add(-time.Minute)
		a.files[k] = f
	}
	a.filesMu.Unlock()
	_, err = a.SubmitTask(context.Background(), task)
	require.NoError(t, err)
	assert.Equal(t, 4, g.uploads)

	// A changed file is a new upload.
	require.NoError(t, os.WriteFile(img, []byte("png, edited"), 0644))
	_, err = a.SubmitTask(context.Background(), task)
	require.NoError(t, err)
	assert.Equal(t, 5, g.uploads)
}

func TestHeighliner_ExpiredFileIsUploadedAgainOnce(t *testing.T) {
	g := newFakeGateway(t)
	a := g.adapter()
	img := filepath.Join(t.TempDir(), "a.png")
	require.NoError(t, os.WriteFile(img, []byte("png"), 0644))
	g.onSubmit = func(w http.ResponseWriter, n int) {
		if n == 2 {
			w.WriteHeader(http.StatusGone)
			_, _ = io.WriteString(w, `{"error":{"code":"file_expired","message":"reference file expired","stage":"validation","retryable":false}}`)
			return
		}
		_, _ = io.WriteString(w, `{"id":"task_ok"}`)
	}
	task := &model.MediaTask{ID: "x", Model: "m", TaskType: "image_generation", Prompt: "p",
		ParamsJSON: paramsJSON(t, map[string]any{"reference_assets": []model.ReferenceItem{{Role: "reference", LocalPath: img}}})}
	_, err := a.SubmitTask(context.Background(), task)
	require.NoError(t, err)
	id, err := a.SubmitTask(context.Background(), task)
	require.NoError(t, err)
	assert.Equal(t, "task_ok", id)
	assert.Equal(t, 2, g.uploads)
	assert.Equal(t, []string{"x", "x", "x-reupload"}, g.idemKeys,
		"the body names a new file, so the resubmission must not reuse the key")
}

func TestHeighliner_SubmitErrorsKeepGatewayCodeAndMessage(t *testing.T) {
	g := newFakeGateway(t)
	a := g.adapter()
	g.onSubmit = func(w http.ResponseWriter, _ int) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = io.WriteString(w, `{"error":{"code":"unsupported_parameter","message":"field seed is not declared for this model","stage":"validation","retryable":false}}`)
	}
	_, err := a.SubmitTask(context.Background(), &model.MediaTask{ID: "e", Model: "m", TaskType: "image_generation", Prompt: "p"})
	require.Error(t, err)
	assert.Equal(t, "unsupported_parameter: field seed is not declared for this model", err.Error())
	assert.Len(t, g.submits, 1, "a 400 is not retried")
}

func TestHeighliner_SubmitBacksOffOnRateLimit(t *testing.T) {
	g := newFakeGateway(t)
	a := g.adapter()
	var waits []time.Duration
	a.sleep = func(_ context.Context, d time.Duration) error { waits = append(waits, d); return nil }
	g.onSubmit = func(w http.ResponseWriter, n int) {
		switch n {
		case 1:
			w.Header().Set("Retry-After", "3")
			w.WriteHeader(http.StatusTooManyRequests)
			_, _ = io.WriteString(w, `{"error":{"code":"rate_limited","message":"slow down"}}`)
		case 2:
			w.Header().Set("Retry-After", "1")
			w.WriteHeader(http.StatusConflict)
			_, _ = io.WriteString(w, `{"error":{"code":"idempotency_in_progress","message":"still accepting"}}`)
		default:
			_, _ = io.WriteString(w, `{"id":"task_after_wait"}`)
		}
	}
	id, err := a.SubmitTask(context.Background(), &model.MediaTask{ID: "rl", Model: "m", TaskType: "video_generation", Prompt: "p"})
	require.NoError(t, err)
	assert.Equal(t, "task_after_wait", id)
	assert.Equal(t, []time.Duration{3 * time.Second, time.Second}, waits)
	assert.Equal(t, []string{"rl", "rl", "rl"}, g.idemKeys)
}

func TestHeighliner_PollKeepsWaitingWhileReconcilingOrPending(t *testing.T) {
	g := newFakeGateway(t)
	a := g.adapter()
	g.onTask = func(w http.ResponseWriter, n int) {
		switch n {
		case 1:
			_, _ = io.WriteString(w, `{"id":"task_1","status":"reconciling","progress":0}`)
		case 2:
			_, _ = io.WriteString(w, `{"id":"task_1","status":"running","progress":40}`)
		case 3:
			_, _ = io.WriteString(w, `{"id":"task_1","status":"succeeded","progress":100,"artifacts":[
				{"index":0,"kind":"video","state":"pending","url":null},
				{"index":1,"kind":"last_frame","state":"available","url":"https://cdn.example.com/last.png"}]}`)
		default:
			_, _ = io.WriteString(w, `{"id":"task_1","status":"succeeded","progress":100,"artifacts":[
				{"index":0,"kind":"video","mime_type":"video/mp4","state":"available","url":"https://cdn.example.com/v.mp4","url_type":"upstream"},
				{"index":1,"kind":"last_frame","state":"available","url":"https://cdn.example.com/last.png"},
				{"index":2,"kind":"audio","state":"available","url":"https://cdn.example.com/a.mp3"}],
				"billing":{"status":"settled","currency":"CNY","amount":"1.200000"}}`)
		}
	}
	task := &model.MediaTask{ID: "vid", ProviderTaskID: "task_1", TaskType: "video_generation"}

	res, err := a.PollTask(context.Background(), task)
	require.NoError(t, err)
	assert.Equal(t, model.TaskStatusRunning, res.Status)
	res, err = a.PollTask(context.Background(), task)
	require.NoError(t, err)
	assert.Equal(t, PollResult{Status: model.TaskStatusRunning, Progress: 40}, *res)
	res, err = a.PollTask(context.Background(), task)
	require.NoError(t, err)
	assert.Equal(t, model.TaskStatusRunning, res.Status, "a pending video is not a failure")

	res, err = a.PollTask(context.Background(), task)
	require.NoError(t, err)
	require.Equal(t, model.TaskStatusSucceeded, res.Status)
	require.Len(t, res.Assets, 2, "audio is not a result; a returned last frame goes with the video")
	assert.Equal(t, "video", res.Assets[0].Kind)
	assert.Equal(t, "videos/vid/output.mp4", res.Assets[0].LocalPath)
	assert.Equal(t, "image_frame", res.Assets[1].Kind)
	assert.Equal(t, "videos/vid/last_frame.png", res.Assets[1].LocalPath)
	assert.JSONEq(t, `{"status":"settled","currency":"CNY","amount":"1.200000"}`, res.BillingDetailsJSON)
}

func TestHeighliner_ImageTaskYieldsOneAssetPerImage(t *testing.T) {
	g := newFakeGateway(t)
	a := g.adapter()
	g.onTask = func(w http.ResponseWriter, _ int) {
		_, _ = io.WriteString(w, `{"status":"succeeded","artifacts":[
			{"index":0,"kind":"image","mime_type":"image/png","state":"available","url":"https://cdn.example.com/0"},
			{"index":1,"kind":"image","mime_type":"image/jpeg","state":"available","url":"https://cdn.example.com/1"}]}`)
	}
	res, err := a.PollTask(context.Background(), &model.MediaTask{ID: "img", ProviderTaskID: "task_1", TaskType: "image_generation"})
	require.NoError(t, err)
	require.Len(t, res.Assets, 2)
	assert.Equal(t, "images/img/base.png", res.Assets[0].LocalPath)
	assert.Equal(t, "images/img/image_01.jpg", res.Assets[1].LocalPath)
}

func TestHeighliner_3DTaskKeepsModelsPreviewAndCoverAndDownloadsWithoutKey(t *testing.T) {
	g := newFakeGateway(t)
	a := g.adapter()
	g.onTask = func(w http.ResponseWriter, _ int) {
		_, _ = io.WriteString(w, `{"status":"succeeded","type":"3d","artifacts":[
			{"index":0,"kind":"image","mime_type":"image/png","state":"available","url":"/media/v1/tasks/task_1/artifacts/0?expires=9&sig=a","url_type":"signed"},
			{"index":1,"kind":"model3d","mime_type":"model/gltf-binary","state":"available","url":"/media/v1/tasks/task_1/artifacts/1?expires=9&sig=b","url_type":"signed","expires_at":1792000000},
			{"index":2,"kind":"model3d","mime_type":"application/octet-stream","format":"fbx","state":"available","url":"/media/v1/tasks/task_1/artifacts/2?expires=9&sig=c","url_type":"signed"},
			{"index":3,"kind":"cover","mime_type":"image/png","state":"available","url":"/media/v1/tasks/task_1/artifacts/3?expires=9&sig=d","url_type":"signed"},
			{"index":4,"kind":"video","mime_type":"video/mp4","state":"available","url":"/media/v1/tasks/task_1/artifacts/4?expires=9&sig=e","url_type":"signed"}],
			"billing":{"status":"reconciling","currency":"CNY","amount":null}}`)
	}
	res, err := a.PollTask(context.Background(), &model.MediaTask{ID: "m3", ProviderTaskID: "task_1", TaskType: "3d_generation"})
	require.NoError(t, err)
	require.Equal(t, model.TaskStatusSucceeded, res.Status)
	var got [][2]string
	for _, as := range res.Assets {
		got = append(got, [2]string{as.Kind, as.LocalPath})
	}
	assert.Equal(t, [][2]string{
		{"model3d", "models/m3/model_00.glb"},
		{"model3d", "models/m3/model_01.fbx"},
		{"cover", "models/m3/cover_02.png"},
		{"video", "models/m3/preview_03.mp4"},
	}, got, "the echoed reference image is dropped")
	assert.Equal(t, g.srv.URL+"/media/v1/tasks/task_1/artifacts/1?expires=9&sig=b", res.Assets[0].RemoteURL)

	dir := t.TempDir()
	for _, as := range res.Assets {
		require.NoError(t, a.DownloadAsset(context.Background(), as.RemoteURL, filepath.Join(dir, as.LocalPath)))
	}
	data, err := os.ReadFile(filepath.Join(dir, "models/m3/model_00.glb"))
	require.NoError(t, err)
	assert.Equal(t, "artifact:/media/v1/tasks/task_1/artifacts/1", string(data))
	assert.Equal(t, []string{"", "", "", ""}, g.downloads, "signed links are fetched without the key")
}

func TestHeighliner_FailedTaskCarriesGatewayError(t *testing.T) {
	g := newFakeGateway(t)
	a := g.adapter()
	g.onTask = func(w http.ResponseWriter, _ int) {
		_, _ = io.WriteString(w, `{"status":"failed","error":{"code":"provider_rejected","message":"内容审核未通过","stage":"generation","retryable":false},
			"billing":{"status":"released","currency":"CNY","amount":null}}`)
	}
	res, err := a.PollTask(context.Background(), &model.MediaTask{ID: "f", ProviderTaskID: "task_1", TaskType: "image_generation"})
	require.NoError(t, err)
	assert.Equal(t, model.TaskStatusFailed, res.Status)
	assert.Equal(t, "provider_rejected", res.ErrorCode)
	assert.Equal(t, "provider_rejected: 内容审核未通过", res.ErrorMessage)
	assert.Contains(t, res.BillingDetailsJSON, "released")
}

func TestHeighliner_PollRespectsRetryAfter(t *testing.T) {
	g := newFakeGateway(t)
	a := g.adapter()
	g.onTask = func(w http.ResponseWriter, _ int) {
		w.Header().Set("Retry-After", "120")
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = io.WriteString(w, `{"error":{"code":"rate_limited","message":"slow down"}}`)
	}
	task := &model.MediaTask{ID: "p", ProviderTaskID: "task_1", TaskType: "video_generation", Progress: 30}
	res, err := a.PollTask(context.Background(), task)
	require.NoError(t, err)
	assert.Equal(t, PollResult{Status: model.TaskStatusRunning, Progress: 30}, *res)
	_, err = a.PollTask(context.Background(), task)
	require.NoError(t, err)
	assert.Equal(t, 1, g.polls, "no request until Retry-After has passed")
}

func TestHeighliner_PollFailsOnUnreadableTask(t *testing.T) {
	g := newFakeGateway(t)
	a := g.adapter()
	g.onTask = func(w http.ResponseWriter, _ int) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = io.WriteString(w, `{"error":{"code":"task_not_found","message":"task not found"}}`)
	}
	res, err := a.PollTask(context.Background(), &model.MediaTask{ID: "nf", ProviderTaskID: "gone", TaskType: "3d_generation"})
	require.NoError(t, err)
	assert.Equal(t, model.TaskStatusFailed, res.Status)
	assert.Equal(t, "task_not_found", res.ErrorCode)
}

func TestHeighliner_UpstreamDownloadsNeverCarryTheKey(t *testing.T) {
	g := newFakeGateway(t)
	a := g.adapter()
	target := filepath.Join(t.TempDir(), "v.mp4")
	require.NoError(t, a.DownloadAsset(context.Background(), g.srv.URL+"/upstream/video.mp4", target))
	assert.Equal(t, []string{""}, g.downloads)
}

func TestHeighliner_PollTimeout(t *testing.T) {
	a := NewHeighlinerAdapter(ChannelConfig{})
	assert.Equal(t, 30*time.Minute, a.PollTimeout(&model.MediaTask{TaskType: "image_generation"}))
	assert.Zero(t, a.PollTimeout(&model.MediaTask{TaskType: "3d_generation"}))
	ad, ok := NewProviderAdapter(model.ProtocolHeighliner, "hl-1", "https://platform.sgt.site", "k", nil)
	require.True(t, ok)
	assert.Equal(t, "hl-1", ad.ProviderName())
}

func TestRenameSniffedModel(t *testing.T) {
	dir := t.TempDir()
	write := func(name, content string) string {
		p := filepath.Join(dir, name)
		require.NoError(t, os.WriteFile(p, []byte(content), 0644))
		return p
	}

	// A GLB the gateway did not name gets its extension back.
	glb := write("model_00.bin", "glTF\x02\x00\x00\x00rest")
	renamed := RenameSniffedModel(glb)
	assert.Equal(t, filepath.Join(dir, "model_00.glb"), renamed)
	assert.FileExists(t, renamed)
	assert.NoFileExists(t, glb)

	// A ZIP (an OBJ or FBX with its textures) and a binary FBX are named too.
	zip := write("model_01.bin", "PK\x03\x04zip")
	assert.Equal(t, filepath.Join(dir, "model_01.zip"), RenameSniffedModel(zip))
	fbx := write("model_03.bin", "Kaydara FBX Binary  \x00\x1a\x00")
	assert.Equal(t, filepath.Join(dir, "model_03.fbx"), RenameSniffedModel(fbx))

	// Unknown bytes (an OBJ is plain text), and files that already have a real extension,
	// stay as they are.
	other := write("model_04.bin", "v 0 0 0\n")
	assert.Equal(t, other, RenameSniffedModel(other))
	named := write("model_02.fbx", "glTF")
	assert.Equal(t, named, RenameSniffedModel(named))
	assert.Equal(t, filepath.Join(dir, "missing.bin"), RenameSniffedModel(filepath.Join(dir, "missing.bin")))
}

func TestHeighliner_SampleSubmitPassesDraftOptionThrough(t *testing.T) {
	g := newFakeGateway(t)
	a := g.adapter()
	task := &model.MediaTask{ID: "s1", Model: "doubao-seedance-2-5-260628", TaskType: "video_generation", Prompt: "蓝色杯子",
		ParamsJSON: paramsJSON(t, map[string]any{
			"parameters":       map[string]any{"resolution": "480p", "duration": 4, "generate_audio": false},
			"provider_options": map[string]any{"volcengine": map[string]any{"draft": true}},
		})}
	_, err := a.SubmitTask(context.Background(), task)
	require.NoError(t, err)
	assert.Equal(t, map[string]any{
		"model": "doubao-seedance-2-5-260628", "prompt": "蓝色杯子", "resolution": "480p", "duration": float64(4), "generate_audio": false,
		"provider_options": map[string]any{"volcengine": map[string]any{"draft": true}},
		"wait":             float64(0),
	}, g.submits[0])
}

func TestHeighliner_FinalizeSendsOnlyDraftTaskAndOutputSettings(t *testing.T) {
	g := newFakeGateway(t)
	a := g.adapter()
	task := &model.MediaTask{ID: "f1", Model: "doubao-seedance-2-5-260628", TaskType: "video_generation", Prompt: "蓝色杯子",
		ParamsJSON: paramsJSON(t, map[string]any{
			"parameters":              map[string]any{"resolution": "1080p", "duration": 4, "prompt": "ignored"},
			"provider_options":        map[string]any{"volcengine": map[string]any{"return_last_frame": true, "draft": true, "other": 1}},
			"action_id":               HeighlinerActionFinalize,
			"source_task_id":          "local-sample",
			"source_provider_task_id": "task_sample",
		})}
	_, err := a.SubmitTask(context.Background(), task)
	require.NoError(t, err)
	assert.Equal(t, "/media/v1/videos/generations", g.submitPaths[0])
	assert.Equal(t, "f1", g.idemKeys[0], "a new local task is a new, explicit generation")
	assert.Equal(t, map[string]any{
		"model": "doubao-seedance-2-5-260628", "resolution": "1080p",
		"provider_options": map[string]any{"volcengine": map[string]any{"draft_task_id": "task_sample", "return_last_frame": true}},
		"wait":             float64(0),
	}, g.submits[0], "prompt, duration and the like are inherited from the sample and must not be sent again")

	task.ParamsJSON = paramsJSON(t, map[string]any{"action_id": HeighlinerActionFinalize})
	_, err = a.SubmitTask(context.Background(), task)
	assert.Error(t, err, "without the sample's gateway task ID there is nothing to build on")
}

func TestHeighliner_SucceededSampleOffersFinalize(t *testing.T) {
	g := newFakeGateway(t)
	a := g.adapter()
	g.onTask = func(w http.ResponseWriter, n int) {
		stage := `"generation_stage":"draft",`
		if n == 2 {
			stage = ""
		}
		if n == 3 {
			stage = `"generation_stage":"final","source_task_id":"task_sample",`
		}
		_, _ = io.WriteString(w, `{"id":"task_1",`+stage+`"status":"succeeded","artifacts":[
			{"index":0,"kind":"video","mime_type":"video/mp4","state":"available","url":"https://cdn.example.com/v.mp4"}]}`)
	}
	finalize := []model.ResultAction{{ID: HeighlinerActionFinalize, Label: "生成正式视频"}}

	res, err := a.PollTask(context.Background(), &model.MediaTask{ID: "a", ProviderTaskID: "task_1", TaskType: "video_generation"})
	require.NoError(t, err)
	assert.Equal(t, finalize, res.ResultActions, "the gateway says it is a sample")

	sampleParams := paramsJSON(t, map[string]any{"provider_options": map[string]any{"volcengine": map[string]any{"draft": true}}})
	res, err = a.PollTask(context.Background(), &model.MediaTask{ID: "b", ProviderTaskID: "task_1", TaskType: "video_generation", ParamsJSON: sampleParams})
	require.NoError(t, err)
	assert.Equal(t, finalize, res.ResultActions, "no stage reported: fall back to what the card asked for")

	res, err = a.PollTask(context.Background(), &model.MediaTask{ID: "c", ProviderTaskID: "task_1", TaskType: "video_generation", ParamsJSON: sampleParams})
	require.NoError(t, err)
	assert.Empty(t, res.ResultActions, "a final video offers no further finalize")
}

func TestHeighliner_SucceededWithUnreadableResultKeepsPolling(t *testing.T) {
	g := newFakeGateway(t)
	a := g.adapter()
	g.onTask = func(w http.ResponseWriter, n int) {
		if n == 1 {
			_, _ = io.WriteString(w, `{"id":"task_1","status":"succeeded","artifacts":[],
				"error":{"code":"provider_unavailable","message":"result temporarily unreadable","stage":"delivery","retryable":true}}`)
			return
		}
		_, _ = io.WriteString(w, `{"id":"task_1","status":"succeeded","artifacts":[
			{"index":0,"kind":"video","state":"available","url":"https://cdn.example.com/v.mp4"}]}`)
	}
	task := &model.MediaTask{ID: "vid", ProviderTaskID: "task_1", TaskType: "video_generation"}
	res, err := a.PollTask(context.Background(), task)
	require.NoError(t, err)
	assert.Equal(t, model.TaskStatusRunning, res.Status, "ask again later, never regenerate")
	res, err = a.PollTask(context.Background(), task)
	require.NoError(t, err)
	assert.Equal(t, model.TaskStatusSucceeded, res.Status)
}

func TestHeighliner_SubmitReplaysTimeoutsAnd5xxWithTheSameKey(t *testing.T) {
	g := newFakeGateway(t)
	a := g.adapter()
	g.onSubmit = func(w http.ResponseWriter, n int) {
		switch n {
		case 1:
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = io.WriteString(w, `{"error":{"code":"provider_unavailable","message":"try later","stage":"submission","retryable":true}}`)
		case 2:
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = io.WriteString(w, `{"error":{"code":"internal_error","message":"boom","stage":"submission","retryable":false}}`)
		default:
			_, _ = io.WriteString(w, `{"id":"task_replayed"}`)
		}
	}
	id, err := a.SubmitTask(context.Background(), &model.MediaTask{ID: "k1", Model: "m", TaskType: "video_generation", Prompt: "p"})
	require.NoError(t, err)
	assert.Equal(t, "task_replayed", id)
	assert.Equal(t, []string{"k1", "k1", "k1"}, g.idemKeys)
	assert.Equal(t, g.submits[0], g.submits[2], "a replay sends the very same body")
}

func TestHeighliner_SubmitNeverReplaysARejection(t *testing.T) {
	for _, tc := range []struct {
		status int
		body   string
	}{
		{http.StatusBadGateway, `{"error":{"code":"provider_rejected","message":"content policy","stage":"submission","retryable":false}}`},
		{http.StatusConflict, `{"error":{"code":"idempotency_conflict","message":"key used with a different request"}}`},
		{http.StatusPaymentRequired, `{"error":{"code":"insufficient_budget","message":"no budget"}}`},
	} {
		g := newFakeGateway(t)
		a := g.adapter()
		g.onSubmit = func(w http.ResponseWriter, _ int) {
			w.WriteHeader(tc.status)
			_, _ = io.WriteString(w, tc.body)
		}
		_, err := a.SubmitTask(context.Background(), &model.MediaTask{ID: "k", Model: "m", TaskType: "image_generation", Prompt: "p"})
		require.Error(t, err)
		assert.Len(t, g.submits, 1, tc.body)
	}
}

func TestHeighliner_SubmitReplaysAfterABrokenConnection(t *testing.T) {
	g := newFakeGateway(t)
	a := g.adapter()
	g.onSubmit = func(w http.ResponseWriter, n int) {
		if n == 1 {
			// The gateway took the request but the answer never arrived.
			hj, ok := w.(http.Hijacker)
			require.True(t, ok)
			conn, _, err := hj.Hijack()
			require.NoError(t, err)
			_ = conn.Close()
			return
		}
		_, _ = io.WriteString(w, `{"id":"task_original"}`)
	}
	id, err := a.SubmitTask(context.Background(), &model.MediaTask{ID: "net", Model: "m", TaskType: "image_generation", Prompt: "p"})
	require.NoError(t, err)
	assert.Equal(t, "task_original", id)
	assert.Equal(t, []string{"net", "net"}, g.idemKeys)
}

func TestHeighliner_SucceededTaskWaitsForEveryArtifactWithinTheGrace(t *testing.T) {
	g := newFakeGateway(t)
	a := g.adapter()
	clock := time.Unix(1_800_000_000, 0)
	a.now = func() time.Time { return clock }
	g.onTask = func(w http.ResponseWriter, _ int) {
		_, _ = io.WriteString(w, `{"id":"task_1","status":"succeeded","artifacts":[
			{"index":0,"kind":"image","mime_type":"image/png","state":"available","url":"https://cdn.example.com/0"},
			{"index":1,"kind":"image","mime_type":"image/png","state":"unavailable","url":null,
			 "error":{"code":"provider_unavailable","message":"upstream file not readable","stage":"delivery","retryable":true}},
			{"index":2,"kind":"image","mime_type":"image/png","state":"archiving","url":"https://cdn.example.com/2"},
			{"index":3,"kind":"image","mime_type":"image/png","state":"available","url":""}]}`)
	}
	task := &model.MediaTask{ID: "img", ProviderTaskID: "task_1", TaskType: "image_generation"}
	res, err := a.PollTask(context.Background(), task)
	require.NoError(t, err)
	assert.Equal(t, model.TaskStatusRunning, res.Status, "unavailable, unknown states and empty URLs are not readable yet")

	clock = clock.Add(heighlinerDeliveryGrace - time.Second)
	res, err = a.PollTask(context.Background(), task)
	require.NoError(t, err)
	assert.Equal(t, model.TaskStatusRunning, res.Status)

	clock = clock.Add(2 * time.Second)
	res, err = a.PollTask(context.Background(), task)
	require.NoError(t, err)
	require.Equal(t, model.TaskStatusSucceeded, res.Status, "past the grace, what is readable is delivered")
	require.Len(t, res.Assets, 1)
	assert.Equal(t, "https://cdn.example.com/0", res.Assets[0].RemoteURL)
}

func TestHeighliner_SucceededTaskWithNothingReadableFailsWithItsGatewayID(t *testing.T) {
	g := newFakeGateway(t)
	a := g.adapter()
	clock := time.Unix(1_800_000_000, 0)
	a.now = func() time.Time { return clock }
	g.onTask = func(w http.ResponseWriter, _ int) {
		_, _ = io.WriteString(w, `{"id":"task_lost","status":"succeeded","artifacts":[],
			"error":{"code":"provider_unavailable","message":"Generation succeeded but the output is not yet readable","stage":"delivery","retryable":true}}`)
	}
	task := &model.MediaTask{ID: "vid", ProviderTaskID: "task_lost", TaskType: "video_generation"}
	res, err := a.PollTask(context.Background(), task)
	require.NoError(t, err)
	assert.Equal(t, model.TaskStatusRunning, res.Status, "an empty success is asked again, not taken as final")

	clock = clock.Add(heighlinerDeliveryGrace)
	res, err = a.PollTask(context.Background(), task)
	require.NoError(t, err)
	assert.Equal(t, model.TaskStatusFailed, res.Status)
	assert.Equal(t, "provider_unavailable", res.ErrorCode)
	assert.Contains(t, res.ErrorMessage, "task_lost")
	assert.Contains(t, res.ErrorMessage, "不要重新生成")
}

func TestHeighliner_VideoKeepsItsContainerAndReturnedLastFrame(t *testing.T) {
	g := newFakeGateway(t)
	a := g.adapter()
	g.onTask = func(w http.ResponseWriter, _ int) {
		_, _ = io.WriteString(w, `{"id":"task_1","status":"succeeded","artifacts":[
			{"index":0,"kind":"last_frame","mime_type":"image/jpeg","state":"available","url":"https://cdn.example.com/last"},
			{"index":1,"kind":"video","mime_type":"video/quicktime","state":"available","url":"https://cdn.example.com/v"}]}`)
	}
	res, err := a.PollTask(context.Background(), &model.MediaTask{ID: "mov", ProviderTaskID: "task_1", TaskType: "video_generation"})
	require.NoError(t, err)
	require.Len(t, res.Assets, 2)
	assert.Equal(t, "videos/mov/output.mov", res.Assets[0].LocalPath, "a MOV is not renamed to MP4")
	assert.Equal(t, "https://cdn.example.com/v", res.ResultURL, "the video comes first, whatever its index")
	assert.Equal(t, model.TaskAsset{AssetIndex: 1, Kind: "image_frame", Name: "last_frame.jpg",
		RemoteURL: "https://cdn.example.com/last", LocalPath: "videos/mov/last_frame.jpg"}, res.Assets[1])
}

func TestHeighliner_RetryDeliveryPacesAndRunsOut(t *testing.T) {
	g := newFakeGateway(t)
	a := g.adapter()
	clock := time.Unix(1_800_000_000, 0)
	a.now = func() time.Time { return clock }
	g.onTask = func(w http.ResponseWriter, _ int) {
		_, _ = io.WriteString(w, `{"id":"task_1","status":"succeeded","artifacts":[
			{"index":0,"kind":"image","mime_type":"image/png","state":"available","url":"https://cdn.example.com/0"}]}`)
	}
	task := &model.MediaTask{ID: "dl", ProviderTaskID: "task_1", TaskType: "image_generation"}
	for i := 0; i < heighlinerRedownloads; i++ {
		require.True(t, a.RetryDelivery(task))
		polls := g.polls
		res, err := a.PollTask(context.Background(), task)
		require.NoError(t, err)
		assert.Equal(t, model.TaskStatusRunning, res.Status, "the next query waits a little")
		assert.Equal(t, polls, g.polls)
		clock = clock.Add(time.Duration(i+1) * 10 * time.Second)
		res, err = a.PollTask(context.Background(), task)
		require.NoError(t, err)
		assert.Equal(t, model.TaskStatusSucceeded, res.Status, "then fresh links are fetched")
	}
	assert.False(t, a.RetryDelivery(task), "after a few rounds the poller settles with what it has")
}

func TestHeighliner_PollInterval(t *testing.T) {
	a := NewHeighlinerAdapter(ChannelConfig{})
	assert.Equal(t, 3*time.Second, a.PollInterval(&model.MediaTask{TaskType: "image_generation"}))
	assert.Equal(t, 5*time.Second, a.PollInterval(&model.MediaTask{TaskType: "video_generation"}))
	assert.Equal(t, 8*time.Second, a.PollInterval(&model.MediaTask{TaskType: "3d_generation"}))
}

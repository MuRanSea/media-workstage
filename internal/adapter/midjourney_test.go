package adapter

import (
	"context"
	"encoding/json"
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

func TestMidjourneyAdapter_SubmitThenPollLifecycle(t *testing.T) {
	var submitted map[string]any
	status, progress := "IN_PROGRESS", "45%"
	var srvURL string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/mj/submit/imagine":
			assert.Equal(t, "Bearer mj-key", r.Header.Get("Authorization"))
			assert.Equal(t, "mj-key", r.Header.Get("mj-api-secret"))
			_ = json.NewDecoder(r.Body).Decode(&submitted)
			// new-api returns the task ID as a bare number.
			_, _ = io.WriteString(w, `{"code":1,"description":"提交成功","properties":{},"result":1320098173412546}`)
		case r.Method == http.MethodGet && r.URL.Path == "/mj/task/1320098173412546/fetch":
			assert.Equal(t, "Bearer mj-key", r.Header.Get("Authorization"))
			resp := map[string]any{"id": "1320098173412546", "action": "IMAGINE", "status": status, "progress": progress}
			if status == "SUCCESS" {
				resp["imageUrl"] = srvURL + "/mj/image/1320098173412546.png"
			}
			_ = json.NewEncoder(w).Encode(resp)
		case r.URL.Path == "/mj/image/1320098173412546.png":
			_, _ = w.Write(pngBytes)
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()
	srvURL = srv.URL

	a := NewMidjourneyAdapter(ChannelConfig{ProviderID: "midjourney", BaseURL: srv.URL + "/", APIKey: "mj-key"})
	task := imageTask("midjourney", "NIJI_JOURNEY", `{"aspect_ratio":"16:9","resolution":"2K"}`)
	id, err := a.SubmitTask(context.Background(), task)
	require.NoError(t, err)
	assert.Equal(t, "1320098173412546", id)
	assert.Equal(t, "NIJI_JOURNEY", submitted["botType"])
	assert.Equal(t, "a red fox --ar 16:9", submitted["prompt"])
	task.ProviderTaskID = id

	res, err := a.PollTask(context.Background(), task)
	require.NoError(t, err)
	assert.Equal(t, model.TaskStatusRunning, res.Status)
	assert.Equal(t, 45, res.Progress)

	status, progress = "SUCCESS", "100%"
	res, err = a.PollTask(context.Background(), task)
	require.NoError(t, err)
	require.Equal(t, model.TaskStatusSucceeded, res.Status)
	require.Len(t, res.Assets, 1, "the 2x2 grid is kept as a single image")
	assert.Equal(t, "images/task-1/base.png", filepath.ToSlash(res.Assets[0].LocalPath))
	target := filepath.Join(t.TempDir(), res.Assets[0].LocalPath)
	require.NoError(t, a.DownloadAsset(context.Background(), res.Assets[0].RemoteURL, target))
	data, _ := os.ReadFile(target)
	assert.Equal(t, pngBytes, data)
}

func TestMidjourneyPrompt_CardRatioYieldsToPromptParams(t *testing.T) {
	cases := []struct{ prompt, ratio, want string }{
		{"a red fox", "16:9", "a red fox --ar 16:9"},
		{"a red fox --ar 2:3 --v 7", "16:9", "a red fox --ar 2:3 --v 7"},
		{"a red fox --aspect 3:2", "1:1", "a red fox --aspect 3:2"},
		{"a red fox --v 7", "1:1", "a red fox --v 7 --ar 1:1"},
		{"a red fox", "", "a red fox"},
		{"a red fox ", "auto", "a red fox"},
		// Midjourney also takes an em dash, which autocorrect produces from "--".
		{"a red fox —ar 9:16", "16:9", "a red fox —ar 9:16"},
		// "--art" is not an aspect flag.
		{"--artistic fox", "4:3", "--artistic fox --ar 4:3"},
	}
	for _, c := range cases {
		params, _ := json.Marshal(map[string]string{"aspect_ratio": c.ratio})
		assert.Equal(t, c.want, midjourneyPrompt(c.prompt, parseGenericImageParams(string(params))), c.prompt)
	}
}

func TestMidjourneyAdapter_OnlyBotTypesAreSentAsBotType(t *testing.T) {
	var submitted map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		submitted = nil
		_ = json.NewDecoder(r.Body).Decode(&submitted)
		_, _ = io.WriteString(w, `{"code":1,"result":"1"}`)
	}))
	defer srv.Close()

	a := NewMidjourneyAdapter(ChannelConfig{BaseURL: srv.URL, APIKey: "k"})
	// new-api lists its billing model names (mj_imagine, ...); those leave the bot to the default.
	_, err := a.SubmitTask(context.Background(), imageTask("midjourney", "mj_imagine", `{}`))
	require.NoError(t, err)
	assert.NotContains(t, submitted, "botType")

	_, err = a.SubmitTask(context.Background(), imageTask("midjourney", "niji_journey", `{}`))
	require.NoError(t, err)
	assert.Equal(t, "NIJI_JOURNEY", submitted["botType"])
}

func TestMidjourneyAdapter_SubmitRejectionCarriesDescription(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, `{"code":24,"description":"可能包含敏感词","result":null}`)
	}))
	defer srv.Close()

	a := NewMidjourneyAdapter(ChannelConfig{BaseURL: srv.URL, APIKey: "k"})
	_, err := a.SubmitTask(context.Background(), imageTask("midjourney", "MID_JOURNEY", `{}`))
	assert.ErrorContains(t, err, "可能包含敏感词")
}

func TestMidjourneyAdapter_QueuedSubmitStillReturnsTask(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, `{"code":22,"description":"排队中","result":"1720000000000001"}`)
	}))
	defer srv.Close()

	a := NewMidjourneyAdapter(ChannelConfig{BaseURL: srv.URL, APIKey: "k"})
	id, err := a.SubmitTask(context.Background(), imageTask("midjourney", "MID_JOURNEY", `{}`))
	require.NoError(t, err)
	assert.Equal(t, "1720000000000001", id)
}

func TestMidjourneyAdapter_FailedAndCancelledTasks(t *testing.T) {
	status, reason := "FAILURE", "Banned prompt detected"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"id": "t", "status": status, "failReason": reason, "progress": "0%"})
	}))
	defer srv.Close()

	a := NewMidjourneyAdapter(ChannelConfig{BaseURL: srv.URL, APIKey: "k"})
	task := imageTask("midjourney", "MID_JOURNEY", `{}`)
	task.ProviderTaskID = "t"
	res, err := a.PollTask(context.Background(), task)
	require.NoError(t, err)
	assert.Equal(t, model.TaskStatusFailed, res.Status)
	assert.Equal(t, "Banned prompt detected", res.ErrorMessage)

	status, reason = "CANCEL", ""
	res, err = a.PollTask(context.Background(), task)
	require.NoError(t, err)
	assert.Equal(t, model.TaskStatusFailed, res.Status)
	assert.NotEmpty(t, res.ErrorMessage)
}

func TestMidjourneyAdapter_RejectsVideoTasks(t *testing.T) {
	task := imageTask("midjourney", "MID_JOURNEY", `{}`)
	task.TaskType = "video_generation"
	_, err := NewMidjourneyAdapter(ChannelConfig{APIKey: "k"}).SubmitTask(context.Background(), task)
	assert.ErrorContains(t, err, "只支持生图任务")
}

func TestMidjourneyAdapter_HTTPErrorCarriesDescription(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = io.WriteString(w, `{"code":401,"description":"无效的令牌","result":null}`)
	}))
	defer srv.Close()

	a := NewMidjourneyAdapter(ChannelConfig{BaseURL: srv.URL, APIKey: "k"})
	_, err := a.SubmitTask(context.Background(), imageTask("midjourney", "MID_JOURNEY", `{}`))
	assert.ErrorContains(t, err, "无效的令牌")
}

func TestMidjourneyAdapter_UnknownTaskFailsInsteadOfRetrying(t *testing.T) {
	// midjourney-proxy answers an unknown task ID with 200 and an empty body.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer srv.Close()

	a := NewMidjourneyAdapter(ChannelConfig{BaseURL: srv.URL, APIKey: "k"})
	task := imageTask("midjourney", "MID_JOURNEY", `{}`)
	task.ProviderTaskID = "gone"
	res, err := a.PollTask(context.Background(), task)
	require.NoError(t, err)
	assert.Equal(t, model.TaskStatusFailed, res.Status)
	assert.Equal(t, "TaskNotFound", res.ErrorCode)
}

func TestMidjourneyAdapter_JustSubmittedTaskWithEmptyStatusKeepsPolling(t *testing.T) {
	// A real gateway returned the task with an empty status right after submit.
	// Only SUCCESS / FAILURE (and CANCEL) end a task; anything else keeps polling.
	status := ""
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := map[string]any{"id": "1790217491102846", "action": "IMAGINE", "status": status,
			"description": "提交成功", "progress": "", "imageUrl": "", "failReason": ""}
		if status == "SUCCESS" {
			resp["progress"] = "100%"
			resp["imageUrl"] = "https://cdn.example.test/grid.webp?ex=1"
		}
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer srv.Close()

	a := NewMidjourneyAdapter(ChannelConfig{BaseURL: srv.URL, APIKey: "k"})
	task := imageTask("midjourney", "mj_imagine", `{}`)
	task.ProviderTaskID = "1790217491102846"
	for _, s := range []string{"", "NOT_START", "SUBMITTED", "MODAL", "SOMETHING_NEW"} {
		status = s
		res, err := a.PollTask(context.Background(), task)
		require.NoError(t, err)
		assert.Equal(t, model.TaskStatusRunning, res.Status, "status %q", s)
		assert.Equal(t, 10, res.Progress, "status %q", s)
	}

	status = "SUCCESS"
	res, err := a.PollTask(context.Background(), task)
	require.NoError(t, err)
	require.Equal(t, model.TaskStatusSucceeded, res.Status)
	assert.Equal(t, "images/task-1/base.webp", filepath.ToSlash(res.Assets[0].LocalPath))
}

func TestMidjourneyAdapter_EnvelopeWithoutTaskIsNotFound(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, `{"code":4,"description":"任务不存在","result":null}`)
	}))
	defer srv.Close()

	a := NewMidjourneyAdapter(ChannelConfig{BaseURL: srv.URL, APIKey: "k"})
	task := imageTask("midjourney", "MID_JOURNEY", `{}`)
	task.ProviderTaskID = "gone"
	res, err := a.PollTask(context.Background(), task)
	require.NoError(t, err)
	assert.Equal(t, model.TaskStatusFailed, res.Status)
	assert.Equal(t, "TaskNotFound", res.ErrorCode)
	assert.Equal(t, "任务不存在", res.ErrorMessage)
}

func TestMidjourneyAdapter_RequiresBaseURL(t *testing.T) {
	// There is no official host: a key saved without an address cannot run.
	_, err := NewMidjourneyAdapter(ChannelConfig{APIKey: "k"}).SubmitTask(context.Background(), imageTask("midjourney", "MID_JOURNEY", `{}`))
	assert.ErrorContains(t, err, "Base URL")
}

func TestMidjourneyPollTask_SuccessReturnsActions(t *testing.T) {
	// Buttons as the real gateway returned them for an IMAGINE grid, plus ones needing user input.
	body := `{"id":"1790217491102846","action":"IMAGINE","status":"SUCCESS","progress":"100%",
	"imageUrl":"https://cdn.example.test/grid.webp","buttons":[
	{"customId":"MJ::JOB::upsample::1::ade29d25","emoji":"","label":"U1","type":2,"style":2},
	{"customId":"MJ::JOB::upsample::2::ade29d25","emoji":"","label":"U2","type":2,"style":2},
	{"customId":"MJ::JOB::reroll::0::ade29d25::SOLO","emoji":"🔄","label":"","type":2,"style":2},
	{"customId":"MJ::JOB::variation::1::ade29d25","emoji":"","label":"V1","type":2,"style":2},
	{"customId":"MJ::CustomZoom::ade29d25","emoji":"🔍","label":"Custom Zoom","type":2,"style":2},
	{"customId":"MJ::Inpaint::1::ade29d25::SOLO","emoji":"🖌️","label":"Vary (Region)","type":2,"style":2},
	{"customId":"MJ::BOOKMARK::ade29d25","emoji":"❤️","label":"","type":2,"style":2}]}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, body)
	}))
	defer srv.Close()

	a := NewMidjourneyAdapter(ChannelConfig{BaseURL: srv.URL, APIKey: "k"})
	task := imageTask("midjourney", "mj_imagine", `{}`)
	task.ProviderTaskID = "1790217491102846"
	res, err := a.PollTask(context.Background(), task)
	require.NoError(t, err)
	require.Equal(t, model.TaskStatusSucceeded, res.Status)
	assert.Equal(t, []model.TaskAction{
		{ID: "MJ::JOB::upsample::1::ade29d25", Label: "U1"},
		{ID: "MJ::JOB::upsample::2::ade29d25", Label: "U2"},
		{ID: "MJ::JOB::reroll::0::ade29d25::SOLO", Emoji: "🔄"},
		{ID: "MJ::JOB::variation::1::ade29d25", Label: "V1"},
	}, res.Actions, "buttons needing user input (custom zoom, region, bookmark) are dropped")
}

package adapter

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"media-workstage/internal/model"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestMidjourneyNativeBase(t *testing.T) {
	cases := []struct {
		in   string
		want string
		ok   bool
	}{
		{"http://gw:3000/midjourney", "http://gw:3000/midjourney", true},
		{"http://gw:3000/midjourney/", "http://gw:3000/midjourney", true},
		{"http://gw:3000/midjourney/v1", "http://gw:3000/midjourney", true},
		{"http://gw:3000", "", false},
		{"http://gw:3000/mj", "", false},
		{"https://midjourney.example.com", "", false},
	}
	for _, c := range cases {
		got, ok := MidjourneyNativeBase(c.in)
		assert.Equal(t, c.ok, ok, c.in)
		assert.Equal(t, c.want, got, c.in)
	}
}

// nativeMJServer fakes the gateway's versioned Midjourney entry under /midjourney.
type nativeMJServer struct {
	*httptest.Server
	requests []*http.Request
	bodies   []map[string]any
	query    string // the data object a query of task_parent returns
}

func newNativeMJServer(t *testing.T) *nativeMJServer {
	s := &nativeMJServer{}
	s.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "Bearer mj-key", r.Header.Get("Authorization"))
		if r.URL.Path == "/midjourney/v1/proxy-1" {
			// The legacy query, which alone carries the proxy's fail_reason.
			assert.Empty(t, r.Header.Get("X-Heighliner-MJ-Response-Version"))
			_, _ = io.WriteString(w, `{"data":{"task_id":"proxy-1","status":"failed","fail_reason":"Forbidden flag, Your plan doesn't include Relax mode."}}`)
			return
		}
		assert.Equal(t, "2026-10-16", r.Header.Get("X-Heighliner-MJ-Response-Version"))
		s.requests = append(s.requests, r)
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		s.bodies = append(s.bodies, body)
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/midjourney/v1/generations":
			w.WriteHeader(http.StatusAccepted)
			_, _ = io.WriteString(w, `{"data":{"task_id":null,"platform_task_id":"task_parent","operation":"imagine","status":"queued","progress":"0%","image_urls":[],"available_actions":[],"error":null}}`)
		case r.Method == http.MethodPost && (r.URL.Path == "/midjourney/v1/generations/upscale" || r.URL.Path == "/midjourney/v1/generations/variation"):
			w.WriteHeader(http.StatusAccepted)
			_, _ = io.WriteString(w, `{"data":{"platform_task_id":"task_child","source_task_id":"task_parent","status":"queued"}}`)
		case r.Method == http.MethodGet && r.URL.Path == "/midjourney/v1/task_parent":
			assert.Equal(t, "platform", r.URL.Query().Get("id_type"))
			_, _ = io.WriteString(w, `{"data":`+s.query+`}`)
		default:
			w.WriteHeader(http.StatusNotFound)
			_, _ = io.WriteString(w, `{"error":{"code":"task_not_found","message":"任务不存在","type":"midjourney_error"}}`)
		}
	}))
	t.Cleanup(s.Close)
	return s
}

func TestMidjourneyNative_ImagineThenPoll(t *testing.T) {
	srv := newNativeMJServer(t)
	a := NewMidjourneyAdapter(ChannelConfig{BaseURL: srv.URL + "/midjourney", APIKey: "mj-key"})

	task := imageTask("midjourney", "MID_JOURNEY", `{"aspect_ratio":"16:9","speed":"FAST"}`)
	id, err := a.SubmitTask(context.Background(), task)
	require.NoError(t, err)
	assert.Equal(t, "task_parent", id, "the platform task ID is what later queries and U/V use")
	assert.Equal(t, map[string]any{"prompt": "a red fox", "size": "16:9", "speed": "fast"}, srv.bodies[0])
	assert.Equal(t, "media-workstage-task-1", srv.requests[0].Header.Get("Idempotency-Key"))
	task.ProviderTaskID = id

	srv.query = `{"platform_task_id":"task_parent","status":"running","progress":"40%"}`
	res, err := a.PollTask(context.Background(), task)
	require.NoError(t, err)
	assert.Equal(t, model.TaskStatusRunning, res.Status)
	assert.Equal(t, 40, res.Progress)

	srv.query = `{"platform_task_id":"task_parent","status":"reconciling","progress":"0%"}`
	res, err = a.PollTask(context.Background(), task)
	require.NoError(t, err)
	assert.Equal(t, model.TaskStatusRunning, res.Status, "a submission being verified keeps polling")

	srv.query = `{"platform_task_id":"task_parent","status":"succeeded","progress":"100%",
		"image_urls":["https://media.example.com/grid.png"],
		"available_actions":[
			{"operation":"upscale","index":1,"enabled":true,"billing_model":"mj_upscale"},
			{"operation":"upscale","index":2,"enabled":true,"billing_model":"mj_upscale"},
			{"operation":"variation","index":1,"enabled":false,"reason":"model_not_authorized","billing_model":"mj_variation"},
			{"operation":"variation","index":2,"enabled":true,"billing_model":"mj_variation"}]}`
	res, err = a.PollTask(context.Background(), task)
	require.NoError(t, err)
	require.Equal(t, model.TaskStatusSucceeded, res.Status)
	assert.Equal(t, "https://media.example.com/grid.png", res.ResultURL)
	require.Len(t, res.Assets, 1)
	assert.Equal(t, []model.ResultAction{
		{ID: "upscale:1", Label: "U1"},
		{ID: "upscale:2", Label: "U2"},
		{ID: "variation:2", Label: "V2"},
	}, res.ResultActions, "disabled buttons are not offered")
}

func TestMidjourneyNative_PromptFlagsWinOverCardFields(t *testing.T) {
	srv := newNativeMJServer(t)
	a := NewMidjourneyAdapter(ChannelConfig{BaseURL: srv.URL + "/midjourney/v1/", APIKey: "mj-key"})
	task := imageTask("midjourney", "mj_imagine", `{"aspect_ratio":"16:9","speed":"RELAX"}`)
	task.Prompt = "a red fox --ar 2:3 --turbo"
	_, err := a.SubmitTask(context.Background(), task)
	require.NoError(t, err)
	assert.Equal(t, map[string]any{"prompt": "a red fox --ar 2:3 --turbo", "speed": "turbo"}, srv.bodies[0],
		"no size beside the prompt's --ar, and the speed field matches the prompt's flag")
}

func TestMidjourneyNative_DefaultSpeedIsFast(t *testing.T) {
	srv := newNativeMJServer(t)
	a := NewMidjourneyAdapter(ChannelConfig{BaseURL: srv.URL + "/midjourney", APIKey: "mj-key"})
	_, err := a.SubmitTask(context.Background(), imageTask("midjourney", "MID_JOURNEY", `{}`))
	require.NoError(t, err)
	assert.Equal(t, map[string]any{"prompt": "a red fox", "speed": "fast"}, srv.bodies[0],
		"the gateway's relax default fails on plans without Relax, so an unset speed is sent as fast")

	_, err = a.SubmitTask(context.Background(), actionTask("task_parent", "upscale:1"))
	require.NoError(t, err)
	assert.Equal(t, "fast", srv.bodies[1]["speed"], "a follow-up whose source named no speed runs fast too")
}

func TestMidjourneyNative_UpscaleAndVariation(t *testing.T) {
	srv := newNativeMJServer(t)
	a := NewMidjourneyAdapter(ChannelConfig{BaseURL: srv.URL + "/midjourney", APIKey: "mj-key"})

	for _, c := range []struct{ action, path string }{
		{"upscale:3", "/midjourney/v1/generations/upscale"},
		{"variation:1", "/midjourney/v1/generations/variation"},
	} {
		task := actionTask("task_parent", c.action)
		task.ParamsJSON = `{"source_task_id":"src-1","source_provider_task_id":"task_parent","action_id":"` + c.action + `","speed":"FAST"}`
		id, err := a.SubmitTask(context.Background(), task)
		require.NoError(t, err)
		assert.Equal(t, "task_child", id)
		last := len(srv.requests) - 1
		assert.Equal(t, c.path, srv.requests[last].URL.Path)
		assert.NotEmpty(t, srv.requests[last].Header.Get("Idempotency-Key"))
	}
	assert.Equal(t, map[string]any{"source_task_id": "task_parent", "index": float64(3), "speed": "fast"}, srv.bodies[0])
	assert.Equal(t, map[string]any{"source_task_id": "task_parent", "index": float64(1), "speed": "fast"}, srv.bodies[1])
}

func TestMidjourneyNative_RejectsWhatTheVersionedWorkflowLacks(t *testing.T) {
	srv := newNativeMJServer(t)
	a := NewMidjourneyAdapter(ChannelConfig{BaseURL: srv.URL + "/midjourney", APIKey: "mj-key"})

	_, err := a.SubmitTask(context.Background(), actionTask("task_parent", "MJ::JOB::reroll::0::h::SOLO"))
	assert.ErrorContains(t, err, "不支持操作")

	blend := imageTask("midjourney", "MID_JOURNEY", `{}`)
	blend.TaskMode = "blend"
	_, err = a.SubmitTask(context.Background(), blend)
	assert.ErrorContains(t, err, "Blend")

	withRefs := imageTask("midjourney", "MID_JOURNEY", `{"reference_assets":[{"local_path":"a.png"}]}`)
	_, err = a.SubmitTask(context.Background(), withRefs)
	assert.ErrorContains(t, err, "参考图")

	assert.Empty(t, srv.requests, "nothing is sent for an unsupported request")
}

func TestMidjourneyNative_FailedTaskAndRequestError(t *testing.T) {
	srv := newNativeMJServer(t)
	a := NewMidjourneyAdapter(ChannelConfig{BaseURL: srv.URL + "/midjourney", APIKey: "mj-key"})
	task := imageTask("midjourney", "MID_JOURNEY", `{}`)
	task.ProviderTaskID = "task_parent"

	srv.query = `{"task_id":"proxy-1","platform_task_id":"task_parent","status":"failed","error":{"code":"provider_rejected","message":"Midjourney generation was rejected or failed","stage":"generation"}}`
	res, err := a.PollTask(context.Background(), task)
	require.NoError(t, err)
	assert.Equal(t, model.TaskStatusFailed, res.Status)
	assert.Equal(t, "provider_rejected", res.ErrorCode)
	assert.Equal(t, "Midjourney generation was rejected or failed：Forbidden flag, Your plan doesn't include Relax mode.", res.ErrorMessage,
		"the proxy's own reason is appended to the generic error")

	srv.query = `{"task_id":null,"platform_task_id":"task_parent","status":"failed","error":{"code":"provider_rejected","message":"Midjourney generation was rejected or failed"}}`
	res, err = a.PollTask(context.Background(), task)
	require.NoError(t, err)
	assert.Equal(t, "Midjourney generation was rejected or failed", res.ErrorMessage, "no proxy ID, no extra lookup")

	task.ProviderTaskID = "task_missing"
	_, err = a.PollTask(context.Background(), task)
	var httpErr *ProviderHTTPError
	require.ErrorAs(t, err, &httpErr)
	assert.Equal(t, http.StatusNotFound, httpErr.Status)
	assert.Equal(t, "任务不存在", httpErr.Message)
}

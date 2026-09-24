package server

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"media-workstage/internal/model"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func seedSourceTask(t *testing.T, srv *Server, mutate func(*model.MediaTask)) *model.MediaTask {
	t.Helper()
	now := time.Now().UTC()
	task := &model.MediaTask{
		ID: "src-1", Provider: "midjourney", ProviderTaskID: "1790217491102846", Model: "mj_imagine",
		TaskType: "image_generation", TaskMode: "single", Prompt: "a red fox", ParamsJSON: `{}`,
		Status: model.TaskStatusSucceeded, CreatedAt: now, UpdatedAt: now,
		ResultActions: []model.TaskAction{{ID: "MJ::JOB::upsample::1::h", Label: "U1"}},
	}
	if mutate != nil {
		mutate(task)
	}
	require.NoError(t, srv.db.Create(task).Error)
	return task
}

func actionTaskBody(provider, sourceID, actionID string) map[string]any {
	return map[string]any{
		"provider": provider, "model": "mj_imagine", "task_type": "image_generation", "task_mode": "action",
		"prompt": "a red fox",
		"params": map[string]any{"source_task_id": sourceID, "action_id": actionID},
	}
}

func TestCreateTask_SourceTaskInjectsProviderTaskID(t *testing.T) {
	srv, r := newProviderTestServer(t)
	seedSourceTask(t, srv, nil)

	w := postJSON(r, "/api/tasks", actionTaskBody("midjourney", "src-1", "MJ::JOB::upsample::1::h"))
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())

	var created model.MediaTask
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &created))
	var params map[string]any
	require.NoError(t, json.Unmarshal([]byte(created.ParamsJSON), &params))
	assert.Equal(t, "1790217491102846", params["source_provider_task_id"])
	assert.Equal(t, "MJ::JOB::upsample::1::h", params["action_id"])
}

func TestCreateTask_SourceTaskRejections(t *testing.T) {
	cases := []struct {
		name     string
		mutate   func(*model.MediaTask)
		provider string
		source   string
		action   string
		wantErr  string
	}{
		{"missing", nil, "midjourney", "nope", "MJ::JOB::upsample::1::h", "来源任务不存在"},
		{"wrong provider", nil, "mj-relay-b", "src-1", "MJ::JOB::upsample::1::h", "服务商"},
		{"not succeeded", func(t *model.MediaTask) { t.Status = model.TaskStatusFailed }, "midjourney", "src-1", "MJ::JOB::upsample::1::h", "尚未成功"},
		{"no provider task", func(t *model.MediaTask) { t.ProviderTaskID = "" }, "midjourney", "src-1", "MJ::JOB::upsample::1::h", "没有服务商任务"},
		{"unknown action", nil, "midjourney", "src-1", "MJ::JOB::upsample::9::h", "不支持该操作"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			srv, r := newProviderTestServer(t)
			seedSourceTask(t, srv, c.mutate)
			w := postJSON(r, "/api/tasks", actionTaskBody(c.provider, c.source, c.action))
			assert.Equal(t, http.StatusBadRequest, w.Code, w.Body.String())
			assert.Contains(t, w.Body.String(), c.wantErr)
		})
	}
}

func TestCreateTask_ActionIDWithoutSourceIsRejected(t *testing.T) {
	_, r := newProviderTestServer(t)
	body := actionTaskBody("midjourney", "", "MJ::JOB::upsample::1::h")
	delete(body["params"].(map[string]any), "source_task_id")
	w := postJSON(r, "/api/tasks", body)
	assert.Equal(t, http.StatusBadRequest, w.Code, w.Body.String())
}

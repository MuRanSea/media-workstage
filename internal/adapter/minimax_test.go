package adapter

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"media-workstage/internal/model"
)

func TestMiniMaxAdapter_Validation(t *testing.T) {
	adapter := NewMiniMaxAdapter(MiniMaxConfig{})

	t.Run("reject non-video task", func(t *testing.T) {
		task := &model.MediaTask{
			TaskType: "image_generation",
			Prompt:   "Prompt",
		}
		_, err := adapter.ValidateTask(task)
		if err == nil || !strings.Contains(err.Error(), "only supports video_generation") {
			t.Fatalf("expected video_generation requirement error, got: %v", err)
		}
	})

	t.Run("reject empty prompt", func(t *testing.T) {
		task := &model.MediaTask{
			TaskType: "video_generation",
			Prompt:   "   ",
		}
		_, err := adapter.ValidateTask(task)
		if err == nil || !strings.Contains(err.Error(), "prompt is required") {
			t.Fatalf("expected prompt required error, got: %v", err)
		}
	})

	t.Run("reject audio or video reference assets", func(t *testing.T) {
		task := &model.MediaTask{
			TaskType: "video_generation",
			Model:    "MiniMax-H3",
			Prompt:   "A prompt",
			ParamsJSON: `{
				"reference_assets": [
					{"role": "reference_audio", "url": "https://example.com/audio.mp3"}
				]
			}`,
		}
		_, err := adapter.ValidateTask(task)
		if err == nil || !strings.Contains(err.Error(), "does not support reference reference_audio") {
			t.Fatalf("expected unsupported reference error, got: %v", err)
		}
	})

	t.Run("reject more than 2 reference images", func(t *testing.T) {
		task := &model.MediaTask{
			TaskType: "video_generation",
			Model:    "MiniMax-H3",
			Prompt:   "A prompt",
			ParamsJSON: `{
				"reference_assets": [
					{"role": "first_frame", "url": "https://example.com/1.png"},
					{"role": "last_frame", "url": "https://example.com/2.png"},
					{"role": "reference_image", "url": "https://example.com/3.png"}
				]
			}`,
		}
		_, err := adapter.ValidateTask(task)
		if err == nil || !strings.Contains(err.Error(), "supports at most 2 reference images") {
			t.Fatalf("expected max 2 reference images error, got: %v", err)
		}
	})

	t.Run("validate video-01 resolution and duration", func(t *testing.T) {
		// Valid video-01
		validTask := &model.MediaTask{
			TaskType:   "video_generation",
			Model:      "video-01",
			Prompt:     "A high speed car chase",
			ParamsJSON: `{"resolution": "1080P", "duration": 6}`,
		}
		if _, err := adapter.ValidateTask(validTask); err != nil {
			t.Fatalf("expected valid video-01 task, got: %v", err)
		}

		// Invalid duration for video-01 (only 6s supported)
		invalidDurTask := &model.MediaTask{
			TaskType:   "video_generation",
			Model:      "video-01",
			Prompt:     "A car chase",
			ParamsJSON: `{"duration": 10}`,
		}
		if _, err := adapter.ValidateTask(invalidDurTask); err == nil || !strings.Contains(err.Error(), "only supports 6s duration") {
			t.Fatalf("expected video-01 duration error, got: %v", err)
		}

		// Invalid resolution for video-01 (2K is only on H3)
		invalidResTask := &model.MediaTask{
			TaskType:   "video_generation",
			Model:      "video-01",
			Prompt:     "A car chase",
			ParamsJSON: `{"resolution": "2K"}`,
		}
		if _, err := adapter.ValidateTask(invalidResTask); err == nil || !strings.Contains(err.Error(), "must be 720P or 1080P") {
			t.Fatalf("expected video-01 resolution error, got: %v", err)
		}
	})

	t.Run("validate MiniMax-H3 resolution and duration", func(t *testing.T) {
		// 2K and 10s is valid for H3
		validH3 := &model.MediaTask{
			TaskType:   "video_generation",
			Model:      "MiniMax-H3",
			Prompt:     "A stunning mountain view",
			ParamsJSON: `{"resolution": "2K", "duration": 10}`,
		}
		if _, err := adapter.ValidateTask(validH3); err != nil {
			t.Fatalf("expected valid H3 task, got: %v", err)
		}

		// Any whole second from 4 to 15 is valid on the V2 API
		if _, err := adapter.ValidateTask(&model.MediaTask{
			TaskType:   "video_generation",
			Model:      "MiniMax-H3",
			Prompt:     "A mountain view",
			ParamsJSON: `{"duration": 8, "resolution": "768P"}`,
		}); err != nil {
			t.Fatalf("expected 8s H3 task to be valid, got: %v", err)
		}

		invalidH3Dur := &model.MediaTask{
			TaskType:   "video_generation",
			Model:      "MiniMax-H3",
			Prompt:     "A mountain view",
			ParamsJSON: `{"duration": 3}`,
		}
		if _, err := adapter.ValidateTask(invalidH3Dur); err == nil || !strings.Contains(err.Error(), "duration must be 4 to 15s") {
			t.Fatalf("expected H3 duration error, got: %v", err)
		}

		// H3-Max is the fast tier: no 2K
		if _, err := adapter.ValidateTask(&model.MediaTask{
			TaskType:   "video_generation",
			Model:      "MiniMax-H3-Max",
			Prompt:     "A mountain view",
			ParamsJSON: `{"resolution": "2K", "duration": 5}`,
		}); err == nil || !strings.Contains(err.Error(), "does not support 2K") {
			t.Fatalf("expected H3-Max 2K error, got: %v", err)
		}
	})
}

func TestMiniMaxAdapter_SubmitTaskFlow(t *testing.T) {
	var capturedBody map[string]interface{}
	var capturedAuth string
	var capturedPath string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodPost && (r.URL.Path == "/video_generation" || r.URL.Path == "/v2/video_generation") {
			capturedPath = r.URL.Path
			capturedAuth = r.Header.Get("Authorization")
			_ = json.NewDecoder(r.Body).Decode(&capturedBody)

			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{
				"task_id": "106916112212032",
				"base_resp": {
					"status_code": 0,
					"status_msg": "success"
				}
			}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	ctx := context.Background()

	// Write local test file for Base64 encoding
	tempDir := t.TempDir()
	localImg := filepath.Join(tempDir, "first_frame.png")
	_ = os.WriteFile(localImg, []byte("MOCK_IMAGE_BYTES"), 0644)

	t.Run("MiniMax-H3 uses the V2 content array", func(t *testing.T) {
		// A /v1 Base URL (the default) is rewritten to the V2 root.
		adapter := NewMiniMaxAdapter(MiniMaxConfig{BaseURL: server.URL + "/v1", APIKey: "test-minimax-key"})
		task := &model.MediaTask{
			ID:       "task-mm-1",
			TaskType: "video_generation",
			Model:    "MiniMax-H3",
			Prompt:   "A beautiful sunset over the ocean",
			ParamsJSON: fmt.Sprintf(`{
				"resolution": "1080P",
				"duration": 6,
				"ratio": "16:9",
				"prompt_optimizer": true,
				"reference_assets": [
					{"role": "first_frame", "local_path": %q},
					{"role": "last_frame", "url": "https://example.com/last.png"}
				]
			}`, localImg),
		}

		taskID, err := adapter.SubmitTask(ctx, task)
		if err != nil {
			t.Fatalf("submit minimax task failed: %v", err)
		}
		if taskID != "106916112212032" {
			t.Errorf("unexpected task ID: %s", taskID)
		}
		if capturedPath != "/v2/video_generation" {
			t.Errorf("expected the V2 endpoint, got %s", capturedPath)
		}
		if capturedAuth != "Bearer test-minimax-key" {
			t.Errorf("unexpected auth header: %s", capturedAuth)
		}
		if capturedBody["model"] != "MiniMax-H3" {
			t.Errorf("unexpected model in request: %v", capturedBody["model"])
		}
		if _, ok := capturedBody["prompt"]; ok {
			t.Errorf("V2 takes the prompt inside content, not at the top level: %v", capturedBody)
		}
		if capturedBody["resolution"] != "2K" || capturedBody["duration"] != float64(6) || capturedBody["ratio"] != "adaptive" {
			t.Errorf("unexpected generation settings: %v", capturedBody)
		}
		content, _ := capturedBody["content"].([]interface{})
		if len(content) != 3 {
			t.Fatalf("expected text + first + last frame, got %v", capturedBody["content"])
		}
		text := content[0].(map[string]interface{})
		if text["type"] != "text" || text["text"] != "A beautiful sunset over the ocean" {
			t.Errorf("unexpected text item: %v", text)
		}
		first := content[1].(map[string]interface{})
		firstURL := first["image_url"].(map[string]interface{})["url"].(string)
		if first["type"] != "image_url" || first["role"] != "first_frame" || !strings.HasPrefix(firstURL, "data:image/png;base64,") {
			t.Errorf("unexpected first frame item: %v", first)
		}
		last := content[2].(map[string]interface{})
		if last["role"] != "last_frame" || last["image_url"].(map[string]interface{})["url"] != "https://example.com/last.png" {
			t.Errorf("unexpected last frame item: %v", last)
		}
	})

	t.Run("text-to-video gets a concrete ratio", func(t *testing.T) {
		adapter := NewMiniMaxAdapter(MiniMaxConfig{BaseURL: server.URL + "/v2", APIKey: "k"})
		_, err := adapter.SubmitTask(ctx, &model.MediaTask{
			ID:         "task-mm-2",
			TaskType:   "video_generation",
			Model:      "MiniMax-H3",
			Prompt:     "A cat on a roof",
			ParamsJSON: `{"resolution": "720P", "duration": 5}`,
		})
		if err != nil {
			t.Fatalf("submit failed: %v", err)
		}
		if capturedBody["resolution"] != "768P" || capturedBody["ratio"] != "16:9" {
			t.Errorf("expected 768P at 16:9, got %v", capturedBody)
		}
	})

	t.Run("Video-01 keeps the V1 request", func(t *testing.T) {
		adapter := NewMiniMaxAdapter(MiniMaxConfig{BaseURL: server.URL, APIKey: "k"})
		_, err := adapter.SubmitTask(ctx, &model.MediaTask{
			ID:         "task-mm-3",
			TaskType:   "video_generation",
			Model:      "video-01",
			Prompt:     "A cat on a roof",
			ParamsJSON: `{"duration": 6}`,
		})
		if err != nil {
			t.Fatalf("submit failed: %v", err)
		}
		if capturedPath != "/video_generation" || capturedBody["prompt"] != "A cat on a roof" {
			t.Errorf("expected the V1 request, got %s %v", capturedPath, capturedBody)
		}
	})
}

func TestMiniMaxAdapter_PollTaskFlowV2(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v2/query/video_generation/task-running":
			w.Write([]byte(`{"task": {"id": "task-running", "status": "running"}}`))
		case "/v2/query/video_generation/task-succeeded":
			w.Write([]byte(`{"task": {"id": "task-succeeded", "status": "succeeded", "resolution": "2K", "duration": 5,
				"content": {"url": "https://cdn.example.com/out.mp4"}}}`))
		case "/v2/query/video_generation/task-failed":
			w.Write([]byte(`{"task": {"id": "task-failed", "status": "failed",
				"error": {"code": "1026", "message": "video description contains sensitive content"}}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	adapter := NewMiniMaxAdapter(MiniMaxConfig{BaseURL: server.URL + "/v1"})
	ctx := context.Background()
	poll := func(id string) *PollResult {
		t.Helper()
		res, err := adapter.PollTask(ctx, &model.MediaTask{ID: "t-" + id, ProviderTaskID: id, TaskType: "video_generation", Model: "MiniMax-H3"})
		if err != nil {
			t.Fatalf("poll %s failed: %v", id, err)
		}
		return res
	}

	if res := poll("task-running"); res.Status != model.TaskStatusRunning {
		t.Errorf("expected running, got %+v", res)
	}

	res := poll("task-succeeded")
	if res.Status != model.TaskStatusSucceeded || res.OutputDurationSec != 5 {
		t.Fatalf("expected succeeded at 5s, got %+v", res)
	}
	if len(res.Assets) != 1 || res.Assets[0].RemoteURL != "https://cdn.example.com/out.mp4" || res.ResultURL != res.Assets[0].RemoteURL {
		t.Errorf("unexpected assets: %+v", res.Assets)
	}

	res = poll("task-failed")
	if res.Status != model.TaskStatusFailed || res.ErrorCode != "MiniMax_1026" || !strings.Contains(res.ErrorMessage, "sensitive content") {
		t.Errorf("unexpected failure: %+v", res)
	}
}

func TestMiniMaxAdapter_PollTaskFlow(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Query().Get("task_id") {
		case "task-running":
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{
				"task_id": "task-running",
				"status": "Processing",
				"base_resp": {"status_code": 0, "status_msg": "success"}
			}`))

		case "task-succeeded":
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{
				"task_id": "task-succeeded",
				"status": "Success",
				"file_id": "176844028768320",
				"video_width": 1920,
				"video_height": 1080,
				"content": {
					"url": "https://file-service.minimax.chat/video/task-succeeded.mp4"
				},
				"base_resp": {"status_code": 0, "status_msg": "success"}
			}`))

		case "task-failed":
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{
				"task_id": "task-failed",
				"status": "Fail",
				"base_resp": {
					"status_code": 2013,
					"status_msg": "Sensitive content detected in prompt"
				}
			}`))

		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	adapter := NewMiniMaxAdapter(MiniMaxConfig{
		BaseURL: server.URL,
	})

	ctx := context.Background()

	// 1. Poll Processing
	runningTask := &model.MediaTask{
		ID:             "t1",
		ProviderTaskID: "task-running",
		TaskType:       "video_generation",
	}
	resRunning, err := adapter.PollTask(ctx, runningTask)
	if err != nil {
		t.Fatalf("poll running task failed: %v", err)
	}
	if resRunning.Status != model.TaskStatusRunning || resRunning.Progress != 60 {
		t.Errorf("unexpected running status: %+v", resRunning)
	}

	// 2. Poll Succeeded
	succTask := &model.MediaTask{
		ID:             "t2",
		ProviderTaskID: "task-succeeded",
		TaskType:       "video_generation",
		Model:          "video-01",
		ParamsJSON:     `{"duration": 10}`,
	}
	resSucc, err := adapter.PollTask(ctx, succTask)
	if err != nil {
		t.Fatalf("poll succeeded task failed: %v", err)
	}
	if resSucc.Status != model.TaskStatusSucceeded || resSucc.Progress != 100 {
		t.Fatalf("expected succeeded status, got: %+v", resSucc)
	}
	if resSucc.OutputDurationSec != 10.0 {
		t.Errorf("expected duration 10.0, got %f", resSucc.OutputDurationSec)
	}
	if len(resSucc.Assets) != 1 || resSucc.Assets[0].RemoteURL != "https://file-service.minimax.chat/video/task-succeeded.mp4" {
		t.Errorf("unexpected assets: %+v", resSucc.Assets)
	}

	// 3. Poll Failed
	failedTask := &model.MediaTask{
		ID:             "t3",
		ProviderTaskID: "task-failed",
		TaskType:       "video_generation",
	}
	resFailed, err := adapter.PollTask(ctx, failedTask)
	if err != nil {
		t.Fatalf("poll failed task returned error: %v", err)
	}
	if resFailed.Status != model.TaskStatusFailed {
		t.Errorf("expected failed status, got: %+v", resFailed)
	}
	if resFailed.ErrorCode != "MiniMax_2013" || !strings.Contains(resFailed.ErrorMessage, "Sensitive content") {
		t.Errorf("unexpected error details: code=%s, msg=%s", resFailed.ErrorCode, resFailed.ErrorMessage)
	}
}

func TestMiniMaxAdapter_DoubleDownloadStrategy(t *testing.T) {
	tempDir := t.TempDir()

	fileServiceHits := 0
	retrieveHits := 0

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/files/retrieve":
			retrieveHits++
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			// Return refreshed download url pointing back to valid stream endpoint
			w.Write([]byte(`{
				"file": {
					"file_id": "176844028768320",
					"bytes": 24,
					"filename": "output.mp4",
					"download_url": "` + "http://" + r.Host + `/download_fresh.mp4"
				},
				"base_resp": {"status_code": 0, "status_msg": "success"}
			}`))

		case r.Method == http.MethodGet && r.URL.Path == "/download_primary.mp4":
			fileServiceHits++
			w.Header().Set("Content-Type", "video/mp4")
			w.WriteHeader(http.StatusOK)
			w.Write([]byte("PRIMARY_DOWNLOAD_STREAM_CONTENT"))

		case r.Method == http.MethodGet && r.URL.Path == "/download_fresh.mp4":
			w.Header().Set("Content-Type", "video/mp4")
			w.WriteHeader(http.StatusOK)
			w.Write([]byte("FRESH_DOWNLOAD_STREAM_CONTENT"))

		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	adapter := NewMiniMaxAdapter(MiniMaxConfig{
		BaseURL: server.URL,
	})

	ctx := context.Background()

	// 1. Direct primary download
	targetPath1 := filepath.Join(tempDir, "video1.mp4")
	if err := adapter.DownloadAsset(ctx, server.URL+"/download_primary.mp4", targetPath1); err != nil {
		t.Fatalf("primary download failed: %v", err)
	}
	content1, _ := os.ReadFile(targetPath1)
	if string(content1) != "PRIMARY_DOWNLOAD_STREAM_CONTENT" {
		t.Errorf("unexpected downloaded content: %s", string(content1))
	}

	// 2. Protocol fallback with minimax-file://<file_id>
	targetPath2 := filepath.Join(tempDir, "video2.mp4")
	if err := adapter.DownloadAsset(ctx, "minimax-file://176844028768320", targetPath2); err != nil {
		t.Fatalf("fallback download failed: %v", err)
	}
	content2, _ := os.ReadFile(targetPath2)
	if string(content2) != "FRESH_DOWNLOAD_STREAM_CONTENT" {
		t.Errorf("unexpected fallback downloaded content: %s", string(content2))
	}
	if retrieveHits != 1 {
		t.Errorf("expected 1 retrieve hit, got %d", retrieveHits)
	}
}

// A result download is not cut off by the API calls' timeout.
func TestMiniMaxAdapter_DownloadOutlastsAPITimeout(t *testing.T) {
	const apiTimeout = 100 * time.Millisecond
	server := slowFileServer(t, apiTimeout)
	a := NewMiniMaxAdapter(MiniMaxConfig{BaseURL: server.URL, HTTPClient: &http.Client{Timeout: apiTimeout}})

	target := filepath.Join(t.TempDir(), "videos", "task1", "output.mp4")
	if err := a.DownloadAsset(context.Background(), server.URL+"/output.mp4", target); err != nil {
		t.Fatalf("download failed: %v", err)
	}
	if content, _ := os.ReadFile(target); string(content) != "FIRST_HALF_SECOND_HALF" {
		t.Errorf("unexpected content %q", content)
	}
}

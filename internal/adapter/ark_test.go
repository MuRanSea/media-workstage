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

	"media-workstage/internal/model"
)

func TestArkAdapter_SeedanceValidation(t *testing.T) {
	adapter := NewArkAdapter(ArkConfig{})

	t.Run("text_to_video valid", func(t *testing.T) {
		task := &model.MediaTask{
			Model:    "doubao-seedance-2-5-260628",
			TaskType: "video_generation",
			TaskMode: "text_to_video",
			Prompt:   "A cinematic shot of a cyberpunk city in neon rain",
			ParamsJSON: `{
				"resolution": "720p",
				"ratio": "16:9",
				"duration": 5
			}`,
		}
		params, err := adapter.ValidateTask(task)
		if err != nil {
			t.Fatalf("expected valid task, got error: %v", err)
		}
		if params.Resolution != "720p" || params.Ratio != "16:9" || params.Duration != 5 {
			t.Errorf("unexpected parsed params: %+v", params)
		}
	})

	t.Run("text_to_video invalid with reference assets", func(t *testing.T) {
		task := &model.MediaTask{
			Model:    "doubao-seedance-2-5-260628",
			TaskType: "video_generation",
			TaskMode: "text_to_video",
			Prompt:   "A cinematic shot",
			ParamsJSON: `{
				"reference_assets": [{"role": "reference_image", "url": "https://example.com/test.png"}]
			}`,
		}
		_, err := adapter.ValidateTask(task)
		if err == nil || !strings.Contains(err.Error(), "text_to_video mode cannot contain reference assets") {
			t.Fatalf("expected reference assets error, got: %v", err)
		}
	})

	t.Run("first_last_frame valid 2 frames forces adaptive ratio", func(t *testing.T) {
		task := &model.MediaTask{
			Model:    "doubao-seedance-2-5-260628",
			TaskType: "video_generation",
			TaskMode: "first_last_frame",
			Prompt:   "Morph between frames",
			ParamsJSON: `{
				"ratio": "16:9",
				"reference_assets": [
					{"role": "first_frame", "url": "https://example.com/first.png"},
					{"role": "last_frame", "url": "https://example.com/last.png"}
				]
			}`,
		}
		params, err := adapter.ValidateTask(task)
		if err != nil {
			t.Fatalf("expected valid first_last_frame task, got: %v", err)
		}
		if params.Ratio != "adaptive" {
			t.Errorf("expected ratio to be forced to 'adaptive', got '%s'", params.Ratio)
		}
	})

	t.Run("first_last_frame invalid with 3 images", func(t *testing.T) {
		task := &model.MediaTask{
			Model:    "doubao-seedance-2-5-260628",
			TaskType: "video_generation",
			TaskMode: "first_last_frame",
			Prompt:   "Morph between frames",
			ParamsJSON: `{
				"reference_assets": [
					{"role": "first_frame", "url": "https://example.com/1.png"},
					{"role": "last_frame", "url": "https://example.com/2.png"},
					{"role": "reference_image", "url": "https://example.com/3.png"}
				]
			}`,
		}
		_, err := adapter.ValidateTask(task)
		if err == nil || !strings.Contains(err.Error(), "strictly 1 or 2 images") {
			t.Fatalf("expected 1 or 2 images error, got: %v", err)
		}
	})

	t.Run("all_modal valid multi-reference", func(t *testing.T) {
		task := &model.MediaTask{
			Model:    "doubao-seedance-2-5-260628",
			TaskType: "video_generation",
			TaskMode: "all_modal",
			Prompt:   "Video using ref assets",
			ParamsJSON: `{
				"resolution": "1080p",
				"duration": 10,
				"reference_assets": [
					{"role": "reference_image", "url": "https://example.com/img1.png"},
					{"role": "reference_video", "url": "https://example.com/vid1.mp4"},
					{"role": "reference_audio", "url": "https://example.com/aud1.mp3"}
				]
			}`,
		}
		_, err := adapter.ValidateTask(task)
		if err != nil {
			t.Fatalf("expected valid all_modal task, got: %v", err)
		}
	})

	t.Run("all_modal invalid with first_frame role", func(t *testing.T) {
		task := &model.MediaTask{
			Model:    "doubao-seedance-2-5-260628",
			TaskType: "video_generation",
			TaskMode: "all_modal",
			Prompt:   "Prompt",
			ParamsJSON: `{
				"reference_assets": [
					{"role": "first_frame", "url": "https://example.com/img.png"}
				]
			}`,
		}
		_, err := adapter.ValidateTask(task)
		if err == nil || !strings.Contains(err.Error(), "cannot contain first_frame or last_frame") {
			t.Fatalf("expected role error, got: %v", err)
		}
	})

	t.Run("all_modal limit checking for seedance 2.0 vs 2.5", func(t *testing.T) {
		// 10 reference images is valid for 2.5 but exceeds 9 for 2.0
		refs := make([]map[string]string, 10)
		for i := range 10 {
			refs[i] = map[string]string{"role": "reference_image", "url": fmt.Sprintf("https://example.com/%d.png", i)}
		}
		refsBytes, _ := json.Marshal(refs)

		task20 := &model.MediaTask{
			Model:      "doubao-seedance-2-0-260128",
			TaskType:   "video_generation",
			TaskMode:   "all_modal",
			Prompt:     "Test",
			ParamsJSON: fmt.Sprintf(`{"reference_assets": %s}`, string(refsBytes)),
		}
		_, err := adapter.ValidateTask(task20)
		if err == nil || !strings.Contains(err.Error(), "exceed max allowed (9") {
			t.Fatalf("expected limit error for Seedance 2.0, got: %v", err)
		}

		task25 := &model.MediaTask{
			Model:      "doubao-seedance-2-5-260628",
			TaskType:   "video_generation",
			TaskMode:   "all_modal",
			Prompt:     "Test",
			ParamsJSON: fmt.Sprintf(`{"reference_assets": %s}`, string(refsBytes)),
		}
		_, err = adapter.ValidateTask(task25)
		if err != nil {
			t.Fatalf("expected 10 refs to be valid for Seedance 2.5, got: %v", err)
		}
	})
}

func TestArkAdapter_SeedreamValidation(t *testing.T) {
	adapter := NewArkAdapter(ArkConfig{})

	t.Run("Seedream 5.0 Pro preset sizes", func(t *testing.T) {
		validTiers := []string{"1K", "1.5K", "2K", "auto"}
		for _, tier := range validTiers {
			task := &model.MediaTask{
				Model:      "doubao-seedream-5-0-pro-260628",
				TaskType:   "image_generation",
				Prompt:     "A beautiful sunset",
				ParamsJSON: fmt.Sprintf(`{"size": "%s"}`, tier),
			}
			if _, err := adapter.ValidateTask(task); err != nil {
				t.Errorf("expected tier %s to be valid for 5.0 Pro, got: %v", tier, err)
			}
		}

		invalidTask := &model.MediaTask{
			Model:      "doubao-seedream-5-0-pro-260628",
			TaskType:   "image_generation",
			Prompt:     "A sunset",
			ParamsJSON: `{"size": "4K"}`,
		}
		if _, err := adapter.ValidateTask(invalidTask); err == nil || !strings.Contains(err.Error(), "size tier must be 1K, 1.5K, 2K, or auto") {
			t.Fatalf("expected 4K to be rejected for 5.0 Pro, got: %v", err)
		}
	})

	t.Run("Seedream 5.0 Pro explicit dimensions bounds", func(t *testing.T) {
		// Valid: 2048x1024 -> total = 2,097,152 (in [921600, 4624220]), ratio = 2.0 (in [1/16, 16])
		validTask := &model.MediaTask{
			Model:      "doubao-seedream-5-0-pro-260628",
			TaskType:   "image_generation",
			Prompt:     "A portrait",
			ParamsJSON: `{"size": "2048x1024"}`,
		}
		if _, err := adapter.ValidateTask(validTask); err != nil {
			t.Fatalf("expected valid explicit size, got: %v", err)
		}

		// Invalid: 512x512 -> total = 262,144 (< 921600)
		tooSmallTask := &model.MediaTask{
			Model:      "doubao-seedream-5-0-pro-260628",
			TaskType:   "image_generation",
			Prompt:     "A portrait",
			ParamsJSON: `{"size": "512x512"}`,
		}
		if _, err := adapter.ValidateTask(tooSmallTask); err == nil || !strings.Contains(err.Error(), "must be within [921600, 4624220]") {
			t.Fatalf("expected too small pixels error, got: %v", err)
		}

		// Invalid: 3000x3000 -> total = 9,000,000 (> 4624220)
		tooLargeTask := &model.MediaTask{
			Model:      "doubao-seedream-5-0-pro-260628",
			TaskType:   "image_generation",
			Prompt:     "A portrait",
			ParamsJSON: `{"size": "3000x3000"}`,
		}
		if _, err := adapter.ValidateTask(tooLargeTask); err == nil || !strings.Contains(err.Error(), "must be within [921600, 4624220]") {
			t.Fatalf("expected too large pixels error, got: %v", err)
		}
	})

	t.Run("Seedream 5.0 Lite preset and explicit dimensions", func(t *testing.T) {
		// Valid presets for Lite: 2K, 3K, 4K
		for _, tier := range []string{"2K", "3K", "4K"} {
			task := &model.MediaTask{
				Model:      "doubao-seedream-5-0-lite-260628",
				TaskType:   "image_generation",
				Prompt:     "A landscape",
				ParamsJSON: fmt.Sprintf(`{"size": "%s"}`, tier),
			}
			if _, err := adapter.ValidateTask(task); err != nil {
				t.Errorf("expected tier %s to be valid for 5.0 Lite, got: %v", tier, err)
			}
		}

		// Valid explicit: 3750x1250 -> total = 4,687,500 (in [3686400, 16777216])
		validTask := &model.MediaTask{
			Model:      "doubao-seedream-5-0-lite-260628",
			TaskType:   "image_generation",
			Prompt:     "A landscape",
			ParamsJSON: `{"size": "3750x1250"}`,
		}
		if _, err := adapter.ValidateTask(validTask); err != nil {
			t.Fatalf("expected valid explicit size for Lite, got: %v", err)
		}

		// Invalid explicit: 1500x1500 -> total = 2,250,000 (< 3686400)
		tooSmallTask := &model.MediaTask{
			Model:      "doubao-seedream-5-0-lite-260628",
			TaskType:   "image_generation",
			Prompt:     "A landscape",
			ParamsJSON: `{"size": "1500x1500"}`,
		}
		if _, err := adapter.ValidateTask(tooSmallTask); err == nil || !strings.Contains(err.Error(), "must be within [3686400, 16777216]") {
			t.Fatalf("expected too small pixels error for Lite, got: %v", err)
		}
	})

	t.Run("Feature exclusivity between Pro and Lite", func(t *testing.T) {
		// Layer decomposition on Pro: valid
		proLayerTask := &model.MediaTask{
			Model:      "doubao-seedream-5-0-pro-260628",
			TaskType:   "image_generation",
			Prompt:     "A character portrait",
			ParamsJSON: `{"layer_decomposition": true}`,
		}
		if _, err := adapter.ValidateTask(proLayerTask); err != nil {
			t.Fatalf("expected layer_decomposition to be valid on Pro, got: %v", err)
		}

		// Layer decomposition on Lite: rejected
		liteLayerTask := &model.MediaTask{
			Model:      "doubao-seedream-5-0-lite-260628",
			TaskType:   "image_generation",
			Prompt:     "A character portrait",
			ParamsJSON: `{"layer_decomposition": true}`,
		}
		if _, err := adapter.ValidateTask(liteLayerTask); err == nil || !strings.Contains(err.Error(), "only supported on Seedream 5.0 Pro") {
			t.Fatalf("expected layer_decomposition error on Lite, got: %v", err)
		}

		// Sequential generation on Lite: valid
		liteSeqTask := &model.MediaTask{
			Model:      "doubao-seedream-5-0-lite-260628",
			TaskType:   "image_generation",
			Prompt:     "Storyboard",
			ParamsJSON: `{"sequential_image_generation": "auto"}`,
		}
		if _, err := adapter.ValidateTask(liteSeqTask); err != nil {
			t.Fatalf("expected sequential_image_generation to be valid on Lite, got: %v", err)
		}

		// Sequential generation on Pro: rejected
		proSeqTask := &model.MediaTask{
			Model:      "doubao-seedream-5-0-pro-260628",
			TaskType:   "image_generation",
			Prompt:     "Storyboard",
			ParamsJSON: `{"sequential_image_generation": "auto"}`,
		}
		if _, err := adapter.ValidateTask(proSeqTask); err == nil || !strings.Contains(err.Error(), "not supported on Seedream 5.0 Pro") {
			t.Fatalf("expected sequential error on Pro, got: %v", err)
		}
	})
}

func TestArkAdapter_Base64Encoding(t *testing.T) {
	tempDir := t.TempDir()
	pngPath := filepath.Join(tempDir, "sample.png")
	mockBytes := []byte("FAKE_PNG_BINARY_CONTENT")
	if err := os.WriteFile(pngPath, mockBytes, 0644); err != nil {
		t.Fatalf("failed to write test file: %v", err)
	}

	uri, err := EncodeLocalAssetToBase64(pngPath)
	if err != nil {
		t.Fatalf("failed to encode local asset: %v", err)
	}

	if !strings.HasPrefix(uri, "data:image/png;base64,") {
		t.Fatalf("expected data URI format, got: %s", uri)
	}
}

func TestArkAdapter_VideoTaskFlow(t *testing.T) {
	var capturedSubmitBody map[string]interface{}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/contents/generations/tasks":
			_ = json.NewDecoder(r.Body).Decode(&capturedSubmitBody)
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"id": "cgt-20260828-mock123"}`))

		case r.Method == http.MethodGet && r.URL.Path == "/contents/generations/tasks/cgt-20260828-mock123":
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{
				"id": "cgt-20260828-mock123",
				"model": "doubao-seedance-2-5-260628",
				"status": "succeeded",
				"content": {
					"video_url": "https://tos.example.com/video_output.mp4",
					"last_frame_url": "https://tos.example.com/last_frame.png"
				},
				"duration": 5,
				"resolution": "720p",
				"ratio": "16:9",
				"usage": {
					"completion_tokens": 512,
					"total_tokens": 512
				}
			}`))

		case r.Method == http.MethodGet && r.URL.Path == "/contents/generations/tasks/cgt-failed":
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{
				"id": "cgt-failed",
				"status": "failed",
				"error": {
					"code": "InvalidParameter.TaskTypeConstraint",
					"message": "Reference image ratio out of supported bounds"
				}
			}`))

		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	adapter := NewArkAdapter(ArkConfig{
		BaseURL: server.URL,
		APIKey:  "test-api-key",
	})

	ctx := context.Background()

	// 1. Submit Video Task
	task := &model.MediaTask{
		ID:         "task-v1",
		Model:      "doubao-seedance-2-5-260628",
		TaskType:   "video_generation",
		TaskMode:   "all_modal",
		Prompt:     "A dramatic cinematic drone shot",
		ParamsJSON: `{"resolution": "720p", "ratio": "16:9", "duration": 5}`,
	}

	taskID, err := adapter.SubmitTask(ctx, task)
	if err != nil {
		t.Fatalf("submit video task failed: %v", err)
	}
	if taskID != "cgt-20260828-mock123" {
		t.Fatalf("unexpected task ID: %s", taskID)
	}

	// Verify captured request body sent to server
	if capturedSubmitBody["model"] != "doubao-seedance-2-5-260628" {
		t.Errorf("unexpected model in request: %v", capturedSubmitBody["model"])
	}

	// 2. Poll Succeeded Task
	task.ProviderTaskID = taskID
	result, err := adapter.PollTask(ctx, task)
	if err != nil {
		t.Fatalf("poll video task failed: %v", err)
	}

	if result.Status != model.TaskStatusSucceeded {
		t.Fatalf("expected succeeded status, got: %s", result.Status)
	}
	if result.OutputDurationSec != 5 {
		t.Errorf("expected duration 5, got %f", result.OutputDurationSec)
	}
	if result.UsageTokens != 512 {
		t.Errorf("expected 512 usage tokens, got %d", result.UsageTokens)
	}
	if len(result.Assets) != 2 {
		t.Fatalf("expected 2 assets (video + last frame), got %d", len(result.Assets))
	}
	if result.Assets[0].Kind != "video" || result.Assets[1].Kind != "image_frame" {
		t.Errorf("unexpected asset kinds: %+v", result.Assets)
	}

	// 3. Poll Failed Task
	failedTask := &model.MediaTask{
		ID:             "task-v2",
		ProviderTaskID: "cgt-failed",
		TaskType:       "video_generation",
	}
	failedResult, err := adapter.PollTask(ctx, failedTask)
	if err != nil {
		t.Fatalf("poll failed task returned error: %v", err)
	}
	if failedResult.Status != model.TaskStatusFailed {
		t.Fatalf("expected failed status, got: %s", failedResult.Status)
	}
	if failedResult.ErrorCode != "InvalidParameter.TaskTypeConstraint" {
		t.Errorf("unexpected error code: %s", failedResult.ErrorCode)
	}
}

func TestArkAdapter_ImageTaskFlow(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodPost && r.URL.Path == "/images/generations" {
			var body map[string]interface{}
			_ = json.NewDecoder(r.Body).Decode(&body)

			if body["layer_decomposition"] == true {
				// Return Layer Decomposition mock response
				w.WriteHeader(http.StatusOK)
				w.Write([]byte(`{
					"created": 1720000000,
					"model": "doubao-seedream-5-0-pro-260628",
					"data": [
						{
							"url": "https://tos.example.com/base.png",
							"size": "2048x2048",
							"output_format": "png",
							"z_index": 0,
							"name": "Base",
							"description": "Full composite base image"
						},
						{
							"url": "https://tos.example.com/layer_0.png",
							"size": "2048x2048",
							"output_format": "png",
							"z_index": 1,
							"name": "Character",
							"description": "Main character",
							"bounding_box": {
								"absolute": [100, 200, 500, 800],
								"normalized": [0.05, 0.1, 0.25, 0.4]
							}
						},
						{
							"url": "https://tos.example.com/layer_1.png",
							"size": "2048x2048",
							"output_format": "png",
							"z_index": 2,
							"name": "Background",
							"description": "Cyberpunk city background",
							"bounding_box": {
								"absolute": [0, 0, 2048, 2048],
								"normalized": [0.0, 0.0, 1.0, 1.0]
							}
						}
					],
					"usage": {
						"generated_images": 1,
						"input_images": 0,
						"output_tokens": 16384,
						"total_tokens": 16384
					}
				}`))
				return
			}

			// Standard single image response
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{
				"created": 1720000000,
				"model": "doubao-seedream-5-0-pro-260628",
				"data": [
					{
						"url": "https://tos.example.com/image_single.png",
						"size": "2048x2048",
						"output_format": "jpeg"
					}
				],
				"usage": {
					"generated_images": 1,
					"output_tokens": 8192,
					"total_tokens": 8192
				}
			}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()

	adapter := NewArkAdapter(ArkConfig{
		BaseURL: server.URL,
	})

	ctx := context.Background()

	// 1. Layer decomposition flow
	task := &model.MediaTask{
		ID:         "task-img-layer",
		Model:      "doubao-seedream-5-0-pro-260628",
		TaskType:   "image_generation",
		Prompt:     "A character in a futuristic city",
		ParamsJSON: `{"size": "2K", "layer_decomposition": true}`,
	}

	taskID, err := adapter.SubmitTask(ctx, task)
	if err != nil {
		t.Fatalf("submit layer decomp task failed: %v", err)
	}

	task.ProviderTaskID = taskID
	result, err := adapter.PollTask(ctx, task)
	if err != nil {
		t.Fatalf("poll layer decomp task failed: %v", err)
	}

	if result.Status != model.TaskStatusSucceeded {
		t.Fatalf("expected succeeded, got: %s", result.Status)
	}
	// Expected assets: 1 base + 2 layers = 3 assets
	if len(result.Assets) != 3 {
		t.Fatalf("expected 3 assets (1 base + 2 layers), got %d", len(result.Assets))
	}
	if result.Assets[0].Kind != "image_base" || result.Assets[1].Kind != "image_layer" || result.Assets[2].Kind != "image_layer" {
		t.Errorf("unexpected asset kinds: %+v", result.Assets)
	}
	if !strings.Contains(result.Assets[1].BoundingBoxJSON, "100") {
		t.Errorf("unexpected bounding box JSON: %s", result.Assets[1].BoundingBoxJSON)
	}

	// 2. Test restart recovery from BillingDetailsJSON when memory cache is wiped
	adapter.imageCache.Delete(taskID)
	recoveredResult, err := adapter.PollTask(ctx, task)
	if err != nil {
		t.Fatalf("expected restart recovery to succeed from task.BillingDetailsJSON: %v", err)
	}
	if len(recoveredResult.Assets) != 3 {
		t.Fatalf("expected 3 assets from recovered result, got %d", len(recoveredResult.Assets))
	}
}

func TestArkAdapter_DownloadAsset(t *testing.T) {
	tempDir := t.TempDir()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("DOWNLOADED_BINARY_IMAGE_DATA_12345"))
	}))
	defer server.Close()

	adapter := NewArkAdapter(ArkConfig{})
	ctx := context.Background()

	// 1. HTTP remote download
	targetPath := filepath.Join(tempDir, "images", "task1", "base.png")
	if err := adapter.DownloadAsset(ctx, server.URL+"/test.png", targetPath); err != nil {
		t.Fatalf("download asset failed: %v", err)
	}

	content, err := os.ReadFile(targetPath)
	if err != nil || string(content) != "DOWNLOADED_BINARY_IMAGE_DATA_12345" {
		t.Fatalf("unexpected downloaded content: %s, err: %v", string(content), err)
	}

	// 2. Data URI decoding
	dataURI := "data:image/png;base64,RkFLRV9EQVRBX1VSSV9QQVlMT0FE"
	targetPath2 := filepath.Join(tempDir, "images", "task1", "layer_00.png")
	if err := adapter.DownloadAsset(ctx, dataURI, targetPath2); err != nil {
		t.Fatalf("download data URI failed: %v", err)
	}

	content2, err := os.ReadFile(targetPath2)
	if err != nil || string(content2) != "FAKE_DATA_URI_PAYLOAD" {
		t.Fatalf("unexpected data URI decoded content: %s, err: %v", string(content2), err)
	}
}

package adapter

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync/atomic"
	"time"

	"media-workstage/internal/model"
)

// APIMartAdapter generates images and videos (Kling, MiniMax-H3) through APIMart's unified async API:
// POST /images/generations or /videos/generations returns a task_id, then GET /tasks/{id} is polled.
type APIMartAdapter struct {
	channelImageBase
	// Set once the endpoint answers 404/405 (relays that do not forward /uploads/images).
	uploadUnsupported atomic.Bool
}

func NewAPIMartAdapter(cfg ChannelConfig) *APIMartAdapter {
	return &APIMartAdapter{channelImageBase: newChannelImageBase("apimart", "https://api.apimart.ai/v1", cfg)}
}

type apimartImageRequest struct {
	Model        string `json:"model"`
	Prompt       string `json:"prompt"`
	N            int    `json:"n"`
	Size         string `json:"size,omitempty"`
	Resolution   string `json:"resolution,omitempty"`
	OutputFormat string `json:"output_format,omitempty"`
}

type apimartSubmitResponse struct {
	Data []struct {
		Status string `json:"status"`
		TaskID string `json:"task_id"`
	} `json:"data"`
}

type apimartTaskResponse struct {
	Data struct {
		ID       string `json:"id"`
		Status   string `json:"status"` // pending | processing | completed | failed
		Progress int    `json:"progress"`
		Result   *struct {
			Images []apimartMedia `json:"images"`
			Videos []apimartMedia `json:"videos"`
		} `json:"result"`
		Error *struct {
			Code    any    `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	} `json:"data"`
}

func (a *APIMartAdapter) SubmitTask(ctx context.Context, task *model.MediaTask) (string, error) {
	switch task.TaskType {
	case "image_generation":
		return a.submitImage(ctx, task)
	case "video_generation":
		return a.submitVideo(ctx, task)
	}
	return "", fmt.Errorf("apimart 渠道不支持 %s 任务", task.TaskType)
}

func (a *APIMartAdapter) submitImage(ctx context.Context, task *model.MediaTask) (string, error) {
	params := parseGenericImageParams(task.ParamsJSON)

	reqBody := apimartImageRequest{
		Model:  task.Model,
		Prompt: task.Prompt,
		N:      1,
		Size:   params.AspectRatio,
	}
	if params.Resolution != "" {
		// GPT image models document lowercase tiers ("2k"); the others use "2K".
		reqBody.Resolution = params.Resolution
		if isGPTImageModel(task.Model) {
			reqBody.Resolution = strings.ToLower(params.Resolution)
		}
	}
	if isGPTImageModel(task.Model) {
		switch params.OutputFormat {
		case "png", "jpeg", "webp":
			reqBody.OutputFormat = params.OutputFormat
		}
	}
	body, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("failed to marshal apimart request: %w", err)
	}
	return a.postTask(ctx, "/images/generations", body)
}

// postTask submits a generation request and returns APIMart's task_id.
func (a *APIMartAdapter) postTask(ctx context.Context, path string, body []byte) (string, error) {
	baseURL, apiKey := a.credentials()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+path, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	var resp apimartSubmitResponse
	if err := a.doJSON(req, &resp); err != nil {
		return "", err
	}
	if len(resp.Data) == 0 || resp.Data[0].TaskID == "" {
		return "", errors.New("apimart did not return a task_id")
	}
	return resp.Data[0].TaskID, nil
}

func (a *APIMartAdapter) PollTask(ctx context.Context, task *model.MediaTask) (*PollResult, error) {
	baseURL, apiKey := a.credentials()
	endpoint := fmt.Sprintf("%s/tasks/%s?language=zh", baseURL, url.PathEscape(task.ProviderTaskID))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)

	var resp apimartTaskResponse
	if err := a.doJSON(req, &resp); err != nil {
		return nil, err
	}

	switch resp.Data.Status {
	case "completed":
		res := &PollResult{Status: model.TaskStatusSucceeded, Progress: 100}
		if resp.Data.Result != nil {
			if task.TaskType == "video_generation" {
				for _, v := range resp.Data.Result.Videos {
					for _, u := range v.urls() {
						res.Assets = append(res.Assets, videoAsset(task.ID, len(res.Assets), u))
					}
				}
			} else {
				for _, img := range resp.Data.Result.Images {
					for _, u := range img.urls() {
						res.Assets = append(res.Assets, imageAsset(task.ID, len(res.Assets), u, imageExt("", u)))
					}
				}
			}
		}
		if len(res.Assets) == 0 {
			return &PollResult{Status: model.TaskStatusFailed, ErrorCode: "EmptyResult", ErrorMessage: "apimart 任务完成但没有返回结果文件"}, nil
		}
		res.ResultURL = res.Assets[0].RemoteURL
		return res, nil

	case "failed":
		msg := "apimart 任务失败"
		if resp.Data.Error != nil && resp.Data.Error.Message != "" {
			msg = resp.Data.Error.Message
		}
		return &PollResult{Status: model.TaskStatusFailed, ErrorCode: "ProviderFailed", ErrorMessage: msg}, nil

	default: // pending | processing
		return &PollResult{Status: model.TaskStatusRunning, Progress: max(resp.Data.Progress, 10)}, nil
	}
}

// PollTimeout gives APIMart's queued jobs more than the poller's defaults: image jobs
// often take 1–3 minutes, Kling videos (pro / 4K, 10–15 s) can take far longer.
func (a *APIMartAdapter) PollTimeout(task *model.MediaTask) time.Duration {
	if task.TaskType == "video_generation" {
		return 30 * time.Minute
	}
	return 10 * time.Minute
}

package adapter

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"media-workstage/internal/model"
)

// MidjourneyAdapter serves the MJ Proxy protocol (midjourney-proxy's /mj API), which
// self-hosted proxies and new-api style relays both speak: POST /mj/submit/imagine
// returns a task ID, then GET /mj/task/{id}/fetch is polled. The bound model is the
// bot type (MID_JOURNEY / NIJI_JOURNEY); the result is Midjourney's 2x2 grid as one image.
type MidjourneyAdapter struct {
	channelImageBase
}

func NewMidjourneyAdapter(cfg ChannelConfig) *MidjourneyAdapter {
	// There is no official host, so the base URL always comes from config.
	return &MidjourneyAdapter{channelImageBase: newChannelImageBase("midjourney", "", cfg)}
}

type midjourneyImagineRequest struct {
	BotType string `json:"botType,omitempty"`
	Prompt  string `json:"prompt"`
}

type midjourneySubmitResponse struct {
	Code        int             `json:"code"`
	Description string          `json:"description"`
	Result      json.RawMessage `json:"result"` // task ID, as a string or a bare number
}

type midjourneyFetchResponse struct {
	ID          string `json:"id"`
	Status      string `json:"status"`   // NOT_START | SUBMITTED | MODAL | IN_PROGRESS | SUCCESS | FAILURE | CANCEL
	Progress    string `json:"progress"` // "45%"
	ImageURL    string `json:"imageUrl"`
	FailReason  string `json:"failReason"`
	Description string `json:"description"` // set on relay error envelopes, which carry no status
}

// Submit codes that carry a task ID: 1 accepted, 22 queued.
const (
	midjourneyCodeSubmitted = 1
	midjourneyCodeQueued    = 22
)

func (a *MidjourneyAdapter) SubmitTask(ctx context.Context, task *model.MediaTask) (string, error) {
	if err := requireImageTask(a.name, task); err != nil {
		return "", err
	}
	body, err := json.Marshal(midjourneyImagineRequest{
		BotType: midjourneyBotType(task.Model),
		Prompt:  midjourneyPrompt(task.Prompt, parseGenericImageParams(task.ParamsJSON)),
	})
	if err != nil {
		return "", fmt.Errorf("failed to marshal midjourney request: %w", err)
	}
	baseURL, apiKey := a.credentials()
	if baseURL == "" {
		return "", fmt.Errorf("%s 未填写 Base URL：Midjourney 没有官方地址，请在设置中填写代理或中转地址", a.name)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/mj/submit/imagine", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	setMidjourneyKey(req, apiKey)

	var resp midjourneySubmitResponse
	if err := a.doJSON(req, &resp); err != nil {
		return "", err
	}
	id := strings.Trim(strings.TrimSpace(string(resp.Result)), `"`)
	if resp.Code != midjourneyCodeSubmitted && resp.Code != midjourneyCodeQueued {
		return "", fmt.Errorf("%s 提交失败（code %d）：%s", a.name, resp.Code, resp.Description)
	}
	if id == "" || id == "null" {
		return "", fmt.Errorf("%s did not return a task ID", a.name)
	}
	return id, nil
}

func (a *MidjourneyAdapter) PollTask(ctx context.Context, task *model.MediaTask) (*PollResult, error) {
	baseURL, apiKey := a.credentials()
	endpoint := fmt.Sprintf("%s/mj/task/%s/fetch", baseURL, url.PathEscape(task.ProviderTaskID))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	setMidjourneyKey(req, apiKey)

	var resp midjourneyFetchResponse
	if err := a.doJSON(req, &resp); err != nil {
		return nil, err
	}

	switch resp.Status {
	case "SUCCESS":
		if resp.ImageURL == "" {
			return &PollResult{Status: model.TaskStatusFailed, ErrorCode: "EmptyResult", ErrorMessage: "Midjourney 任务完成但没有返回图片"}, nil
		}
		asset := imageAsset(task.ID, 0, resp.ImageURL, imageExt("", resp.ImageURL))
		return &PollResult{
			Status:    model.TaskStatusSucceeded,
			Progress:  100,
			ResultURL: resp.ImageURL,
			Assets:    []model.TaskAsset{asset},
		}, nil

	case "FAILURE", "CANCEL":
		msg := resp.FailReason
		if msg == "" {
			msg = "Midjourney 任务失败"
			if resp.Status == "CANCEL" {
				msg = "Midjourney 任务已取消"
			}
		}
		return &PollResult{Status: model.TaskStatusFailed, ErrorCode: "ProviderFailed", ErrorMessage: msg}, nil

	case "":
		// midjourney-proxy answers an unknown ID with an empty body; relays with an error envelope.
		msg := "Midjourney 服务找不到该任务"
		if resp.Description != "" {
			msg = resp.Description
		}
		return &PollResult{Status: model.TaskStatusFailed, ErrorCode: "TaskNotFound", ErrorMessage: msg}, nil

	default: // NOT_START | SUBMITTED | MODAL | IN_PROGRESS
		return &PollResult{Status: model.TaskStatusRunning, Progress: max(parseMidjourneyProgress(resp.Progress), 10)}, nil
	}
}

// PollTimeout covers Relax-mode queues, which routinely take several minutes per job.
func (a *MidjourneyAdapter) PollTimeout(*model.MediaTask) time.Duration {
	return 15 * time.Minute
}

// setMidjourneyKey sends the key both ways: midjourney-proxy reads mj-api-secret,
// relays read the Bearer token.
func setMidjourneyKey(req *http.Request, apiKey string) {
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("mj-api-secret", apiKey)
}

// midjourneyBotType returns the botType for a bound model. Relays such as new-api list
// billing model names (mj_imagine, ...) instead; those send no botType, so the proxy's
// default (MID_JOURNEY) applies.
func midjourneyBotType(modelID string) string {
	switch bot := strings.ToUpper(strings.TrimSpace(modelID)); bot {
	case "MID_JOURNEY", "NIJI_JOURNEY":
		return bot
	}
	return ""
}

// midjourneyAspectFlag matches a prompt's own aspect parameter ("--ar 2:3", "--aspect 3:2"),
// including the em-dash form Midjourney also accepts ("—ar 2:3").
var midjourneyAspectFlag = regexp.MustCompile(`(?i)(^|\s)(--|—)(ar|aspect)(\s|$)`)

// midjourneyPrompt appends the card's aspect ratio as --ar unless the prompt already
// sets one; Midjourney takes no size field, and resolution does not apply to it.
func midjourneyPrompt(prompt string, params genericImageParams) string {
	prompt = strings.TrimSpace(prompt)
	if params.AspectRatio == "" || midjourneyAspectFlag.MatchString(prompt) {
		return prompt
	}
	if _, ok := ratioValue(params.AspectRatio); !ok {
		return prompt
	}
	return prompt + " --ar " + params.AspectRatio
}

// parseMidjourneyProgress reads midjourney-proxy's progress strings ("45%"); anything else is 0.
func parseMidjourneyProgress(s string) int {
	n, err := strconv.Atoi(strings.TrimSuffix(strings.TrimSpace(s), "%"))
	if err != nil {
		return 0
	}
	return min(max(n, 0), 100)
}

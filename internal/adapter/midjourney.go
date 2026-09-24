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
	ID          string             `json:"id"`
	Action      string             `json:"action"`   // IMAGINE | UPSCALE | VARIATION | REROLL | DESCRIBE | BLEND | ...
	Status      string             `json:"status"`   // NOT_START | SUBMITTED | MODAL | IN_PROGRESS | SUCCESS | FAILURE | CANCEL
	Progress    string             `json:"progress"` // "45%"
	ImageURL    string             `json:"imageUrl"`
	FailReason  string             `json:"failReason"`
	Description string             `json:"description"` // task description, or the error text of a relay envelope
	Buttons     []midjourneyButton `json:"buttons"`
	Properties  struct {
		FinalPrompt string `json:"finalPrompt"`
	} `json:"properties"`
}

// midjourneyButton is one follow-up the result offers; customId is what /mj/submit/action takes.
type midjourneyButton struct {
	CustomID string `json:"customId"`
	Label    string `json:"label"`
	Emoji    string `json:"emoji"`
}

// midjourneyActionParams are the task params of a follow-up action (task_mode "action").
type midjourneyActionParams struct {
	SourceProviderTaskID string `json:"source_provider_task_id"`
	ActionID             string `json:"action_id"`
}

type midjourneyActionRequest struct {
	TaskID            string `json:"taskId"`
	CustomID          string `json:"customId"`
	ChooseSameChannel bool   `json:"chooseSameChannel"`
}

type midjourneyModalRequest struct {
	TaskID string `json:"taskId"`
	Prompt string `json:"prompt"`
}

// Submit codes: 1 accepted and 22 queued carry a new task ID. 21 is used both for "task
// already exists" and "waiting for a modal"; the task's status tells them apart.
const (
	midjourneyCodeSubmitted = 1
	midjourneyCodeExisting  = 21
	midjourneyCodeQueued    = 22
)

// SubmitTask dispatches on the task mode: "action" runs a follow-up on a finished task,
// anything else is an imagine.
func (a *MidjourneyAdapter) SubmitTask(ctx context.Context, task *model.MediaTask) (string, error) {
	if err := requireImageTask(a.name, task); err != nil {
		return "", err
	}
	if baseURL, _ := a.credentials(); baseURL == "" {
		return "", fmt.Errorf("%s 未填写 Base URL：Midjourney 没有官方地址，请在设置中填写代理或中转地址", a.name)
	}
	switch task.TaskMode {
	case "action":
		return a.submitAction(ctx, task)
	default:
		return a.submitImagine(ctx, task)
	}
}

func (a *MidjourneyAdapter) submitImagine(ctx context.Context, task *model.MediaTask) (string, error) {
	resp, err := a.postSubmit(ctx, "/mj/submit/imagine", midjourneyImagineRequest{
		BotType: midjourneyBotType(task.Model),
		Prompt:  midjourneyPrompt(task.Prompt, parseGenericImageParams(task.ParamsJSON)),
	})
	if err != nil {
		return "", err
	}
	return a.acceptedID(resp)
}

// submitAction runs one of the source task's buttons. An action that opens a modal (a
// variation in remix mode, for one) is confirmed with the task's prompt.
func (a *MidjourneyAdapter) submitAction(ctx context.Context, task *model.MediaTask) (string, error) {
	var params midjourneyActionParams
	_ = json.Unmarshal([]byte(task.ParamsJSON), &params)
	if params.SourceProviderTaskID == "" || params.ActionID == "" {
		return "", fmt.Errorf("%s 后续操作缺少来源任务或操作 ID", a.name)
	}
	resp, err := a.postSubmit(ctx, "/mj/submit/action", midjourneyActionRequest{
		TaskID:            params.SourceProviderTaskID,
		CustomID:          params.ActionID,
		ChooseSameChannel: true,
	})
	if err != nil {
		return "", err
	}
	if resp.Code != midjourneyCodeExisting {
		return a.acceptedID(resp)
	}

	id := resp.taskID()
	if id == "" {
		return "", fmt.Errorf("%s 提交失败（code %d）：%s", a.name, resp.Code, resp.Description)
	}
	existing, err := a.fetch(ctx, id)
	if err != nil {
		return "", err
	}
	if existing.Status != "MODAL" {
		return id, nil
	}
	modal, err := a.postSubmit(ctx, "/mj/submit/modal", midjourneyModalRequest{TaskID: id, Prompt: strings.TrimSpace(task.Prompt)})
	if err != nil {
		return "", err
	}
	return a.acceptedID(modal)
}

// postSubmit sends a /mj/submit/* request and decodes the submit envelope.
func (a *MidjourneyAdapter) postSubmit(ctx context.Context, path string, payload any) (*midjourneySubmitResponse, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal midjourney request: %w", err)
	}
	baseURL, apiKey := a.credentials()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	setMidjourneyKey(req, apiKey)

	var resp midjourneySubmitResponse
	if err := a.doJSON(req, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// acceptedID returns the new task ID of an accepted (1) or queued (22) submission.
func (a *MidjourneyAdapter) acceptedID(resp *midjourneySubmitResponse) (string, error) {
	if resp.Code != midjourneyCodeSubmitted && resp.Code != midjourneyCodeQueued {
		return "", fmt.Errorf("%s 提交失败（code %d）：%s", a.name, resp.Code, resp.Description)
	}
	id := resp.taskID()
	if id == "" {
		return "", fmt.Errorf("%s did not return a task ID", a.name)
	}
	return id, nil
}

// taskID reads the result field, which carries the task ID as a string or a bare number.
func (r *midjourneySubmitResponse) taskID() string {
	id := strings.Trim(strings.TrimSpace(string(r.Result)), `"`)
	if id == "null" {
		return ""
	}
	return id
}

// fetch reads one task from /mj/task/{id}/fetch.
func (a *MidjourneyAdapter) fetch(ctx context.Context, id string) (*midjourneyFetchResponse, error) {
	baseURL, apiKey := a.credentials()
	endpoint := fmt.Sprintf("%s/mj/task/%s/fetch", baseURL, url.PathEscape(id))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	setMidjourneyKey(req, apiKey)

	var resp midjourneyFetchResponse
	if err := a.doJSON(req, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

func (a *MidjourneyAdapter) PollTask(ctx context.Context, task *model.MediaTask) (*PollResult, error) {
	resp, err := a.fetch(ctx, task.ProviderTaskID)
	if err != nil {
		return nil, err
	}

	if resp.ID == "" {
		// midjourney-proxy answers an unknown ID with an empty body; relays with an error envelope.
		msg := "Midjourney 服务找不到该任务"
		if resp.Description != "" {
			msg = resp.Description
		}
		return &PollResult{Status: model.TaskStatusFailed, ErrorCode: "TaskNotFound", ErrorMessage: msg}, nil
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
			Actions:   midjourneyActions(resp.Buttons),
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

	default:
		// Only SUCCESS / FAILURE / CANCEL end a task. NOT_START, SUBMITTED, MODAL, IN_PROGRESS,
		// and anything unlisted keep polling until the poll timeout; some gateways report an
		// empty status right after submit.
		return &PollResult{Status: model.TaskStatusRunning, Progress: max(parseMidjourneyProgress(resp.Progress), 10)}, nil
	}
}

// PollTimeout covers Relax-mode queues, which routinely take several minutes per job.
func (a *MidjourneyAdapter) PollTimeout(*model.MediaTask) time.Duration {
	return 15 * time.Minute
}

// midjourneyInteractiveButtons marks buttons that need user input (a zoom factor, a
// region mask, an image picker) or only bookmark the message; they are not offered.
var midjourneyInteractiveButtons = []string{"CustomZoom", "Inpaint", "PicReader", "BOOKMARK"}

// midjourneyActions turns the result's buttons into the follow-ups a card can run directly.
func midjourneyActions(buttons []midjourneyButton) []model.TaskAction {
	var actions []model.TaskAction
next:
	for _, b := range buttons {
		if b.CustomID == "" {
			continue
		}
		for _, marker := range midjourneyInteractiveButtons {
			if strings.Contains(b.CustomID, "::"+marker+"::") {
				continue next
			}
		}
		actions = append(actions, model.TaskAction{ID: b.CustomID, Label: b.Label, Emoji: b.Emoji})
	}
	return actions
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

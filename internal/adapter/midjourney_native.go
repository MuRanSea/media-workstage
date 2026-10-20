package adapter

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"media-workstage/internal/model"
)

// The Heighliner gateway's native Midjourney entry (<gateway>/midjourney) speaks the
// versioned workflow when every request carries this header: imagine, then plain
// upscale (U) and variation (V) on a succeeded task, all keyed by platform task IDs.
const (
	midjourneyNativeVersionHeader = "X-Heighliner-MJ-Response-Version"
	midjourneyNativeVersion       = "2026-10-16"
)

// MidjourneyNativeBase reports whether baseURL is a gateway's native Midjourney entry
// (a path ending in /midjourney, with or without /v1) and returns it without the /v1.
func MidjourneyNativeBase(baseURL string) (string, bool) {
	base := strings.TrimSuffix(strings.TrimRight(strings.TrimSpace(baseURL), "/"), "/v1")
	u, err := url.Parse(base)
	if err != nil || !strings.HasSuffix(strings.ToLower(u.Path), "/midjourney") {
		return "", false
	}
	return base, true
}

type midjourneyNativeImagineRequest struct {
	Prompt string `json:"prompt"`
	Size   string `json:"size,omitempty"`
	Speed  string `json:"speed,omitempty"`
}

type midjourneyNativeActionRequest struct {
	SourceTaskID string `json:"source_task_id"`
	Index        int    `json:"index"`
	Speed        string `json:"speed,omitempty"`
}

// midjourneyNativeTask is the data object of a versioned submit or query response.
type midjourneyNativeTask struct {
	PlatformTaskID   string   `json:"platform_task_id"`
	Status           string   `json:"status"` // queued | running | succeeded | failed | reconciling
	Progress         string   `json:"progress"`
	ImageURLs        []string `json:"image_urls"`
	AvailableActions []struct {
		Operation string `json:"operation"` // upscale | variation
		Index     int    `json:"index"`
		Enabled   bool   `json:"enabled"`
	} `json:"available_actions"`
	Error *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
		Stage   string `json:"stage"`
	} `json:"error"`
}

// midjourneyNativeOperations are the result actions the versioned workflow runs, with
// the button label prefix each gets.
var midjourneyNativeOperations = map[string]string{"upscale": "U", "variation": "V"}

func (a *MidjourneyAdapter) submitNative(ctx context.Context, base string, task *model.MediaTask) (string, error) {
	switch task.TaskMode {
	case midjourneyModeAction:
		return a.submitNativeAction(ctx, base, task)
	case midjourneyModeBlend, midjourneyModeDescribe:
		return "", fmt.Errorf("%s 新版 Midjourney 接口只支持文生图与 U/V，不支持 Blend 和反推提示词", a.name)
	}
	if len(parseReferenceAssets(task.ParamsJSON)) > 0 {
		return "", fmt.Errorf("%s 新版 Midjourney 接口不支持参考图，请断开参考图后再生成", a.name)
	}
	if strings.EqualFold(strings.TrimSpace(task.Model), "NIJI_JOURNEY") {
		return "", fmt.Errorf("%s 新版 Midjourney 接口不支持 Niji 机器人，请改用 MID_JOURNEY 模型", a.name)
	}
	params := parseGenericImageParams(task.ParamsJSON)
	prompt := strings.TrimSpace(task.Prompt)
	req := midjourneyNativeImagineRequest{Prompt: prompt, Speed: midjourneyNativeSpeed(params.Speed, prompt)}
	// The prompt's own --ar wins; sending a size too would conflict with it.
	if !midjourneyAspectFlag.MatchString(prompt) {
		if _, ok := ratioValue(params.AspectRatio); ok {
			req.Size = params.AspectRatio
		}
	}
	return a.postNative(ctx, base+"/v1/generations", task.ID, req)
}

func (a *MidjourneyAdapter) submitNativeAction(ctx context.Context, base string, task *model.MediaTask) (string, error) {
	var params struct {
		midjourneyActionParams
		Speed string `json:"speed"`
	}
	_ = json.Unmarshal([]byte(task.ParamsJSON), &params)
	if params.SourceProviderTaskID == "" || params.ActionID == "" {
		return "", fmt.Errorf("%s 后续操作缺少来源任务或操作 ID", a.name)
	}
	operation, index, ok := parseMidjourneyNativeAction(params.ActionID)
	if !ok {
		return "", fmt.Errorf("%s 新版 Midjourney 接口不支持操作 %q", a.name, params.ActionID)
	}
	return a.postNative(ctx, base+"/v1/generations/"+operation, task.ID, midjourneyNativeActionRequest{
		SourceTaskID: params.SourceProviderTaskID,
		Index:        index,
		Speed:        midjourneyNativeSpeed(strings.ToUpper(strings.TrimSpace(params.Speed)), ""),
	})
}

// postNative submits one generation. The task ID is the idempotency key, so a resubmit
// of the same task after a lost response gets the original platform task back.
func (a *MidjourneyAdapter) postNative(ctx context.Context, endpoint, taskID string, payload any) (string, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("failed to marshal midjourney request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "media-workstage-"+taskID)
	a.setNativeHeaders(req)

	var resp struct {
		Data midjourneyNativeTask `json:"data"`
	}
	if err := a.doJSON(req, &resp); err != nil {
		return "", err
	}
	if resp.Data.PlatformTaskID == "" {
		return "", fmt.Errorf("%s 没有返回平台任务 ID（状态 %s），请稍后重试同一任务", a.name, resp.Data.Status)
	}
	return resp.Data.PlatformTaskID, nil
}

func (a *MidjourneyAdapter) pollNative(ctx context.Context, base string, task *model.MediaTask) (*PollResult, error) {
	endpoint := fmt.Sprintf("%s/v1/%s?id_type=platform", base, url.PathEscape(task.ProviderTaskID))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	a.setNativeHeaders(req)
	var resp struct {
		Data midjourneyNativeTask `json:"data"`
	}
	if err := a.doJSON(req, &resp); err != nil {
		return nil, err
	}
	data := resp.Data

	switch data.Status {
	case "succeeded":
		if len(data.ImageURLs) == 0 || data.ImageURLs[0] == "" {
			return &PollResult{Status: model.TaskStatusFailed, ErrorCode: "EmptyResult", ErrorMessage: "Midjourney 任务完成但没有返回图片"}, nil
		}
		imageURL := data.ImageURLs[0]
		return &PollResult{
			Status:        model.TaskStatusSucceeded,
			Progress:      100,
			ResultURL:     imageURL,
			Assets:        []model.TaskAsset{imageAsset(task.ID, 0, imageURL, imageExt("", imageURL))},
			ResultActions: midjourneyNativeActions(data),
		}, nil
	case "failed":
		code, msg := "ProviderFailed", "Midjourney 任务失败"
		if data.Error != nil {
			if data.Error.Code != "" {
				code = data.Error.Code
			}
			if data.Error.Message != "" {
				msg = data.Error.Message
			}
		}
		return &PollResult{Status: model.TaskStatusFailed, ErrorCode: code, ErrorMessage: msg}, nil
	default:
		// queued, running and reconciling (submission outcome being verified) keep polling.
		return &PollResult{Status: model.TaskStatusRunning, Progress: max(parseMidjourneyProgress(data.Progress), 10)}, nil
	}
}

func (a *MidjourneyAdapter) setNativeHeaders(req *http.Request) {
	_, apiKey := a.credentials()
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set(midjourneyNativeVersionHeader, midjourneyNativeVersion)
}

// midjourneyNativeActions lists the enabled U/V buttons as "<operation>:<index>" actions.
func midjourneyNativeActions(data midjourneyNativeTask) []model.ResultAction {
	var actions []model.ResultAction
	for _, act := range data.AvailableActions {
		prefix, ok := midjourneyNativeOperations[act.Operation]
		if !ok || !act.Enabled || act.Index < 1 || act.Index > 4 {
			continue
		}
		actions = append(actions, model.ResultAction{
			ID:    fmt.Sprintf("%s:%d", act.Operation, act.Index),
			Label: fmt.Sprintf("%s%d", prefix, act.Index),
		})
	}
	return actions
}

// parseMidjourneyNativeAction reads an action ID made by midjourneyNativeActions.
func parseMidjourneyNativeAction(id string) (operation string, index int, ok bool) {
	operation, n, found := strings.Cut(id, ":")
	if !found {
		return "", 0, false
	}
	if _, known := midjourneyNativeOperations[operation]; !known {
		return "", 0, false
	}
	index, err := strconv.Atoi(n)
	if err != nil || index < 1 || index > 4 {
		return "", 0, false
	}
	return operation, index, true
}

// midjourneyNativeSpeed is the speed field: a speed flag in the prompt wins (the field
// must not contradict it), else the card's mode; empty leaves the gateway default.
func midjourneyNativeSpeed(cardSpeed, prompt string) string {
	if m := midjourneySpeedFlag.FindStringSubmatch(prompt); m != nil {
		return strings.ToLower(m[3])
	}
	switch cardSpeed {
	case "FAST", "RELAX", "TURBO":
		return strings.ToLower(cardSpeed)
	}
	return ""
}

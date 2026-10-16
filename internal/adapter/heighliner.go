package adapter

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"media-workstage/internal/model"
)

// HeighlinerAdapter runs image, video and 3D cards through the Heighliner gateway's media
// platform protocol: POST <root>/media/v1/{images,videos,3d}/generations creates a task,
// GET <root>/media/v1/tasks/{id} is polled. The base URL is the gateway root.
//
// Cards compile only fields the model's capability descriptor declares (ADR 0010); the
// adapter adds nothing of its own beyond model, prompt, references and wait.
type HeighlinerAdapter struct {
	channelImageBase

	filesMu sync.Mutex
	files   map[string]heighlinerFile // "path|size|mtime" -> uploaded reference file

	backoffMu sync.Mutex
	notBefore map[string]time.Time // local task ID -> no poll before (429 Retry-After, redownload)

	deliveryMu  sync.Mutex
	undelivered map[string]time.Time // local task ID -> first poll that found it succeeded but not fully readable
	redownloads map[string]int       // local task ID -> downloads retried after a failed one

	// sleep waits between submit retries and now reads the clock; tests swap them out.
	sleep func(ctx context.Context, d time.Duration) error
	now   func() time.Time
}

type heighlinerFile struct {
	id      string
	expires time.Time
}

// heighlinerParams is what a Heighliner card compiles into task params.
type heighlinerParams struct {
	// Parameters are the descriptor's top-level fields with values (prompt excluded).
	Parameters map[string]any `json:"parameters"`
	// ProviderOptions holds vendor fields under their namespace ({"tencent": {...}}).
	ProviderOptions map[string]any        `json:"provider_options"`
	ReferenceAssets []model.ReferenceItem `json:"reference_assets"`

	// ActionID and SourceProviderTaskID mark a follow-up on a finished task (the server
	// checks the source and fills the gateway's task ID in): today only 样片 → 正式视频.
	ActionID             string `json:"action_id"`
	SourceProviderTaskID string `json:"source_provider_task_id"`
}

// HeighlinerActionFinalize is the result action a succeeded Seedance 2.5 sample (样片)
// offers: render the full video from it. The gateway never does this by itself.
const HeighlinerActionFinalize = "finalize"

// heighlinerReference is one entry of a request's references: one source of three.
type heighlinerReference struct {
	Role    string `json:"role"`
	Type    string `json:"type"`
	FileID  string `json:"file_id,omitempty"`
	AssetID string `json:"asset_id,omitempty"`
	URL     string `json:"url,omitempty"`
}

type heighlinerArtifact struct {
	Index    int    `json:"index"`
	Kind     string `json:"kind"` // image | video | model3d | audio | cover | last_frame, maybe more later
	MimeType string `json:"mime_type"`
	// State is available | pending | unavailable; only available is readable, unknown values never.
	State   string           `json:"state"`
	URL     string           `json:"url"`
	URLType string           `json:"url_type"` // upstream | signed
	Error   *heighlinerError `json:"error"`
	// Tolerated when present; signed URLs carry no file extension.
	Format   string `json:"format"`
	Filename string `json:"filename"`
}

type heighlinerError struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Stage     string `json:"stage"`
	Retryable bool   `json:"retryable"`
}

type heighlinerTask struct {
	ID     string `json:"id"`
	Status string `json:"status"`
	// GenerationStage is "draft" for a sample and "final" for a video made from one;
	// SourceTaskID is the sample a final video was made from.
	GenerationStage string               `json:"generation_stage"`
	SourceTaskID    string               `json:"source_task_id"`
	Progress        int                  `json:"progress"`
	Artifacts       []heighlinerArtifact `json:"artifacts"`
	Error           *heighlinerError     `json:"error"`
	Billing         json.RawMessage      `json:"billing"`
}

// HeighlinerAPIError is a non-2xx gateway response in the media protocol's error shape.
type HeighlinerAPIError struct {
	Status     int
	Code       string
	Message    string
	Stage      string
	Retryable  bool
	RetryAfter time.Duration
}

func (e *HeighlinerAPIError) Error() string {
	switch {
	case e.Code != "" && e.Message != "":
		return fmt.Sprintf("%s: %s", e.Code, e.Message)
	case e.Message != "":
		return e.Message
	case e.Code != "":
		return e.Code
	}
	return fmt.Sprintf("Heighliner 返回 HTTP %d", e.Status)
}

// Submit retries replay the same key and body (see submitRetryable); waits are capped so a
// card never hangs on one header. A succeeded task whose results are not all readable is
// asked again for heighlinerDeliveryGrace, and a failed download is retried with fresh
// links heighlinerRedownloads times, before what there is gets delivered.
const (
	heighlinerSubmitAttempts = 4
	heighlinerMaxRetryAfter  = time.Minute
	heighlinerFileLifetime   = 7 * 24 * time.Hour
	heighlinerDeliveryGrace  = 15 * time.Minute
	heighlinerRedownloads    = 3
)

func NewHeighlinerAdapter(cfg ChannelConfig) *HeighlinerAdapter {
	if cfg.HTTPClient == nil {
		// Requests return at once (wait=0); uploads of reference videos take longer.
		cfg.HTTPClient = &http.Client{Timeout: 5 * time.Minute}
	}
	a := &HeighlinerAdapter{
		channelImageBase: newChannelImageBase("heighliner", "https://platform.sgt.site", cfg),
		files:            map[string]heighlinerFile{},
		notBefore:        map[string]time.Time{},
		undelivered:      map[string]time.Time{},
		redownloads:      map[string]int{},
		now:              time.Now,
	}
	a.sleep = func(ctx context.Context, d time.Duration) error {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(d):
			return nil
		}
	}
	return a
}

// heighlinerEndpoint maps a task type onto its generation path.
func heighlinerEndpoint(taskType string) (string, bool) {
	switch taskType {
	case "image_generation":
		return "/media/v1/images/generations", true
	case "video_generation":
		return "/media/v1/videos/generations", true
	case "3d_generation":
		return "/media/v1/3d/generations", true
	}
	return "", false
}

func (a *HeighlinerAdapter) SubmitTask(ctx context.Context, task *model.MediaTask) (string, error) {
	endpoint, ok := heighlinerEndpoint(task.TaskType)
	if !ok {
		return "", fmt.Errorf("%s 服务商不支持 %s 任务", a.name, task.TaskType)
	}
	var params heighlinerParams
	if task.ParamsJSON != "" {
		if err := json.Unmarshal([]byte(task.ParamsJSON), &params); err != nil {
			return "", fmt.Errorf("invalid task params: %w", err)
		}
	}

	submit := func(key string) (string, error) {
		var body []byte
		var err error
		if params.ActionID == HeighlinerActionFinalize {
			body, err = finalizeBody(task, params)
		} else {
			body, err = a.requestBody(ctx, task, params)
		}
		if err != nil {
			return "", err
		}
		return a.submitWithRetry(ctx, endpoint, key, body)
	}
	id, err := submit(task.ID)
	// A cached reference file the gateway no longer has: upload afresh and submit once more.
	// The body now names a new file, and a key once sent with other content is answered
	// with idempotency_conflict, so the second submission gets a key of its own.
	var apiErr *HeighlinerAPIError
	if err != nil && errors.As(err, &apiErr) && (apiErr.Code == "file_expired" || apiErr.Code == "file_not_found") && a.forgetFiles(params.ReferenceAssets) {
		id, err = submit(task.ID + "-reupload")
	}
	return id, err
}

// requestBody builds the generation request from the compiled card.
func (a *HeighlinerAdapter) requestBody(ctx context.Context, task *model.MediaTask, params heighlinerParams) ([]byte, error) {
	body := make(map[string]any, len(params.Parameters)+5)
	for k, v := range params.Parameters {
		// Explicit nulls are rejected by the gateway; an unset field is simply left out.
		if v != nil {
			body[k] = v
		}
	}
	body["model"] = task.Model
	if strings.TrimSpace(task.Prompt) != "" {
		body["prompt"] = task.Prompt
	} else {
		delete(body, "prompt")
	}
	if len(params.ProviderOptions) > 0 {
		body["provider_options"] = params.ProviderOptions
	} else {
		delete(body, "provider_options")
	}
	if len(params.ReferenceAssets) > 0 {
		refs := make([]heighlinerReference, len(params.ReferenceAssets))
		for i, ref := range params.ReferenceAssets {
			r, err := a.reference(ctx, ref)
			if err != nil {
				return nil, err
			}
			refs[i] = r
		}
		body["references"] = refs
	} else {
		delete(body, "references")
	}
	body["wait"] = 0
	return json.Marshal(body)
}

// finalizeBody renders the full video from a finished sample: the gateway inherits the
// prompt, references, duration, ratio, seed and audio from the sample and rejects any of
// them being sent again, so only the output settings go (resolution must be explicit).
func finalizeBody(task *model.MediaTask, params heighlinerParams) ([]byte, error) {
	if params.SourceProviderTaskID == "" {
		return nil, errors.New("正式视频缺少来源样片的任务 ID")
	}
	body := map[string]any{"model": task.Model, "resolution": "1080p", "wait": 0}
	if v, ok := params.Parameters["resolution"].(string); ok && v != "" {
		body["resolution"] = v
	}
	if v, ok := params.Parameters["output_format"].(string); ok && v != "" {
		body["output_format"] = v
	}
	volc := map[string]any{"draft_task_id": params.SourceProviderTaskID}
	if opts, ok := params.ProviderOptions["volcengine"].(map[string]any); ok {
		for _, k := range []string{"watermark", "return_last_frame"} {
			if v, ok := opts[k]; ok && v != nil {
				volc[k] = v
			}
		}
	}
	body["provider_options"] = map[string]any{"volcengine": volc}
	return json.Marshal(body)
}

// isSampleTask reports whether the task is a Seedance sample, by what the gateway says
// or, failing that, by what the card asked for.
func isSampleTask(task *model.MediaTask, resp *heighlinerTask) bool {
	if resp.GenerationStage != "" {
		return resp.GenerationStage == "draft"
	}
	var params heighlinerParams
	if json.Unmarshal([]byte(task.ParamsJSON), &params) != nil {
		return false
	}
	volc, _ := params.ProviderOptions["volcengine"].(map[string]any)
	draft, _ := volc["draft"].(bool)
	return draft
}

// referenceType is a reference's media type: as compiled, else implied by a legacy role
// or the file's extension.
func referenceType(ref model.ReferenceItem) string {
	if ref.Type != "" {
		return ref.Type
	}
	switch ref.Role {
	case "reference_video":
		return "video"
	case "reference_audio", "voice":
		return "audio"
	}
	name := ref.LocalPath
	if name == "" {
		name = ref.URL
		if u, err := url.Parse(ref.URL); err == nil {
			name = u.Path
		}
	}
	switch strings.ToLower(filepath.Ext(name)) {
	case ".mp4", ".mov", ".webm", ".m4v", ".mkv":
		return "video"
	case ".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac":
		return "audio"
	}
	return "image"
}

// reference resolves one reference to a single source. The card has already decided
// between a library asset (asset://, only where the role supports it) and the file.
func (a *HeighlinerAdapter) reference(ctx context.Context, ref model.ReferenceItem) (heighlinerReference, error) {
	out := heighlinerReference{Role: ref.Role, Type: referenceType(ref)}
	switch {
	case strings.HasPrefix(ref.URL, "asset://"):
		out.AssetID = strings.TrimPrefix(ref.URL, "asset://")
		if out.AssetID == "" {
			return out, fmt.Errorf("参考素材 %s 的素材 ID 为空", ref.Label)
		}
	case strings.HasPrefix(ref.URL, "http://") || strings.HasPrefix(ref.URL, "https://"):
		out.URL = ref.URL
	case strings.HasPrefix(ref.URL, "data:"):
		id, _, err := a.uploadFile(ctx, "", []byte(ref.URL), ref.Label)
		if err != nil {
			return out, fmt.Errorf("上传参考素材 %s 失败: %w", ref.Label, err)
		}
		out.FileID = id
	case ref.LocalPath != "":
		id, err := a.localFileID(ctx, ref.LocalPath)
		if err != nil {
			return out, fmt.Errorf("上传参考素材 %s 失败: %w", ref.Label, err)
		}
		out.FileID = id
	case strings.HasPrefix(ref.RemoteURL, "http://") || strings.HasPrefix(ref.RemoteURL, "https://"):
		out.URL = ref.RemoteURL
	default:
		return out, fmt.Errorf("参考素材 %s 没有可用的文件", ref.Label)
	}
	return out, nil
}

func fileCacheKey(localPath string) (string, error) {
	info, err := os.Stat(localPath)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%s|%d|%d", localPath, info.Size(), info.ModTime().UnixNano()), nil
}

// localFileID uploads a local file as a reference file (purpose=reference) and remembers
// its ID until an hour before it expires, so re-running a card does not upload it again.
func (a *HeighlinerAdapter) localFileID(ctx context.Context, localPath string) (string, error) {
	key, err := fileCacheKey(localPath)
	if err != nil {
		return "", err
	}
	a.filesMu.Lock()
	cached, ok := a.files[key]
	a.filesMu.Unlock()
	if ok && time.Now().Before(cached.expires) {
		return cached.id, nil
	}
	data, err := os.ReadFile(localPath)
	if err != nil {
		return "", err
	}
	id, expires, err := a.uploadFile(ctx, localPath, data, "")
	if err != nil {
		return "", err
	}
	a.filesMu.Lock()
	a.files[key] = heighlinerFile{id: id, expires: expires.Add(-time.Hour)}
	a.filesMu.Unlock()
	return id, nil
}

// forgetFiles drops the cached uploads of refs, reporting whether any was cached.
func (a *HeighlinerAdapter) forgetFiles(refs []model.ReferenceItem) bool {
	a.filesMu.Lock()
	defer a.filesMu.Unlock()
	dropped := false
	for _, ref := range refs {
		if ref.LocalPath == "" {
			continue
		}
		if key, err := fileCacheKey(ref.LocalPath); err == nil {
			if _, ok := a.files[key]; ok {
				delete(a.files, key)
				dropped = true
			}
		}
	}
	return dropped
}

// uploadFile sends a reference to POST /media/v1/files: a local file as multipart, or a
// data URI as JSON base64. It returns the file ID and when it expires.
func (a *HeighlinerAdapter) uploadFile(ctx context.Context, localPath string, data []byte, name string) (string, time.Time, error) {
	baseURL, apiKey := a.credentials()
	var (
		body        io.Reader
		contentType string
	)
	if localPath != "" {
		var buf bytes.Buffer
		w := multipart.NewWriter(&buf)
		_ = w.WriteField("purpose", "reference")
		header := make(textproto.MIMEHeader)
		header.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename=%q`, filepath.Base(localPath)))
		header.Set("Content-Type", mediaMimeForExt(filepath.Ext(localPath)))
		part, err := w.CreatePart(header)
		if err != nil {
			return "", time.Time{}, err
		}
		if _, err := part.Write(data); err != nil {
			return "", time.Time{}, err
		}
		if err := w.Close(); err != nil {
			return "", time.Time{}, err
		}
		body, contentType = &buf, w.FormDataContentType()
	} else {
		payload := map[string]any{"purpose": "reference", "base64": string(data)}
		if name != "" {
			payload["name"] = truncateRunes(name, 64)
		}
		raw, _ := json.Marshal(payload)
		body, contentType = bytes.NewReader(raw), "application/json"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/media/v1/files", body)
	if err != nil {
		return "", time.Time{}, err
	}
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Authorization", "Bearer "+apiKey)

	var file struct {
		ID        string          `json:"id"`
		Status    string          `json:"status"`
		ExpiresAt json.RawMessage `json:"expires_at"`
	}
	if _, err := a.do(req, &file); err != nil {
		return "", time.Time{}, err
	}
	if file.ID == "" {
		return "", time.Time{}, errors.New("文件接口没有返回 id")
	}
	expires := time.Now().Add(heighlinerFileLifetime)
	if t, ok := unixTime(file.ExpiresAt); ok {
		expires = t
	}
	return file.ID, expires, nil
}

func truncateRunes(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n])
	}
	return s
}

// unixTime reads a Unix-seconds timestamp given as a number or numeric string.
func unixTime(raw json.RawMessage) (time.Time, bool) {
	var n json.Number
	if len(raw) == 0 || json.Unmarshal(raw, &n) != nil {
		var s string
		if json.Unmarshal(raw, &s) != nil {
			return time.Time{}, false
		}
		n = json.Number(s)
	}
	v, err := n.Int64()
	if err != nil || v <= 0 {
		return time.Time{}, false
	}
	return time.Unix(v, 0), true
}

func mediaMimeForExt(ext string) string {
	switch strings.ToLower(ext) {
	case ".mp4", ".m4v":
		return "video/mp4"
	case ".mov":
		return "video/quicktime"
	case ".webm":
		return "video/webm"
	case ".mp3":
		return "audio/mpeg"
	case ".wav":
		return "audio/wav"
	case ".m4a", ".aac":
		return "audio/aac"
	}
	return mimeForExt(ext)
}

// submitWithRetry posts the generation with the local task ID as Idempotency-Key, so a
// replay (rate limit, a restart before the ID was saved) returns the original task.
func (a *HeighlinerAdapter) submitWithRetry(ctx context.Context, endpoint, key string, body []byte) (string, error) {
	baseURL, apiKey := a.credentials()
	var lastErr error
	for attempt := 0; attempt < heighlinerSubmitAttempts; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+endpoint, bytes.NewReader(body))
		if err != nil {
			return "", err
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+apiKey)
		req.Header.Set("Idempotency-Key", key)

		var task heighlinerTask
		_, err = a.do(req, &task)
		if err == nil {
			if task.ID == "" {
				return "", errors.New("Heighliner 没有返回任务 id")
			}
			return task.ID, nil
		}
		lastErr = err
		if !submitRetryable(ctx, err) {
			return "", err
		}
		var wait time.Duration
		if apiErr := (*HeighlinerAPIError)(nil); errors.As(err, &apiErr) {
			wait = apiErr.RetryAfter
		}
		if wait <= 0 {
			wait = time.Duration(attempt+1) * 2 * time.Second
		}
		if err := a.sleep(ctx, min(wait, heighlinerMaxRetryAfter)); err != nil {
			return "", err
		}
	}
	return "", lastErr
}

// submitRetryable reports whether a failed submission is replayed with the same key and
// body, which returns the original task if the gateway did accept it: a timeout or broken
// connection before an answer, a rate limit, a submission still being accepted, a 5xx
// other than an outright rejection, or anything the gateway marks retryable.
func submitRetryable(ctx context.Context, err error) bool {
	if ctx.Err() != nil {
		return false
	}
	var apiErr *HeighlinerAPIError
	if !errors.As(err, &apiErr) {
		return true
	}
	switch {
	case apiErr.Retryable, apiErr.Status == http.StatusTooManyRequests, apiErr.Code == "idempotency_in_progress":
		return true
	case apiErr.Code == "provider_rejected":
		return false
	}
	return apiErr.Status >= 500
}

// do sends req and decodes a 2xx JSON body into out; anything else becomes a
// HeighlinerAPIError carrying the gateway's code, message and Retry-After.
func (a *HeighlinerAdapter) do(req *http.Request, out any) (int, error) {
	resp, err := a.client.Do(req)
	if err != nil {
		return 0, fmt.Errorf("%s request failed: %w", a.name, err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return resp.StatusCode, fmt.Errorf("failed to read %s response: %w", a.name, err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		apiErr := &HeighlinerAPIError{Status: resp.StatusCode, RetryAfter: retryAfter(resp.Header.Get("Retry-After"))}
		var env struct {
			Error *heighlinerError `json:"error"`
		}
		if json.Unmarshal(raw, &env) == nil && env.Error != nil {
			apiErr.Code, apiErr.Message = env.Error.Code, env.Error.Message
			apiErr.Stage, apiErr.Retryable = env.Error.Stage, env.Error.Retryable
		} else {
			apiErr.Message = errMessage(raw)
		}
		return resp.StatusCode, apiErr
	}
	if len(bytes.TrimSpace(raw)) > 0 && out != nil {
		if err := json.Unmarshal(raw, out); err != nil {
			return resp.StatusCode, fmt.Errorf("failed to parse %s response: %w", a.name, err)
		}
	}
	return resp.StatusCode, nil
}

// retryAfter parses Retry-After as seconds or an HTTP date.
func retryAfter(v string) time.Duration {
	v = strings.TrimSpace(v)
	if v == "" {
		return 0
	}
	if secs, err := strconv.Atoi(v); err == nil {
		return time.Duration(max(secs, 0)) * time.Second
	}
	if t, err := http.ParseTime(v); err == nil {
		return max(time.Until(t), 0)
	}
	return 0
}

func (a *HeighlinerAdapter) PollTask(ctx context.Context, task *model.MediaTask) (*PollResult, error) {
	running := &PollResult{Status: model.TaskStatusRunning, Progress: task.Progress}
	a.backoffMu.Lock()
	until, backingOff := a.notBefore[task.ID]
	a.backoffMu.Unlock()
	if backingOff && a.now().Before(until) {
		return running, nil
	}

	baseURL, apiKey := a.credentials()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+"/media/v1/tasks/"+url.PathEscape(task.ProviderTaskID), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)

	var resp heighlinerTask
	if _, err := a.do(req, &resp); err != nil {
		var apiErr *HeighlinerAPIError
		if errors.As(err, &apiErr) {
			switch {
			case apiErr.Status == http.StatusTooManyRequests:
				wait := apiErr.RetryAfter
				if wait <= 0 {
					wait = 10 * time.Second
				}
				a.backoffMu.Lock()
				a.notBefore[task.ID] = a.now().Add(min(wait, 10*time.Minute))
				a.backoffMu.Unlock()
				return running, nil
			case apiErr.Status == http.StatusNotFound || apiErr.Status == http.StatusUnauthorized || apiErr.Status == http.StatusForbidden:
				// The task is gone or no longer readable with this key: polling cannot recover.
				return &PollResult{Status: model.TaskStatusFailed, ErrorCode: firstNonEmpty(apiErr.Code, "TaskUnreadable"), ErrorMessage: apiErr.Error()}, nil
			}
		}
		return nil, err
	}
	a.backoffMu.Lock()
	delete(a.notBefore, task.ID)
	a.backoffMu.Unlock()
	return a.pollResult(task, &resp), nil
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

// pollResult maps a media.task onto the poller's states and the task's assets.
func (a *HeighlinerAdapter) pollResult(task *model.MediaTask, resp *heighlinerTask) *PollResult {
	billing := ""
	if len(resp.Billing) > 0 && string(resp.Billing) != "null" {
		billing = string(resp.Billing)
	}
	switch resp.Status {
	case "succeeded":
		d := a.collectArtifacts(task, resp.Artifacts)
		if d.primary == 0 || d.unreadable > 0 {
			// Generation succeeded but delivery has not: empty artifacts, a pending or
			// unreadable item, or a delivery error. Asking again later gets the files;
			// regenerating would be billed twice. Past the grace, what is readable is
			// delivered, and with nothing readable the task fails with its gateway ID.
			if a.awaitDelivery(task.ID) {
				return &PollResult{Status: model.TaskStatusRunning, Progress: max(task.Progress, 95)}
			}
			if d.primary == 0 {
				a.forgetTask(task.ID)
				code, reason := "EmptyResult", d.reason
				if resp.Error != nil {
					code = firstNonEmpty(resp.Error.Code, code)
					reason = firstNonEmpty(reason, resp.Error.Message)
				}
				msg := fmt.Sprintf("Heighliner 任务已生成成功，但 %d 分钟内仍没有可读取的产物（网关任务 %s）。不要重新生成以免重复计费，请把任务 ID 交给平台核对",
					int(heighlinerDeliveryGrace/time.Minute), firstNonEmpty(resp.ID, task.ProviderTaskID))
				if reason != "" {
					msg += "：" + reason
				}
				return &PollResult{Status: model.TaskStatusFailed, ErrorCode: code, ErrorMessage: msg, BillingDetailsJSON: billing}
			}
		}
		a.forgetTask(task.ID)
		res := &PollResult{Status: model.TaskStatusSucceeded, Progress: 100, Assets: d.assets, BillingDetailsJSON: billing}
		res.ResultURL = d.assets[0].RemoteURL
		if task.TaskType == "video_generation" && isSampleTask(task, resp) {
			res.ResultActions = []model.ResultAction{{ID: HeighlinerActionFinalize, Label: "生成正式视频"}}
		}
		return res

	case "failed", "cancelled", "expired":
		a.forgetTask(task.ID)
		status := map[string]string{
			"failed":    model.TaskStatusFailed,
			"cancelled": model.TaskStatusCancelled,
			"expired":   model.TaskStatusExpired,
		}[resp.Status]
		res := &PollResult{Status: status, ErrorCode: "ProviderFailed", ErrorMessage: "Heighliner 任务" + map[string]string{
			"failed": "失败", "cancelled": "已取消", "expired": "已过期（厂商未完成生成）",
		}[resp.Status], BillingDetailsJSON: billing}
		if resp.Error != nil {
			if resp.Error.Code != "" {
				res.ErrorCode = resp.Error.Code
			}
			if resp.Error.Message != "" {
				res.ErrorMessage = resp.Error.Message
				if resp.Error.Code != "" {
					res.ErrorMessage = resp.Error.Code + ": " + resp.Error.Message
				}
			}
		}
		return res

	default: // queued | running | reconciling, and statuses added later
		return &PollResult{Status: model.TaskStatusRunning, Progress: max(resp.Progress, 10)}
	}
}

// awaitDelivery reports whether a succeeded task whose results are not all readable is
// still within the grace for asking again, starting the grace on its first such poll.
func (a *HeighlinerAdapter) awaitDelivery(taskID string) bool {
	a.deliveryMu.Lock()
	defer a.deliveryMu.Unlock()
	first, ok := a.undelivered[taskID]
	if !ok {
		a.undelivered[taskID] = a.now()
		return true
	}
	return a.now().Sub(first) < heighlinerDeliveryGrace
}

// forgetTask drops what the adapter remembers about a task once it is settled.
func (a *HeighlinerAdapter) forgetTask(taskID string) {
	a.deliveryMu.Lock()
	delete(a.undelivered, taskID)
	a.deliveryMu.Unlock()
	a.backoffMu.Lock()
	delete(a.notBefore, taskID)
	a.backoffMu.Unlock()
}

// RetryDelivery is asked by the poller when a succeeded task's downloads failed: the
// gateway's links can expire (403) or be briefly unreadable (502), and querying the task
// again returns fresh ones. It allows heighlinerRedownloads such rounds, each after a
// longer pause, then lets the poller settle with what it has.
func (a *HeighlinerAdapter) RetryDelivery(task *model.MediaTask) bool {
	a.deliveryMu.Lock()
	n := a.redownloads[task.ID]
	if n >= heighlinerRedownloads {
		delete(a.redownloads, task.ID)
		a.deliveryMu.Unlock()
		return false
	}
	a.redownloads[task.ID] = n + 1
	a.deliveryMu.Unlock()
	a.backoffMu.Lock()
	a.notBefore[task.ID] = a.now().Add(time.Duration(n+1) * 10 * time.Second)
	a.backoffMu.Unlock()
	return true
}

// heighlinerDelivery is what a succeeded task's artifacts give a card right now.
type heighlinerDelivery struct {
	assets     []model.TaskAsset
	primary    int    // readable main results: images, videos or 3D models
	unreadable int    // wanted artifacts not readable yet (pending, unavailable, no URL)
	reason     string // the gateway's word on an unreadable artifact, if any
}

// collectArtifacts picks the artifacts a card shows. Image and video tasks keep their
// images or videos, one result each, and a video its returned last frame; a 3D task keeps
// every model file, the Express preview video and the cover. Only an available artifact
// with an HTTP(S) URL is readable; any other state, known or not, is waited for.
func (a *HeighlinerAdapter) collectArtifacts(task *model.MediaTask, artifacts []heighlinerArtifact) heighlinerDelivery {
	baseURL, _ := a.credentials()
	var d heighlinerDelivery
	var lastFrames []string
	for _, art := range artifacts {
		var wanted, primary bool
		switch task.TaskType {
		case "image_generation":
			wanted, primary = art.Kind == "image", art.Kind == "image"
		case "video_generation":
			wanted, primary = art.Kind == "video" || art.Kind == "last_frame", art.Kind == "video"
		case "3d_generation":
			// The reference images a 3D task echoes back (Tripo's image kind) are not results.
			// Express with output_format mp4 may return only the turntable video.
			wanted = art.Kind == "model3d" || art.Kind == "video" || art.Kind == "cover"
			primary = art.Kind == "model3d" || art.Kind == "video"
		}
		if !wanted {
			continue
		}
		remote := ""
		if art.URL != "" {
			remote = resolveArtifactURL(baseURL, art.URL)
		}
		if art.State != "available" || !(strings.HasPrefix(remote, "https://") || strings.HasPrefix(remote, "http://")) {
			d.unreadable++
			if art.Error != nil && d.reason == "" {
				d.reason = firstNonEmpty(art.Error.Message, art.Error.Code)
			}
			continue
		}
		if art.Kind == "last_frame" {
			lastFrames = append(lastFrames, remote+"\x00"+art.MimeType)
			continue
		}
		if primary {
			d.primary++
		}
		index := len(d.assets)
		switch task.TaskType {
		case "image_generation":
			d.assets = append(d.assets, imageAsset(task.ID, index, remote, imageExt(art.MimeType, remote)))
		case "video_generation":
			d.assets = append(d.assets, heighlinerVideoAsset(task.ID, index, art.MimeType, remote))
		default:
			d.assets = append(d.assets, model3DAsset(task.ID, index, art, remote))
		}
	}
	// A returned last frame (Seedance return_last_frame) goes with the video, after it.
	for i, lf := range lastFrames {
		remote, mimeType, _ := strings.Cut(lf, "\x00")
		name := "last_frame"
		if i > 0 {
			name = fmt.Sprintf("last_frame_%02d", i)
		}
		ext := imageExt(mimeType, remote)
		d.assets = append(d.assets, model.TaskAsset{
			AssetIndex: len(d.assets),
			Kind:       "image_frame",
			Name:       name + "." + ext,
			RemoteURL:  remote,
			LocalPath:  fmt.Sprintf("videos/%s/%s.%s", task.ID, name, ext),
		})
	}
	return d
}

// heighlinerVideoAsset is videoAsset with the container the gateway names: Seedance can
// return a MOV (video/quicktime), which keeps its own extension rather than posing as MP4.
func heighlinerVideoAsset(taskID string, index int, mimeType, remote string) model.TaskAsset {
	asset := videoAsset(taskID, index, remote)
	if mt, _, err := mime.ParseMediaType(mimeType); err == nil {
		switch strings.ToLower(mt) {
		case "video/quicktime":
			asset.LocalPath = strings.TrimSuffix(asset.LocalPath, ".mp4") + ".mov"
		case "video/webm":
			asset.LocalPath = strings.TrimSuffix(asset.LocalPath, ".mp4") + ".webm"
		}
	}
	return asset
}

// resolveArtifactURL makes a signed path (/media/v1/tasks/…/artifacts/…) absolute.
func resolveArtifactURL(baseURL, raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.IsAbs() {
		return raw
	}
	base, err := url.Parse(baseURL + "/")
	if err != nil {
		return raw
	}
	return base.ResolveReference(u).String()
}

// model3DExts maps 3D MIME types onto file extensions; signed URLs carry none.
var model3DExts = map[string]string{
	"model/gltf-binary":            "glb",
	"model/gltf+json":              "gltf",
	"model/obj":                    "obj",
	"text/plain":                   "obj",
	"model/stl":                    "stl",
	"model/x.stl-binary":           "stl",
	"application/sla":              "stl",
	"application/vnd.ms-pki.stl":   "stl",
	"model/vnd.usdz+zip":           "usdz",
	"model/vnd.usd+zip":            "usdz",
	"application/fbx":              "fbx",
	"model/fbx":                    "fbx",
	"application/zip":              "zip",
	"application/x-zip-compressed": "zip",
	"video/mp4":                    "mp4",
	"image/png":                    "png",
	"image/jpeg":                   "jpg",
	"image/webp":                   "webp",
}

var known3DExts = map[string]bool{"glb": true, "gltf": true, "obj": true, "stl": true, "usdz": true, "fbx": true, "zip": true, "mp4": true, "png": true, "jpg": true, "jpeg": true, "webp": true}

// artifactExt names a 3D artifact's file type from its format, file name, MIME type or URL.
func artifactExt(art heighlinerArtifact, remote string) string {
	clean := func(e string) string { return strings.TrimPrefix(strings.ToLower(strings.TrimSpace(e)), ".") }
	if e := clean(art.Format); known3DExts[e] {
		return e
	}
	if e := clean(path.Ext(art.Filename)); known3DExts[e] {
		return e
	}
	if mt, _, err := mime.ParseMediaType(art.MimeType); err == nil {
		if e, ok := model3DExts[strings.ToLower(mt)]; ok {
			return e
		}
		if strings.Contains(mt, "fbx") {
			return "fbx"
		}
	}
	if u, err := url.Parse(remote); err == nil {
		if e := clean(path.Ext(u.Path)); known3DExts[e] {
			return e
		}
	}
	switch art.Kind {
	case "video":
		return "mp4"
	case "cover":
		return "png"
	}
	return "bin"
}

// model3DAsset lays out a 3D task's files: models/<task>/model_NN.<ext>, preview.mp4, cover.<ext>.
func model3DAsset(taskID string, index int, art heighlinerArtifact, remote string) model.TaskAsset {
	ext := artifactExt(art, remote)
	name := fmt.Sprintf("model_%02d", index)
	switch art.Kind {
	case "video":
		name = fmt.Sprintf("preview_%02d", index)
	case "cover":
		name = fmt.Sprintf("cover_%02d", index)
	}
	if ext == "jpeg" {
		ext = "jpg"
	}
	return model.TaskAsset{
		AssetIndex: index,
		Kind:       art.Kind,
		Name:       ext,
		RemoteURL:  remote,
		LocalPath:  fmt.Sprintf("models/%s/%s.%s", taskID, name, ext),
	}
}

// sniffedModelExts names a 3D file by its first bytes. A ZIP holds an OBJ or FBX with its
// textures; an OBJ is plain text and cannot be told apart, so it stays ".bin".
var sniffedModelExts = []struct {
	magic string
	ext   string
}{
	{"glTF", ".glb"},
	{"PK\x03\x04", ".zip"},
	{"Kaydara FBX Binary", ".fbx"},
}

// RenameSniffedModel gives a downloaded ".bin" its real extension when its bytes say
// what it is: the gateway can return a model as application/octet-stream with no format,
// file name or MIME type that names it. It returns the path the file now has, which is
// the old one when nothing changed.
func RenameSniffedModel(localPath string) string {
	if !strings.EqualFold(filepath.Ext(localPath), ".bin") {
		return localPath
	}
	f, err := os.Open(localPath)
	if err != nil {
		return localPath
	}
	head := make([]byte, 32)
	n, _ := io.ReadFull(f, head)
	f.Close()
	head = head[:n]
	for _, s := range sniffedModelExts {
		if !bytes.HasPrefix(head, []byte(s.magic)) {
			continue
		}
		renamed := strings.TrimSuffix(localPath, filepath.Ext(localPath)) + s.ext
		if err := os.Rename(localPath, renamed); err != nil {
			return localPath
		}
		return renamed
	}
	return localPath
}

// DownloadAsset fetches an artifact without credentials: signed platform links need
// none, and upstream URLs belong to other hosts that must never see the key.
func (a *HeighlinerAdapter) DownloadAsset(ctx context.Context, remoteURL string, targetLocalPath string) error {
	if err := os.MkdirAll(filepath.Dir(targetLocalPath), 0755); err != nil {
		return fmt.Errorf("failed to create directory for %s: %w", targetLocalPath, err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, remoteURL, nil)
	if err != nil {
		return fmt.Errorf("failed to create download request: %w", err)
	}
	resp, err := downloadClient(a.client).Do(req)
	if err != nil {
		return fmt.Errorf("failed to download %s: %w", remoteURL, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("asset download returned HTTP %d for %s", resp.StatusCode, remoteURL)
	}
	file, err := os.Create(targetLocalPath)
	if err != nil {
		return fmt.Errorf("failed to create target file %s: %w", targetLocalPath, err)
	}
	defer file.Close()
	if _, err := io.Copy(file, resp.Body); err != nil {
		return fmt.Errorf("failed to stream asset to file: %w", err)
	}
	return file.Sync()
}

// PollTimeout gives gateway-queued images more than the poller's image default, with room
// for the delivery grace after they succeed; videos and 3D already get its long default.
func (a *HeighlinerAdapter) PollTimeout(task *model.MediaTask) time.Duration {
	if task.TaskType == "image_generation" {
		return 30 * time.Minute
	}
	return 0
}

// PollInterval is the gateway's advice on how often to ask: images every 3 seconds,
// videos every 5, 3D every 8 (5–10). Task queries share a per-user limit of 120 a minute.
func (a *HeighlinerAdapter) PollInterval(task *model.MediaTask) time.Duration {
	switch task.TaskType {
	case "image_generation":
		return 3 * time.Second
	case "3d_generation":
		return 8 * time.Second
	}
	return 5 * time.Second
}

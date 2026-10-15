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
	notBefore map[string]time.Time // local task ID -> no poll before (429 Retry-After)

	// sleep waits between submit retries; tests swap it out.
	sleep func(ctx context.Context, d time.Duration) error
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
}

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
	Kind     string `json:"kind"` // image | video | model3d | audio | cover | last_frame
	MimeType string `json:"mime_type"`
	State    string `json:"state"` // available | pending | unavailable
	URL      string `json:"url"`
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
	ID        string               `json:"id"`
	Status    string               `json:"status"`
	Progress  int                  `json:"progress"`
	Artifacts []heighlinerArtifact `json:"artifacts"`
	Error     *heighlinerError     `json:"error"`
	Billing   json.RawMessage      `json:"billing"`
}

// HeighlinerAPIError is a non-2xx gateway response in the media protocol's error shape.
type HeighlinerAPIError struct {
	Status     int
	Code       string
	Message    string
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

// Submit retries: rate limits and an idempotent submission still being accepted are
// replayed with the same key; waits are capped so a card never hangs on one header.
const (
	heighlinerSubmitAttempts = 4
	heighlinerMaxRetryAfter  = time.Minute
	heighlinerFileLifetime   = 7 * 24 * time.Hour
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

	submit := func() (string, error) {
		body, err := a.requestBody(ctx, task, params)
		if err != nil {
			return "", err
		}
		return a.submitWithRetry(ctx, endpoint, task.ID, body)
	}
	id, err := submit()
	// A cached reference file the gateway no longer has: upload afresh and submit once more.
	var apiErr *HeighlinerAPIError
	if err != nil && errors.As(err, &apiErr) && (apiErr.Code == "file_expired" || apiErr.Code == "file_not_found") && a.forgetFiles(params.ReferenceAssets) {
		id, err = submit()
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
		var apiErr *HeighlinerAPIError
		if !errors.As(err, &apiErr) || !(apiErr.Status == http.StatusTooManyRequests || apiErr.Code == "idempotency_in_progress") {
			return "", err
		}
		wait := apiErr.RetryAfter
		if wait <= 0 {
			wait = time.Duration(attempt+1) * 2 * time.Second
		}
		if err := a.sleep(ctx, min(wait, heighlinerMaxRetryAfter)); err != nil {
			return "", err
		}
	}
	return "", lastErr
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
	if backingOff && time.Now().Before(until) {
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
				a.notBefore[task.ID] = time.Now().Add(min(wait, 10*time.Minute))
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
		assets, pending := a.collectArtifacts(task, resp.Artifacts)
		if pending {
			// Archiving is still going on; this is not a failure and must not be regenerated.
			return &PollResult{Status: model.TaskStatusRunning, Progress: max(task.Progress, 95)}
		}
		if len(assets) == 0 {
			return &PollResult{Status: model.TaskStatusFailed, ErrorCode: "EmptyResult", ErrorMessage: "Heighliner 任务成功但没有可下载的产物", BillingDetailsJSON: billing}
		}
		res := &PollResult{Status: model.TaskStatusSucceeded, Progress: 100, Assets: assets, BillingDetailsJSON: billing}
		res.ResultURL = assets[0].RemoteURL
		return res

	case "failed", "cancelled", "expired":
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

// collectArtifacts picks the artifacts a card shows. Image and video tasks keep their
// images or videos, one result each; a 3D task keeps every model file, the Express
// preview video and the cover. pending reports a wanted artifact still being archived.
func (a *HeighlinerAdapter) collectArtifacts(task *model.MediaTask, artifacts []heighlinerArtifact) (assets []model.TaskAsset, pending bool) {
	baseURL, _ := a.credentials()
	for _, art := range artifacts {
		var wanted bool
		switch task.TaskType {
		case "image_generation":
			wanted = art.Kind == "image"
		case "video_generation":
			wanted = art.Kind == "video"
		case "3d_generation":
			// The reference images a 3D task echoes back are not results.
			wanted = art.Kind == "model3d" || art.Kind == "video" || art.Kind == "cover"
		}
		if !wanted {
			continue
		}
		switch art.State {
		case "pending":
			pending = true
			continue
		case "unavailable":
			continue
		}
		if art.URL == "" {
			continue
		}
		remote := resolveArtifactURL(baseURL, art.URL)
		index := len(assets)
		switch task.TaskType {
		case "image_generation":
			assets = append(assets, imageAsset(task.ID, index, remote, imageExt(art.MimeType, remote)))
		case "video_generation":
			assets = append(assets, videoAsset(task.ID, index, remote))
		default:
			assets = append(assets, model3DAsset(task.ID, index, art, remote))
		}
	}
	return assets, pending
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

// RenameSniffedModel gives a downloaded ".bin" its real extension when its bytes say
// what it is: the gateway can return a GLB with no format, file name or MIME type that
// names it. It returns the path the file now has, which is the old one when nothing changed.
func RenameSniffedModel(localPath string) string {
	if !strings.EqualFold(filepath.Ext(localPath), ".bin") {
		return localPath
	}
	f, err := os.Open(localPath)
	if err != nil {
		return localPath
	}
	magic := make([]byte, 4)
	_, err = io.ReadFull(f, magic)
	f.Close()
	if err != nil || string(magic) != "glTF" {
		return localPath
	}
	renamed := strings.TrimSuffix(localPath, filepath.Ext(localPath)) + ".glb"
	if err := os.Rename(localPath, renamed); err != nil {
		return localPath
	}
	return renamed
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

// PollTimeout gives gateway-queued images more than the poller's image default; videos
// and 3D already get its long default.
func (a *HeighlinerAdapter) PollTimeout(task *model.MediaTask) time.Duration {
	if task.TaskType == "image_generation" {
		return 15 * time.Minute
	}
	return 0
}

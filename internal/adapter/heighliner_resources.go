package adapter

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// Media management requests address only fixed Media API resources.
// IDs and query values never select another host or an arbitrary endpoint.
func (a *HeighlinerAdapter) mediaResource(ctx context.Context, method, path, contentType string, query url.Values, body io.Reader) (json.RawMessage, int, error) {
	base, key := a.credentials()
	endpoint := base + "/media/v1/" + path
	if len(query) > 0 {
		endpoint += "?" + query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Authorization", "Bearer "+key)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	var raw json.RawMessage
	status, err := a.do(req, &raw)
	return raw, status, err
}

func mediaResourceID(id string) (string, error) {
	if id == "" || len(id) > 255 || id == "." || id == ".." || strings.ContainsAny(id, `/\%?#`) || strings.TrimSpace(id) != id {
		return "", errors.New("无效的平台资源 ID")
	}
	return url.PathEscape(id), nil
}

func (a *HeighlinerAdapter) CancelMediaTask(ctx context.Context, id string) (json.RawMessage, int, error) {
	id, err := mediaResourceID(id)
	if err != nil {
		return nil, http.StatusBadRequest, err
	}
	return a.mediaResource(ctx, http.MethodPost, "tasks/"+id+"/cancel", "", nil, nil)
}

func (a *HeighlinerAdapter) MediaFiles(ctx context.Context, method, id, contentType string, query url.Values, body io.Reader) (json.RawMessage, int, error) {
	path := "files"
	if id != "" {
		safe, err := mediaResourceID(id)
		if err != nil {
			return nil, http.StatusBadRequest, err
		}
		path += "/" + safe
	}
	switch {
	case method == http.MethodGet, method == http.MethodPost && id == "", method == http.MethodDelete && id != "":
		return a.mediaResource(ctx, method, path, contentType, query, body)
	default:
		return nil, http.StatusMethodNotAllowed, errors.New("不支持的文件操作")
	}
}

func (a *HeighlinerAdapter) QueryMediaTasks(ctx context.Context, query url.Values, cursorQuery io.Reader) (json.RawMessage, int, error) {
	if cursorQuery != nil {
		return a.mediaResource(ctx, http.MethodPost, "tasks/query", "application/json", nil, cursorQuery)
	}
	return a.mediaResource(ctx, http.MethodGet, "tasks", "", query, nil)
}

func (a *HeighlinerAdapter) ReadMediaBilling(ctx context.Context, id string) (json.RawMessage, error) {
	safe, err := mediaResourceID(id)
	if err != nil {
		return nil, err
	}
	raw, _, err := a.mediaResource(ctx, http.MethodGet, "tasks/"+safe, "", nil, nil)
	if err != nil {
		return nil, err
	}
	var result struct {
		ID      string          `json:"id"`
		Billing json.RawMessage `json:"billing"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("读取任务账务: %w", err)
	}
	if result.ID != id {
		return nil, errors.New("账务响应没有匹配原任务 ID")
	}
	return result.Billing, nil
}

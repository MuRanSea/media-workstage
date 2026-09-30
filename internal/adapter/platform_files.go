package adapter

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// errPlatformFilesUnsupported means the provider's origin has no file store.
var errPlatformFilesUnsupported = errors.New("platform has no file store")

// platformFiles hands local files to the relay platform's file store
// (POST <origin>/api/files/upload, the endpoint behind the cards' 「获取链接」) and
// remembers each file's link until shortly before it expires, so re-running a
// generation does not upload the same image again.
type platformFiles struct {
	unsupported atomic.Bool
	mu          sync.Mutex
	links       map[string]platformLink
}

type platformLink struct {
	url     string
	expires time.Time
}

// link returns a public download URL for localPath.
func (p *platformFiles) link(ctx context.Context, client *http.Client, baseURL, apiKey, localPath string) (string, error) {
	if p.unsupported.Load() {
		return "", errPlatformFilesUnsupported
	}
	info, err := os.Stat(localPath)
	if err != nil {
		return "", err
	}
	key := fmt.Sprintf("%s|%d|%d", localPath, info.Size(), info.ModTime().UnixNano())
	p.mu.Lock()
	cached, ok := p.links[key]
	p.mu.Unlock()
	if ok && time.Now().Before(cached.expires) {
		return cached.url, nil
	}

	u, err := url.Parse(baseURL)
	if err != nil || u.Host == "" {
		return "", fmt.Errorf("invalid base URL %q", baseURL)
	}
	data, err := os.ReadFile(localPath)
	if err != nil {
		return "", err
	}
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	header := make(textproto.MIMEHeader)
	header.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename=%q`, filepath.Base(localPath)))
	header.Set("Content-Type", mimeForExt(filepath.Ext(localPath)))
	part, err := w.CreatePart(header)
	if err != nil {
		return "", err
	}
	if _, err := part.Write(data); err != nil {
		return "", err
	}
	if err := w.Close(); err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.Scheme+"://"+u.Host+"/api/files/upload", &body)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", w.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusMethodNotAllowed ||
		strings.Contains(resp.Header.Get("Content-Type"), "text/html") {
		p.unsupported.Store(true)
		return "", errPlatformFilesUnsupported
	}
	var env struct {
		Success bool `json:"success"`
		Data    struct {
			FileURL   string `json:"file_url"`
			ExpiresAt int64  `json:"expires_at"`
		} `json:"data"`
	}
	if json.Unmarshal(raw, &env) != nil || resp.StatusCode >= 300 || !env.Success || env.Data.FileURL == "" {
		return "", fmt.Errorf("文件上传返回 HTTP %d: %s", resp.StatusCode, errMessage(raw))
	}

	// Links last 7 days; without an expiry, trust one for a day. Stop reusing an hour early.
	expires := time.Now().Add(24 * time.Hour)
	if env.Data.ExpiresAt > 0 {
		expires = time.Unix(env.Data.ExpiresAt, 0)
	}
	p.mu.Lock()
	if p.links == nil {
		p.links = map[string]platformLink{}
	}
	p.links[key] = platformLink{url: env.Data.FileURL, expires: expires.Add(-time.Hour)}
	p.mu.Unlock()
	return env.Data.FileURL, nil
}

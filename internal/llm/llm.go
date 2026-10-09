// Package llm sends single-turn text generation requests to the configured providers,
// for text cards that write prompts for image and video cards.
package llm

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"

	"media-workstage/internal/model"
)

// Request is one system + user turn.
type Request struct {
	Model  string
	System string
	Prompt string
	// Images go with the user turn, in order, as data URIs or public http(s) URLs.
	Images []string
}

// MaxImages caps how many images one text run sends.
const MaxImages = 6

// maxRemoteImageBytes caps an image fetched to inline it (Gemini takes no plain URLs).
const maxRemoteImageBytes = 20 << 20

// Anthropic's Messages API: max_tokens is required, and a prompt for an image or video
// card is far shorter than this. An image's Base64 data may be at most 5 MB.
const (
	// AnthropicVersion is the anthropic-version header every Anthropic request carries.
	AnthropicVersion       = "2023-06-01"
	anthropicMaxTokens     = 8192
	anthropicMaxImageBytes = 5 << 20
)

var anthropicImageTypes = map[string]bool{"image/jpeg": true, "image/png": true, "image/gif": true, "image/webp": true}

// Supported reports whether providers speaking protocol can run text generation.
func Supported(protocol model.Protocol) bool {
	switch protocol {
	case model.ProtocolOpenAICompatible, model.ProtocolAPIMart, model.ProtocolArk, model.ProtocolMiniMax, model.ProtocolGemini,
		model.ProtocolAnthropic:
		return true
	}
	return false
}

// Generate runs req against a provider speaking protocol and returns the model's text.
func Generate(ctx context.Context, client *http.Client, protocol model.Protocol, baseURL, apiKey string, req Request) (string, error) {
	baseURL = strings.TrimRight(baseURL, "/")
	var (
		text string
		err  error
	)
	switch protocol {
	case model.ProtocolOpenAICompatible, model.ProtocolAPIMart:
		text, err = chatCompletions(ctx, client, baseURL+"/chat/completions", apiKey, req, nil)
	case model.ProtocolArk:
		// Doubao Seed models think by default; prompt writing is plain text generation,
		// so switch it off as Ark documents (faster, no reasoning tokens billed).
		text, err = chatCompletions(ctx, client, baseURL+"/chat/completions", apiKey, req,
			map[string]any{"thinking": map[string]string{"type": "disabled"}})
	case model.ProtocolMiniMax:
		text, err = chatCompletions(ctx, client, baseURL+"/text/chatcompletion_v2", apiKey, req, nil)
	case model.ProtocolGemini:
		text, err = geminiGenerate(ctx, client, baseURL, apiKey, req)
	case model.ProtocolAnthropic:
		text, err = anthropicMessages(ctx, client, baseURL+"/messages", apiKey, req)
	default:
		return "", fmt.Errorf("接入协议 %s 不支持文本生成", protocol)
	}
	if err != nil {
		return "", err
	}
	text = strings.TrimSpace(stripThinking(text))
	if text == "" {
		return "", errors.New("模型没有返回文本")
	}
	return text, nil
}

// chatMessage content is a string, or with images an array of text / image_url parts.
type chatMessage struct {
	Role    string `json:"role"`
	Content any    `json:"content"`
}

type chatImageURL struct {
	URL string `json:"url"`
}

type chatPart struct {
	Type     string        `json:"type"`
	Text     string        `json:"text,omitempty"`
	ImageURL *chatImageURL `json:"image_url,omitempty"`
}

// userContent is the user turn: plain text, or the OpenAI vision form when images go along.
func userContent(req Request) any {
	if len(req.Images) == 0 {
		return req.Prompt
	}
	parts := []chatPart{{Type: "text", Text: req.Prompt}}
	for _, img := range req.Images {
		parts = append(parts, chatPart{Type: "image_url", ImageURL: &chatImageURL{URL: img}})
	}
	return parts
}

// chatCompletions calls an OpenAI-style endpoint; extra adds provider-specific body fields.
func chatCompletions(ctx context.Context, client *http.Client, endpoint, apiKey string, req Request, extra map[string]any) (string, error) {
	messages := make([]chatMessage, 0, 2)
	if strings.TrimSpace(req.System) != "" {
		messages = append(messages, chatMessage{Role: "system", Content: req.System})
	}
	messages = append(messages, chatMessage{Role: "user", Content: userContent(req)})
	payload := map[string]any{"model": req.Model, "messages": messages}
	for k, v := range extra {
		payload[k] = v
	}
	body, _ := json.Marshal(payload)

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)

	var resp struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		// MiniMax reports errors in base_resp with HTTP 200.
		BaseResp *struct {
			StatusCode int    `json:"status_code"`
			StatusMsg  string `json:"status_msg"`
		} `json:"base_resp"`
	}
	if err := doJSON(client, httpReq, &resp); err != nil {
		return "", err
	}
	if resp.BaseResp != nil && resp.BaseResp.StatusCode != 0 {
		return "", fmt.Errorf("服务商返回错误 %d: %s", resp.BaseResp.StatusCode, resp.BaseResp.StatusMsg)
	}
	if len(resp.Choices) == 0 {
		return "", errors.New("模型没有返回结果")
	}
	return resp.Choices[0].Message.Content, nil
}

// anthropicMessages calls the Messages API. Extended thinking stays off and only text
// blocks are read; images are always inlined, since relays differ on URL sources and
// Anthropic cannot reach local addresses.
func anthropicMessages(ctx context.Context, client *http.Client, endpoint, apiKey string, req Request) (string, error) {
	type imageSource struct {
		Type      string `json:"type"`
		MediaType string `json:"media_type"`
		Data      string `json:"data"`
	}
	type block struct {
		Type   string       `json:"type"`
		Text   string       `json:"text,omitempty"`
		Source *imageSource `json:"source,omitempty"`
	}
	type message struct {
		Role    string `json:"role"`
		Content any    `json:"content"`
	}
	var content any = req.Prompt
	if len(req.Images) > 0 {
		blocks := make([]block, 0, len(req.Images)+1)
		for i, img := range req.Images {
			mime, data, err := inlineImage(ctx, client, img)
			if err != nil {
				return "", err
			}
			if !anthropicImageTypes[mime] {
				return "", fmt.Errorf("第 %d 张图片格式为 %s，Anthropic 只接受 JPEG / PNG / GIF / WebP", i+1, mime)
			}
			if len(data) > anthropicMaxImageBytes {
				return "", fmt.Errorf("第 %d 张图片超过 Anthropic 单张 5 MB 的上限", i+1)
			}
			blocks = append(blocks, block{Type: "image", Source: &imageSource{Type: "base64", MediaType: mime, Data: data}})
		}
		// Anthropic recommends images before the text that asks about them.
		content = append(blocks, block{Type: "text", Text: req.Prompt})
	}
	payload := map[string]any{
		"model":      req.Model,
		"max_tokens": anthropicMaxTokens,
		"messages":   []message{{Role: "user", Content: content}},
	}
	if strings.TrimSpace(req.System) != "" {
		payload["system"] = req.System
	}
	body, _ := json.Marshal(payload)

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("x-api-key", strings.TrimSpace(apiKey))
	httpReq.Header.Set("anthropic-version", AnthropicVersion)

	var resp struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
		StopReason string `json:"stop_reason"`
	}
	if err := doJSON(client, httpReq, &resp); err != nil {
		return "", err
	}
	if resp.StopReason == "refusal" {
		return "", errors.New("模型拒绝回答")
	}
	// A max_tokens stop still returns the text written so far.
	var sb strings.Builder
	for _, b := range resp.Content {
		if b.Type == "text" {
			sb.WriteString(b.Text)
		}
	}
	return sb.String(), nil
}

func geminiGenerate(ctx context.Context, client *http.Client, baseURL, apiKey string, req Request) (string, error) {
	type inlineData struct {
		MimeType string `json:"mimeType"`
		Data     string `json:"data"`
	}
	type part struct {
		Text       string      `json:"text,omitempty"`
		InlineData *inlineData `json:"inlineData,omitempty"`
	}
	type content struct {
		Role  string `json:"role,omitempty"`
		Parts []part `json:"parts"`
	}
	userParts := []part{{Text: req.Prompt}}
	for _, img := range req.Images {
		mime, data, err := inlineImage(ctx, client, img)
		if err != nil {
			return "", err
		}
		userParts = append(userParts, part{InlineData: &inlineData{MimeType: mime, Data: data}})
	}
	payload := map[string]any{
		"contents": []content{{Role: "user", Parts: userParts}},
	}
	if strings.TrimSpace(req.System) != "" {
		payload["systemInstruction"] = content{Parts: []part{{Text: req.System}}}
	}
	body, _ := json.Marshal(payload)

	model := strings.TrimPrefix(req.Model, "models/")
	endpoint := fmt.Sprintf("%s/models/%s:generateContent", baseURL, url.PathEscape(model))
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("x-goog-api-key", apiKey)

	var resp struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text    string `json:"text"`
					Thought bool   `json:"thought"`
				} `json:"parts"`
			} `json:"content"`
			FinishReason string `json:"finishReason"`
		} `json:"candidates"`
		PromptFeedback *struct {
			BlockReason string `json:"blockReason"`
		} `json:"promptFeedback"`
	}
	if err := doJSON(client, httpReq, &resp); err != nil {
		return "", err
	}
	if resp.PromptFeedback != nil && resp.PromptFeedback.BlockReason != "" {
		return "", fmt.Errorf("请求被拦截: %s", resp.PromptFeedback.BlockReason)
	}
	var sb strings.Builder
	for _, cand := range resp.Candidates {
		for _, p := range cand.Content.Parts {
			if !p.Thought {
				sb.WriteString(p.Text)
			}
		}
		if sb.Len() > 0 {
			break
		}
	}
	return sb.String(), nil
}

// inlineImage turns an image into the inline form Gemini and Anthropic take (MIME type +
// Base64): a data URI is split, a URL is downloaded.
func inlineImage(ctx context.Context, client *http.Client, img string) (mime, data string, err error) {
	if rest, ok := strings.CutPrefix(img, "data:"); ok {
		meta, payload, found := strings.Cut(rest, ",")
		if !found || !strings.HasSuffix(meta, ";base64") {
			return "", "", errors.New("图片 data URI 格式不对，需要 Base64 编码")
		}
		return strings.TrimSuffix(meta, ";base64"), payload, nil
	}
	if !strings.HasPrefix(img, "http://") && !strings.HasPrefix(img, "https://") {
		return "", "", fmt.Errorf("读不了这个图片地址: %.60s", img)
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, img, nil)
	if err != nil {
		return "", "", err
	}
	resp, err := client.Do(httpReq)
	if err != nil {
		return "", "", fmt.Errorf("下载参考图失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", "", fmt.Errorf("下载参考图失败: HTTP %d", resp.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxRemoteImageBytes+1))
	if err != nil {
		return "", "", fmt.Errorf("下载参考图失败: %w", err)
	}
	if len(raw) > maxRemoteImageBytes {
		return "", "", errors.New("参考图超过 20 MiB")
	}
	mime = strings.TrimSpace(strings.Split(resp.Header.Get("Content-Type"), ";")[0])
	if !strings.HasPrefix(mime, "image/") {
		mime = http.DetectContentType(raw)
	}
	return mime, base64.StdEncoding.EncodeToString(raw), nil
}

var thinkBlock = regexp.MustCompile(`(?s)<think>.*?</think>`)

// stripThinking drops <think>…</think> reasoning that some models inline in content.
func stripThinking(s string) string {
	return thinkBlock.ReplaceAllString(s, "")
}

func doJSON(client *http.Client, req *http.Request, out any) error {
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("请求服务商失败: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("服务商返回 HTTP %d: %s", resp.StatusCode, errorText(body))
	}
	if strings.Contains(strings.ToLower(resp.Header.Get("Content-Type")), "text/html") {
		return fmt.Errorf("%s 返回的是网页而不是 API，Base URL 的路径可能不对", req.URL.Path)
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("无法解析服务商响应: %w", err)
	}
	return nil
}

func errorText(body []byte) string {
	var env struct {
		Error   json.RawMessage `json:"error"`
		Message string          `json:"message"`
	}
	if json.Unmarshal(body, &env) == nil {
		var obj struct {
			Message string `json:"message"`
		}
		if len(env.Error) > 0 && json.Unmarshal(env.Error, &obj) == nil && obj.Message != "" {
			return obj.Message
		}
		if env.Message != "" {
			return env.Message
		}
	}
	text := strings.TrimSpace(string(body))
	if len(text) > 200 {
		text = text[:200] + "..."
	}
	return text
}

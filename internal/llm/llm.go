// Package llm sends single-turn text generation requests to the configured providers,
// for text cards that write prompts for image and video cards.
package llm

import (
	"bytes"
	"context"
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
}

// Supported reports whether providers speaking protocol can run text generation.
func Supported(protocol model.Protocol) bool {
	switch protocol {
	case model.ProtocolOpenAICompatible, model.ProtocolAPIMart, model.ProtocolArk, model.ProtocolMiniMax, model.ProtocolGemini:
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

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// chatCompletions calls an OpenAI-style endpoint; extra adds provider-specific body fields.
func chatCompletions(ctx context.Context, client *http.Client, endpoint, apiKey string, req Request, extra map[string]any) (string, error) {
	messages := make([]chatMessage, 0, 2)
	if strings.TrimSpace(req.System) != "" {
		messages = append(messages, chatMessage{Role: "system", Content: req.System})
	}
	messages = append(messages, chatMessage{Role: "user", Content: req.Prompt})
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

func geminiGenerate(ctx context.Context, client *http.Client, baseURL, apiKey string, req Request) (string, error) {
	type part struct {
		Text string `json:"text"`
	}
	type content struct {
		Role  string `json:"role,omitempty"`
		Parts []part `json:"parts"`
	}
	payload := map[string]any{
		"contents": []content{{Role: "user", Parts: []part{{Text: req.Prompt}}}},
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

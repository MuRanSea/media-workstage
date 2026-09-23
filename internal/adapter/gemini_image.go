package adapter

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"media-workstage/internal/model"

	"github.com/google/uuid"
)

// GeminiImageAdapter generates images with Gemini image models ("Nano Banana")
// through models/{model}:generateContent. The call is synchronous.
type GeminiImageAdapter struct {
	channelImageBase
}

func NewGeminiImageAdapter(cfg ChannelConfig) *GeminiImageAdapter {
	a := &GeminiImageAdapter{newChannelImageBase("google", "https://generativelanguage.googleapis.com/v1beta", cfg)}
	a.keyHeader = "x-goog-api-key"
	return a
}

type geminiPart struct {
	Text       string        `json:"text,omitempty"`
	InlineData *geminiInline `json:"inlineData,omitempty"`
	// Some relays answer in snake_case.
	InlineDataSnake *geminiInline `json:"inline_data,omitempty"`
}

type geminiInline struct {
	MimeType      string `json:"mimeType,omitempty"`
	MimeTypeSnake string `json:"mime_type,omitempty"`
	Data          string `json:"data"`
}

type geminiImageRequest struct {
	Contents         []geminiContent `json:"contents"`
	GenerationConfig struct {
		ResponseModalities []string `json:"responseModalities"`
		ImageConfig        *struct {
			AspectRatio string `json:"aspectRatio,omitempty"`
			ImageSize   string `json:"imageSize,omitempty"`
		} `json:"imageConfig,omitempty"`
	} `json:"generationConfig"`
}

type geminiContent struct {
	Role  string       `json:"role,omitempty"`
	Parts []geminiPart `json:"parts"`
}

type geminiImageResponse struct {
	Candidates []struct {
		Content      geminiContent `json:"content"`
		FinishReason string        `json:"finishReason"`
	} `json:"candidates"`
	PromptFeedback *struct {
		BlockReason string `json:"blockReason"`
	} `json:"promptFeedback"`
	UsageMetadata *struct {
		TotalTokenCount int `json:"totalTokenCount"`
	} `json:"usageMetadata"`
}

func (a *GeminiImageAdapter) SubmitTask(ctx context.Context, task *model.MediaTask) (string, error) {
	if err := requireImageTask("google", task); err != nil {
		return "", err
	}
	params := parseGenericImageParams(task.ParamsJSON)
	modelID := strings.TrimPrefix(task.Model, "models/")

	var reqBody geminiImageRequest
	reqBody.Contents = []geminiContent{{Role: "user", Parts: []geminiPart{{Text: task.Prompt}}}}
	reqBody.GenerationConfig.ResponseModalities = []string{"TEXT", "IMAGE"}
	aspect, size := params.AspectRatio, geminiImageSize(modelID, params.Resolution)
	if aspect != "" || size != "" {
		reqBody.GenerationConfig.ImageConfig = &struct {
			AspectRatio string `json:"aspectRatio,omitempty"`
			ImageSize   string `json:"imageSize,omitempty"`
		}{AspectRatio: aspect, ImageSize: size}
	}
	body, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("failed to marshal gemini request: %w", err)
	}

	baseURL, apiKey := a.credentials()
	endpoint := fmt.Sprintf("%s/models/%s:generateContent", baseURL, url.PathEscape(modelID))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-goog-api-key", apiKey)

	var resp geminiImageResponse
	if err := a.doJSON(req, &resp); err != nil {
		return "", err
	}

	var images []inlineImage
	var texts []string
	finish := ""
	for _, cand := range resp.Candidates {
		if cand.FinishReason != "" {
			finish = cand.FinishReason
		}
		for _, part := range cand.Content.Parts {
			inline := part.InlineData
			if inline == nil {
				inline = part.InlineDataSnake
			}
			if inline != nil && inline.Data != "" {
				data, err := base64.StdEncoding.DecodeString(inline.Data)
				if err != nil {
					return "", fmt.Errorf("failed to decode gemini image: %w", err)
				}
				mimeType := inline.MimeType
				if mimeType == "" {
					mimeType = inline.MimeTypeSnake
				}
				images = append(images, inlineImage{data: data, mimeType: mimeType})
			} else if strings.TrimSpace(part.Text) != "" {
				texts = append(texts, strings.TrimSpace(part.Text))
			}
		}
	}
	if len(images) == 0 {
		reason := finish
		if resp.PromptFeedback != nil && resp.PromptFeedback.BlockReason != "" {
			reason = "blocked: " + resp.PromptFeedback.BlockReason
		}
		if len(texts) > 0 {
			reason = strings.TrimSpace(reason + " " + strings.Join(texts, " "))
		}
		return "", fmt.Errorf("gemini 未返回图片 (%s)", reason)
	}

	usage := 0
	if resp.UsageMetadata != nil {
		usage = resp.UsageMetadata.TotalTokenCount
	}
	providerTaskID := "gemini-img-" + uuid.New().String()[:12]
	a.storeResult(task, providerTaskID, images, usage)
	return providerTaskID, nil
}

func (a *GeminiImageAdapter) PollTask(_ context.Context, task *model.MediaTask) (*PollResult, error) {
	return a.pollStored(task)
}

// geminiImageSize returns the imageSize to send, or "" where the model has no size
// control: Gemini 2.5 Flash Image and 3.1 Flash Lite Image (1K only).
func geminiImageSize(modelID, resolution string) string {
	lower := strings.ToLower(modelID)
	if strings.Contains(lower, "2.5-flash-image") || strings.Contains(lower, "flash-lite-image") {
		return ""
	}
	switch resolution {
	case "1K", "2K", "4K":
		return resolution
	}
	return ""
}

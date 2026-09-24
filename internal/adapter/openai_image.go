package adapter

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"media-workstage/internal/model"

	"github.com/google/uuid"
)

// OpenAIImageAdapter generates images through the OpenAI Images API
// (POST /images/generations), which also covers OpenAI-compatible relays.
// The API is synchronous: SubmitTask blocks until the image is ready.
type OpenAIImageAdapter struct {
	channelImageBase
}

func NewOpenAIImageAdapter(cfg ChannelConfig) *OpenAIImageAdapter {
	return &OpenAIImageAdapter{newChannelImageBase("openai", "https://api.openai.com/v1", cfg)}
}

type openAIImageRequest struct {
	Model        string `json:"model"`
	Prompt       string `json:"prompt"`
	N            int    `json:"n"`
	Size         string `json:"size,omitempty"`
	OutputFormat string `json:"output_format,omitempty"`
}

type openAIImageResponse struct {
	Data []struct {
		B64JSON string `json:"b64_json"`
		URL     string `json:"url"`
	} `json:"data"`
	OutputFormat string `json:"output_format"`
	Usage        *struct {
		TotalTokens int `json:"total_tokens"`
	} `json:"usage"`
}

func (a *OpenAIImageAdapter) SubmitTask(ctx context.Context, task *model.MediaTask) (string, error) {
	if err := requireImageTask(a.name, task); err != nil {
		return "", err
	}
	params := parseGenericImageParams(task.ParamsJSON)

	reqBody := openAIImageRequest{
		Model:  task.Model,
		Prompt: task.Prompt,
		N:      1,
		Size:   openAIImageSize(task.Model, params.AspectRatio, params.Resolution),
	}
	if isGPTImageModel(task.Model) {
		switch params.OutputFormat {
		case "png", "jpeg", "webp":
			reqBody.OutputFormat = params.OutputFormat
		}
	}
	body, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("failed to marshal openai image request: %w", err)
	}

	baseURL, apiKey := a.credentials()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/images/generations", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	var resp openAIImageResponse
	if err := a.doJSON(req, &resp); err != nil {
		return "", err
	}
	if len(resp.Data) == 0 {
		return "", errors.New("openai returned no image data")
	}

	mimeType := "image/png"
	if resp.OutputFormat != "" {
		mimeType = "image/" + resp.OutputFormat
	}
	images := make([]inlineImage, 0, len(resp.Data))
	for _, item := range resp.Data {
		switch {
		case item.B64JSON != "":
			data, err := base64.StdEncoding.DecodeString(item.B64JSON)
			if err != nil {
				return "", fmt.Errorf("failed to decode openai image: %w", err)
			}
			images = append(images, inlineImage{data: data, mimeType: mimeType})
		case item.URL != "":
			images = append(images, inlineImage{remoteURL: item.URL})
		}
	}
	if len(images) == 0 {
		return "", errors.New("openai returned image entries without b64_json or url")
	}

	usage := 0
	if resp.Usage != nil {
		usage = resp.Usage.TotalTokens
	}
	providerTaskID := "openai-img-" + uuid.New().String()[:12]
	a.storeResult(task, providerTaskID, images, usage)
	return providerTaskID, nil
}

func (a *OpenAIImageAdapter) PollTask(_ context.Context, task *model.MediaTask) (*PollResult, error) {
	return a.pollStored(task)
}

func isGPTImageModel(modelID string) bool {
	return strings.HasPrefix(strings.ToLower(modelID), "gpt-image")
}

// openAIImageSize maps a ratio + resolution tier onto the size the model accepts.
// gpt-image-1 and DALL·E only take three fixed sizes; gpt-image-2 and later accept
// WxH in multiples of 16, max edge 3840, 655,360–8,294,400 total pixels.
func openAIImageSize(modelID, aspectRatio, resolution string) string {
	ratio, ok := ratioValue(aspectRatio)
	if !ok {
		return "auto"
	}
	lower := strings.ToLower(modelID)
	if strings.HasPrefix(lower, "gpt-image-1") || strings.HasPrefix(lower, "dall-e") {
		switch {
		case ratio > 1.05:
			return "1536x1024"
		case ratio < 0.95:
			return "1024x1536"
		default:
			return "1024x1024"
		}
	}

	area := 1024.0 * 1024.0
	switch resolution {
	case "2K":
		area = 2048.0 * 2048.0
	case "4K":
		area = 8294400
	}
	w, h := fitPixels(ratio, area, 16, 3840)
	return fmt.Sprintf("%dx%d", w, h)
}

package adapter

import (
	"context"
	"net/http"
	"strings"
	"time"

	"media-workstage/internal/model"
)

// PollResult represents normalized provider polling output.
type PollResult struct {
	Status             string
	Progress           int
	ResultURL          string
	OutputDurationSec  float64
	UsageTokens        int
	BillingDetailsJSON string
	ErrorCode          string
	ErrorMessage       string
	Assets             []model.TaskAsset
}

// ProviderAdapter defines the abstraction seam for AI media generation services.
type ProviderAdapter interface {
	ProviderName() string
	SubmitTask(ctx context.Context, task *model.MediaTask) (providerTaskID string, err error)
	PollTask(ctx context.Context, task *model.MediaTask) (*PollResult, error)
	DownloadAsset(ctx context.Context, remoteURL string, targetLocalPath string) error
}

// ProviderConfigInfo exposes safe, masked configuration metadata to clients.
type ProviderConfigInfo struct {
	ProviderName string            `json:"provider"`
	BaseURL      string            `json:"base_url"`
	IsConfigured bool              `json:"is_configured"`
	MaskedKey    string            `json:"masked_key"`
	Extra        map[string]string `json:"extra,omitempty"`
}

// ConfigurableAdapter enables dynamic querying and runtime hot-reloading of provider credentials.
type ConfigurableAdapter interface {
	ProviderAdapter
	GetConfig() ProviderConfigInfo
	UpdateConfig(baseURL string, apiKey string, extra map[string]string) error
}

// PollTimeoutHinter lets an adapter extend the poller's default timeout for slow providers.
type PollTimeoutHinter interface {
	PollTimeout(task *model.MediaTask) time.Duration
}

// ChannelConfig is the credential set shared by the image channel adapters.
type ChannelConfig struct {
	BaseURL    string
	APIKey     string
	HTTPClient *http.Client
}

// NewChannelAdapter builds the live adapter for a provider channel, or reports
// false for channels that only store configuration (no generation support yet).
func NewChannelAdapter(provider, baseURL, apiKey string, extra map[string]string) (ProviderAdapter, bool) {
	switch provider {
	case "ark":
		return NewArkAdapter(ArkConfig{BaseURL: baseURL, APIKey: apiKey}), true
	case "minimax":
		return NewMiniMaxAdapter(MiniMaxConfig{BaseURL: baseURL, APIKey: apiKey, GroupID: extra["group_id"]}), true
	case "openai":
		return NewOpenAIImageAdapter(ChannelConfig{BaseURL: baseURL, APIKey: apiKey}), true
	case "google":
		return NewGeminiImageAdapter(ChannelConfig{BaseURL: baseURL, APIKey: apiKey}), true
	case "apimart":
		return NewAPIMartAdapter(ChannelConfig{BaseURL: baseURL, APIKey: apiKey}), true
	}
	return nil, false
}

// MaskSecret safely masks sensitive API keys, showing only prefix and suffix.
func MaskSecret(secret string) string {
	s := strings.TrimSpace(secret)
	if s == "" {
		return ""
	}
	if len(s) <= 8 {
		return "********"
	}
	return s[:4] + "****" + s[len(s)-4:]
}

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
	// Actions are the follow-ups the provider offers on this result.
	Actions []model.TaskAction
	// Text is a text result (e.g. Midjourney Describe); such a task may have no assets.
	Text string
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
	// ProviderID names the Provider this adapter serves; empty means the protocol's preset ID.
	ProviderID string
	BaseURL    string
	APIKey     string
	HTTPClient *http.Client
}

// NewProviderAdapter builds the live adapter for a Provider from its Protocol, or reports
// false for protocols that only store configuration (no generation support yet).
func NewProviderAdapter(protocol model.Protocol, providerID, baseURL, apiKey string, extra map[string]string) (ProviderAdapter, bool) {
	cfg := ChannelConfig{ProviderID: providerID, BaseURL: baseURL, APIKey: apiKey}
	switch protocol {
	case model.ProtocolArk:
		return NewArkAdapter(ArkConfig{BaseURL: baseURL, APIKey: apiKey}), true
	case model.ProtocolMiniMax:
		return NewMiniMaxAdapter(MiniMaxConfig{BaseURL: baseURL, APIKey: apiKey, GroupID: extra["group_id"]}), true
	case model.ProtocolOpenAICompatible:
		return NewOpenAIImageAdapter(cfg), true
	case model.ProtocolGemini:
		return NewGeminiImageAdapter(cfg), true
	case model.ProtocolAPIMart:
		return NewAPIMartAdapter(cfg), true
	case model.ProtocolMidjourney:
		return NewMidjourneyAdapter(cfg), true
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

package adapter

import (
	"context"
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

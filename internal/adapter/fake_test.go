package adapter_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"media-workstage/internal/adapter"
	"media-workstage/internal/model"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFakeProviderAdapter_LifecycleAndAssets(t *testing.T) {
	ctx := context.Background()
	fake := adapter.NewFakeProviderAdapter("ark")

	taskID := uuid.New().String()
	task := &model.MediaTask{
		ID:         taskID,
		Provider:   "ark",
		Model:      "doubao-seedance-2-5-260628",
		TaskType:   "video_generation",
		TaskMode:   "all_modal",
		Prompt:     "A cinematic cybernetic warrior walking in the rain",
		Status:     model.TaskStatusQueued,
		ParamsJSON: `{"duration":5,"resolution":"720p"}`,
	}

	// 1. Submit task
	providerTaskID, err := fake.SubmitTask(ctx, task)
	require.NoError(t, err)
	assert.NotEmpty(t, providerTaskID)

	task.ProviderTaskID = providerTaskID

	// 2. Initial Poll: should simulate running
	poll1, err := fake.PollTask(ctx, task)
	require.NoError(t, err)
	assert.Equal(t, model.TaskStatusRunning, poll1.Status)
	assert.True(t, poll1.Progress > 0)

	// 3. Subsequent Poll: should transition to succeeded with video output
	fake.SetNextPollResult(providerTaskID, &adapter.PollResult{
		Status:            model.TaskStatusSucceeded,
		Progress:          100,
		ResultURL:         "https://fake.tos.volces.com/output.mp4",
		BilledDurationSec: 5.0,
		UsageTokens:       12500,
		Assets: []model.TaskAsset{
			{
				ID:            uuid.New().String(),
				TaskID:        taskID,
				AssetIndex:    0,
				Kind:          "video",
				RemoteURL:     "https://fake.tos.volces.com/output.mp4",
				LocalPath:     "videos/" + taskID + "/output.mp4",
				FileSizeBytes: 5242880,
			},
		},
	})

	poll2, err := fake.PollTask(ctx, task)
	require.NoError(t, err)
	assert.Equal(t, model.TaskStatusSucceeded, poll2.Status)
	assert.Equal(t, 100, poll2.Progress)
	assert.Equal(t, 5.0, poll2.BilledDurationSec)
	assert.Equal(t, 1, len(poll2.Assets))

	// 4. DownloadAsset: verify streaming write to local disk
	destDir := t.TempDir()
	destPath := filepath.Join(destDir, "output.mp4")

	err = fake.DownloadAsset(ctx, poll2.Assets[0].RemoteURL, destPath)
	require.NoError(t, err)

	data, err := os.ReadFile(destPath)
	require.NoError(t, err)
	assert.NotEmpty(t, data)
}

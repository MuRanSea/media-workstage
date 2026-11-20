package db_test

import (
	"path/filepath"
	"testing"
	"time"

	"media-workstage/internal/db"
	"media-workstage/internal/model"

	"github.com/glebarez/sqlite"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestInitDB_DualTablesAndCascade(t *testing.T) {
	// Arrange: isolated temp SQLite DB file with WAL enabled
	dbPath := filepath.Join(t.TempDir(), "test_workstage.db")

	// Act
	database, err := db.InitDB(dbPath)
	require.NoError(t, err)
	require.NotNil(t, database)

	// Register connection close on test exit so Windows file lock is released before TempDir cleanup
	sqlDB, err := database.DB()
	require.NoError(t, err)
	t.Cleanup(func() {
		_ = sqlDB.Close()
	})

	// Verify tables exist by inserting MediaTask and TaskAssets
	taskID := uuid.New().String()
	now := time.Now().UTC().Truncate(time.Second)

	task := &model.MediaTask{
		ID:                 taskID,
		Provider:           "ark",
		ProviderTaskID:     "cgt-20260828-test001",
		Model:              "doubao-seedream-5-0-pro-260628",
		TaskType:           "image_generation",
		TaskMode:           "layer_decomp",
		Prompt:             "Cyberpunk warrior girl",
		ParamsJSON:         `{"size":"2K","layer_decomposition":true}`,
		Status:             model.TaskStatusSucceeded,
		Progress:           100,
		UsageTokens:        16384,
		OutputDurationSec:  0,
		BillingDetailsJSON: `{"pre_deducted_ipm":17,"actual_layers":2}`,
		CreatedAt:          now,
		UpdatedAt:          now,
		CompletedAt:        &now,
		Assets: []model.TaskAsset{
			{
				ID:              uuid.New().String(),
				TaskID:          taskID,
				AssetIndex:      0,
				Kind:            "image_base",
				Name:            "Base Layer",
				Description:     "Composite background",
				ZIndex:          0,
				BoundingBoxJSON: `[0,0,2048,2048]`,
				RemoteURL:       "https://tos.volces.com/base.png",
				LocalPath:       "images/" + taskID + "/base.png",
				FileSizeBytes:   2048500,
				DownloadedAt:    &now,
			},
			{
				ID:              uuid.New().String(),
				TaskID:          taskID,
				AssetIndex:      1,
				Kind:            "image_layer",
				Name:            "Character Layer",
				Description:     "Warrior subject cutout",
				ZIndex:          1,
				BoundingBoxJSON: `[512,384,1024,1536]`,
				RemoteURL:       "https://tos.volces.com/layer_01.png",
				LocalPath:       "images/" + taskID + "/layer_01.png",
				FileSizeBytes:   1024200,
				DownloadedAt:    &now,
			},
		},
	}

	err = database.Create(task).Error
	require.NoError(t, err)

	// Read back and verify Preload relationship
	var fetched model.MediaTask
	err = database.Preload("Assets").First(&fetched, "id = ?", taskID).Error
	require.NoError(t, err)

	assert.Equal(t, taskID, fetched.ID)
	assert.Equal(t, "ark", fetched.Provider)
	assert.Equal(t, model.TaskStatusSucceeded, fetched.Status)
	assert.Equal(t, 2, len(fetched.Assets))
	assert.Equal(t, "image_base", fetched.Assets[0].Kind)
	assert.Equal(t, "image_layer", fetched.Assets[1].Kind)
	assert.Equal(t, `[512,384,1024,1536]`, fetched.Assets[1].BoundingBoxJSON)
}

func TestInitDB_SplitsLegacyUploadSettingsOnlyOnce(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy.db")
	legacy, err := gorm.Open(sqlite.Open(path))
	require.NoError(t, err)
	legacySQL, err := legacy.DB()
	require.NoError(t, err)
	defer legacySQL.Close()
	require.NoError(t, legacy.AutoMigrate(&model.SystemConfig{}))
	require.NoError(t, legacy.Create(&[]model.SystemConfig{
		{Key: "upload_base_url", Value: "https://old.example"},
		{Key: "upload_api_key", Value: "sk-legacy-test"},
	}).Error)

	database, err := db.InitDB(path)
	require.NoError(t, err)
	sqlDB, err := database.DB()
	require.NoError(t, err)
	defer sqlDB.Close()
	readSettings := func(db *gorm.DB, pattern string) map[string]string {
		var rows []model.SystemConfig
		require.NoError(t, db.Where("key LIKE ?", pattern).Find(&rows).Error)
		values := map[string]string{}
		for _, row := range rows {
			values[row.Key] = row.Value
		}
		return values
	}
	assert.Equal(t, map[string]string{
		"file_upload_base_url": "https://old.example",
		"file_upload_api_key":  "sk-legacy-test",
	}, readSettings(database, "file_upload_%"))

	require.NoError(t, database.Where("key LIKE ?", "file_upload_%").Delete(&model.SystemConfig{}).Error)
	restarted, err := db.InitDB(path)
	require.NoError(t, err)
	restartedSQL, err := restarted.DB()
	require.NoError(t, err)
	defer restartedSQL.Close()
	assert.Empty(t, readSettings(restarted, "file_upload_%"))
	assert.Equal(t, "https://old.example", readSettings(restarted, "upload_base_url")["upload_base_url"])
	assert.Equal(t, "sk-legacy-test", readSettings(restarted, "upload_api_key")["upload_api_key"])
}

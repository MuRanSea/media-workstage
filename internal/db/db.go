package db

import (
	"fmt"
	"os"
	"path/filepath"

	"media-workstage/internal/model"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// InitDB initializes SQLite database using pure-Go driver and runs AutoMigrate.
func InitDB(dbPath string) (*gorm.DB, error) {
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create database directory %s: %w", dir, err)
	}

	// Enable WAL mode & busy timeout via pragmas
	dsn := fmt.Sprintf("%s?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)", dbPath)

	database, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to connect to sqlite database: %w", err)
	}

	// AutoMigrate tables
	if err := database.AutoMigrate(&model.MediaTask{}, &model.TaskAsset{}, &model.SystemConfig{}, &model.MediaCallbackReceipt{}); err != nil {
		return nil, fmt.Errorf("failed to run database automigrate: %w", err)
	}

	if err := splitUploadConfig(database); err != nil {
		return nil, fmt.Errorf("failed to migrate upload settings: %w", err)
	}
	return database, nil
}

// Copy a complete saved pair so a partial config never sends a key to the wrong origin.
// Record the migration even on a clean install so later edits or clears stay independent.
func splitUploadConfig(database *gorm.DB) error {
	return database.Transaction(func(tx *gorm.DB) error {
		marker := tx.Exec(`INSERT OR IGNORE INTO system_configs (key, value, updated_at)
			VALUES ('upload_config_split_v1', '1', CURRENT_TIMESTAMP)`)
		if marker.Error != nil || marker.RowsAffected == 0 {
			return marker.Error
		}
		return tx.Exec(`INSERT OR IGNORE INTO system_configs (key, value, updated_at)
			SELECT 'file_' || key, value, updated_at FROM system_configs
			WHERE key IN ('upload_base_url', 'upload_api_key') AND trim(value) <> ''
			AND (SELECT COUNT(*) FROM system_configs
				WHERE key IN ('upload_base_url', 'upload_api_key') AND trim(value) <> '') = 2`).Error
	})
}

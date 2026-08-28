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
	if err := database.AutoMigrate(&model.MediaTask{}, &model.TaskAsset{}); err != nil {
		return nil, fmt.Errorf("failed to run database automigrate: %w", err)
	}

	return database, nil
}

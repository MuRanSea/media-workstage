package model

import (
	"time"
)

// Task status constants
const (
	TaskStatusQueued    = "queued"
	TaskStatusRunning   = "running"
	TaskStatusSucceeded = "succeeded"
	TaskStatusFailed    = "failed"
	TaskStatusCancelled = "cancelled"
	TaskStatusExpired   = "expired"
)

// ReferenceItem represents an input reference media item.
type ReferenceItem struct {
	CardID   string `json:"card_id"`
	TagIndex int    `json:"tag_index"`
	Role     string `json:"role"` // "reference_image" | "first_frame" | "last_frame"
	Label    string `json:"label"`
	URL      string `json:"url,omitempty"`
}

// MediaTask represents a generation job in the system.
type MediaTask struct {
	ID                 string      `gorm:"primaryKey;type:varchar(64)" json:"id"`
	Provider           string      `gorm:"type:varchar(32);index;not null" json:"provider"` // "ark" | "minimax"
	ProviderTaskID     string      `gorm:"type:varchar(128);index" json:"provider_task_id"`
	Model              string      `gorm:"type:varchar(64);not null" json:"model"`
	TaskType           string      `gorm:"type:varchar(32);not null" json:"task_type"` // "video_generation" | "image_generation"
	TaskMode           string      `gorm:"type:varchar(32);not null" json:"task_mode"` // "all_modal" | "first_last_frame" | "text_to_video" | "single" | "layer_decomp" | "sequential"
	Prompt             string      `gorm:"type:text;not null" json:"prompt"`
	ParamsJSON         string      `gorm:"type:text" json:"params_json"`
	Status             string      `gorm:"type:varchar(32);index;not null" json:"status"`
	Progress           int         `gorm:"default:0" json:"progress"`
	ErrorCode          string      `gorm:"type:varchar(64)" json:"error_code,omitempty"`
	ErrorMessage       string      `gorm:"type:text" json:"error_message,omitempty"`
	UsageTokens        int         `gorm:"default:0" json:"usage_tokens"`
	BilledDurationSec  float64     `gorm:"default:0" json:"billed_duration_sec"`
	BillingDetailsJSON string      `gorm:"type:text" json:"billing_details_json,omitempty"`
	CreatedAt          time.Time   `gorm:"index;not null" json:"created_at"`
	UpdatedAt          time.Time   `gorm:"not null" json:"updated_at"`
	CompletedAt        *time.Time  `json:"completed_at,omitempty"`
	Assets             []TaskAsset `gorm:"foreignKey:TaskID;constraint:OnDelete:CASCADE" json:"assets,omitempty"`
}

// TaskAsset represents a granular output file produced by a MediaTask.
type TaskAsset struct {
	ID              string     `gorm:"primaryKey;type:varchar(64)" json:"id"`
	TaskID          string     `gorm:"type:varchar(64);index;not null" json:"task_id"`
	AssetIndex      int        `gorm:"not null" json:"asset_index"`
	Kind            string     `gorm:"type:varchar(32);not null" json:"kind"` // "video" | "image_base" | "image_layer" | "image_frame"
	Name            string     `gorm:"type:varchar(128)" json:"name,omitempty"`
	Description     string     `gorm:"type:text" json:"description,omitempty"`
	ZIndex          int        `gorm:"default:0" json:"z_index"`
	BoundingBoxJSON string     `gorm:"type:text" json:"bounding_box_json,omitempty"`
	RemoteURL       string     `gorm:"type:text" json:"remote_url,omitempty"`
	LocalPath       string     `gorm:"type:text;not null" json:"local_path"`
	FileSizeBytes   int64      `gorm:"default:0" json:"file_size_bytes"`
	DownloadedAt    *time.Time `json:"downloaded_at,omitempty"`
}

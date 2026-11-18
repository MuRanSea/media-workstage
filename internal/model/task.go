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

// Delivery is tracked independently of the upstream generation result.
const (
	DeliveryPending     = "pending"
	DeliveryComplete    = "complete"
	DeliveryPartial     = "partial"
	DeliveryUnavailable = "unavailable"
)

// ReferenceItem represents an input reference media item.
type ReferenceItem struct {
	CardID      string `json:"card_id"`
	TagIndex    int    `json:"tag_index"`
	ReferenceID string `json:"reference_id,omitempty"`
	FileID      string `json:"file_id,omitempty"`
	// "reference_image" | "first_frame" | "last_frame" | "reference_video" | "reference_audio";
	// Heighliner cards use the gateway's own roles ("reference", "multi_view_left", "voice"…).
	Role string `json:"role"`
	// Type is the media type for protocols whose roles do not imply it: "image" | "video" | "audio".
	Type      string `json:"type,omitempty"`
	Label     string `json:"label"`
	URL       string `json:"url,omitempty"`
	LocalPath string `json:"local_path,omitempty"`
	// RemoteURL is where the provider originally served a generated image. It may
	// expire; adapters needing a public URL use it only when they cannot upload LocalPath.
	RemoteURL string `json:"remote_url,omitempty"`
}

// ResultAction is a follow-up operation a provider offers on a finished task, such as
// Midjourney's U1-U4 / V1-V4 buttons. ID is the provider's own identifier for it.
type ResultAction struct {
	ID    string `json:"id"`
	Label string `json:"label,omitempty"`
	Emoji string `json:"emoji,omitempty"`
}

// MediaTask represents a generation job in the system.
type MediaTask struct {
	ID                 string         `gorm:"primaryKey;type:varchar(64)" json:"id"`
	ProjectID          string         `gorm:"type:varchar(64);index" json:"project_id,omitempty"` // Owning project; empty for pre-project tasks
	Provider           string         `gorm:"type:varchar(32);index;not null" json:"provider"`    // "ark" | "minimax"
	ProviderTaskID     string         `gorm:"type:varchar(128);index" json:"provider_task_id"`
	Model              string         `gorm:"type:varchar(64);not null" json:"model"`
	TaskType           string         `gorm:"type:varchar(32);not null" json:"task_type"` // "video_generation" | "image_generation" | "3d_generation"
	TaskMode           string         `gorm:"type:varchar(32);not null" json:"task_mode"` // "all_modal" | "first_last_frame" | "text_to_video" | "video_edit" | "single" | "layer_decomp" | "sequential"
	Prompt             string         `gorm:"type:text;not null" json:"prompt"`
	ParamsJSON         string         `gorm:"type:text" json:"params_json"`
	Status             string         `gorm:"type:varchar(32);index;not null" json:"status"`
	Progress           int            `gorm:"default:0" json:"progress"`
	ErrorCode          string         `gorm:"type:varchar(64)" json:"error_code,omitempty"`
	ErrorMessage       string         `gorm:"type:text" json:"error_message,omitempty"`
	UsageTokens        int            `gorm:"default:0" json:"usage_tokens"`
	OutputDurationSec  float64        `gorm:"default:0" json:"output_duration_sec"` // Returned video duration
	BillingDetailsJSON string         `gorm:"type:text" json:"billing_details_json,omitempty"`
	BillingChecks      int            `gorm:"default:0" json:"-"`
	NextBillingCheck   *time.Time     `json:"-"`
	DeliveryStartedAt  *time.Time     `json:"-"` // Bounds retry/transfer across worker restarts.
	DeliveryStatus     string         `gorm:"type:varchar(32)" json:"delivery_status,omitempty"`
	DeliveryMessage    string         `gorm:"type:text" json:"delivery_message,omitempty"`
	ResultActions      []ResultAction `gorm:"serializer:json;type:text" json:"result_actions,omitempty"` // Follow-ups offered on the result
	ResultText         string         `gorm:"type:text" json:"result_text,omitempty"`                    // Text output (e.g. Midjourney Describe)
	ResultVersion      int            `json:"result_version,omitempty"`
	Contents           []MediaContent `gorm:"serializer:json;type:text" json:"contents,omitempty"`
	CreatedAt          time.Time      `gorm:"index;not null" json:"created_at"`
	SubmittedAt        *time.Time     `json:"submitted_at,omitempty"` // Accepted by the provider; the poll deadline counts from here
	UpdatedAt          time.Time      `gorm:"not null" json:"updated_at"`
	CompletedAt        *time.Time     `json:"completed_at,omitempty"`
	Assets             []TaskAsset    `gorm:"foreignKey:TaskID;constraint:OnDelete:CASCADE" json:"assets,omitempty"`
}

// MediaContent is a candidate's ordered output, distinct from the file list.
type MediaContent struct {
	CandidateIndex int                `json:"candidate_index"`
	Role           string             `json:"role,omitempty"`
	Parts          []MediaContentPart `json:"parts"`
}

type MediaContentPart struct {
	Type          string  `json:"type"`
	Text          *string `json:"text,omitempty"`
	ArtifactIndex *int    `json:"artifact_index,omitempty"`
}

// TaskAsset represents a granular output file produced by a MediaTask.
type TaskAsset struct {
	ID                   string     `gorm:"primaryKey;type:varchar(64)" json:"id"`
	TaskID               string     `gorm:"type:varchar(64);index;not null" json:"task_id"`
	AssetIndex           int        `gorm:"not null" json:"asset_index"`
	Kind                 string     `gorm:"type:varchar(32);not null" json:"kind"` // "video" | "image_base" | "image_layer" | "image_frame"
	Name                 string     `gorm:"type:varchar(128)" json:"name,omitempty"`
	Description          string     `gorm:"type:text" json:"description,omitempty"`
	ZIndex               int        `gorm:"default:0" json:"z_index"`
	ProviderMetadataJSON string     `gorm:"type:text" json:"provider_metadata_json,omitempty"`
	ProviderOutputID     string     `json:"provider_output_id,omitempty"`
	Variant              string     `json:"variant,omitempty"`
	DurationSeconds      string     `json:"duration_seconds,omitempty"`
	BoundingBoxJSON      string     `gorm:"type:text" json:"bounding_box_json,omitempty"`
	RemoteURL            string     `gorm:"type:text" json:"remote_url,omitempty"`
	GlobalFallback       bool       `json:"-"` // Downloaded after the owning project left the root.
	LocalPath            string     `gorm:"type:text;not null" json:"local_path"`
	FileSizeBytes        int64      `gorm:"default:0" json:"file_size_bytes"`
	DownloadedAt         *time.Time `json:"downloaded_at,omitempty"`
}

// MediaCallbackReceipt stores the highest authenticated event received per local task.
type MediaCallbackReceipt struct {
	TaskID   string `gorm:"primaryKey"`
	Sequence int64
	EventID  string
}

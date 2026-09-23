package model

import "time"

// SystemConfig stores persistent application settings (e.g. API keys, base URLs).
type SystemConfig struct {
	Key       string    `gorm:"primaryKey;type:varchar(64)" json:"key"`
	Value     string    `gorm:"type:text;not null" json:"value"`
	UpdatedAt time.Time `gorm:"not null" json:"updated_at"`
}

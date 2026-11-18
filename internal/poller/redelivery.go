package poller

import (
	"context"
	"errors"
	"gorm.io/gorm"
	"media-workstage/internal/model"
	"time"
)

var ErrNotRedeliverable = errors.New("only an existing successful task with missing files can be redelivered")

// RequeueDelivery never enters the submission queue state. Startup recovery can
// safely resume the same provider ID if the desktop exits after the DB update.
func (p *TaskPoller) RequeueDelivery(ctx context.Context, task *model.MediaTask) error {
	if task.ProviderTaskID == "" {
		return ErrNotRedeliverable
	}
	now := time.Now().UTC()
	scope := p.db.WithContext(ctx).Model(&model.MediaTask{}).Where("id = ? AND project_id = ? AND provider = ? AND provider_task_id = ?", task.ID, task.ProjectID, task.Provider, task.ProviderTaskID)
	updated := scope.Session(&gorm.Session{}).Where("status = ? AND delivery_status IN ?", model.TaskStatusSucceeded, []string{model.DeliveryUnavailable, model.DeliveryPartial}).Updates(map[string]any{"status": model.TaskStatusRunning, "delivery_status": model.DeliveryPending, "delivery_started_at": now, "updated_at": now, "delivery_message": ""})
	if updated.Error != nil {
		return updated.Error
	}
	if updated.RowsAffected == 0 {
		var current model.MediaTask
		if err := scope.First(&current).Error; err != nil {
			return err
		}
		if current.Status == model.TaskStatusRunning && current.DeliveryStatus == model.DeliveryPending || current.Status == model.TaskStatusSucceeded && current.DeliveryStatus == model.DeliveryComplete {
			return nil
		}
		return ErrNotRedeliverable
	}
	if active, ok := p.activeTasks.Load(task.ID); ok {
		go func() { <-active.(*taskWorker).done; p.Enqueue(task.ID) }()
	} else {
		p.Enqueue(task.ID)
	}
	return nil
}

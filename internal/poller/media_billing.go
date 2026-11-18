package poller

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"media-workstage/internal/adapter"
	"media-workstage/internal/model"
)

const maxBillingChecks = 10

var errNoBillingAdapter = errors.New("no configured Media billing adapter")

var billingTerminalTasks = []string{model.TaskStatusSucceeded, model.TaskStatusFailed, model.TaskStatusCancelled, model.TaskStatusExpired}

// RefreshMediaBilling queries the existing remote job and changes only its billing fields.
// A missing billing field leaves the previous evidence intact, never implying a zero charge.
func (p *TaskPoller) RefreshMediaBilling(ctx context.Context, task *model.MediaTask) (*model.MediaTask, error) {
	ad, _ := p.registry.GetForTask(task.Provider, task.ProviderTaskID)
	a, ok := ad.(*adapter.HeighlinerAdapter)
	if !ok || !a.GetConfig().IsConfigured || task.ProviderTaskID == "" {
		return nil, errNoBillingAdapter
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	raw, err := a.ReadMediaBilling(ctx, task.ProviderTaskID)
	if err != nil {
		return nil, err
	}
	var field struct {
		Status string `json:"status"`
	}
	if json.Unmarshal(raw, &field) != nil || field.Status == "" {
		return nil, errors.New("no billing evidence on the original task")
	}
	if string(raw) != task.BillingDetailsJSON {
		// Another refresh may have observed a newer reply concurrently. Do not replace it blindly.
		update := p.db.WithContext(ctx).Model(&model.MediaTask{}).
			Where("id = ? AND provider_task_id = ? AND status IN ? AND COALESCE(billing_details_json, '') = ?", task.ID, task.ProviderTaskID, billingTerminalTasks, task.BillingDetailsJSON).
			UpdateColumn("billing_details_json", string(raw))
		if update.Error != nil {
			return nil, update.Error
		}
		if update.RowsAffected != 0 {
			event := model.MediaTask{ID: task.ID, ProjectID: task.ProjectID, BillingDetailsJSON: string(raw)}
			p.broadcaster.Broadcast("task.billing", &event)
		}
	}
	var fresh model.MediaTask
	err = p.db.WithContext(ctx).Preload("Assets").First(&fresh, "id = ?", task.ID).Error
	return &fresh, err
}

func (p *TaskPoller) runBillingChecks(ctx context.Context) {
	defer p.workerWg.Done()
	tick := time.NewTicker(5 * time.Second)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-tick.C:
			p.checkPendingBilling(ctx, now)
		}
	}
}

func (p *TaskPoller) checkPendingBilling(ctx context.Context, now time.Time) {
	var providers []string
	for id, ad := range p.registry.GetAll() {
		if a, ok := ad.(*adapter.HeighlinerAdapter); ok && a.GetConfig().IsConfigured {
			providers = append(providers, id)
		}
	}
	if len(providers) == 0 {
		return
	}
	var due []model.MediaTask
	err := p.db.WithContext(ctx).Where("provider IN ?", providers).Where("status IN ? AND provider_task_id <> '' AND billing_checks < ?", billingTerminalTasks, maxBillingChecks).
		Where("next_billing_check IS NULL OR next_billing_check <= ?", now).
		Where(`CASE WHEN json_valid(billing_details_json) THEN json_extract(billing_details_json, '$.status') END IN ('reserved', 'reconciling', 'release_pending')`).
		Order("next_billing_check ASC, completed_at ASC").Limit(12).Find(&due).Error
	if err != nil {
		return
	}
	for i := range due {
		if ctx.Err() != nil {
			return
		}
		task := &due[i]
		ad, _ := p.registry.GetForTask(task.Provider, task.ProviderTaskID)
		if a, ok := ad.(*adapter.HeighlinerAdapter); !ok || !a.GetConfig().IsConfigured {
			continue
		}
		attempts := task.BillingChecks + 1
		delay := 5 * time.Second << min(attempts-1, 7)
		next := now.Add(delay)
		// Persist the bounded budget before the request so restart cannot reset it.
		res := p.db.WithContext(ctx).Model(&model.MediaTask{}).Where("id = ? AND billing_checks = ? AND billing_details_json = ?", task.ID, task.BillingChecks, task.BillingDetailsJSON).
			UpdateColumns(map[string]any{"billing_checks": attempts, "next_billing_check": next})
		if res.Error == nil && res.RowsAffected != 0 {
			if _, err := p.RefreshMediaBilling(ctx, task); errors.Is(err, errNoBillingAdapter) {
				// Revoked between claiming the row and dispatch: no HTTP attempt was made.
				p.db.Model(&model.MediaTask{}).Where("id = ? AND billing_checks = ? AND next_billing_check = ?", task.ID, attempts, next).UpdateColumns(map[string]any{"billing_checks": task.BillingChecks, "next_billing_check": task.NextBillingCheck})
			}
		}
	}
}

package server

import (
	"errors"
	"fmt"

	"gorm.io/gorm"

	"media-workstage/internal/model"
)

// resolveSourceTask validates a follow-up task's link to the task it acts on. When
// params carry "action_id", "source_task_id" must name a succeeded task of the same
// Provider that offered that action; its provider task ID is then added to params as
// "source_provider_task_id" for the adapter. Tasks without "action_id" pass through.
func resolveSourceTask(db *gorm.DB, provider string, params map[string]interface{}) error {
	actionID, _ := params["action_id"].(string)
	if actionID == "" {
		return nil
	}
	sourceID, _ := params["source_task_id"].(string)
	if sourceID == "" {
		return errors.New("后续操作缺少来源任务（source_task_id）")
	}

	var source model.MediaTask
	if err := db.First(&source, "id = ?", sourceID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return fmt.Errorf("来源任务不存在：%s", sourceID)
		}
		return err
	}
	switch {
	case source.Provider != provider:
		return fmt.Errorf("来源任务属于服务商 %s，不能用 %s 执行后续操作", source.Provider, provider)
	case source.Status != model.TaskStatusSucceeded:
		return errors.New("来源任务尚未成功，不能执行后续操作")
	case source.ProviderTaskID == "":
		return errors.New("来源任务没有服务商任务 ID")
	}
	for _, a := range source.ResultActions {
		if a.ID == actionID {
			params["source_provider_task_id"] = source.ProviderTaskID
			return nil
		}
	}
	return errors.New("来源任务不支持该操作")
}

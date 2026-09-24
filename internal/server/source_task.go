package server

import (
	"errors"
	"fmt"
	"net/http"

	"gorm.io/gorm"

	"media-workstage/internal/model"
)

// resolveSourceTask validates a follow-up task's link to the task it acts on (a Result
// action). A task in mode "action", or whose params carry "action_id", must name via
// "source_task_id" a succeeded task of the same Provider and project that offered that
// action; its provider task ID is then added to params as "source_provider_task_id" for
// the adapter. It returns the HTTP status to answer with when the link is rejected.
func resolveSourceTask(db *gorm.DB, payload CreateTaskPayload, params map[string]interface{}) (int, error) {
	actionID, _ := params["action_id"].(string)
	if actionID == "" {
		if payload.TaskMode == "action" {
			return http.StatusBadRequest, errors.New("后续操作缺少要执行的操作（action_id）")
		}
		return 0, nil
	}
	sourceID, _ := params["source_task_id"].(string)
	if sourceID == "" {
		return http.StatusBadRequest, errors.New("后续操作缺少来源任务（source_task_id）")
	}

	var source model.MediaTask
	if err := db.First(&source, "id = ?", sourceID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return http.StatusBadRequest, fmt.Errorf("来源任务不存在：%s", sourceID)
		}
		return http.StatusInternalServerError, fmt.Errorf("读取来源任务失败：%w", err)
	}
	switch {
	case source.Provider != payload.Provider:
		return http.StatusBadRequest, fmt.Errorf("来源任务属于服务商 %s，不能用 %s 执行后续操作", source.Provider, payload.Provider)
	case source.ProjectID != payload.ProjectID:
		return http.StatusBadRequest, errors.New("来源任务属于另一个工程")
	case source.Status != model.TaskStatusSucceeded:
		return http.StatusBadRequest, errors.New("来源任务尚未成功，不能执行后续操作")
	case source.ProviderTaskID == "":
		return http.StatusBadRequest, errors.New("来源任务没有服务商任务 ID")
	}
	for _, a := range source.ResultActions {
		if a.ID == actionID {
			params["source_provider_task_id"] = source.ProviderTaskID
			return 0, nil
		}
	}
	return http.StatusBadRequest, errors.New("来源任务不支持该操作")
}

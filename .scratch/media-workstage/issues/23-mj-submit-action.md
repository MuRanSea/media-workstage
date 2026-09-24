# 23: 提交 MJ 后续动作（U/V/重绘等）

**Blocked by:** 22

**Status:** resolved

- [x] 创建任务时 `params.source_task_id` + `params.action_id`：服务端校验父任务同服务商、已成功、有 provider_task_id、动作在其按钮中，否则 400；注入 `source_provider_task_id`
- [x] `task_mode=action` → `POST /mj/submit/action {taskId, customId, chooseSameChannel}`
- [x] code 21：有 id 则查询一次，`MODAL` → `POST /mj/submit/modal {taskId, prompt}`；否则直接使用该 id

计划：`~/.claude/plans/ok-toasty-milner.md`（分支 `feat/mj-full`）。

## Answer

服务端 `resolveSourceTask`（`internal/server/source_task.go`）：params 带 `action_id` 时，`source_task_id` 必须指向同服务商、已成功、有服务商任务 ID、且 `ResultActions` 里有该动作的任务，否则 400（中文原因）；通过后注入 `source_provider_task_id`。不含 MJ 专有逻辑。

适配器：`SubmitTask` 按 `task_mode` 分派（`action` / 其余为 imagine），抽出 `postSubmit`、`acceptedID`、`fetch` 共用。动作提交 `{taskId, customId, chooseSameChannel: true}`，不带 prompt / botType。code 21：查询该 id，`MODAL` 时以任务提示词提交 `/mj/submit/modal`，否则直接沿用该 id。

验证：适配器 4 个新测试（请求体、21+MODAL、21 已存在、缺来源）；服务端注入与 5 种拒绝；新 `midjourney_e2e_test.go`（抽出 `newMidjourneyE2E` / `createAndWait`）含 imagine → U1 端到端，放大结果带自己的按钮并过滤掉 Custom Zoom。

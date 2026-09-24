# 23: 提交 MJ 后续动作（U/V/重绘等）

**Blocked by:** 22

**Status:** ready-for-agent

- [ ] 创建任务时 `params.source_task_id` + `params.action_id`：服务端校验父任务同服务商、已成功、有 provider_task_id、动作在其按钮中，否则 400；注入 `source_provider_task_id`
- [ ] `task_mode=action` → `POST /mj/submit/action {taskId, customId, chooseSameChannel}`
- [ ] code 21：有 id 则查询一次，`MODAL` → `POST /mj/submit/modal {taskId, prompt}`；否则直接使用该 id

计划：`~/.claude/plans/ok-toasty-milner.md`（分支 `feat/mj-full`）。

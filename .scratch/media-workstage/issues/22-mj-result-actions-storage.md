# 22: MJ 结果按钮与结果文本的存储

**Status:** resolved

- [x] 新增通用 `TaskAction{ID, Label, Emoji}`；`PollResult.Actions` / `PollResult.Text`
- [x] `MediaTask.ResultActions`（JSON 序列化列）与 `MediaTask.ResultText`，经 `GET /api/tasks/:id` 返回
- [x] MJ 成功时解析 `buttons`，过滤需要用户输入的按钮（CustomZoom / Inpaint / PicReader / 书签）
- [x] 轮询器成功时写入按钮与文本；有文本无资产的任务可以成功

计划：`~/.claude/plans/ok-toasty-milner.md`（分支 `feat/mj-full`）。

## Answer

`model.TaskAction{ID, Label, Emoji}`；`MediaTask.ResultActions`（`serializer:json` 文本列，AutoMigrate 自动加列）与 `ResultText`，由轮询器 `handleSuccess` 从 `PollResult.Actions` / `Text` 写入。MJ 适配器解析 fetch 的 `buttons`，丢掉 customId 含 `::CustomZoom::`、`::Inpaint::`、`::PicReader::`、`::BOOKMARK::` 的按钮。轮询器本就只在"有资产且全部下载失败"时判失败，无资产的文本结果直接成功。

验证：新增 `TestMidjourneyPollTask_SuccessReturnsActions`（真实网关按钮样例）、`TestTaskPoller_StoresResultActionsAndTextWithoutAssets`，端到端测试断言 `GET /api/tasks/:id` 返回 `result_actions`；Go 全部通过。

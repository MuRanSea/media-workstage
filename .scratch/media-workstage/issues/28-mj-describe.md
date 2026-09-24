# 28: MJ Describe 反推提示词 → 文本卡

**Blocked by:** 24, 26

**Status:** resolved

- [x] 成功的图片卡右键「Midjourney 反推提示词」，新建派生文本卡并提交 describe 任务
- [x] `POST /mj/submit/describe {base64, botType}`；结果取 `properties.finalPrompt` 写入文本卡，可连到图片卡当提示词
- [x] finalPrompt 为空 → EmptyResult

计划：`~/.claude/plans/ok-toasty-milner.md`（分支 `feat/mj-full`）。

## Answer

后端：`task_mode: describe` → `/mj/submit/describe {botType, base64}`（恰好 1 张参考图）；成功时取 `properties.finalPrompt` 作为 `PollResult.Text`、不产出文件（被描述的图是用户自己的图）；为空 → `EmptyResult`。

前端：`findDescribeProvider`（第一个已配置、绑了图片模型的 MJ 协议服务商）；成功的图片卡右键菜单「Midjourney 反推提示词」（存在这样的服务商时才出现），新建派生文本卡（`spawnDescribeCard`：来源图作为参考，`derivedFrom.operation = describe`，紫色派生连线，不再额外画参考连线）并立即提交；`handleTriggerGenerate` 对这类文本卡走任务流程（`compileDescribePayload`），其他文本卡仍走 LLM。结果由 `applyTaskToCard` 写入 `textOutput`，可直接连到图片卡当提示词。文本卡与属性面板对反推卡隐藏用途/模型选择，按钮为「反推提示词 / 重新反推」。

验证：`TestMidjourneySubmitDescribe`、`TestMidjourneyPollTask_DescribeText`、`TestMidjourneyDescribe_EndToEnd`；`mjActions.test.ts` +3、`compiler.test.ts` +1；前端 106、Go 全部通过。

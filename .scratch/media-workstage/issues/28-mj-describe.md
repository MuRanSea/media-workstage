# 28: MJ Describe 反推提示词 → 文本卡

**Blocked by:** 24, 26

**Status:** ready-for-agent

- [ ] 成功的图片卡右键「Midjourney 反推提示词」，新建派生文本卡并提交 describe 任务
- [ ] `POST /mj/submit/describe {base64, botType}`；结果取 `properties.finalPrompt` 写入文本卡，可连到图片卡当提示词
- [ ] finalPrompt 为空 → EmptyResult

计划：`~/.claude/plans/ok-toasty-milner.md`（分支 `feat/mj-full`）。

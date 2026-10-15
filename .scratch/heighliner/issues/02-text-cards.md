# 02: Heighliner 文本卡

Parent: [../spec.md](../spec.md)

**Status:** done

**What to build:**
`llm.Supported` 和 `llm.Generate` 支持 `heighliner`：根地址拼成 `/v1/chat/completions`，复用 `chatCompletions`，只发标准字段（`model`、`messages`，图片走 `image_url`），不加 `thinking` 之类厂商字段。前端 `READY_PROTOCOLS.text` 加上 `heighliner`。

**Blocked by:** 01

- [x] Heighliner 服务商的 chat 模型出现在文本卡的模型下拉里，可以运行
- [x] 请求地址是 `<根地址>/v1/chat/completions`，Base URL 末尾带不带 `/` 都能正确拼接
- [x] 请求体里不含任何厂商专属字段
- [x] 带图片的文本卡照常发出 vision 内容
- [x] Go 单元测试覆盖地址拼接和请求体

## Comments

- 2026-10-14 实现记录：`llm.Supported`/`Generate` 加 heighliner，地址 `<根>/v1/chat/completions`（Base URL 先去掉末尾 `/`），复用 `chatCompletions` 且不传 extra。前端 `READY_PROTOCOLS.text` 加 heighliner。测试：`internal/llm/llm_heighliner_test.go`（两种 Base URL 写法、请求体只有 model/messages、vision 部件）；`channelModels.test.ts` 的 Heighliner readiness。

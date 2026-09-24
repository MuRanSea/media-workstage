# 18: 服务商按接入协议分支（行为不变的重构）

**What to build:**
为"服务商是接入协议的实例"（[ADR 0004](../../../docs/adr/0004-providers-as-protocol-instances.md)）铺路：给每个服务商标上接入协议，把所有"服务商 ID 是不是 `ark` / `openai` …"的分支改成按协议判断。服务商列表、ID、配置键、界面表现都不变，这一步只换判断依据。

**Blocked by:** —

**Status:** resolved

接入协议取值：`ark`（火山方舟原生）、`minimax`、`kling`、`midjourney`、`gemini`、`openai_compatible`、`apimart`。现有 7 个服务商都是预置服务商，协议分别对应；预置的 `openai` 服务商的协议是 `openai_compatible`，`google` 的协议是 `gemini`。

- [x] 后端 `channelSpec` 增加协议字段；`GET /api/config` 每个服务商返回 `protocol` 和 `preset: true`
- [x] `adapter.NewChannelAdapter` 按协议构建适配器，接收服务商 ID 作为适配器的名字（`ProviderName()`、`requireImageTask` 的报错用实例 ID，而不是写死的 `"openai"` 等）
- [x] `llm.Supported` / `llm.Generate` 按协议选择端点（Ark 关闭 thinking、MiniMax 走 `chatcompletion_v2`、Gemini 走 `generateContent`、`openai_compatible` 与 `apimart` 走 `/chat/completions`）
- [x] `cmd/server/main.go` 遍历服务商列表构建适配器，去掉 `[]string{"openai", "google", "apimart"}` 这类写死列表；无密钥时走 mock 仍只限预置的 `ark` / `minimax`
- [x] 前端 `ChannelId` 联合类型改为普通字符串 `ProviderId`；`ProviderConfigItem` 增加 `protocol`、`preset`
- [x] `READY_CHANNELS`、`MOCK_CHANNELS`、`isModelReady` 改为按协议；`cardParams.ts`、`compiler.ts`、`ImageInspector.tsx`、`ImageCardView.tsx`、`resolveVideoModelDef` 里的 `=== 'ark'` / `=== 'minimax'` / `=== 'apimart'` 改为按协议判断（模型能力定义继续跟着协议走）
- [x] 卡片上的服务商名称取自 `GET /api/config` 的 `name`，不再用前端的 `CHANNEL_SHORT_NAMES`；后端预置名称改为现在的短名（"火山方舟"、"MiniMax 官方"、"可灵"……）
- [x] 设置页每个服务商的说明文案（标题、副标题、占位符、提示）改为按协议取
- [x] 按协议分支的逻辑有单测；现有 Go 与前端测试全部通过

## Answer

后端新增 `model.Protocol`；`internal/server/providers.go`（原 `channels.go`）拆成按协议的 `protocolSpecs`（连接探测、模型列表）和 `presetProviders`（ID、名称、协议、环境变量、预设模型、`MockWhenUnset`）。`adapter.NewProviderAdapter` 与 `llm.Supported/Generate` 按协议分支；启动与清除配置共用 `liveAdapter`，`main.go` 只调 `server.PresetAdapters`。

前端 `engine/providers.ts` 维护服务商 → 协议 / 显示名（预置服务商在配置加载前即可解析），`channelModels`、`cardParams`、`compiler`、`videoCompiler`、`connections`、`resolveVideoModelDef` 与各卡片 / 属性面板改为按协议判断；设置页文案改为 `PROTOCOL_META`，左侧列表来自 `GET /api/config`。

Go 全部测试与前端 75 个单测通过（新增协议分支测试）。用隔离数据库启动打包后的程序走查：设置页列出 7 个预置服务商、OpenAI 显示"OpenAI 兼容 API"；火山方舟图片卡仍走 Seedream 档位并按 2816x1584 提交；视频卡切到 MiniMax 官方后按 MiniMax 限制（720P、最多 2 张参考）并出现"自动优化提示词"，两个任务均由 mock 适配器接收，控制台无报错。

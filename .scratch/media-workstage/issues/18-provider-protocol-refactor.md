# 18: 服务商按接入协议分支（行为不变的重构）

**What to build:**
为"服务商是接入协议的实例"（[ADR 0004](../../../docs/adr/0004-providers-as-protocol-instances.md)）铺路：给每个服务商标上接入协议，把所有"服务商 ID 是不是 `ark` / `openai` …"的分支改成按协议判断。服务商列表、ID、配置键、界面表现都不变，这一步只换判断依据。

**Blocked by:** —

**Status:** ready-for-agent

接入协议取值：`ark`（火山方舟原生）、`minimax`、`kling`、`midjourney`、`gemini`、`openai_compatible`、`apimart`。现有 7 个服务商都是预置服务商，协议分别对应；预置的 `openai` 服务商的协议是 `openai_compatible`，`google` 的协议是 `gemini`。

- [ ] 后端 `channelSpec` 增加协议字段；`GET /api/config` 每个服务商返回 `protocol` 和 `preset: true`
- [ ] `adapter.NewChannelAdapter` 按协议构建适配器，接收服务商 ID 作为适配器的名字（`ProviderName()`、`requireImageTask` 的报错用实例 ID，而不是写死的 `"openai"` 等）
- [ ] `llm.Supported` / `llm.Generate` 按协议选择端点（Ark 关闭 thinking、MiniMax 走 `chatcompletion_v2`、Gemini 走 `generateContent`、`openai_compatible` 与 `apimart` 走 `/chat/completions`）
- [ ] `cmd/server/main.go` 遍历服务商列表构建适配器，去掉 `[]string{"openai", "google", "apimart"}` 这类写死列表；无密钥时走 mock 仍只限预置的 `ark` / `minimax`
- [ ] 前端 `ChannelId` 联合类型改为普通字符串 `ProviderId`；`ProviderConfigItem` 增加 `protocol`、`preset`
- [ ] `READY_CHANNELS`、`MOCK_CHANNELS`、`isModelReady` 改为按协议；`cardParams.ts`、`compiler.ts`、`ImageInspector.tsx`、`ImageCardView.tsx`、`resolveVideoModelDef` 里的 `=== 'ark'` / `=== 'minimax'` / `=== 'apimart'` 改为按协议判断（模型能力定义继续跟着协议走）
- [ ] 卡片上的服务商名称取自 `GET /api/config` 的 `name`，不再用前端的 `CHANNEL_SHORT_NAMES`；后端预置名称改为现在的短名（"火山方舟"、"MiniMax 官方"、"可灵"……）
- [ ] 设置页每个服务商的说明文案（标题、副标题、占位符、提示）改为按协议取
- [ ] 按协议分支的逻辑有单测；现有 Go 与前端测试全部通过

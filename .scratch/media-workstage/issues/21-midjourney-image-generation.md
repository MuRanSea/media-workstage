# 21: Midjourney（MJ Proxy 协议）生图

**What to build:**
Midjourney 服务商配好 Key 和地址后，图片卡的服务商选择器里仍显示"未接入"：`midjourney` 协议此前只保存配置，没有生成适配器。按 midjourney-proxy 的 `/mj` 接口（New API 文档：https://github.com/QuantumNous/new-api-docs/blob/main/docs/api/midjourney-proxy-image.md）接入文生图。

**Status:** resolved

- [x] 后端 `MidjourneyAdapter`：`POST /mj/submit/imagine` 提交（code 1 提交成功、22 排队都算成功，任务 ID 兼容字符串与裸数字），`GET /mj/task/{id}/fetch` 轮询；同时发送 `Authorization: Bearer` 与 `mj-api-secret`
- [x] 绑定的"模型"即 Bot type（`MID_JOURNEY` / `NIJI_JOURNEY`），作为 `botType` 发送；New API 列出的计费模型名（如 `mj_imagine`）不发 `botType`，走代理默认的 `MID_JOURNEY`
- [x] 结果是 MJ 的 2×2 四宫格，原样作为一张图保存（不切图、不自动 U1–U4）
- [x] 卡片宽高比拼成 `--ar W:H` 追加到 prompt；prompt 里已有 `--ar` / `--aspect`（含 `—ar`）时以 prompt 为准；分辨率对 MJ 无意义，忽略
- [x] 只做文生图；视频 / 文本任务拒绝
- [x] 前端：图片卡可选 Midjourney；文本、视频卡仍不可用；设置页不再提示"只保存配置"

## Answer

后端：`internal/adapter/midjourney.go`，由 `NewProviderAdapter` 按协议构建，适配器以服务商 ID 命名。状态映射：`SUCCESS` 成功，`FAILURE` / `CANCEL` 失败（带 `failReason`），其余为进行中（解析 `"45%"` 进度）；空响应（midjourney-proxy 对未知任务返回 200 空 body）判为 `TaskNotFound`，不再重试到超时。未填 Base URL 时提交直接报明确错误。轮询超时 15 分钟以覆盖 Relax 队列。共用的 `doJSON` 现在容忍 2xx 空 body，`errMessage` 能读出 `description`。

前端：`READY_PROTOCOLS.image` 加入 `midjourney`，`protocolMeta.midjourney.adapterReady = true`。

验证：新增适配器单测 9 个、服务商构建断言、一个经 HTTP API → 轮询器 → 适配器 → 假 MJ 代理 → 落盘的端到端测试，以及前端就绪性单测；Go 全部与前端 81 个单测通过，`tsc --noEmit` 通过。未对真实 Midjourney 中转做走查。

后续可做：MJ 卡片上的分辨率选项对 MJ 无效，可按协议隐藏；U/V 按钮、垫图、Blend 等动作未接入。

## Comments

2026-09-24 首次真实出图：任务提交成功、网关约 6 秒出图（`SUCCESS`），但卡片报失败 `TaskNotFound`，错误信息为"提交成功"。原因是网关在刚提交时返回的任务对象 `status` 为空字符串（novicezk 文档只列 `NOT_START` / `SUBMITTED` / `IN_PROGRESS` / `FAILURE` / `SUCCESS`，网关略有偏差），而适配器把"空状态"当成任务不存在直接判失败——这条规则是自拟的，文档里没有。修正：只有 `SUCCESS` / `FAILURE` / `CANCEL` 结束任务，其余（含空与未知值）继续轮询、靠 15 分钟超时兜底；仅当响应里没有任务 `id`（空 body 或错误信封）才判 `TaskNotFound`。结果图在 Discord CDN 的临时链接上（带 `ex=` 过期参数，约 24 小时），轮询成功后立即下载即可。

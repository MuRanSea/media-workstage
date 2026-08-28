# 04-minimax-video-api-contract

Type: research
Status: resolved
Blocked by: none

## Question

深入调研 MiniMax 官方海螺（Hailuo）视频生成接口的官方 Endpoint、鉴权模式（API Key / Group ID）、异步任务提交（Prompt + 参考图）与状态轮询接口协议，并提炼其与 Ark 任务生命周期的共性与差异。

## Answer

研究报告已归档至 [docs/research/04-minimax-video-api-contract.md](../../docs/research/04-minimax-video-api-contract.md)。

核心结论：
1. **Endpoint**: 任务创建 `POST /v1/video_generation`，状态轮询 `GET /v1/query/video_generation?task_id={id}`，文件提取 `GET /v1/files/retrieve?file_id={id}`。
2. **鉴权**: Header `Authorization: Bearer <MINIMAX_API_KEY>`。
3. **输入素材**: 支持文本 Prompt（支持 `prompt_optimizer` 开关）、首帧 `first_frame_image`（支持 Data URL Base64 或公网 URL）、尾帧 `last_frame_image`。
4. **状态机**: `Preparing` -> `Queueing` -> `Processing` -> `Success`（提取 `file_id` 与 `content.url`）/ `Fail`。
5. **架构设计**: 提炼出通用的 `ProviderAdapter` 接口，抹平 Ark 与 MiniMax 状态机差异。

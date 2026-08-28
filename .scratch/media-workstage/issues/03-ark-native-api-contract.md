# 03-ark-native-api-contract

Type: research
Status: resolved
Blocked by: none

## Question

基于 `D:\Work\volcengine_doc_skill` 官方文档，深入研究火山方舟（Ark）原生视频生成（Seedance 2.5 / 2.0，`chapters/ark/5.1`）与图像生成（Seedream 5.0 / 4.x，`chapters/ark/6.1`）的完整请求体结构、异步任务创建/轮询接口契约、错误码处理、以及 Base64 直传与 URL 引用的具体限制。

## Answer

研究报告已归档至 [docs/research/03-ark-native-api-contract.md](../../docs/research/03-ark-native-api-contract.md)。

核心结论：
1. **Endpoint**: 任务创建 `POST /api/v3/contents/generations/tasks`，状态轮询 `GET /api/v3/contents/generations/tasks/{id}`，生图 `POST /api/v3/images/generations`。
2. **鉴权**: 标准 Header `Authorization: Bearer <ARK_API_KEY>`。
3. **多模态与 Base64**: Seedance 2.5 支持 `content` 数组内传递图片（最多30张）、视频（最多10段）、音频（最多10段）。图片与音频支持 `data:image/...;base64,...` 直传，单张图片 < 30MB，请求体 ≤ 64MB。
4. **状态机**: `queued` -> `running` -> `succeeded`（提取 `content.video_url`）/ `failed` / `cancelled`。

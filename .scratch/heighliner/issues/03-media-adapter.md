# 03: Heighliner 媒体适配器：提交、轮询、文件上传

Parent: [../spec.md](../spec.md)

**Status:** done

**What to build:**
新增 `HeighlinerAdapter`（注册到 `NewProviderAdapter`）。
- **提交**：按任务类型选 `/media/v1/images|videos|3d/generations`。请求带 `Idempotency-Key: <本地任务 ID>`、`wait: 0`，请求体是卡片编译出来的通用字段、`references` 和 `provider_options`。适配器不补任何未声明的字段。返回 202 或 200 时都取任务 `id`。
- **轮询**：`GET /media/v1/tasks/{id}`。
  - `queued`、`running`、`reconciling` 算进行中，`progress` 透传。
  - `succeeded` 时，只要有一项需要的产物还是 `pending`，就继续轮询。
  - `failed`、`cancelled`、`expired` 映射为失败，带上 `error.code` 和 `error.message`。
  - `billing` 原样存进 `BillingDetailsJSON`。
- **产物**：
  - 图片、视频任务：每个 `image` 或 `video` 产物一个 `TaskAsset`。
  - 3D 任务：所有 `model3d` 和 `video` 产物归同一个结果，`cover` 作缩略图，回传的参考图 `image` 忽略。
  - 签名链接下载时不带鉴权，非网关域名的地址绝不附带密钥。
- **参考素材**：
  - 本地文件上传到 `POST /media/v1/files`（multipart，`purpose=reference`）拿 `file_id`，按“路径 + 大小 + 修改时间”缓存到 `expires_at` 前一小时，做法参照 `platformFiles`。
  - 带平台素材 ID 的上传卡，在该角色 `supports_asset` 时发 `asset_id`，否则发 `file_id`。
- **错误**：媒体协议的错误形状是 `{"error": {code, message, stage, retryable}}`，把 `message` 和 `code` 显示给用户。429 按 `Retry-After` 退避。
- **超时**：视频和 3D 用较长的轮询超时（参照现有的视频 48 小时），图片用默认值。

**Blocked by:** 01

- [x] 图片、视频、3D 都能提交、轮询并下载产物，httptest 假网关覆盖每种任务类型
- [x] 幂等键等于本地任务 ID；同一任务重启后重新提交，带的是同一个键
- [x] `reconciling`、产物 `pending` 时不判失败
- [x] `n>1` 的图片任务产出多个资产
- [x] 3D 任务的多个格式文件和 cover 都下载到工程内
- [x] 同一个本地文件第二次运行不再上传；过期后重新上传
- [x] 支持素材的角色发 `asset_id`，不支持的角色发 `file_id`
- [x] 错误信息原样显示，例如 `unsupported_parameter: ...`

## Comments

- 2026-10-14 实现记录：
  - `internal/adapter/heighliner.go`，`NewProviderAdapter` 注册 heighliner。任务类型新增 `3d_generation`（轮询器按非图片走长超时；图片给 15 分钟）。
  - **与卡片编译器（工单 04）的约定**：`params = {parameters: {...描述声明的顶层字段，prompt 除外}, provider_options: {<命名空间>: {...}}}`，`reference_assets[]` 的 `role` 直接用网关角色，新增 `ReferenceItem.type`（image/video/audio，缺省时按旧角色或扩展名推断）。素材库/文件的选择由编译器按角色的 `supports_asset` 决定：发 `url: asset://<id>` 即 `asset_id`；本地文件上传换 `file_id`；http(s) 直接作 `url`；data URI 以 JSON base64 上传。
  - 适配器只加 `model`、非空 `prompt`、`references`、`wait: 0`；参数里的 null 丢弃。
  - 提交遇 429 / `idempotency_in_progress` 按 `Retry-After`（上限 1 分钟）用同一键重放，最多 4 次；遇 `file_expired`/`file_not_found` 清掉缓存重新上传后再交一次。
  - 轮询遇 429 记下“不早于”时间，期间不发请求；404/401/403 直接判失败。错误显示为 `code: message`。
  - 3D 产物落在 `models/<task>/model_NN.<ext>`、`cover_NN.<ext>`、`preview_NN.mp4`，`TaskAsset.Kind` 为 model3d/cover/video，`Name` 是格式。签名路径按根地址补全；所有下载都不带密钥。扩展名依次取 `format`、`filename`、`mime_type`、URL，无法识别时为 `bin`。
  - `CreateTaskPayload.Prompt` 不再必填，非 Heighliner 服务商空提示词仍返回 400。
  - 测试：`internal/adapter/heighliner_test.go`（假网关覆盖三种任务、幂等键、上传缓存/过期、asset_id、错误、退避、pending/reconciling、计费），`internal/server/heighliner_test.go` 的 3D 端到端。

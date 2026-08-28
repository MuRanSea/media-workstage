# ADR 0002: 任务队列、SQLite 持久化与计费风控架构

## 上下文 (Context)
在本地媒体工作台中，生图（Seedream 5.0）与生视频（Seedance 2.5 / MiniMax H3）具有以下关键特征：
1. **多产物多资产输出**：
   - Seedream 5.0 Pro 的图层拆分（`layer_decomposition`）会产出 1 张底图 + 最多 16 个透明通道 PNG 图层（附带 `z_index`、`bounding_box`、名称与描述）。
   - Seedream 5.0 Lite 的连续组图（`sequential_image_generation`）会产出最多 15 张连贯分镜图。
   - 单视频生成可能同时产出成片 MP4 与首尾帧快照图片。
2. **云端计费与 IPM 限流机制**：
   - 火山方舟具有严格的 **IPM（Images Per Minute）限流**，图层拆分任务会在提交时**预扣 17 IPM**，实际生成后按实际产出图层数多退少补。
   - 视频自适应时长（`duration: -1`）在生成完成前时长未知，计费以实际生成的总帧数 (`frames`) / 24fps 及 `usage.completion_tokens` 为准。
3. **临时链接过期与下载容灾**：
   - 方舟 TOS 预签名 URL 有效期 ~24 小时，MiniMax `content.url` 有效期 ~9 小时。必须在就绪后由后台立即流式落盘，并支持单资产维度的重试与断点续传。

## 决策 (Decision)

### 1. 数据库持久化模型（双表设计）
在 SQLite 中采用主子表设计：

- **主表 `media_tasks`（任务生命周期与计费主记录）**：
  - `id`: UUID (TEXT, PK)
  - `provider`: `"ark"` | `"minimax"`
  - `provider_task_id`: 云端返回的 TaskID
  - `model`: 模型名称（如 `doubao-seedance-2-5-260628`, `doubao-seedream-5-0-pro-260628`）
  - `task_type`: `"video_generation"` | `"image_generation"`
  - `task_mode`: `"all_modal"` | `"first_last_frame"` | `"text_to_video"` | `"single"` | `"layer_decomp"` | `"sequential"`
  - `prompt`: 提示词文本
  - `params_json`: 完整请求参数（分辨率、比例、时长、音频开关、Size档位、Seed等）
  - `status`: `"queued"` $\rightarrow$ `"running"` $\rightarrow$ `"succeeded"` / `"failed"` / `"cancelled"` / `"expired"`
  - `progress`: 整数进度（0~100）
  - `error_code`, `error_message`: 异步报错详情（如 `InvalidParameter.TaskTypeConstraint`）
  - `usage_tokens`: 实际消耗 Token 总量（`completion_tokens`）
  - `billing_details_json`: 计费明细（包含预扣点数、实际扣费额度、实际生成帧数 `frames` 等）
  - `created_at`, `updated_at`, `completed_at`

- **子表 `task_assets`（多产物细粒度资产表）**：
  - `id`: UUID (TEXT, PK)
  - `task_id`: 关联 `media_tasks.id` (外键，建立索引)
  - `asset_index`: 资产序号（0..N）
  - `kind`: 资产类型（`"video"` | `"image_base"` | `"image_layer"` | `"image_frame"`）
  - `name`, `description`: 图层名称与描述（图层拆分专属）
  - `z_index`: 图层层级顺序
  - `bounding_box_json`: 坐标边界框 `[x, y, width, height]`（图层拆分专属）
  - `remote_url`: 云端临时下载 URL
  - `local_path`: 本地落盘相对路径（如 `./assets/images/task1_layer2.png`）
  - `file_size_bytes`: 文件大小
  - `downloaded_at`: 本地下载完成时间戳

### 2. Goroutine 任务调度器与 IPM 节流保护 (Task Poller)
- **并发与频控**：后台 Worker 限制单 Provider 并发请求数，内置基于令牌桶算法的本地限流器，防止批量触发云端 IPM/RPM 阈值。
- **智能退避轮询**：
  - 生图任务：提交后延迟 2s 轮询，间隔 2s，超时 60s。
  - 视频任务：提交后延迟 5s 轮询，间隔 6s~8s，超时 600s。
- **进程自愈恢复**：Go 服务启动时，自动加载所有状态为 `queued` / `running` 的未完结任务并拉起 Goroutine 继续追踪。

### 3. SSE 单向流通信协议
- 前端通过原生 `EventSource` 订阅 `GET /api/tasks/events`。
- 服务端以标准 `text/event-stream` 推送：
  - `task.created`、`task.progress`、`task.succeeded`（附带本地静态文件 URL 与子图层列表）、`task.failed`（附带错误码）。

### 4. 资产就绪即刻落盘管道
- 任务一旦进入 `succeeded`，后台 Worker 立即并发拉取所有子资产写入本地 `./assets/`，更新 `task_assets.downloaded_at` 与本地路径后，才向前端广播完成。

## 结果与影响 (Consequences)
- **正面影响**：
  - 精确支撑复杂多产物场景（图层拆分 16 层可直接在前端被拆解为独立的画布卡片）。
  - 计费透明化：完整沉淀 Token 与帧数消耗，方便用户对账与成本预估。
  - 资产永久化：本地落盘避免临时 URL 过期。
- **权衡与妥协**：
  - 引入了双表结构与下载管道，相比单表单文件略微增加了本地存储逻辑复杂度，但换来了高度健壮的数据模型。

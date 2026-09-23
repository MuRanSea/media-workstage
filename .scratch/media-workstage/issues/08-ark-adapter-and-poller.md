# 08: 火山方舟适配器、异步轮询器与 IPM 控频

**What to build:**
构建火山方舟（Volcengine Ark）原生 API 适配器与后台 Goroutine 任务调度器，对接 Seedance 2.5/2.0 视频生成任务与 Seedream 5.0 Pro/Lite 图片生成任务，实现小素材 Base64 自动编码、3种互斥生成模式参数校验、后台智能退避轮询、Seedream 5.0 Pro 图层拆分 17 IPM 预扣与回退风控，并在任务完成后自动将远端视频/图片流式下载至本地 `./assets/` 目录。

**Blocked by:** 07-backend-foundation

**Status:** resolved

- [x] 实现 `ArkAdapter`（实现 `ProviderAdapter` 接口），对接方舟原生视频生成（`POST /api/v3/contents/generations/tasks`）、状态轮询（`GET /api/v3/contents/generations/tasks/{id}`）与生图（`POST /api/v3/images/generations`）API
- [x] 严格校验 Seedance 3 种互斥场景（全模态参考 `0~30` 张、首尾帧严格 `1~2` 张强制 `adaptive` 比例、纯文生视频）
- [x] 严格校验 Seedream 5.0 Pro（1K/1.5K/2K 档位 vs 显式像素 `[92万, 462万]`）与 5.0 Lite（2K/3K/4K 档位 vs 显式像素 `[368万, 1677万]`）互斥尺寸规范
- [x] 实现基于 Goroutine 的 `TaskPoller` 任务轮询池，支持生图（2s 间隔）与视频（6~8s 间隔，超时 600s）智能退避
- [x] 实装本地令牌桶限流器，内置 Seedream 5.0 Pro 图层拆分每次提交预扣 17 IPM 的风控保护与按实回退
- [x] 实现任务进入 `succeeded` 后的即刻流式下载落盘管道（包含图层拆分多图层解包写入 `task_assets`），更新 `output_duration_sec` 与计费明细
- [x] 编写并通过 ArkAdapter Payload 序列化与 Mock Poller 任务状态机的单元测试

## Answer

Ticket 08 已通过 TDD 闭环实现并通过全量测试（`go test -v -count=1 ./...` 全部通过，`CGO_ENABLED=0` 静态编译通过）：

### 核心实现：
1. **火山方舟适配器 (`internal/adapter/ark.go`)**：
   - 对接方舟视频生成任务创建（`POST /api/v3/contents/generations/tasks`）、视频状态轮询（`GET /api/v3/contents/generations/tasks/{id}`）与图片生成（`POST /api/v3/images/generations`）。
   - 支持本地小文件（图片/音频/视频）自动 Base64 编码为 `data:<mime>;base64,...`。
   - 严格校验 Seedance 3 种互斥模式（`text_to_video`、`first_last_frame` 强制 `adaptive` 比例、`all_modal` 支持 0~30 图片/0~10 视频/0~10 音频）。
   - 严格校验 Seedream 5.0 Pro（1K/1.5K/2K/auto 预设档位 vs `[921600, 4624220]` 显式像素）与 5.0 Lite（2K/3K/4K 预设档位 vs `[3686400, 16777216]` 显式像素）互斥尺寸规范，以及图层拆分（Pro 独占）与连环组图（Lite 独占）特性排他性。
   - 真实对接 Seedream 5.0 Pro 图层拆分扁平 `data[]` 结构（`z_index=0` 底图 + `z_index>=1` 透明图层，解析 `bounding_box`），并在 `task.BillingDetailsJSON` 中持久化 `PollResult` 保证进程重启自愈不丢资产。
2. **IPM 令牌桶限流器 (`internal/poller/limiter.go`)**：
   - 实现线程安全的令牌桶限流器，内置普通生图 1 IPM 扣减、Seedream 5.0 Pro 图层拆分 17 IPM 预扣，以及任务完成后的按实回退（`17 - (1 + actual_layers)`）与失败全额回退（17 IPM）。
3. **Goroutine 任务轮询调度池 (`internal/poller/poller.go`, `internal/poller/broadcaster.go`)**：
   - 并发 Worker 调度池，支持生图任务（2s 间隔，60s 超时）与视频任务（6s 间隔，600s 超时）智能退避。
   - 启动时扫描 SQLite 中未完结任务（`status IN ('queued', 'running')`）自愈恢复。
   - 任务进入 `succeeded` 状态后，即刻拉起流式下载落盘至 `./assets/`（写入 `task_assets` 子表并记录 `z_index`、`bounding_box_json`、文件大小与下载时间），精确回填 `output_duration_sec`、`usage_tokens` 与计费明细。
   - 通过 SSE 单向流（`EventBroadcaster`）向前端实时推送 `task.created`、`task.progress`、`task.succeeded` 与 `task.failed` 事件。
4. **服务端集成与测试 (`internal/server/server.go`, `cmd/server/main.go`)**：
   - 将 `TaskPoller` 和 `ArkAdapter` 注册到 Gin HTTP 服务，提供端到端自动化测试覆盖。

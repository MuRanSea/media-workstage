# 07: Go 后端底座、SQLite 双表、ProviderAdapter 契约与静态流媒体服务

**What to build:**
建立本地后端服务的核心框架，提供基础运行配置、数据库持久化模型自动迁移（`media_tasks` 与 `task_assets`）、核心 `ProviderAdapter` 接口定义与 Fake Adapter 测试桩、统一任务 API / SSE 推流路由骨架、以及支持 RFC 7233 Range 请求的静态资源服务，为后续并行开发方舟适配器、MiniMax 适配器与前端画布提供坚实地基。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] 初始化 Go 1.26+ 模块与 Gin Web 框架工程结构
- [x] 采用 `github.com/glebarez/sqlite` 纯 Go 驱动配置 SQLite 数据库连接（测试使用 `t.TempDir()` 独立 SQLite 实例，启用 WAL 模式）
- [x] 定义并自动迁移 `media_tasks`（主任务表）与 `task_assets`（子资产表，支持图层拆分/连环组图多产物）模型
- [x] 定义通用的 `ProviderAdapter` 接口契约，并实现一个内存级 `FakeProviderAdapter`（作为系统核心单一测试 Seam）
- [x] 搭建 `POST /api/tasks` 统一任务提交路由骨架与 `GET /api/tasks/events` SSE 单向推流骨架
- [x] 实现 `GET /assets/*filepath` 静态资源托管接口，包含防路径遍历安全校验、RFC 7233 Range 请求（`Accept-Ranges: bytes`, 206 Partial Content）与强缓存头
- [x] 编写并通过核心路由、Fake Adapter 调度与 Range 流媒体切片下载的自动化测试

## Answer

Ticket 07 已通过 TDD 闭环实现并通过全量测试（`go test -v ./...` 全部通过，`CGO_ENABLED=0` 静态编译通过）：

### 核心实现：
1. **纯 Go SQLite 双表模型 (`internal/model/task.go`, `internal/db/db.go`)**：
   - `media_tasks`：支持记录任务类型、模式、Prompt、参数 JSON、Token 消耗（`usage_tokens`）、实际生成时长（`output_duration_sec`）与计费明细。
   - `task_assets`：支持图层拆分（`z_index`、`bounding_box_json`、`name`、`description`）与连环组图等多产物子资产。
2. **`ProviderAdapter` 接口与 Fake Adapter 测试桩 (`internal/adapter/`)**：
   - 定义了 `SubmitTask`、`PollTask` 与 `DownloadAsset` 抽象，并实现内存可控的 `FakeProviderAdapter` 作为系统顶级测试 Seam。
3. **静态流媒体服务 (`internal/server/asset_server.go`)**：
   - 挂载 `GET /assets/*filepath`，严格防范路径穿越，支持 RFC 7233 `206 Partial Content` 分片传输与 `immutable` 强缓存。
4. **Gin HTTP / SSE 路由骨架与入口 (`internal/server/server.go`, `cmd/server/main.go`)**：
   - 挂载 `/health`、`/api/config`、`POST /api/tasks`、`GET /api/tasks`、`GET /api/tasks/:id` 与 `GET /api/tasks/events`。

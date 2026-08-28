# 05-local-task-queue-and-persistence

Type: grilling
Status: resolved
Blocked by: none

## Question

设计本地任务调度器与 SQLite 数据库持久化方案：包括 Task 表结构（ID, Provider, Model, Type, Prompt, Status, ResultURL, LocalPath, Error, Timestamps）、后台异步 Poller 轮询机制、以及前后端状态实时同步（WebSocket vs Server-Sent Events SSE）。

## Answer

决议采纳 **`media_tasks` + `task_assets` 双表架构 + Goroutine 令牌桶节流轮询器 + SSE 单向实时事件推流** 方案。

### 核心结论（详见 [docs/adr/0002-task-queue-and-sqlite-persistence.md](../../docs/adr/0002-task-queue-and-sqlite-persistence.md)）：
1. **持久化模型（主子表设计）**：
   - 主表 `media_tasks`：记录全局任务生命周期、复现参数、消耗 Token（`usage_tokens`）与计费明细（`billing_details_json`，含预扣与实际消耗记录）。
   - 子表 `task_assets`：精确承接多产物输出（如 Seedream 5.0 Pro 的 1 底图 + 最多 16 个带 `bounding_box` 的透明图层，以及 5.0 Lite 的最多 15 张连环组图），支持细粒度本地落盘与单资产下载重试。
2. **异步 Poller 调度与计费/限流风控**：
   - 采用 Goroutine 协程池 + 指数退避智能轮询（生图 2s，视频 6~8s，超时 600s）。
   - 内置令牌桶频控，防止批量任务触发火山方舟账号级 **IPM 限流（图层拆分单次预扣 17 IPM）**。
   - 服务启动自愈：自动加载并续拉 `queued`/`running` 状态的云端未完结任务。
3. **SSE 前后端实时通信**：
   - 采用标准 `GET /api/tasks/events`（Server-Sent Events）推流，原生支持浏览器断线自动重连。
4. **资产即刻流式落盘**：
   - 任务进入 `succeeded` 时后台立即并发拉取远端临时 URL 下载至本地 `./assets/`，彻底消除 9~24h 云端链接过期隐患。

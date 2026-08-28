# ADR 0001: Go 后端与嵌入式单二进制 SPA 架构

## 上下文 (Context)
媒体工作台（media-workstage）定位为个人/本地运行的桌面级多模态媒体创作工具，需要：
1. 本地启动 HTTP/WebSocket 服务，承载 REST API 与静态前端资源。
2. 调度火山方舟（Seedance 2.5/2.0、Seedream 5.0）与 MiniMax（Hailuo H3 / Video-01）的异步生成任务。
3. 纯本地 SQLite 数据库持久化与本地素材文件管理。
4. 极简的单机部署与一键启动体验（无需用户预装复杂的 Python/Node 运行环境）。

## 决策 (Decision)
我们决定采用 **Go 1.26+** 作为本地后端服务技术栈，并采用 **前后端嵌入式单二进制（Embedded SPA）** 架构：

1. **Web 框架**：采用 **Gin**（轻量、高性能、路由与中间件生态成熟）。
2. **数据库与驱动**：采用 **GORM + `modernc.org/sqlite`（纯 Go 驱动）**。
   - 彻底避免 CGO 编译依赖，支持跨平台原生静态交叉编译。
   - GORM 提供透明的结构体模型迁移（AutoMigrate）与 CRUD 操作。
3. **交付形态**：
   - 开发期：Vite Dev Server (Port 5173) 前端热更新，反向代理至 Go 后端 (Port 8080)。
   - 生产期：通过 Go 1.16+ `//go:embed dist/*` 将前端静态网页直接打包进单个可执行文件，双击单文件即可运行完整工作台。
4. **并发与调度**：
   - 利用 Go 原生 **Goroutines + Channels** 构建轻量级后台轮询器（Task Poller Pool），高效管理长时间的云端生成任务状态同步。

## 结果与影响 (Consequences)
- **正面影响**：
  - 极佳的用户分发体验：零外部依赖，单 `.exe` 文件即插即用。
  - 极低资源占用：常驻内存仅 ~20MB，启动毫秒级。
  - 健壮的并发模型：原生协程处理批量轮询无阻塞。
- **权衡与妥协**：
  - 前端构建与 Go 构建之间需要统一的自动化构建脚本（如 Makefile / PowerShell 脚本）。

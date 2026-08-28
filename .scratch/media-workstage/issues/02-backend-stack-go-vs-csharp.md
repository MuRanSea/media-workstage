# 02-backend-stack-go-vs-csharp

Type: grilling
Status: resolved
Blocked by: none

## Question

在 Go（Gin/Chi + SQLite + volcengine-go-sdk）与 C#（.NET 8/9 Minimal API + SQLite + HttpClient）之间进行权衡，从本地单二进制打包分发、跨平台运行、异步后台任务轮询（Goroutines vs Async Task Worker）、以及与方舟/MiniMax API 交互便利度出发，确定本地后端服务技术栈。

## Answer

决议采纳 **Go 1.26+ (Gin + GORM + `modernc.org/sqlite` + `//go:embed`)** 作为本地工作台后端技术栈。

核心结论（详见 [docs/adr/0001-go-backend-with-embedded-spa.md](../../docs/adr/0001-go-backend-with-embedded-spa.md)）：
1. **单二进制交付**：生产期通过 Go `embed.FS` 将 Vite React 前端完全打包至单个可执行文件，实现零外部运行时依赖、双击即用的极简桌面分发。
2. **纯 Go 免 CGO 数据库**：采用 `modernc.org/sqlite` 驱动搭配 GORM，保障跨平台静态编译与自动化表结构迁移。
3. **原生 SDK 与 Goroutine 调度**：火山方舟官方 Go SDK (`arkruntime`) 原生支持 `CreateContentGenerationTask` 视频任务流；配合轻量 Goroutine Worker Pool 高效管理后台多任务轮询。

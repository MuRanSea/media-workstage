# 13: 前后端单二进制打包内嵌与端到端冒烟验证

**What to build:**
实现前后端统一构建脚本，利用 Go 1.16+ `//go:embed dist/*` 将前端 Vite 生产产物内嵌至单个 Go 可执行文件中（`media-workstage.exe`），实现跨平台零外部运行时依赖的极简桌面运行体验，并在启动时自动打开默认浏览器，完成端到端生图、多图引用生视频的完整冒烟测试。

**Blocked by:** 11-image-card-node, 12-video-card-and-references

**Status:** resolved

- [x] 配置 Go `embed.FS` 嵌入前端 `dist/` 静态网页资源，并在 Gin 中挂载 SPA Fallback 路由
- [x] 编写一键自动化构建脚本（支持 Windows PowerShell `build.ps1` 与跨平台 `Makefile`：先构建前端，再执行 `CGO_ENABLED=0 go build` 静态打包）
- [x] 实现服务启动时自动检测并在系统默认浏览器中弹出应用界面（支持 `--no-browser` / `NO_BROWSER=1` 禁用开关）
- [x] 执行全流程端到端冒烟测试：启动单个可执行文件 $\rightarrow$ 创建 Seedream 5.0 生图卡片 $\rightarrow$ 引入生成图至 Seedance 2.5 视频卡片并 `@图1` 指代 $\rightarrow$ 提交任务并观察 SSE 进度 $\rightarrow$ 验证本地 `./assets/` 文件落盘与内嵌循环播放
- [x] 验证生产构建产物无任何 CGO 依赖且体积轻量（~26 MB 单可执行文件）

## Answer

Ticket 13 已通过 TDD 闭环实现并通过全量前端单元测试（28/28 通过）、后端单元测试与集成测试、跨平台静态单二进制构建（`CGO_ENABLED=0`）以及真实 Chromium 浏览器端到端全流程冒烟验证：

### 核心实现：
1. **嵌入式单二进制 SPA 架构 (`cmd/server/main.go`, `internal/server/server.go`, `web/vite.config.ts`)**：
   - Vite 配置 `assetsDir: 'static'`，将编译后的 SPA 资源打包输出至 `cmd/server/dist/`，完全与动态媒体资源 `/assets/*filepath` 解耦，消除了路由命名空间冲突。
   - 使用 Go 1.16+ `//go:embed all:dist` 将前端网页嵌入 Go 二进制，并通过 `fs.Sub` 挂载为 `http.FS`。
   - 在 Gin 路由中实装 SPA Fallback 机制（`r.NoRoute(...)`）：精准拦截并服务 `/static/*` 静态脚本与样式，客户端单页路由（如 `/canvas`）透明回退至 `index.html`，同时严格保障 `/api/*` 返回 404 JSON 而不发生错误兜底。
   - 编写并通过 `TestServer_EmbeddedSPARoutes` 集成测试。
2. **跨平台一键自动化构建脚本 (`build.ps1`, `Makefile`)**：
   - `build.ps1`：PowerShell 自动化流水线，先执行前端 Vite 构建，再开启 `CGO_ENABLED=0` 执行 Go 静态编译，最终输出 ~26 MB 极简单文件 `media-workstage.exe`。
   - `Makefile`：提供 `build-web`, `build-server`, `build`, `test`, `clean` 跨平台构建目标。
3. **系统默认浏览器自启动 (`cmd/server/main.go`)**：
   - 跨平台自启动：Windows (`rundll32 url.dll,FileProtocolHandler`)、macOS (`open`)、Linux (`xdg-open`)。
   - 支持 `--no-browser` 命令行参数与 `NO_BROWSER=1` 环境变量，方便在 CI 或无头服务器中静默启动。
4. **单二进制全流程端到端冒烟验证**：
   - 启动独立编译产物 `./media-workstage.exe --port=8099 --no-browser`。
   - 使用真实 Chromium 浏览器加载 `http://localhost:8099/`，验证单二进制直接托管嵌入式 SPA。
   - 端到端全流程实测：生成 Seedream 5.0 原画卡片 $\rightarrow$ 引入图片至 Seedance 2.5 视频卡片 $\rightarrow$ 提交视频任务并通过 SSE 接收渲染进度 $\rightarrow$ 远端 MP4 流式落盘本地 `./assets/videos/` $\rightarrow$ 在卡片内成功循环平滑播放（断言 `video.readyState === 4`, `video.duration = 1s`）。

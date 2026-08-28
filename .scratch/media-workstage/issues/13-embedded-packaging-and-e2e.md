# 13: 前后端单二进制打包内嵌与端到端冒烟验证

**What to build:**
实现前后端统一构建脚本，利用 Go 1.16+ `//go:embed dist/*` 将前端 Vite 生产产物内嵌至单个 Go 可执行文件中（`media-workstage.exe`），实现跨平台零外部运行时依赖的极简桌面运行体验，并在启动时自动打开默认浏览器，完成端到端生图、多图引用生视频的完整冒烟测试。

**Blocked by:** 11-image-card-node, 12-video-card-and-references

**Status:** ready-for-agent

- [ ] 配置 Go `embed.FS` 嵌入前端 `dist/` 静态网页资源，并在 Gin 中挂载 SPA Fallback 路由
- [ ] 编写一键自动化构建脚本（支持 Windows PowerShell 与 Makefile：先构建前端 `npm run build`，再执行 `CGO_ENABLED=0 go build` 静态打包）
- [ ] 实现服务启动时自动检测并在系统默认浏览器中弹出 `http://localhost:8080`
- [ ] 执行全流程端到端冒烟测试：启动单个可执行文件 $\rightarrow$ 创建 Seedream 5.0 生图卡片 $\rightarrow$ 引入生成图至 Seedance 2.5 视频卡片并 `@图1` 指代 $\rightarrow$ 提交任务并观察 SSE 进度 $\rightarrow$ 验证本地 `./assets/` 文件落盘与播放
- [ ] 验证生产构建产物无任何 CGO 依赖且体积轻量

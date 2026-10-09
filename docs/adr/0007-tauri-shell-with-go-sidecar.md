# ADR 0007: Tauri 桌面壳 + Go sidecar

## 上下文 (Context)
ADR 0001 的交付形态是单个 Go exe：内嵌 SPA，启动后调起系统浏览器。工作台因此只能作为一个浏览器标签页使用，没有独立窗口，也拿不到原生能力。我们想把它做成桌面应用，同时不动已经稳定的 Go 后端（各服务商适配器、任务轮询器、SQLite、工程文件夹，合计约 2 万行）。

## 决策 (Decision)
- 桌面壳采用 **Tauri**。Go 后端原样保留，作为 Tauri 的 **sidecar 子进程**运行。Rust 一侧只负责拉起 Go 进程、等待它就绪、打开窗口、在退出时结束子进程，不承载任何业务逻辑。
- 现有的 Go 单文件启动方式继续保留（浏览器模式、`--no-browser`、开发期 Vite 代理）。Tauri 只是多加了一种启动方式。
- 目标平台目前只有 Windows（WebView2）。暂不接入 updater，也不做代码签名。
- **窗口加载 Go 提供的页面**：窗口直接打开 `http://127.0.0.1:<port>`，Tauri 不打包前端。Go 用 `--port 0` 监听随机端口，并在 stdout 打印实际端口，Rust 读到后再开窗口。
- **生命周期**：关闭窗口即退出应用。Go 子进程通过 Windows Job Object 和壳进程绑定，壳进程崩溃时 Go 也随之结束。只允许运行一个实例。
- **目录可配置**：数据目录默认是 `%LOCALAPPDATA%\media-workstage\`，工程目录默认是 `文档\Media Workstage\projects\`，二者都可以在设置里修改。这两项设置存放在位置固定的 `%LOCALAPPDATA%\media-workstage\settings.json` 中，不放进 SQLite，因为数据库本身的位置就是设置的一部分。设置由 Go 写入，前端保存后调用 Tauri 重启应用来生效。修改目录只改变指向，不搬运已有文件。Go 启动失败时（例如目录所在的盘已经拔掉，或者没有写权限），由 Rust 弹出原生对话框，提供"恢复默认目录后重试"和"退出"两个选项，避免用户被一个打不开的设置困住。

## 考虑过的方案 (Considered Options)
- **Electron**：自带 Chromium，生态最成熟。但 Windows 上的 WebView2 本来就是 Chromium，内核一致这个卖点在这里不成立；剩下的是约 100MB 的安装包和数百 MB 的内存，违背 ADR 0001 追求轻量的初衷。
- **Wails**：壳层也用 Go，不用引入第三种语言，是最贴合现有技术栈的方案。最终没有选它，原因是 Tauri 的生态（插件、打包、以后的 updater）更成熟，我们愿意为此多维护一小段 Rust。
- **用 Rust 重写后端、去掉 sidecar**：投入太大，用户感知不到收益。

## 结果与影响 (Consequences)
- 构建链路新增 Rust 工具链和 Tauri CLI。Go 二进制需要按 Tauri 的 sidecar 命名规则（`-x86_64-pc-windows-msvc` 后缀）产出。
- 前端和 Go 之间仍然是 localhost HTTP 通信，没有改成 Tauri IPC。这样前端代码在两种启动方式下保持同一份。

# 开发与构建

后端是一个 Go 单文件程序，前端 React 页面直接内嵌在里面。启动方式有两种：作为桌面应用打开独立窗口（Tauri 壳拉起 Go 子进程），或者运行 exe 后在浏览器里使用（见 [ADR 0001](adr/0001-go-backend-with-embedded-spa.md)、[ADR 0007](adr/0007-tauri-shell-with-go-sidecar.md)）。

## 环境准备

- Go 1.26+
- [Bun](https://bun.sh)（也可以用 npm）
- 只在构建桌面安装包时需要：Rust 工具链（`winget install Rustlang.Rustup`）

先安装前端依赖：

```powershell
cd web; bun install
```

Go 程序通过 `//go:embed` 内嵌 `cmd/server/dist`，这个目录不在版本库里，所以第一次编译后端之前要先构建一次前端：

```powershell
cd web; bun run build
```

## 本地开发

开两个终端，一个跑后端，一个跑带热更新的前端：

```powershell
go run ./cmd/server -no-browser
```

```powershell
cd web; bun run dev
```

然后打开 <http://localhost:5173>。Vite 会把 `/api` 和 `/assets` 代理到 `http://localhost:8080`，如果后端换了端口，可以用 `BACKEND_URL` 环境变量指定新地址。

## 测试

```powershell
go test ./...
```

```powershell
cd web; bun run test
```

## 构建

```powershell
.\build.ps1
```

先构建前端，再把它内嵌进 Go 程序，最终在仓库根目录生成单个 `media-workstage.exe`（`CGO_ENABLED=0`）。

```powershell
.\build.ps1 -Desktop
```

在上一步的基础上，把同一个 exe 作为 sidecar 交给 Tauri，生成桌面安装包，输出到 `src-tauri/target/release/bundle/nsis/`。

在 macOS 或 Linux 上，也可以用 `make build` 构建浏览器模式的二进制，用 `make test` 运行全部测试。

## 发布

1. 在 `src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`（及 `Cargo.lock`）、`web/package.json` 中同步修改版本号，合并到 `master`。
2. 运行 `.\build.ps1 -Desktop` 生成安装包。
3. 用 `gh release create vX.Y.Z <安装包>` 在合并提交上打标签并上传安装包，附上中文更新说明。

## 浏览器模式

构建后直接运行：

```powershell
.\media-workstage.exe
```

程序默认监听 `127.0.0.1:8080`，并自动打开浏览器。数据存放在当前目录下：

| 内容 | 默认位置 |
| --- | --- |
| 数据库（服务商、任务、设置） | `./data/media_workstage.db` |
| 不属于任何工程的任务产物 | `./assets/` |
| 工程 | `./projects/` |

### 命令行参数

| 参数 | 环境变量 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `-port` | `PORT` | `8080` | 监听端口，`0` 表示随机端口 |
| `-host` | `HOST` | `127.0.0.1` | 监听地址 |
| `-db` | `DB_PATH` | `./data/media_workstage.db` | SQLite 数据库路径 |
| `-assets` | `ASSET_DIR` | `./assets` | 不属于任何工程的任务产物目录 |
| `-projects` | `PROJECTS_DIR` | `./projects` | 工程目录 |
| `-no-browser` | `NO_BROWSER=1` | 关 | 启动时不自动打开浏览器 |
| `-data-dir` | | | 桌面模式使用：数据目录，其下放 `data/`、`assets/`、`logs/` |
| `-settings` | | | 桌面模式使用：桌面壳的 `settings.json`，指定后启用目录设置接口 |

用 `-host 0.0.0.0` 在局域网里访问时，请用 IP 地址打开页面。为了防止 DNS 重绑定攻击，修改设置、发起生成和写入工程这些接口只接受通过 `localhost` 或 IP 地址发来的请求。

### 用环境变量提供凭据

服务商凭据也可以通过环境变量提供，数据库里已保存的值优先。全部变量列在 [.env.example](../.env.example) 里。程序不会自动读取 `.env` 文件，需要在启动前把变量设置到环境中。

火山方舟和 MiniMax 在没有配置 Key 时使用模拟适配器运行，方便在不调用真实接口的情况下体验流程。

## 目录结构

```
cmd/server/      Go 程序入口，内嵌前端构建产物
internal/
  adapter/       各接入协议的服务商适配器（方舟、MiniMax、可灵、MJ、Gemini、OpenAI、APIMart）
  poller/        后台任务轮询与限流
  server/        HTTP 路由、服务商配置、上传、工程接口
  project/       工程文件夹读写
  db/ model/     SQLite 与数据模型
  desktop/       桌面模式的设置与重启
web/src/
  components/    画布、卡片、检查器、设置等界面
  engine/        画布变换、连线、参数编译、旧工程迁移等纯逻辑
src-tauri/       Tauri 桌面壳（只负责拉起 Go 子进程和打开窗口）
docs/adr/        架构决策记录
docs/research/   服务商接口调研
CONTEXT.md       领域术语表
```

## 文档

- [CONTEXT.md](../CONTEXT.md)：领域术语（工程、生成卡、结果卡、服务商、接入协议等），代码和讨论中都使用这里的用词。
- [docs/adr/](adr/)：架构决策记录，包括任务队列（[0002](adr/0002-task-queue-and-sqlite-persistence.md)）、工程文件夹（[0003](adr/0003-project-folders-persistence.md)）、服务商协议（[0004](adr/0004-providers-as-protocol-instances.md)）、生成卡与结果卡（[0005](adr/0005-generation-and-result-cards.md)）、结果动作（[0006](adr/0006-result-actions-yield-result-cards.md)）。
- [docs/research/](research/)：火山方舟、MiniMax 接口契约与素材存储方案调研。
- `.scratch/`：需求规格与工单，约定见 [docs/agents/issue-tracker.md](agents/issue-tracker.md)。

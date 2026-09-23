## Destination

构建并交付《本地空间无限画布媒体工作台 v1 规范与架构原型》：单用户本地 Web 工作台，具备空间无限画布拖拽/定点缩放、节点卡片流转、多模型（火山方舟 Seedance 2.5/2.0、Seedream 5.0、MiniMax Hailuo）异步生成任务调度、以及本地资产管理与极简启动服务。

## Notes

- **前端画布引擎**：自研空间无限画布引擎（Spatial Canvas），基于原子状态矩阵定点缩放与 SVG 多模态流光射线。
- **后端技术栈**：Go 1.26+ (Gin + GORM + `modernc.org/sqlite` + `embed.FS`)，单二进制内嵌 SPA 前端。
- **数据库与调度**：SQLite 双表 (`media_tasks` + `task_assets`)，Goroutine 令牌桶节流轮询器，SSE 实时推流。
- **架构原则**：构建清晰的 `ProviderAdapter` 隔离层，统一抽象 Ark 与 MiniMax 的任务提交与轮询协议。
- **资产传输**：本地图片/音频素材优先利用 Ark/MiniMax 原生 Base64 直传（单张<30MB, body≤64MB），大文件/超长视频走 TOS / 本地静态服务通道。
- **关联技能**：`domain-modeling`, `codebase-design`, `prototype`, `research`.

## Decisions so far

- [01-canvas-engine-selection](issues/01-canvas-engine-selection.md): 选定自研空间无限画布架构（Spatial Canvas），实现紧凑美观卡片（~380px）与 Tab 抽屉折叠、零漂移光标定点缩放、多图参考胶囊与 @Prompt 绑定。原型分支 `prototype/canvas-engine`。
- [02-backend-stack-go-vs-csharp](issues/02-backend-stack-go-vs-csharp.md): 确定 Go 后端技术栈，采用 Gin + GORM + 纯 Go SQLite + `embed.FS` 单二进制打包分发架构。详见 [docs/adr/0001-go-backend-with-embedded-spa.md](../../docs/adr/0001-go-backend-with-embedded-spa.md)。
- [03-ark-native-api-contract](issues/03-ark-native-api-contract.md): 确定火山方舟原生 Seedance 2.5/2.0 与 Seedream 5.0 接口契约，支持小素材 Base64 Data URL 直传，统一异步轮询模型与状态机。详见 [docs/research/03-ark-native-api-contract.md](../../docs/research/03-ark-native-api-contract.md)。
- [04-minimax-video-api-contract](issues/04-minimax-video-api-contract.md): 确定 MiniMax 官方海螺视频生成接口契约，规范双重下载回退策略与 ProviderAdapter 统一抽象模型。详见 [docs/research/04-minimax-video-api-contract.md](../../docs/research/04-minimax-video-api-contract.md)。
- [05-local-task-queue-and-persistence](issues/05-local-task-queue-and-persistence.md): 确定 SQLite `media_tasks` + `task_assets` 双表多产物架构、Goroutine 令牌桶节流轮询器（支持图层拆分 17 IPM 预扣与回退风控）及 SSE 前后端单向实时推流。详见 [docs/adr/0002-task-queue-and-sqlite-persistence.md](../../docs/adr/0002-task-queue-and-sqlite-persistence.md)。
- [06-asset-storage-and-tos-fallback](issues/06-asset-storage-and-tos-fallback.md): 确定本地 `./assets/` 层级目录、Gin 静态流媒体托管（RFC 7233 Range 请求）及火山 TOS 大文件预签名直传 Fallback 机制。详见 [docs/research/06-asset-storage-and-tos-fallback.md](../../docs/research/06-asset-storage-and-tos-fallback.md)。
- [07-backend-foundation](issues/07-backend-foundation.md): 完成 Go 1.26+ 后端底座、GORM + 纯 Go SQLite 双表自动迁移、`ProviderAdapter` 抽象与 Fake Adapter 测试桩、RFC 7233 范围请求流媒体静态服务与 HTTP/SSE 路由骨架。
- [08-ark-adapter-and-poller](issues/08-ark-adapter-and-poller.md): 完成火山方舟原生 API 适配器（Seedance 2.5/2.0 视频生成与 Seedream 5.0 生图）、Seedance 3 种互斥场景与 Seedream 尺寸校验、Goroutine 任务轮询调度池、17 IPM 预扣与回退风控限流器及资产即刻落盘管道。
- [09-minimax-adapter-and-sse](issues/09-minimax-adapter-and-sse.md): 完成 MiniMax 海螺视频生成适配器（MiniMax-H3、Video-01）、双重下载流转（`content.url` 优先 + `/files/retrieve` 回退）与精准计费元数据沉淀。
- [10-spatial-canvas-core](issues/10-spatial-canvas-core.md): 搭建 React 19 + TypeScript + TailwindCSS 现代工程结构，完成空间无限画布原子变换矩阵、光标定点零漂移缩放公式、双指/滚轮非被动漫游、专业快捷键导航、拉框框选、多卡片联动拖拽与自动网格排版。
- [11-image-card-node](issues/11-image-card-node.md): 完成 Seedream 5.0 生图卡片组件与参数抽屉、单源严格尺寸编译器（档位+比例映射 vs 显式像素）、图层拆分多透明图层解包与连环组图画布一键裂变展开。
- [12-video-card-and-references](issues/12-video-card-and-references.md): 完成多模态视频生成卡片、全模态/首尾帧/纯文生 3 种互斥模式、Prompt 文本框 `@` 智能补全与快捷胶囊、多图参考池路径排他解析与 `@图N` 重新编号、SVG 渐变流光连线引擎及内嵌 MP4 循环播放器。
- [13-embedded-packaging-and-e2e](issues/13-embedded-packaging-and-e2e.md): 完成 Go `embed.FS` 单二进制打包、Gin SPA Fallback 路由（解耦 `/static` 与 `/assets` 命名空间）、跨平台自动化构建流水线（`build.ps1`, `Makefile`）、浏览器自动弹出及全流程端到端冒烟验证。
- [14-project-store-backend](issues/14-project-store-backend.md): 工程以磁盘文件夹持久化（`project.json` + `assets/`），`internal/project.Store` 原子写入与 revision 乐观并发，工程 REST API 与 `.trash` 删除。详见 [docs/adr/0003-project-folders-persistence.md](../../docs/adr/0003-project-folders-persistence.md)。
- [15-project-scoped-tasks-and-assets](issues/15-project-scoped-tasks-and-assets.md): 任务携带 `project_id`，产物下载进工程文件夹并经 `/api/projects/:id/assets` 访问，参考素材按工程解析。
- [16-project-ui-and-autosave](issues/16-project-ui-and-autosave.md): 工程列表页、顶栏工程切换与改名、防抖自动保存 + Ctrl+S + 冲突提示、打开工程时补齐任务状态。
## Not yet specified

- 视频后处理工具扩展（火山 AI MediaKit 智能剪辑、画质增强集成）

## Out of scope

- 多租户与复杂云端用户权限系统（v1 定位单机本地极简工作台）
- ComfyUI 风格的高复杂度底层 AST 算子执行引擎

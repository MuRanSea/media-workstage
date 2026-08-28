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

## Not yet specified

- 画布工程文件持久化（本地 JSON 项目保存与恢复）
- 视频后处理工具扩展（火山 AI MediaKit 智能剪辑、画质增强集成）

## Out of scope

- 多租户与复杂云端用户权限系统（v1 定位单机本地极简工作台）
- ComfyUI 风格的高复杂度底层 AST 算子执行引擎

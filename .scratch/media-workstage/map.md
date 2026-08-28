## Destination

构建并交付《本地无限画布媒体工作台 v1 规范与架构原型》：单用户本地 Web 工作台，具备无限画布拖拽/缩放、节点卡片流转、多模型（火山方舟 Seedance 2.5/2.0、Seedream 5.0、MiniMax Hailuo）异步生成任务调度、以及本地资产管理与极简启动服务。

## Notes

- **架构原则**：构建清晰的 `ProviderAdapter` 隔离层，统一抽象 Ark 与 MiniMax 的任务提交与轮询协议。
- **资产传输**：本地图片/音频素材优先利用 Ark/MiniMax 原生 Base64 直传（单张<30MB, body≤64MB），大文件/超长视频保留 TOS / 本地静态服务通道。
- **关联技能**：`domain-modeling`, `codebase-design`, `prototype`, `research`.

## Decisions so far

- [03-ark-native-api-contract](issues/03-ark-native-api-contract.md): 确定火山方舟原生 Seedance 2.5/2.0 与 Seedream 5.0 接口契约，支持小素材 Base64 Data URL 直传，统一异步轮询模型与状态机。详见 [docs/research/03-ark-native-api-contract.md](../../docs/research/03-ark-native-api-contract.md)。
- [04-minimax-video-api-contract](issues/04-minimax-video-api-contract.md): 确定 MiniMax 官方海螺视频生成接口契约，提取通用的 ProviderAdapter 抽象，统一任务生命周期。详见 [docs/research/04-minimax-video-api-contract.md](../../docs/research/04-minimax-video-api-contract.md)。

## Not yet specified

- 画布工程文件持久化（本地 JSON 项目保存与恢复）
- 任务并发限制与排队节流策略（Rate Limiting & Concurrency Control）
- 视频后处理工具扩展（火山 AI MediaKit 智能剪辑、画质增强集成）

## Out of scope

- 多租户与复杂云端用户权限系统（v1 定位单机本地极简工作台）
- ComfyUI 风格的高复杂度底层 AST 算子执行引擎

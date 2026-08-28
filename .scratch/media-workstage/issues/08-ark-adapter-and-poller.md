# 08: 火山方舟适配器、异步轮询器与 IPM 控频

**What to build:**
构建火山方舟（Volcengine Ark）原生 API 适配器与后台 Goroutine 任务调度器，对接 Seedance 2.5/2.0 视频生成任务与 Seedream 5.0 Pro/Lite 图片生成任务，实现小素材 Base64 自动编码、3种互斥生成模式参数校验、后台智能退避轮询、Seedream 5.0 Pro 图层拆分 17 IPM 预扣与回退风控，并在任务完成后自动将远端视频/图片流式下载至本地 `./assets/` 目录。

**Blocked by:** 07-backend-foundation

**Status:** ready-for-agent

- [ ] 实现 `ArkAdapter`（实现 `ProviderAdapter` 接口），对接方舟原生视频生成（`POST /api/v3/contents/generations/tasks`）、状态轮询（`GET /api/v3/contents/generations/tasks/{id}`）与生图（`POST /api/v3/images/generations`）API
- [ ] 严格校验 Seedance 3 种互斥场景（全模态参考 `0~30` 张、首尾帧严格 `1~2` 张强制 `adaptive` 比例、纯文生视频）
- [ ] 严格校验 Seedream 5.0 Pro（1K/1.5K/2K 档位 vs 显式像素 `[92万, 462万]`）与 5.0 Lite（2K/3K/4K 档位 vs 显式像素 `[368万, 1677万]`）互斥尺寸规范
- [ ] 实现基于 Goroutine 的 `TaskPoller` 任务轮询池，支持生图（2s 间隔）与视频（6~8s 间隔，超时 600s）智能退避
- [ ] 实装本地令牌桶限流器，内置 Seedream 5.0 Pro 图层拆分每次提交预扣 17 IPM 的风控保护与按实回退
- [ ] 实现任务进入 `succeeded` 后的即刻流式下载落盘管道（包含图层拆分多图层解包写入 `task_assets`），更新 `output_duration_sec` 与计费明细
- [ ] 编写并通过 ArkAdapter Payload 序列化与 Mock Poller 任务状态机的单元测试

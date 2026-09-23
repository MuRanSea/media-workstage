# 09: MiniMax 适配器与双重下载流转

**What to build:**
构建 MiniMax 官方海螺视频生成适配器（支持 MiniMax-H3 与 Video-01），实现 `ProviderAdapter` 接口契约，打通 MiniMax 视频生成异步任务提交、状态轮询与双重下载流转（`content.url` 优先 + `GET /v1/files/retrieve` 回退），使系统能够独立调度 MiniMax 视频生成能力并记录精准计费数据。

**Blocked by:** 07-backend-foundation

**Status:** resolved

- [x] 实现 `MiniMaxAdapter`（实现 `ProviderAdapter` 接口），对接 MiniMax 视频生成（`POST /v1/video_generation`）与查询（`GET /v1/query/video_generation`）API
- [x] 实现双重下载流转策略：`Success` 响应中优先提取 `content.url` 下载；若链接缺失/过期，则通过 `GET /v1/files/retrieve?file_id={id}` 获取有效下载地址
- [x] 校验并构造 MiniMax H3（支持首尾帧 `first_frame_image` + `last_frame_image`、2K 分辨率）与 Video-01 的 Payload
- [x] 连通 Poller 轮询器，在任务成功时将 MP4 文件流式下载至本地 `./assets/videos/`，并写入 `task_assets`
- [x] 记录实际生成时长（`output_duration_sec`）与使用量元数据
- [x] 编写并通过 MiniMaxAdapter 任务提交、轮询与文件提取回退的单元测试

## Answer

Ticket 09 已通过 TDD 闭环实现并通过全量测试（`go test -v -count=1 ./...` 全部通过，`CGO_ENABLED=0` 静态编译通过）：

### 核心实现：
1. **MiniMax 服务商适配器 (`internal/adapter/minimax.go`)**：
   - 实现了 `ProviderAdapter` 接口（`ProviderName()`, `SubmitTask()`, `PollTask()`, `DownloadAsset()`）。
   - 对接 MiniMax 视频生成接口（`POST /v1/video_generation`）与状态查询接口（`GET /v1/query/video_generation?task_id={id}`）。
   - 支持本地小图素材自动转换为 Base64 Data URL（`data:image/png;base64,...`）。
   - 支持通过 `MINIMAX_API_KEY`、`MINIMAX_BASE_URL` 与 `MINIMAX_GROUP_ID` 环境变量配置鉴权与租户/企业分组 Header。
2. **参数与互斥校验规则**：
   - 校验仅支持 `video_generation` 任务且 Prompt 必填。
   - 严格限制参考素材（最多 2 张图片：`first_frame` 首帧 / `last_frame` 尾帧），禁止传入 reference_video / reference_audio。
   - 模型分辨率校验：`video-01` 支持 `720P`/`1080P`；`MiniMax-H3` 支持 `720P`/`1080P`/`2K`。
   - 模型时长校验：`video-01` 强制 6s；`MiniMax-H3` 支持 5s、6s、10s、15s。
3. **双重下载流转与文件回退策略 (`DownloadAsset`, `RetrieveFileURL`)**：
   - 优先直接通过 `content.url` 异步流式下载 MP4 文件。
   - 若签名链接失效/过期或初始仅返回 `file_id`（`minimax-file://<file_id>`），自动调用 `GET /v1/files/retrieve?file_id={file_id}` 刷新 `download_url` 并完成落盘。
4. **调度器与服务端装配 (`internal/server/server.go`, `cmd/server/main.go`)**：
   - 将 `MiniMaxAdapter` 挂载至服务端 Adapter 路由表，由 `TaskPoller` 统一调度，任务完成后落盘 `./assets/videos/{task_id}/output.mp4` 并记录 `file_id`、分辨率、生成时长与 `task_assets`。

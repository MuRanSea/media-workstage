# 09: MiniMax 适配器与双重下载流转

**What to build:**
构建 MiniMax 官方海螺视频生成适配器（支持 MiniMax-H3 与 Video-01），实现 `ProviderAdapter` 接口契约，打通 MiniMax 视频生成异步任务提交、状态轮询与双重下载流转（`content.url` 优先 + `GET /v1/files/retrieve` 回退），使系统能够独立调度 MiniMax 视频生成能力并记录精准计费数据。

**Blocked by:** 07-backend-foundation

**Status:** ready-for-agent

- [ ] 实现 `MiniMaxAdapter`（实现 `ProviderAdapter` 接口），对接 MiniMax 视频生成（`POST /v1/video_generation`）与查询（`GET /v1/query/video_generation`）API
- [ ] 实现双重下载流转策略：`Success` 响应中优先提取 `content.url` 下载；若链接缺失/过期，则通过 `GET /v1/files/retrieve?file_id={id}` 获取有效下载地址
- [ ] 校验并构造 MiniMax H3（支持首尾帧 `first_frame_image` + `last_frame_image`、2K 分辨率）与 Video-01 的 Payload
- [ ] 连通 Poller 轮询器，在任务成功时将 MP4 文件流式下载至本地 `./assets/videos/`，并写入 `task_assets`
- [ ] 记录实际生成时长（`output_duration_sec`）与使用量元数据
- [ ] 编写并通过 MiniMaxAdapter 任务提交、轮询与文件提取回退的单元测试

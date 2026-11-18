# Heighliner Media API 第一批契约修复

日期：2026-11-18；基线：`de4cd74`（`origin/master`）。
依据：[任务与交付](https://platform.sgt.site/docs/md/media-tasks.md)、[视频与样片](https://platform.sgt.site/docs/md/media-videos.md)、[图片与拆图](https://platform.sgt.site/docs/md/media-images.md)、[3D 格式](https://platform.sgt.site/docs/md/media-3d.md)。

## 目标与验收

1. **生成终态与交付分开。** 平台 `failed`、`cancelled`、`expired` 原样进入本地 MediaTask，保存错误及本次返回的账务。平台 `succeeded` 时，用独立交付状态表达完整、部分、无法交付；画布只显示确实落盘的 TaskAsset，失败文件不写 `downloaded_at`，不能把部分产物当整套交付。仍在准备的产物继续查原任务；永久过期的产物不再等待或下载，保留已经下载的文件。重试原任务时复用已成功下载的文件；局部失败或重试耗尽时不能发起新的生成请求。输出文件先写临时文件再落位，避免断流留下看似有效的文件。兼容已有任务与历史工程。
2. **样片。** 仅主 Seedance 2.5 支持 480p 样片，Flash 不出现该模式、不发送 `draft`。来源 Result Card 提供 1080p 和 4K 正式视频操作，提交只带正式视频允许的参数，独立生成、独立计费。提示说明按厂商创建时间在 2026-10-28 10:00 UTC+8 前后分别为 7／14 天；不拿本地提交时间判断到期。保留旧 `finalize` 的 1080p 行为。
3. **可灵 3.0／Omni 多镜头。** 在能力声明允许时提供选项，显式 true 不丢；未选择时保持省略。Omni 带参考视频时，省略由网关推导，显式 false 在本地报错；视频编辑不发送普通生成的多镜头选项。Turbo 不开放。
4. **3D 包装优先。** `container=zip` 以 `.zip` 保存，不因 `format=obj` 或 `format=glb` 将其误当模型裸文件。已有非 ZIP 格式和无元数据的探测兼容。
5. **自动拆图入口。** Seedream 5.5 能力声明支持拆图时，一张参考图且启用拆图，可不填提示词；零张或多张在提交前拦截。拆图场景不发送 `background` 默认值；不能放开普通生图和其他 Provider 的提示词要求。

## 验证边界

- Go：使用本地 HTTP 假网关验证请求体、终态、过期及归档路径；轮询器 + SQLite 验证文件和任务落库、项目通知与有界重试。
- 前端：使用现有画布提交/编译、控制项及 Result Card 测试入口验证场景，不调用外部生成。运行受影响的 Go 和 Vitest 回归。
- 本批不接 Nano 图文、拆图 OCR/新元数据与复杂对象选项、动作控制、音频参考、Seedance 编辑/延长、Kling 4.0、取消入口、回调、账务独立追踪或统一文件管理。模拟测试不等于真实 Provider 验收；不涉及部署。

# Heighliner 平台服务商：文本 + 媒体平台协议（含 3D）

网关文档：https://platform.sgt.site/docs/ （另有 Markdown 版本 `/docs/md/<页>.md`，以及 `llms.txt`）。参数面板的决策见 [ADR 0010](../../docs/adr/0010-heighliner-capability-driven-cards.md)，术语见 CONTEXT.md 中的 **Heighliner protocol**、**Capability descriptor**、**3D Generation Card / 3D Result Card**。

## 目标
新增 `heighliner` 接入协议。一个 Heighliner 服务商用一把虚拟密钥跑文本卡、图片卡、视频卡和新增的 3D 卡。媒体部分走网关的媒体平台协议 `/media/v1`，文本部分走 `/v1/chat/completions`。

## 范围
- 协议与服务商：只能由用户新增，没有预置服务商。Base URL 填网关根地址（如 `https://platform.sgt.site`），后端自己拼 `/v1/...` 和 `/media/v1/...`。
- 获取模型列表：同时查 `/media/v1/models` 和 `/v1/models`。媒体模型按 `type` 绑定为 image、video、3d，并保存能力描述；`/v1/models` 中 `supported_endpoint_types` 含 `openai` 且不在媒体目录里的模型，绑定为 chat。
- 文本卡：Chat Completions，只发标准字段，不关思考，不加厂商专属字段。
- 媒体适配器：
  - 提交：`/images|videos|3d/generations`，`Idempotency-Key` 用本地任务 ID，`wait=0`。
  - 轮询：`GET /media/v1/tasks/{id}`。`queued`、`running`、`reconciling` 算进行中，`succeeded` 但产物仍是 `pending` 时继续轮询，`failed`、`cancelled`、`expired` 算失败。
- 参考素材：本地文件上传到 `POST /media/v1/files`（`purpose=reference`）拿 `file_id`，按文件缓存到过期前。上传卡已有的平台素材 ID，在该角色 `supports_asset` 时作为 `asset_id` 发出，否则退回 `file_id`。
- 产物：
  - 图片、视频：每个 `image` 或 `video` 产物一张结果卡。`cover`、`last_frame`、`audio` 忽略。
  - 3D：一次运行一张 3D 结果卡，所有 `model3d` 文件和 Express 的 `video` 都归这张卡，`cover` 作卡面，回传的参考图 `image` 忽略。
- 参数面板由能力描述驱动（ADR 0010）。视频卡沿用三种模式开关，能选哪些模式由描述里的角色决定。音频 `voice` 只能通过素材库参考填素材 ID，并且只在 `supports_asset` 为 true 时出现。
- 3D 卡：新建菜单、拖放创建、Tab 菜单都加上“3D”。参考图按视角分配角色，第一张默认是主图。3D 结果卡没有 `@` 标签、没有输出端口。双击时如果有 glb/gltf 就打开交互预览（three.js），其他格式提供“在文件夹中显示”。
- 账务：`billing` 原样存进 `billing_details_json`，不加界面。
- 模型显示名：ID 与现有内置定义一致时借用友好名，否则显示 ID。

## 不在范围
- 网关的厂商原生协议（`/volcengine`、`/kling`、`/minimax`、`/gemini`、`/tencent`、`/midjourney`）和 APIMart 入口。
- 文本的 Responses、Messages、Gemini 入口。
- 任务取消（`/cancel`）、账务界面。
- 上传平台（ADR 0008）迁移到 `/media/v1/files`：另立工单。
- MiniMax-H3 等模型的非素材库音频参考（画布上没有音频卡）。
- 文本卡的“3D 提示词”预设。
- 本地复刻网关的参数组合校验。

## 约束
- 请求只发描述里声明过的字段。网关会以 400 拒绝未知字段和显式 `null`。
- 不向第三方域名发送平台密钥。签名产物链接下载时不带鉴权。
- 3D 产物的签名链接最短 24 小时就过期，成功后立即下载到工程内。
- 旧工程无需迁移，新增字段都有缺省值。

## 工单顺序
01 →（02、03 可并行）→ 04 → 05 → 06

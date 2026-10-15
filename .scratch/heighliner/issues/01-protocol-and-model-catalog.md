# 01: Heighliner 协议、服务商配置与获取模型列表

Parent: [../spec.md](../spec.md)

**Status:** done

**What to build:**
新增接入协议 `heighliner`（后端 `model.ProtocolHeighliner`、前端 `Protocol` 联合类型、`PROTOCOL_META` 设置文案）。它只能由用户新增，加入 `CREATABLE_PROTOCOLS` 和后端的同一份列表，没有预置服务商。Base URL 填网关根地址，默认占位 `https://platform.sgt.site`。连接测试用 `GET /media/v1/models`。
“获取模型列表”同时查 `/media/v1/models` 和 `/v1/models`：
- 媒体模型按 `type` 绑定为 `image`、`video`、`3d`，并把每个模型的能力描述（`parameters`、`references`、`provider_options_schema`、`provider`、`sync`、`capability_version`）随绑定模型保存。
- `/v1/models` 里 `supported_endpoint_types` 含 `openai` 且不在媒体目录中的模型，绑定为 `chat`。
- 重新获取时覆盖原有的绑定和描述。

前端能通过服务商配置读到每个绑定模型的能力描述。

**Blocked by:** 无

- [x] 设置页可以新增 Heighliner 服务商、填根地址和密钥、测试连接
- [x] 获取模型列表后，绑定结果分成图片、视频、3D、文本四类；Seedream 不会出现在文本里
- [x] 能力描述持久化，重启后仍在，前端 API 能取到
- [x] `boundModel.Type` 支持 `3d`
- [x] Go 单元测试：用 `internal/server/testdata/heighliner-media-models.json`、`heighliner-text-models.json`（2026-10-14 从真实网关抓取的目录）验证分类、描述保存和覆盖刷新
- [x] 旧的服务商配置读取不受影响

## Comments

- 2026-10-14 实现记录：
  - 后端：`model.ProtocolHeighliner`；`protocolSpecs` 加 heighliner（探测 `GET <根>/media/v1/models`，要求 2xx）；`listHeighlinerModels` 先查媒体目录按 type 绑定 image/video/3d 并带原始描述，再查 `/v1/models` 取含 `openai` 且不在媒体目录里的为 chat。未知媒体类型（如 audio）不列出。
  - 描述存在 `<id>_capabilities`（模型 ID → 原始 JSON），在 `/api/config/models` 远程获取成功时整体覆盖；`boundModels()` 返回时附到 `capability` 字段；前端回传的描述被 `sanitizeBoundModels` 丢弃。清空、删除服务商时一并删除。
  - 前端：`Protocol`、`ModelType` 加 `3d`，`BoundModel.capability` 及 `CapabilityDescriptor` 类型（`provider_options_schema` 是 JSON Schema 对象，`capability_version` 是整数，同一角色可按媒体类型出现多次）；`PROTOCOL_META.heighliner`（`runs3d`），`CREATABLE_PROTOCOLS`；绑定面板加 3D 页签和手动 3D 选项（仅 `runs3d` 协议）。
  - 测试：`internal/server/heighliner_test.go`（目录 16 个媒体模型 = 图 3 / 视频 8 / 3D 5，文本 18 个）。

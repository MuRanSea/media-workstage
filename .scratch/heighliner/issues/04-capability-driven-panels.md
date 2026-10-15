# 04: 能力描述驱动的图片、视频参数面板

Parent: [../spec.md](../spec.md)

**Status:** done（真实网关的图片、视频最低档提交待用你自己的 key 补跑）

**What to build:**
Heighliner 服务商的图片卡和视频卡，参数面板由绑定模型的能力描述生成（ADR 0010）。
- **规格页**：描述里有哪些通用字段就显示哪些：`aspect_ratio`、`resolution`、`duration`（枚举出下拉，范围出带上下限的输入框）、`n`、`generate_audio`、`seed`、`negative_prompt`、`output_format`。`size` 不显示。
- **高级页**：`provider_options_schema` 自动生成控件：布尔出开关，枚举出下拉，整数出带范围的输入框。按厂商命名空间编译成 `provider_options.<provider>`。
- **默认值与切换模型**：初始值取 `default`，没有默认值的字段留空，留空就不发。切换模型时，旧值不在新范围内就重置成默认值，新模型没有的字段直接丢弃。
- **视频参考**：沿用全能参考、首尾帧、文生视频三种模式。描述里有 `first_frame` 才能选首尾帧，有 `last_frame` 才能加尾帧，有 `reference` 才能选全能参考；数量上限取 `max_count`；图片和视频分别对应 `reference` 角色下的 `image` 和 `video`。
- **音频**：`voice` 只在 `supports_asset` 时出现，通过素材库参考填素材 ID。
- **图片参考**：连进来的图片卡都用 `reference` 角色，数量上限取 `max_count`。
- **模型显示名**：ID 与现有内置定义一致时借用友好名，否则显示 ID。
- 前端 `READY_PROTOCOLS.image`、`READY_PROTOCOLS.video` 加上 `heighliner`。卡片编译器为 Heighliner 生成通用字段、`references` 和 `provider_options`。

**Blocked by:** 01, 03

- [x] Seedream Lite 能选 `n` 1–15、分辨率 2K/3K/4K；Pro 的 `n` 固定为 1
- [x] Seedance 2.5 的时长是 -1 和 4–30 的枚举，默认比例是 adaptive；可灵 Turbo 不出现音频开关
- [x] 高级页显示 `volcengine.watermark`、`kling.multi_shot` 这类厂商选项，编译结果放在正确的命名空间里
- [x] 编译结果里没有未声明的字段，也没有 `null`
- [x] 切换模型后，越界的值被重置，多余的字段被丢弃
- [x] H3 的首尾帧和参考模式按描述开放，音频入口不出现；Seedance 的音频素材库入口出现
- [x] 前端单元测试覆盖面板生成、默认值、切换模型、编译结果
- [ ] 开发服务器走查：用真实网关各跑一次图片和视频的最低档，提交成功并产出结果卡

## Comments

- 2026-10-14 走查记录：
  - **走查环境**：没有真实网关 key（也不应由代理代填），用本地假网关 `127.0.0.1:8099` 代替：它返回仓库里的真实模型目录 `internal/server/testdata/heighliner-media-models.json`，3D 任务两次 running 后成功，产物走签名路径、不带鉴权下载。服务器用隔离的 db/assets/projects 目录启动，浏览器是临时配置的无头 Chrome。截图在 `../walkthrough/`。
  - 设置里新建 Heighliner 服务商，点"获取模型"拿到 34 个模型（图片 3、视频 8、3D 5、文本 18），全选保存（`04-fetch-models.png`）。
  - 图片卡选 Heighliner 后，面板按描述生成：比例下拉、清晰度 2K/3K/4K、张数"范围 1–15"、文件格式 jpeg/png，高级页出现 `volcengine.watermark`，参考图上限 14（`04-image-panel.png`）。
  - 单元测试在 `web/src/engine/heighliner.test.ts`，覆盖上面前七条。
  - **未完成**：最后一条要求用真实网关各跑一次图片和视频的最低档。假网关只实现了 3D 生成，真实提交需要你在设置里填自己的 Heighliner key 后补跑。

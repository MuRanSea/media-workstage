# 05: 3D 生成卡与 3D 结果卡

Parent: [../spec.md](../spec.md)

**Status:** done（真实网关的 `hy-3d-express` 走查待用你自己的 key 补跑）

**What to build:**
新增卡片种类 `3d`。
- **3D 生成卡**：
  - 提示词，加上由能力描述生成的面板（复用 04 的生成器）：`output_format`、`negative_prompt`、`seed`，以及 `provider_options.tencent` 的全部字段。
  - 参考面板：图片卡（结果卡或上传卡）可以连进来，每张图选一个视角，可选项来自描述里的角色（主图 `reference` / `multi_view_front` / `multi_view_left` ...），中文显示为主图、正面、左、右、背、顶、底、左前、右前。第一张默认主图，每个视角最多一张。组合规则交给网关校验。
  - 模型下拉只列 Heighliner 服务商的 3D 模型。没有可用模型时提示“需要先添加 Heighliner 服务商并获取模型列表”，运行按钮禁用。
- **入口**：新建菜单、拖放创建、Tab 菜单都加上“3D”。
- **3D 结果卡**：一次运行一张。卡面显示 cover，带格式标签（如 GLB、FBX）和“在文件夹中显示”。没有 `@` 标签，没有输出端口，不能当参考。运行中显示进度，与其他结果卡一致。
- 工程保存时加上 3D 卡相关字段，旧工程不受影响。

**Blocked by:** 03, 04

- [x] 能新建 3D 生成卡，连两张图并分别设为主图和左视图，提交请求里的 `references` 角色正确
- [x] 混元 3.0 的高级页出现 `generate_type`（含 LowPoly）、`face_count`、`polygon_type`、`enable_pbr`；Tripo P1 的 `face_limit` 范围是 50–20000
- [x] 结果卡显示 cover 和全部格式；“在文件夹中显示”打开工程内的文件
- [x] 3D 结果卡拖不出连线，也不出现在其他卡的参考候选里
- [x] 工程导出、导入、复制后，3D 卡和文件都还在
- [x] 单元测试覆盖视角分配和请求编译
- [ ] 开发服务器走查：用真实网关跑一次 `hy-3d-express` 文生，产出结果卡

## Comments

- 2026-10-14 实现记录：
  - 卡片种类 `3d`。参考图仍是 `role: 'reference_image'`，新增 `ReferenceItem.view` 存网关角色；可选视角来自描述里接受 image 的角色，按 主图/正面/左/右/背/顶/底/左前/右前 排序。第一张取主图，后续取下一个空位；选已占用的视角时两张互换；切换模型时按新模型的视角重新安放，放不下的丢弃。
  - 编译器 `compileHeighliner3DPayload`：`task_type: 3d_generation`，`task_mode: single`；连了图时提示词可以不写，两者都没有时报"请先填写提示词，或连入参考图"。
  - 结果卡没有 tag、没有输出端口，保留全部产物（model3d / video / cover），`resultUrl` 用 cover。格式标签和"在文件夹中显示"调用新接口 `POST /api/projects/:id/reveal-asset`，路径限制在工程的 assets 目录内（`TestRevealAsset_ShowsProjectFilesOnly`）。
  - 入口：顶部"添加"菜单、双击/Tab 菜单、拖放创建、空画布引导都有 3D。
  - 测试：`web/src/engine/model3d.test.ts`（视角分配、请求编译、结果卡）；`internal/project/transfer_test.go` 的 `TestTransfer_3DResultsSurviveExportImportAndDuplicate`（导出、导入、复制后 3D 卡和模型文件都在）。
- 2026-10-14 走查记录：
  - **走查环境**：没有真实网关 key（也不应由代理代填），用本地假网关 `127.0.0.1:8099` 代替：它返回仓库里的真实模型目录 `internal/server/testdata/heighliner-media-models.json`，3D 任务两次 running 后成功，产物走签名路径、不带鉴权下载。服务器用隔离的 db/assets/projects 目录启动，浏览器是临时配置的无头 Chrome。截图在 `../walkthrough/`。
  - 新建 3D 卡默认选中 hy-3d-3.0，面板出现文件格式 stl/usdz/fbx、PBR、面数（3000–1500000）、生成类型（含 LowPoly）、多边形类型，可选视角 9 个（`05-3d-card-panel.png`）。
  - 选 fbx 文生：请求体是 `{"model":"hy-3d-3.0","output_format":"fbx","prompt":…,"provider_options":{"tencent":{…}},"wait":0}`，结果卡显示 cover、STL/FBX 标签和"在文件夹中显示"，文件落在 `assets/models/<task>/model_00.stl`、`model_01.fbx`、`cover_02.png`，完成后有提示（`05-3d-result.png`）。
  - 切到 hy-3d-express 并选 glb：参考图上限变成 1（只有主图），请求 `output_format: glb`，结果卡带 GLB 标签。
  - "在文件夹中显示"没在走查里点：它会在你的桌面弹出资源管理器。由后端测试覆盖。
  - **未完成**：用真实网关跑 `hy-3d-express` 文生。需要你在设置里填自己的 Heighliner key 后补跑。

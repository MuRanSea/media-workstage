# 12: 多模态生视频卡片、@Prompt 指代与流光射线

**What to build:**
在空间无限画布中实装多模态视频生成卡片（支持 Seedance 2.5/2.0 与 MiniMax H3），支持从画布一键引入最多 30 张图片至参考素材池，支持在 Prompt 运镜指令中通过 `@图1`、`@图2` 快捷插入进行角色/首尾帧精准语义指代，动态渲染多射线流光连线与 `@图N` 关系徽章，连接后端视频任务提交、异步轮询与本地视频平滑播放。

**Blocked by:** 08-ark-adapter-and-poller, 09-minimax-adapter-and-sse, 10-spatial-canvas-core

**Status:** resolved

- [x] 实现视频卡片 UI（全模态参考 / 首尾帧严格 / 纯文生视频 3 种互斥模式切换）
- [x] 实装全黑化模型切换下拉框（Seedance 2.5、Seedance 2.0 Pro、MiniMax H3、Video-01）并联动对应分辨率、时长与比例矩阵
- [x] 实装多图参考素材池（显示 `@图N` 胶囊药丸，支持一键引入画布图片与解绑，并严格受模型 maxRefs 约束）
- [x] 实装 Prompt 文本框 `@` 快捷补全与快捷插入 Pill，后端提交时自动重映射为合规的 `图N`
- [x] 实现 SVG 多模态渐变流光连线引擎，在连线中点悬浮渲染 `@图N` 关系徽章
- [x] 实装高级控制折叠抽屉（原生音频开关、MOV/MP4 格式切换、MiniMax Prompt 优化器、种子数支持 0 与 -1 随机）
- [x] 连通后端视频任务调度与 SSE 状态广播，支持生成完成后的本地真实有效 MP4 视频在卡片内平滑循环播放

## Answer

Ticket 12 已通过 TDD 闭环实现并通过全量前端单元测试（28/28 通过）、TypeScript 类型检查、生产构建与真实浏览器端到端交互验证（断言 `video.readyState === 4` 与 `video.duration = 1s`）：

### 核心实现：
1. **多模态视频生成卡片 UI 与模型矩阵 (`web/src/components/cards/VideoCardView.tsx`)**：
   - 紧凑玻璃拟态卡片容器（~460px 宽度，`#12141e`），支持 3 种互斥场景切换：全模态多参考（`all_modal`）、首尾帧严格（`first_last_frame`，强制锁定自适应首帧比例）、纯文生视频（`text_to_video`）。
   - 统一由 `getModelMaxReferences` 驱动模型约束：Seedance 2.5（30s 全模态、30 图参考）、Seedance 2.0 Pro（4K 档位、9 图参考）、MiniMax H3（2K 动态、2 图参考）与 Video-01（严格限制 1 图参考，超出报错拦截）。
   - 高级控制折叠抽屉：原生配音开关、MOV/MP4 格式切换、MiniMax Prompt 优化器、随机种子数输入（精确支持 `seed: 0` 与 `-1` 随机）。
2. **Prompt 文本框 `@` 快捷补全与多图素材指代 (`web/src/components/cards/VideoCardView.tsx`, `web/src/engine/videoCompiler.ts`)**：
   - 在 Prompt 文本框中键入 `@` 自动弹出内联智能补全悬浮窗，展示画布所有可用生图素材，选择后自动插入 `@图N ` 并绑定至素材槽位（在纯文生模式下自动禁用并剥离提示词悬空指代）。
   - 文本框上方渲染可点击的 `[@图1]`、`[@图2]` 快捷插入胶囊。
   - 编译器 `compileVideoTaskPayload` 接收画布卡片集合，按 `cardId` 解析已生成产物（规范化为 `assets/<local_path>`，有可读本地路径时排他返回，确保 Go 适配器走本地 Base64 编码路径；对未生成素材明确拦截报错）。
   - 自动将全局任意 `@图7`、`@图42` 依参考数组顺序重映射为云端合规的 `图1`、`图2`，并将 `seed` 正确编译传入请求参数。
   - `<Code />` JSON 检查器与 `POST /api/tasks` 统一调用该单源编译器。
3. **SVG 多模态渐变流光连线引擎 (`web/src/components/SpatialCanvas.tsx`)**：
   - 动态计算素材卡片右侧锚点到目标视频卡片左侧锚点之间的三次贝塞尔流光曲线（Cubic Bezier Rays）。
   - 流光连线具有粉-紫-蓝渐变外发光与脉冲呼吸效果，并在连线中心动态悬浮渲染带毛玻璃底色的 `@图N` 关系徽章。
4. **内嵌真实可播放 MP4 视频与播放器 (`internal/adapter/fake.go`, `web/src/components/cards/VideoCardView.tsx`)**：
   - `FakeProviderAdapter` 内置合法完整的 1 秒 320x240 H.264/AAC MP4 视频二进制数据，使得本地静态服务返回符合 ISO BMFF 标准的真实视频流。
   - 卡片预览区内嵌渲染 HTML5 视频播放器（`<video src={resultUrl} controls autoPlay loop muted playsInline />`），在真实 Chromium 浏览器中实测断言 `loadedmetadata` 事件触发且 `video.readyState === 4` (HAVE_ENOUGH_DATA) 循环平滑播放。
5. **自动化测试与端到端冒烟验证**：
   - 28/28 前端单元测试全部通过（`videoCompiler.test.ts`, `compiler.test.ts`, `expansion.test.ts`, `layout.test.ts`, `matrix.test.ts`）。
   - `tsc --noEmit` 零诊断通过，`vite build` 生产构建成功。
   - 在真实 Chromium 浏览器中实测完成键入 `@` 自动补全素材、`seed` 种子配置、多图素材绑定、流光射线渲染、未生成素材拦截、图片生成就绪后一键生成视频及真实 MP4 视频在卡片内循环播放。


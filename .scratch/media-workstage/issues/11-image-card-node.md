# 11: 生图卡片组件与 Seedream 5.0 多模式联动

**What to build:**
在空间无限画布中实装生图卡片组件，完整支持 Seedream 5.0 Pro（1K/1.5K/2K 档位、显式像素输入、图层拆分）与 Seedream 5.0 Lite（2K/3K/4K 档位、连续组图），支持全量参数在折叠抽屉中按需展开，连接后端生图 API 与 SSE 进度流，并将生成的产物或拆解出的图层（1底图+最多16图层）自动展示在卡片视口或在画布上衍生为新的素材卡片。

**Blocked by:** 08-ark-adapter-and-poller, 10-spatial-canvas-core

**Status:** resolved

- [x] 实现紧凑美观的生图卡片 UI（高度 ~380px，深色玻璃拟态设计，卡片自带 `@图N` 唯一标签）
- [x] 实现全黑化定制模型下拉菜单（Seedream 5.0 Pro vs 5.0 Lite）
- [x] 实装方式 1 档位预设（点选 1K/1.5K/2K/3K/4K 与比例动态映射像素）与方式 2 显式像素互斥切换
- [x] 实装折叠参数抽屉（单图 / 图层拆分 / 连续组图，JPEG/PNG，透明通道背景，无水印开关）
- [x] 连通 `POST /api/tasks` 生图接口与 SSE 进度推流，实现生成就绪后的卡片画面实时更新
- [x] 支持图层拆分结果与连环组图产物在画布上一键展开为独立的带 `@图N` 标签卡片

## Answer

Ticket 11 已通过 TDD 闭环实现并通过全量前端与后端测试、TypeScript 编译检查及真实浏览器端到端交互验证：

### 核心实现：
1. **生图卡片 UI 与折叠参数抽屉 (`web/src/components/cards/ImageCardView.tsx`)**：
   - 紧凑玻璃拟态卡片容器（~340px 宽度，`bg-[#12141e]/95 backdrop-blur-xl border-slate-800`），头部集成拖拽把柄、`@图N` 专属标签、`<Code />` JSON 检查器与删除按钮。
   - 定制全黑化模型切换下拉框（Seedream 5.0 Pro 与 Seedream 5.0 Lite）。
   - 抽屉折叠面板支持尺寸规格与高级模式选项卡：单图 / 图层拆分（16层） / 连环组图（15张）、JPEG/PNG 格式切换、透明/不透明底通道与无水印开关。
2. **尺寸配置互斥规则与动态像素映射 (`web/src/engine/compiler.ts`)**：
   - 方式 1（档位预设）：点击 1K/1.5K/2K/3K/4K 档位与 8 种常用宽高比（1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 21:9），实时计算并展示映射像素（如 2K 16:9 $\rightarrow$ `2816x1584`）。
   - 方式 2（显式像素）：自定义输入 `<width>x<height>` 格式，并严格校验像素范围。
   - 提取统一的单源编译器 `compileCardImagePayload`，确保 `<Code />` JSON 检查器与 `POST /api/tasks` 提交完全一致，严禁静默 fallback。
3. **后端 API 与 SSE 实时推流连接 (`web/src/services/api.ts`, `web/src/App.tsx`, `internal/server/server.go`)**：
   - `POST /api/tasks` 支持前端传入确定性的卡片 Task ID，彻底消除了异步任务提交与 SSE 事件推流之间的时序竞态（Race Condition）。
   - 通过 `subscribeTaskEvents` 实时接收 `task.progress`、`task.succeeded` 与 `task.failed` 事件，卡片预览区实时渲染生成完成的图像与 `就绪` 状态徽章。
4. **图层拆分多层解包与分镜画布一键裂变展开 (`web/src/engine/expansion.ts`)**：
   - 任务生成完成后，卡片预览区内嵌 `[底图] [图层1] [图层2]` 快速层级切换预览器。
   - 提供「在画布展开 N 个透明图层」与「在画布展开 N 张分镜卡片」快捷按钮，点击自动在世界坐标系右侧生成对应数量、自动自增 `@图N` 标签、透明背景 PNG 的独立素材卡片。
5. **自动化测试与浏览器冒烟验证**：
   - 18/18 前端单元测试通过（`matrix.test.ts`, `layout.test.ts`, `expansion.test.ts`, `compiler.test.ts`）。
   - `tsc --noEmit` 零诊断通过，`vite build` 生产打包成功。
   - 在真实 Chromium 浏览器中实测完成端到端生图提交、SSE 进度更新与透明图层一键裂变展开至画布。

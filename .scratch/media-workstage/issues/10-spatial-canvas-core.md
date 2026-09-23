# 10: 前端空间无限画布核心与零漂移光标缩放引擎

**What to build:**
在前端建立自研空间无限画布（Spatial Canvas）核心引擎，实现以鼠标光标所在世界坐标为锚点的数学零漂移缩放、触控板双指/滚轮平移、专业级快捷导航（`0` 适屏全览、`1` 100% 原始大小、`F` 聚焦选中卡片、`Space` 抓手漫游），以及卡片在无限空间中的自由拖拽、框选与多卡片排版。

**Blocked by:** 07-backend-foundation

**Status:** resolved

- [x] 初始化前端 React + Vite + TailwindCSS 现代工程结构（从 `prototype/canvas-engine` 原型迁移核心组件）
- [x] 实现原子状态矩阵变换（`transform: { zoom, panX, panY }`），应用光标定点公式 $W = (S - \text{pan}_1) / z_1, \text{pan}_2 = S - W \cdot z_2$
- [x] 注册原生非被动 `wheel` 监听器，区分 Trackpad Pinch / Ctrl+Wheel 缩放与自然平移
- [x] 实装右下角快捷导航悬浮坞与全局快捷键（`0` 适屏全览 / `1` 100% / `F` 聚焦 / `+`/`-` 步进 / `Space` 抓手）
- [x] 实现多卡片自由拖拽、坐标更新与选中高亮边框视觉反馈
- [x] 编写并通过光标定点缩放矩阵变换的无漂移数学单元测试

## Answer

Ticket 10 已通过 TDD 闭环实现并通过全量前端数学与工程测试（`bun test` 6/6 通过，`vite build` 生产构建成功，`go test ./...` 后端测试全绿）：

### 核心实现：
1. **前端工程结构搭建 (`web/`)**：
   - 采用 React 19 + TypeScript + Vite 6 + TailwindCSS 3 + Lucide Icons 架构。
   - 配置 Vite 代理将 `/api` 与 `/assets` 透明反向代理至 Go 后端服务（`http://localhost:8080`），构建产物打包至 `dist/`。
2. **空间无限画布核心变换引擎 (`web/src/engine/matrix.ts`)**：
   - 定义原子变换矩阵 `CanvasTransform: { zoom, panX, panY }`。
   - 实现严格光标定点无漂移缩放公式：$W = (S - \text{pan}_1) / z_1, \quad \text{pan}_2 = S - W \cdot z_2$。
   - 实现屏幕坐标与世界画布坐标互转：`screenToWorld` 与 `worldToScreen`。
   - 实现全局自适应全景计算 `calculateFitView` 与单节点视口居中聚焦 `calculateFocusSelection`。
3. **手势、事件与快捷导航 (`web/src/engine/useSpatialCanvas.ts`, `web/src/components/NavigationDock.tsx`)**：
   - 注册原生非被动 `wheel` 监听器，智能区分双指 Pinch / Ctrl+Wheel 缩放与自然 2D 滚轮漫游平移（支持 Shift 横向滚轮）。
   - 实装专业快捷键响应（`0` 适屏全景 / `1` 100% / `F` 聚焦 / `+`/`-` 步进 / `Space` 抓手漫游切换）。
   - 实装右下角悬浮快捷导航坞（显示缩放百分比、步进按钮、适屏与工具切换）。
4. **框选、多选与多卡片排版 (`web/src/engine/layout.ts`, `web/src/components/SelectionToolbar.tsx`)**：
   - 实现背景拖拽拉框框选（Marquee Box Selection），计算 2D 轴对齐包围盒相交判定 (`isRectIntersecting`)。
   - 支持单选与 Shift/Ctrl/Cmd 多选集合（`selectedCardIds: Set<string>`），多选状态下拖拽任意卡片带动所有选中卡片同向位移。
   - 实装多卡片排版悬浮坞（`SelectionToolbar.tsx`），支持左/中/右/顶/垂直居中/底对齐与自动双列/三列网格排版 (`autoArrangeGrid`)。
5. **数学单元测试 (`web/src/engine/matrix.test.ts`, `web/src/engine/layout.test.ts`)**：
   - 验证任意锚点在 100 次连续放大/缩小循环下的零漂移数学不变量。
   - 验证坐标转换的双射可逆性以及 `fitView` / `focusSelection` 的精确居中。
   - 验证拉框相交检测、坐标归一化、对齐算法与多列网格排版数学逻辑（10/10 单元测试通过）。

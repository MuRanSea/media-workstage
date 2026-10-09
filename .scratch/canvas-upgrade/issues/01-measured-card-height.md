# 01: 实测卡高

Parent: [../spec.md](../spec.md)

**Status:** done

**What to build:**
`SpatialCard` 没有高度字段，适应视图、聚焦、对齐、框选都硬编码 `height: 380`。在引擎里加一份运行时测量的高度表（ResizeObserver 采集，卡片卸载时清除），首帧和测量缺失时用 `estimateCardHeight` 兜底。高度不写进 `project.json`，旧工程不受影响。把现有用到 380 的地方（`useSpatialCanvas.ts` 适应视图/聚焦/框选，`layout.ts` 对齐和网格排列）改用这份高度。它是吸附、视口裁剪、小地图、分区、自动整理的共同前置。

**Blocked by:** 无

- [x] 引擎暴露「某张卡当前高度」，测量值优先，缺失时回退到估算
- [x] 适应视图、聚焦、框选、底部对齐、垂直居中、网格排列都用这份高度，源码里不再有写死的 380
- [x] 卡片高度变化（展开参数、媒体加载完成）后，下一次计算用的是新高度
- [x] `project.json` 内容不含高度字段，保存的文件与改动前格式一致
- [x] 单元测试覆盖：测量值优先于估算；缺失时回退；卡片卸载后表项被清除；对齐和适应视图在不同高度下的输入输出
- [x] 开发服务器走查：一张很高的卡和一张很矮的卡，底部对齐后底边确实齐平，适应视图能完整框住两张卡

## Comments

- 2026-10-09 实现完成。新增 `engine/cardMetrics.ts`（运行时高度表 `CardMetrics`，`cardHeight` 为实测优先、缺失回退 `estimateCardHeight`）与 `components/cards/CardMetricsContext.tsx`（`useReportCardHeight`：每张卡挂载时 ResizeObserver 上报 `offsetHeight`，卸载时清除；高度为 0 视为隐藏，保留上一次的值）。`CardShell` 上报，`CanvasPage` 持有高度表，原先按 DOM 查询的 `measuredHeight` 改读高度表。`useSpatialCanvas` 新增必填参数 `heightOf`，适应视图、聚焦、框选、对齐、网格排列都用它；`layout.ts` 的 `getCardsBoundingBox` / `alignCards` / `autoArrangeGrid` 增加可选的 `heightOf` 参数。`layout.ts` 里仅保留命名常量 `DEFAULT_CARD_HEIGHT = 380`，给没有高度也没有测量的 `LayoutCard` 当兜底，画布路径都不会用到它。
- 测试：新增 `cardMetrics.test.ts`（9 条，含底部对齐齐平、垂直居中、网格行高、卸载清除、零高度忽略）；全部 283 条通过，`tsc --noEmit` 通过。
- 走查（新建临时工程，已删除）：两张高度 212 / 186 的卡，全选后底部对齐，两者底边同为 474；按 `0` 适应视图后上下留白相等（232.8 / 232.8），说明按真实高度居中。落盘的卡没有任何高度字段。控制台无报错。

# 开源无限画布项目调研：哪些功能值得借鉴

调研日期：2026-10-09。星数与功能来自各项目 README 和文档页，没有逐个读源码；许可证以仓库页面为准，借鉴前请再核对。

## 1. 项目一览

| 项目 | 许可证 | 规模 | 与我们的相关度 | 能否参考代码 |
|---|---|---|---|---|
| [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas) | MIT | 7.4k★ | AI 创作画布：多画布管理、小地图、撤销重做、导入导出、画布助手、MCP Canvas Agent、插件 SDK、提示词库 | 能 |
| [ddcat-ai/Open-AI-Canvas](https://github.com/ddcat-ai/Open-AI-Canvas) | MIT | 1.2k★ | AI 影视画布：分镜组、批量创作表、自动整理、连线显隐、时间线剪辑、只读分享 | 能 |
| [ljquan/opentu](https://github.com/ljquan/opentu) | MIT | 782★ | 基于 Plait 的白板加 AI；Frame、任务队列、素材库 | 能 |
| [chatfire-AI/huobao-canvas](https://github.com/chatfire-AI/huobao-canvas) | CC BY-NC-SA 4.0 | 865★ | Vue Flow 节点画布：连线落点菜单、Prompt Dock、`@` 引用、分组节点、服务端队列 | 否，只看思路 |
| ComfyUI 前端 | GPL-3.0 | — | 子图（可发布成节点）、小地图、节点库、队列历史、App Mode | 否，只看思路 |
| [React Flow](https://reactflow.dev/examples) | MIT（部分示例为 Pro） | — | 交互模式清单：对齐线、拖线到空白新建节点、靠近自动连线、情境缩放、套索 | 当交互清单参考 |
| tldraw | 生产需商业授权 | 50k★ | 吸附、frame、同步 | 不引入 |
| Weavy（Figma Weave）/ Krea Nodes / Flora | 闭源商业 | — | Node Agent、模板、app mode、版本历史、协作 | 只看思路 |

## 2. 与本项目画布的差距

本项目画布是自研零依赖引擎（`web/src/engine/`），连线存在目标卡字段里（ADR 0005）。盘点结果：

**已持平或领先**：撤销重做（含手势合并，且不回退任务产出）、复制粘贴（`@图N` 重编号和连线重映射）、带类型校验的连线、框选、六种对齐加网格排列、乐观锁自动保存、结果卡自动找空位。

**缺失**：小地图、拖动吸附和对齐线、拖线到空白新建卡、分组/折叠、自动整理布局、视口裁剪和 `React.memo`、工程导入导出与复制、模板、命令面板、触屏手势、连线端点改接、批量创作、Agent。

**已有缺陷**（单独立工单，不混进功能）：适应视图、聚焦、对齐、框选都硬编码卡高 380；视口平移也会触发保存并 `revision` +1；`F` 只聚焦第一张选中卡；缩放范围在画布（0.25–2.5）、文档归一化（0.05–8）、适应视图（最小 0.35）三处不一致；滚轮缩放不看 `deltaY` 大小。

## 3. 取舍结论（2026-10-09 与用户确认）

| 决定 | 内容 |
|---|---|
| 产出 | 本次只产出调研和工单，不写功能代码 |
| 优先级 | A 画布手感 → B 大画布组织 → C 创作工作流（后做） |
| 路线 | 保持自研零依赖引擎，只借鉴功能；只参考 MIT 项目的代码，CC BY-NC-SA 与 GPL 项目只看思路 |
| 排除 | 多人协作、插件系统、云同步与只读分享、时间线剪辑 |
| 规模目标 | 一个工程 200～300 张卡片保持流畅 |

具体功能边界：

- **A1 实测卡高**：运行时用 ResizeObserver 测量，不写进 `project.json`，首帧用 `estimateCardHeight` 兜底。它是 A 类其余功能的前置。
- **A2 吸附与对齐线**：对齐其他卡的边缘和中线，阈值 6 屏幕像素，Alt 临时关闭；不做网格吸附；多选整体拖动时以选区包围盒吸附。
- **A3 拖线到空白新建卡**：落点菜单只列这条线合法的目标卡类型（由 `connections.ts` 的校验算出），在落点新建生成卡并连线，作为一步进入撤销。
- **A4 视口裁剪**：视口外（加余量）不渲染，选中、拖动中、有运行中任务的卡保持挂载；连线只画可见部分。
- **A5 小地图**：右下角常驻，按卡类型着色，点击或拖动视口框平移，导航坞里可开关，默认开。
- **B1 分区（Section）**：见 ADR 0009。带标题的矩形区域，不是卡片；几何包含判定归属；整体移动；可折叠；不做便签卡。
- **B2 自动整理**：只在点击时执行，按连线从左到右分层，无连线的按卡类型分组，可撤销，分区内的卡只在其区域内整理。
- **B3 工程导入导出**：导出整个工程文件夹为 zip（含 `assets/`），导入生成新工程 ID；另加"复制工程"。
- **模板**：不设独立概念，模板就是被复制的工程。

## 4. 暂缓清单（C 类与排除项里值得记住的）

- **批量创作表**（Open-AI-Canvas）：一张表里每行一个任务，行内带参考图和全局提示词。
- **底部 Prompt Dock**（huobao）：选中生成卡时在底部展开提示词和已连入素材的参考条。
- **连线显隐**（Open-AI-Canvas）：平时隐藏连线，悬停或选中节点时才显示。
- **视频 hover 预览**、**九宫格切分**、**多角度**（Open-AI-Canvas）。
- **画布 Agent**：[infinite-canvas](https://github.com/basketikun/infinite-canvas) 通过 MCP 让 Codex/Claude Code 操作画布；Krea 的 Node Agent 先出计划再执行。
- **App Mode**（ComfyUI、Weavy）：把一个工作流收成简易表单给别人用。
- **命令面板**、**触屏手势**、**连线端点改接**。

## 5. 来源

- <https://github.com/basketikun/infinite-canvas>
- <https://github.com/ddcat-ai/Open-AI-Canvas>
- <https://github.com/ljquan/opentu>
- <https://github.com/chatfire-AI/huobao-canvas>
- <https://github.com/tldraw/tldraw>
- <https://reactflow.dev/examples>
- <https://blog.comfy.org/p/comfyui-035-frontend-updates>
- <https://docs.comfy.org/interface/features/subgraph>
- <https://docs.krea.ai/user-guide/features/nodes>

# 01-canvas-engine-selection

Type: prototype
Status: resolved
Blocked by: none

## Question

评估 React Flow (@xyflow/react) 与 tldraw 在多模态媒体卡片交互（紧凑卡片美学、全量参数 Tab 抽屉折叠、零漂移光标锚定缩放、快捷键 0/1/+/Space 画布漫游、多图参考槽位绑定、@图N 提示词指代、进度条展示、媒体预览与连线流转）及手势缩放、平移手感上的优劣，通过一个轻量级前端原型确定 v1 的无限画布底层引擎。

## Answer

经过对 Variant A（React Flow DAG）、Variant B（空间无限画布 Spatial Canvas）、Variant C（分镜故事板）的原型实装与多轮人机交互打磨，**决议选用 Variant B（空间无限画布引擎架构）** 作为工作台的核心前端基座。

### 核心结论与选型依据：
1. **交互自由度与创作直觉**：
   - 相比传统节点图（React Flow）强制的左右输入/输出 Handle 与刚性连接线，空间无限画布允许卡片自由漫游、随心拖拽，并使用智能多模态流光射线（Multi-Ray Curves）动态连接引用的素材，完全契合多图参考创作习惯。
2. **数学严谨的零漂移光标定点缩放**：
   - 采用原子状态矩阵变换（$W = (S - \text{pan}_1) / z_1, \text{pan}_2 = S - W \cdot z_2$），实现鼠标滚轮、触控板捏合及快捷键（`+`/`-`/`=`）严格以光标所在绝对坐标为锚点定点缩放。
   - 完善的画布导航：`0` 适屏全览 (Fit View)、`1` 100% 原始比例、`F` 聚焦选中卡片、`Space` 抓手漫游。
3. **紧凑卡片美学与全量参数折叠抽屉**：
   - 默认状态卡片高度压缩至 ~380px，居顶大幅画面预览 + 状态摘要药丸；点击展开结构化 Tab 抽屉，完整保留 Ark 5.1/6.1 与 MiniMax 的所有参数控制能力。
4. **代码与原型归档**：
   - 完整原型代码已归档至分支 `prototype/canvas-engine`，验证规范已沉淀至 `CONTEXT.md`。

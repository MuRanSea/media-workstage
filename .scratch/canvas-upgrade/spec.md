# 画布升级：手感与大画布组织

调研见 [docs/research/07-infinite-canvas-benchmark.md](../../docs/research/07-infinite-canvas-benchmark.md)，分区的决策见 [ADR 0009](../../docs/adr/0009-sections-are-regions-not-cards.md)。

## 目标
借鉴开源无限画布的交互，让一个工程 200～300 张卡片时仍然流畅、好整理。先补画布手感（A），再补大画布组织（B）。

## 范围
- A：实测卡高、吸附与对齐线、拖线到空白新建卡、视口裁剪、小地图
- B：分区（Section）、分区折叠、自动整理、工程导入导出与复制
- 缺陷：画布上已有的几处错误（工单 02）

## 不在范围
- 多人协作、插件系统、云同步与只读分享、时间线剪辑
- C 类创作工作流（批量创作表、Prompt Dock、分镜组、九宫格切分、画布 Agent、App Mode）：另起一份 spec
- 命令面板、触屏手势、连线端点改接、独立的模板概念（模板就是被复制的工程）
- 换用 React Flow 或 tldraw：保持自研引擎

## 约束
- 只参考 MIT 项目的代码；huobao-canvas（CC BY-NC-SA）和 ComfyUI（GPL）只看思路
- 连线数据结构不变（ADR 0005）
- 旧工程无需迁移：新增字段都有缺省值

## 工单顺序
01 → (02, 03, 04, 05, 06, 07, 10 可并行；03/04/05/07 依赖 01) → 08 → 09

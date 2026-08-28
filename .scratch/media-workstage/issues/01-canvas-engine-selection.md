# 01-canvas-engine-selection

Type: prototype
Status: claimed
Blocked by: none

## Question

评估 React Flow (@xyflow/react) 与 tldraw 在多模态媒体卡片交互（Prompt 编辑、3种互斥生成模式切换、多图参考槽位绑定、@图N 提示词指代、进度条展示、媒体预览与连线流转）及手势缩放、平移手感上的优劣，通过一个轻量级前端原型确定 v1 的无限画布底层引擎。

## Prototype Reference

- **Git 分支**: `prototype/canvas-engine`
- **本地运行预览**: `http://localhost:5173/` (已实时热更新)
- **核心交互规范（严密契合 Ark 5.1 与 MiniMax 原生 API 契约）**:
  1. **互斥场景模式切换 (Mutually Exclusive Task Modes)**：
     - **全模态参考 (All-Modal Reference - 推荐)**：支持 0~30 张参考图，API 层面全部作为 `reference_image` 输入；通过 Prompt 中书写「以 @图1 为首帧，以 @图2 为雨夜场景」指定首尾帧与主体。
     - **首尾帧严格模式 (First & Last Frame)**：严格锁定起止画面（必须为 1 或 2 张图，分别标记为 `first_frame` 与 `last_frame`）。
     - **纯文生视频 (Text-to-Video)**：纯文本直接驱动。
  2. **画布全局素材标签与 @Prompt 绑定**：
     - 画布上每张生图节点自带唯一 `@图1`, `@图2` 标签。
     - 视频卡片支持引入多图、展示流光连线与中点 `@图N` 徽章。
     - 提示词区域提供快捷插入 Pill，并与后端生成请求体完全对齐。

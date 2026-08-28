# 01-canvas-engine-selection

Type: prototype
Status: claimed
Blocked by: none

## Question

评估 React Flow (@xyflow/react) 与 tldraw 在多模态媒体卡片交互（Prompt 编辑、多图参考槽位绑定、@图N 提示词指代、进度条展示、媒体预览与连线流转）及手势缩放、平移手感上的优劣，通过一个轻量级前端原型确定 v1 的无限画布底层引擎。

## Prototype Reference

- **Git 分支**: `prototype/canvas-engine`
- **本地运行预览**: `http://localhost:5173/` (已实时热更新)
- **多图引用实装**:
  - 画布上每张生图节点自带唯一 `@图1`, `@图2` 标签。
  - 视频卡片内置 **多图参考素材池 (References)**，支持最多 30 个素材绑定。
  - 支持为每个引用指定角色：`主体外观 (reference_image)`, `首帧 (first_frame)`, `尾帧 (last_frame)`, `场景参考 (scene)`。
  - 提示词 Prompt 区域支持 `@图1`, `@图2` 精准指代与快捷点击插入。
  - 画布直观渲染多条动态渐变流光连线（Multi-Ray Curves），并在连线中点标注 `@图N` 关系标签。

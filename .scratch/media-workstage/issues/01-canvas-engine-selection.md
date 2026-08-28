# 01-canvas-engine-selection

Type: prototype
Status: claimed
Blocked by: none

## Question

评估 React Flow (@xyflow/react) 与 tldraw 在多模态媒体卡片交互（Prompt 编辑、3种互斥生成模式切换、多模型全参数矩阵选择、多图参考槽位绑定、@图N 提示词指代、进度条展示、媒体预览与连线流转）及手势缩放、平移手感上的优劣，通过一个轻量级前端原型确定 v1 的无限画布底层引擎。

## Prototype Reference

- **Git 分支**: `prototype/canvas-engine`
- **本地运行预览**: `http://localhost:5173/` (已实时热更新)
- **已实装特性（契合 Ark / MiniMax 全参数矩阵）**:
  1. **全黑化自定义下拉组件 (Dark Popovers)**：彻底消除 Windows 浏览器原生 `<select>` 的白色背景色块问题，统一样式与动画。
  2. **动态模型参数矩阵 (Model Capabilities Matrix)**：
     - **Seedance 2.5**：分辨率 (`480p`, `720p`, `1080p`)、时长 (`4s`, `5s`, `10s`, `15s`, `20s`, `30s`, `自适应`)、比例 (`16:9`, `9:16`, `1:1`, `4:3`, `3:4`, `21:9`, `adaptive`)、原生音频开关、MOV/MP4 格式切换、最多 30 个素材参考。
     - **Seedance 2.0 Pro**：分辨率 (`480p`, `720p`, `1080p`, `4k`)、时长 (`4s`~`15s`, `自适应`)。
     - **MiniMax H3**：分辨率 (`720P`, `1080P`, `2K`)、时长 (`5s`, `6s`, `10s`, `15s`)。
     - **MiniMax Video-01**：分辨率 (`720P`, `1080P`)、时长 (`6s`)。
     - **Seedream 5.0 Pro**：生图规格 (`1K`, `1.5K`, `2K`)。
  3. **实时 API Payload 序列化预览 (Inspector)**：卡片右上角配备 `<Code>` 按钮，实时展开查看后端序列化后的真实 JSON 请求体与 `图N` 重映射。

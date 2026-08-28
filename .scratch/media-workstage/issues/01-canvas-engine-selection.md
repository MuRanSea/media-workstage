# 01-canvas-engine-selection

Type: prototype
Status: claimed
Blocked by: none

## Question

评估 React Flow (@xyflow/react) 与 tldraw 在多模态媒体卡片交互（Prompt 编辑、3种互斥生成模式切换、生图/生视频模型矩阵选择、多图参考槽位绑定、@图N 提示词指代、进度条展示、媒体预览与连线流转）及手势缩放、平移手感上的优劣，通过一个轻量级前端原型确定 v1 的无限画布底层引擎。

## Prototype Reference

- **Git 分支**: `prototype/canvas-engine`
- **本地运行预览**: `http://localhost:5173/` (已实时热更新)
- **已实装模型矩阵与参数规范（严格契合火山方舟 Ark 5.1 / 6.1 与 MiniMax 原生 API）**:
  1. **生图模型选择（Seedream 5.0 系列）**：
     - **Seedream 5.0 Pro (`doubao-seedream-5-0-pro-260628`)**：
       - 方式 1 档位：`1K`、`1.5K`、`2K`、`auto`（默认 2K，支持映射 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 21:9 等）。
       - 方式 2 显式像素：区间限制在 `[92万, 462万像素]`，如 `2048x1024`。
       - 特有模式：图层拆分（`layer_decomposition`，1底图+最多16图层）、交互编辑。
     - **Seedream 5.0 Lite (`doubao-seedream-5-0-lite-260128`)**：
       - 方式 1 档位：`2K`、`3K`、`4K`（默认 2K）。
       - 方式 2 显式像素：区间限制在 `[368万, 1677万像素]`，如 `2048x2048`, `4096x2304`。
       - 特有模式：连续组图分镜生成（`sequential_image_generation: "auto"` 最多 15 张）。
  2. **生视频模型矩阵（Seedance 2.5 / 2.0 / MiniMax H3 / Video-01）**：
     - 包含全模态多参考、首尾帧严格模式与纯文生视频 3 种互斥场景。
     - 联动分辨率、时长、宽高比、原生音频开关与 MOV/MP4 格式。
  3. **全黑化自定义 Dropdown / Popovers**：彻底消灭 Windows 下白底弹层问题。

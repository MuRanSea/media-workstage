# 01-canvas-engine-selection

Type: prototype
Status: claimed
Blocked by: none

## Question

评估 React Flow (@xyflow/react) 与 tldraw 在多模态媒体卡片交互（紧凑卡片美学、全量参数 Tab 抽屉折叠、零漂移光标锚定缩放、快捷键 0/1/+/Space 画布漫游、多图参考槽位绑定、@图N 提示词指代、进度条展示、媒体预览与连线流转）及手势缩放、平移手感上的优劣，通过一个轻量级前端原型确定 v1 的无限画布底层引擎。

## Prototype Reference

- **Git 分支**: `prototype/canvas-engine`
- **本地运行预览**: `http://localhost:5173/` (已实时热更新，控制台 0 错误)
- **最新实装核心交互优化**:
  1. **严格以鼠标光标所在世界坐标为中心的定点缩放（Zero-Drift Cursor Anchor）**：
     - 重构底层矩阵变换公式，将 `zoom` 与 `pan` 整合为原子状态：$w = (s - \text{pan}_1) / z_1$，$\text{pan}_2 = s - w \cdot z_2$。
     - 无论是滚动鼠标滚轮、触控板捏合、按快捷键（`+`、`-`、`=`）还是点击右下角缩放按钮，**鼠标所在位置的像素点在缩放过程中保持绝对静止，彻底消灭漂移**。
  2. **全量参数“合理折叠”，完整保留所有模型能力**：
     - **生视频**：
       - **Specs 规格 Tab**：3 种互斥场景模式（全模态参考 / 首尾帧严格 / 纯文生）、动态分辨率（480p/720p/1080p/4k）、时长（4s~30s/自适应）、画面比例（16:9/9:16/1:1/4:3/21:9/adaptive）。
       - **Refs 素材槽位 Tab**：多图绑定列表、角色标识、一键引入/解绑。
       - **Advanced 高级 Tab**：原生音频开关、MOV/MP4 格式、Prompt 智能优化器开关。
     - **生图（Seedream 5.0 系列）**：
       - **Specs 尺寸 Tab**：方式 1 分辨率档位（1K/1.5K/2K/3K/4K）+ 比例像素映射，方式 2 显式像素输入（区间校验 `[92万~462万]` 与 `[368万~1677万]`）。
       - **Advanced 模式 Tab**：单图生成 / 图层拆分（Pro 专属 16 层） / 连环组图（Lite 专属 15 张），JPEG/PNG 格式，透明背景，水印控制。

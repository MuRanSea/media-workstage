# 01-canvas-engine-selection

Type: prototype
Status: claimed
Blocked by: none

## Question

评估 React Flow (@xyflow/react) 与 tldraw 在多模态媒体卡片交互（Prompt 编辑、参数配置、进度条展示、媒体预览与连线流转）及手势缩放、平移手感上的优劣，通过一个轻量级前端原型确定 v1 的无限画布底层引擎。

## Prototype Reference

- **Git 分支**: `prototype/canvas-engine`
- **本地运行预览**: `http://localhost:5173` (已启动)
- **切换参数**: 底部悬浮控制台或通过 `?variant=A` / `?variant=B` / `?variant=C` 切换

### 候选交互形态：
1. **Variant A: 显式节点连线 (React Flow DAG Pipeline)**
   - 结构化节点图，清晰的左右端口与连线流转（Seedream 生图输出端子 $\rightarrow$ Seedance/MiniMax 视频首帧输入端子）。
   - 优势：数据依赖关系明确，适合精确排布生成管道。
2. **Variant B: 自由空间卡片 (Lovart / Spatial Canvas)**
   - 类似 Lovart / tldraw 的无限漫游画布，卡片自由拖拽摆放、磁吸对齐、基于语义或轻量连线的素材继承。
   - 优势：自由度极高，无拘无束，最符合直觉创作与海量素材平铺对比。
3. **Variant C: 混合故事板 (Storyboard & Hybrid Inspector)**
   - 中央大屏预览舞台 + 底部镜头连续时间轴序列 + 右侧参数控制台。
   - 优势：专注于短剧/视频连续分镜制作与顺流播放。

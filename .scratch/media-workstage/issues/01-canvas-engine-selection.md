# 01-canvas-engine-selection

Type: prototype
Status: claimed
Blocked by: none

## Question

评估 React Flow (@xyflow/react) 与 tldraw 在多模态媒体卡片交互（紧凑卡片美学、参数 Tab 抽屉折叠、光标中心缩放锚定、快捷键 0/1/+/Space 画布漫游、多图参考槽位绑定、@图N 提示词指代、进度条展示、媒体预览与连线流转）及手势缩放、平移手感上的优劣，通过一个轻量级前端原型确定 v1 的无限画布底层引擎。

## Prototype Reference

- **Git 分支**: `prototype/canvas-engine`
- **本地运行预览**: `http://localhost:5173/` (已实时热更新，浏览器端验证 0 错误)
- **已解决与实装特性**:
  1. **以当前鼠标光标为锚点的平滑缩放 (Cursor-Anchored Zoom)**：
     - 无论是滚动鼠标滚轮、触控板双指缩放，还是按快捷键（`+`、`-`、`=`）与点击放大缩小按钮，缩放中心点严格锁定在**当前鼠标指针所在的位置**，彻底消除视图漂移。
  2. **高密度参数合理折叠体系 (Tabbed Parameter Drawer)**：
     - **默认紧凑视图 (~380px)**：卡片只展示大图视口预览、模型药丸、精简参数摘要（如 `720p / 5s / 16:9 • 🔊配音`）、多图参考胶囊与 Prompt 生成按钮。
     - **点击 `[展开参数]` 弹出结构化 Tab 抽屉**：
       - **基础规格 (Specs)**：模式切换（全模态/首尾帧/纯文生）、分辨率、时长、比例联动。
       - **素材槽位 (Refs)**：多图绑定列表、角色标识、一键引入/解绑。
       - **高级控制 (Advanced)**：原生音频开关、MOV/MP4 格式、Prompt 智能优化器、种子数（Seed）、透明背景（PNG）、水印控制等全部保留且分类清晰。

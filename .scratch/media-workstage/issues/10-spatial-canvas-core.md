# 10: 前端空间无限画布核心与零漂移光标缩放引擎

**What to build:**
在前端建立自研空间无限画布（Spatial Canvas）核心引擎，实现以鼠标光标所在世界坐标为锚点的数学零漂移缩放、触控板双指/滚轮平移、专业级快捷导航（`0` 适屏全览、`1` 100% 原始大小、`F` 聚焦选中卡片、`Space` 抓手漫游），以及卡片在无限空间中的自由拖拽、框选与多卡片排版。

**Blocked by:** 07-backend-foundation

**Status:** ready-for-agent

- [ ] 初始化前端 React + Vite + TailwindCSS 现代工程结构（从 `prototype/canvas-engine` 原型迁移核心组件）
- [ ] 实现原子状态矩阵变换（`transform: { zoom, panX, panY }`），应用光标定点公式 $W = (S - \text{pan}_1) / z_1, \text{pan}_2 = S - W \cdot z_2$
- [ ] 注册原生非被动 `wheel` 监听器，区分 Trackpad Pinch / Ctrl+Wheel 缩放与自然平移
- [ ] 实装右下角快捷导航悬浮坞与全局快捷键（`0` 适屏全览 / `1` 100% / `F` 聚焦 / `+`/`-` 步进 / `Space` 抓手）
- [ ] 实现多卡片自由拖拽、坐标更新与选中高亮边框视觉反馈
- [ ] 编写并通过光标定点缩放矩阵变换的无漂移数学单元测试

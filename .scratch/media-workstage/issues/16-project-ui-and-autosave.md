# 16: 工程列表页、顶栏切换与自动保存

**What to build:**
前端接入工程：`/` 工程列表页，`/p/:id` 打开画布；顶栏显示工程名（可直接改名）、保存状态与切换菜单；画布改动自动保存，Ctrl+S 立即保存。

**Blocked by:** 14-project-store-backend, 15-project-scoped-tasks-and-assets

**Status:** resolved

- [x] 轻量路由（`services/router.ts`，无第三方依赖），`CanvasPage` 以 `key={projectId}` 挂载
- [x] `ProjectListPage`：新建、打开、重命名、删除（移入 `.trash` 前二次确认）、在资源管理器中打开，底部显示工程目录
- [x] `ProjectSwitcher`：工程名内联重命名、保存状态徽标、全部工程 / 新建工程 / 最近工程菜单
- [x] `useAutosave`：约 1 秒防抖、串行保存、Ctrl+S、`beforeunload` keepalive 补写、409 冲突暂停自动保存
- [x] 视口随工程保存与恢复（`SpatialCanvas.initialViewport` / `onViewportChange`）
- [x] 打开工程时补齐关闭期间完成的任务；抽出 `applyTaskToCard` 统一 SSE / 提交回填 / 补齐三处映射
- [x] 收敛 5 处重复的素材路径拼接为 `assetStoredPath` / `assetUrl`

## Answer

`projectDoc.test.ts` 覆盖文档归一化、任务映射与素材路径；打包后在浏览器中验证了新建工程、刷新后卡片与视口恢复、生成结果落入工程文件夹、关闭期间完成任务的补齐、双标签页冲突、拷贝工程文件夹后两份均可正常显示、删除移入 `.trash`、顶栏切换工程。

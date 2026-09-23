# 15: 任务与素材归属工程

**What to build:**
让生成任务归属工程：任务携带 `project_id`，产物下载到该工程的 `assets/` 文件夹，并通过工程作用域的素材路由访问；参考素材路径按工程文件夹解析。

**Blocked by:** 14-project-store-backend

**Status:** resolved

- [x] `media_tasks.project_id`（可空、带索引，AutoMigrate 加列）
- [x] `TaskPollerConfig.AssetRoot` 注入：有工程时下载到 `<工程>/assets/`，否则回落全局 `./assets/`
- [x] `POST /api/tasks` 接收 `project_id`，未知工程返回 400，参考素材 `local_path` 解析为工程内绝对路径并做目录穿越校验
- [x] `GET/HEAD /api/projects/:id/assets/*filepath`（复用 Range / ETag / 防穿越的 `serveAssetFile`）

## Answer

`TestProjectTask_DownloadsIntoProjectFolder` 端到端验证产物落在工程文件夹、不写入全局目录，且可经工程素材路由读取；`TestResolveProjectReferences` 覆盖路径解析与穿越拒绝。顺带修复了参考图按进程工作目录读取的隐患。

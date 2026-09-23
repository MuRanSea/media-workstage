# 14: 工程文件夹存储与工程 API

**What to build:**
新增“工程（Project）”概念的后端部分：以磁盘文件夹持久化画布工程（`project.json` + `assets/`），提供工程的列表、新建、读取、保存、重命名、删除与在资源管理器中打开的 REST API。详见 [ADR 0003](../../../docs/adr/0003-project-folders-persistence.md)。

**Blocked by:** 13-embedded-packaging-and-e2e

**Status:** resolved

- [x] `internal/project.Store`：扫描根目录建立 id → 文件夹索引，文件夹名 slug（保留中文、规避非法字符与 Windows 保留名、重名加后缀）
- [x] 原子写入 `project.json`（临时文件 + rename），`revision` 乐观并发，冲突返回 `ErrConflict`
- [x] 拷贝文件夹导致的重复 id 在扫描时自动重新分配
- [x] 删除工程移入 `<root>/.trash/`
- [x] `GET/POST /api/projects`、`GET/PUT/PATCH/DELETE /api/projects/:id`、`POST /api/projects/:id/reveal`，写操作走同源校验
- [x] `-projects` / `PROJECTS_DIR` 启动参数（默认 `./projects`）

## Answer

`internal/project/store.go` 与 `internal/server/projects.go` 实现，`store_test.go`、`projects_test.go` 覆盖创建、列表、保存与 409 冲突、重命名、拷贝去重、删除入回收站及跨域写拒绝。

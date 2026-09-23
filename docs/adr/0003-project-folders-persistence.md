# ADR 0003: 工程（Project）以磁盘文件夹持久化

## 上下文 (Context)
画布卡片与视口原本只存在前端内存中，刷新即丢失；唯一持久化的是全局 SQLite 任务库与全局 `./assets/` 目录，生成的素材与“它属于哪张画布”之间没有任何关联。用户需要“新建工程 / 打开工程 / 自动保存”，并希望一个工程能作为整体备份、拷贝到其他机器。

## 决策 (Decision)

### 1. 一个工程 = 一个自包含文件夹
工程根目录默认 `./projects`（`-projects` / `PROJECTS_DIR` 可改），每个工程一个子文件夹：
```
projects/<文件夹名>/
  project.json            # { version, id, name, createdAt, updatedAt, revision, viewport, cards }
  assets/images|videos|uploads/...
projects/.trash/          # 删除的工程被移到这里，而非直接删除
```
- 文件夹名在创建时由工程名生成（保留中文，替换非法字符，规避 Windows 保留名，重名加 `-2` 后缀）。重命名只改 `project.json` 中的 `name`，不移动文件夹，避免与正在下载的任务竞争路径。
- 工程列表通过扫描根目录下含 `project.json` 的子目录得到；拷贝文件夹会复制 `id`，扫描时给后出现的副本重新分配 `id` 并写回。
- `cards` 对后端是不透明 JSON，形状由前端 `SpatialCard` 定义。

### 2. 素材路径相对化
卡片中的本地素材路径保持 `/assets/...` 形式，约定为**相对工程文件夹**。前端仅在渲染时经 `assetUrl()` 映射为 `/api/projects/:id/assets/...`；因此文件夹被移动或拷贝后引用依然有效。

### 3. 任务库仍然全局，任务携带 `project_id`
`media_tasks` 继续承担计费历史与重启恢复，新增可空列 `project_id`：
- Poller 通过注入的 `AssetRoot(task)` 把产物下载到 `<工程>/assets/`；无工程的旧任务仍落到全局 `./assets/`。
- 创建任务时后端把参考素材的相对路径解析为工程内的绝对路径（带目录穿越校验），适配器不再依赖进程工作目录。

### 4. 保存语义
- 前端改动后约 1 秒防抖自动保存，Ctrl+S 立即保存，关闭页面时以 `fetch keepalive` 补写。
- 写入采用临时文件 + rename 的原子替换。
- 乐观并发：`PUT` 需携带 `revision`，不匹配返回 409；前端显示冲突并暂停自动保存，避免多窗口互相覆盖。
- 工程关闭期间完成的任务：打开工程时对未终结且有 `taskId` 的卡片调用 `GET /api/tasks/:id` 补齐状态。

## 结果与影响 (Consequences)
- **正面**：工程可整体拷贝/备份，素材与画布天然归属；刷新、重启不丢工作；多窗口不会静默覆盖。
- **权衡**：工程文件夹与全局任务库之间是弱关联（按 `project_id`），删除工程不会删除任务记录；工程被移出根目录后，其未完成任务会回落到全局 `./assets/`。暂不支持打开根目录以外的工程文件夹。

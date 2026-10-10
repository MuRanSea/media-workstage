# 02: 画布已有缺陷

Parent: [../spec.md](../spec.md)

**Status:** done

**What to build:**
盘点中发现的几处已有错误，一并修掉：
1. 视口平移和缩放也触发自动保存并让 `revision` +1，多标签页下平移一下就可能造成保存冲突。
2. `F` 聚焦只取第一张选中卡，多选时应聚焦选区的包围盒。
3. 缩放范围三处不一致：画布 0.25–2.5，文档归一化 0.05–8，适应视图最小 0.35；卡片很多时适应视图装不下。
4. 滚轮缩放每个事件固定乘 1.06/0.94，不看 `deltaY` 大小，触控板捏合过快。
5. 快捷键帮助弹窗没有列出 `+`/`-` 缩放键和 Backspace 删除。

**Blocked by:** 无（第 2、3 条里"包围盒"用到卡高，若 01 已完成就用实测高度）

- [x] 仅视口变化不再让 `revision` +1，也不会在另一个标签页造成 409；视口仍随工程保存并在重新打开时恢复
- [x] 多选后按 `F`，视口框住所有选中卡
- [x] 画布缩放、文档归一化、适应视图使用同一组上下限，卡片很多时适应视图能装下全部卡
- [x] 滚轮和捏合缩放的幅度随 `deltaY` 变化，且有单次上限
- [x] 快捷键帮助弹窗补全
- [x] 单元测试覆盖：缩放上下限一致；多选聚焦的包围盒；视口变化不触发 revision 递增

## Comments

- 2026-10-09 实现完成。
  1. 后端新增 `Store.SaveViewport` 和 `PUT /api/projects/:id/viewport`：只写视口，不检查也不递增 `revision`，不改 `updatedAt`（工程列表的"更新于"只反映内容改动）。前端 `useAutosave` 把视口变化改为单独的 1 秒防抖保存（`apiSaveViewport`），卡片保存仍顺带写视口；离开页面时若只有视口未保存，单独发视口（可 keepalive）。视口保存失败不改保存状态徽标，下一次保存会带上。
  2. `F` 改用新的 `calculateFocusRects`：选区放得下就以 100% 居中，放不下就缩小到刚好放下。
  3. `matrix.ts` 导出 `MIN_ZOOM = 0.1`、`MAX_ZOOM = 2.5`，滚轮缩放、聚焦、适应视图下限、`normalizeViewport` 统一使用；适应视图上限仍是 1.2（只是"不把少量卡放得过大"，不是缩放边界）。原 `projectDoc.test.ts` 断言上限为 8 的用例同步改为 2.5。
  4. `wheelZoomFactor(deltaY, deltaMode)`：按 `exp(-deltaY × 0.0015)` 缩放，单次事件限制在 1/1.25～1.25；行模式按 16px/行折算。
  5. 快捷键帮助补上 `+ / -` 和 `Delete / Backspace`。
- 新增 `.claude/launch.json` 配置 `media-workstage-go`（`go run ./cmd/server`），走查后端改动时不必覆盖仓库根目录的 `media-workstage.exe`。
- 测试：Go `internal/project`、`internal/server` 新增视口保存用例；前端新增缩放范围、300 卡适应视图、滚轮幅度、多选聚焦用例。前端 289 条全部通过，`tsc` 通过。
- 走查（临时工程，已删除）：两张卡保存后 revision 为 3；滚轮平移后视口落盘为 `(-60, -160)`，revision 仍为 3。全选两张卡按 `F`，两张卡的包围盒中心正好落在视口中心（640, 360），缩放 100%。

# 26: MJ 垫图（参考图生图）

**Blocked by:** 25

**Status:** ready-for-agent

- [ ] 图片卡可以连线到 MJ 图片卡作为参考图（最多 5 张），Seedream 等其他图片卡仍拒绝
- [ ] 后端把本地参考图转 data URI 放入 imagine 的 `base64Array`；单张超过 4MB 或只有远程 URL 时给出明确错误
- [ ] 切换到非 MJ 服务商时清掉参考图；属性面板显示参考图列表

计划：`~/.claude/plans/ok-toasty-milner.md`（分支 `feat/mj-full`）。

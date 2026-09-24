# 25: MJ 速度模式 + 隐藏分辨率

**Status:** ready-for-agent

- [ ] MJ 卡片属性面板：速度（网关默认 / Fast / Relax / Turbo），不显示分辨率；摘要显示「16:9 · Relax」
- [ ] 请求体只发 `accountFilter.modes`，不改 prompt；prompt 自带 `--fast/--relax/--turbo` 时不发；动作任务不发
- [ ] MJ 请求不再带 resolution

计划：`~/.claude/plans/ok-toasty-milner.md`（分支 `feat/mj-full`）。

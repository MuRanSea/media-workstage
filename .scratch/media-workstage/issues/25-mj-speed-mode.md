# 25: MJ 速度模式 + 隐藏分辨率

**Status:** resolved

- [x] MJ 卡片属性面板：速度（网关默认 / Fast / Relax / Turbo），不显示分辨率；摘要显示「16:9 · Relax」
- [x] 请求体只发 `accountFilter.modes`，不改 prompt；prompt 自带 `--fast/--relax/--turbo` 时不发；动作任务不发
- [x] MJ 请求不再带 resolution

计划：`~/.claude/plans/ok-toasty-milner.md`（分支 `feat/mj-full`）。

## Answer

前端：`SpatialCard.mjSpeed`（`FAST` / `RELAX` / `TURBO`，未设为网关默认）；MJ 卡片属性面板「比例与速度」只有比例和速度，不再显示清晰度；摘要为「3:2 · Relax」；编译时 MJ 只发 `{aspect_ratio, speed?}`；切到其他服务商时清掉 `mjSpeed`。

后端：`genericImageParams.Speed`；imagine 带 `accountFilter: {modes: [SPEED]}`；提示词里已有 `--fast/--relax/--turbo`（含 `—`）时不发，未知速度忽略；提示词从不被改动。动作任务不带 filter（沿用来源通道）。

验证：`TestMidjourneySubmit_SpeedAccountFilter`（5 种情况）、`cardParams.test.ts` +2、`compiler.test.ts` +1；前端 95、Go 全部通过。网关是否真按 `accountFilter` 选账号需在真实网关实测（M1）。

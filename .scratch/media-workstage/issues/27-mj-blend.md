# 27: MJ Blend 多图混合

**Blocked by:** 26

**Status:** resolved

- [x] 参考图 ≥2 张时可切到 Blend；2–5 张校验
- [x] `POST /mj/submit/blend {botType, base64Array, dimensions}`，比例映射 SQUARE / PORTRAIT / LANDSCAPE

计划：`~/.claude/plans/ok-toasty-milner.md`（分支 `feat/mj-full`）。

## Answer

前端：`SpatialCard.mjOperation`（`imagine` 默认 / `blend`）；MJ 属性面板「参考图」区块里切换「提示词生图 / Blend 混合」（不足 2 张时 Blend 不可选）；Blend 时卡片不显示提示词输入，改为说明；摘要「Blend · 1:1」；编译为 `task_mode: blend`，校验 2–5 张，提示词为空时记录为 "Blend"；切走 MJ 时一并清掉。

后端：`submitBlend` → `/mj/submit/blend {botType, base64Array, dimensions, accountFilter?}`，不发 prompt；`midjourneyDimensions`：方 → SQUARE，竖 → PORTRAIT，横 → LANDSCAPE，无效比例按 SQUARE；张数不对报错。

验证：`TestMidjourneySubmitBlend`；`compiler.test.ts` +2、`cardParams.test.ts` 断言补充；前端 102、Go 全部通过。

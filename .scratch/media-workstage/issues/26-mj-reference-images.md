# 26: MJ 垫图（参考图生图）

**Blocked by:** 25

**Status:** resolved

- [x] 图片卡可以连线到 MJ 图片卡作为参考图（最多 5 张），Seedream 等其他图片卡仍拒绝
- [x] 后端把本地参考图转 data URI 放入 imagine 的 `base64Array`；单张超过 4MB 或只有远程 URL 时给出明确错误
- [x] 切换到非 MJ 服务商时清掉参考图；属性面板显示参考图列表

计划：`~/.claude/plans/ok-toasty-milner.md`（分支 `feat/mj-full`）。

## Answer

前端：`connectCards` 对 Midjourney 图片卡放开 image → image（`attachImageToMidjourney`：非派生卡、不重复、最多 `MJ_MAX_REFERENCES = 5`，不给提示词加 `@图N`）；其他图片卡仍拒绝（提示「只有 Midjourney 图片卡片支持连入参考图」）。MJ 编译带 `reference_assets`（复用 `videoCompiler.resolveReferenceAsset`，未按计划挪到新文件——它已被多处引用，搬移只增加改动）；`compileCardImagePayload(card, allCards)`。切到非 MJ 服务商时清掉 `mjSpeed` 与 `references`（`midjourneyOnlyReset`）。参考图列表抽成 `inspector/ReferenceList.tsx`，视频卡与 MJ 图片卡共用。

后端：`parseReferenceAssets`；`midjourneyBase64Array` 优先读本地文件（Discord 链接会过期）、接受 data URI，只有远程 URL 时报「没有本地文件」；超过 5 张或单张超过 4MB 报明确错误；imagine 带 `base64Array`。

验证：`connections.test.ts` +3、`compiler.test.ts` +1、`cardParams.test.ts` +1；`TestMidjourneySubmit_ReferenceImages` / `_ReferenceImageLimits`；`TestMidjourneyReferenceImages_EndToEnd`。前端 100、Go 全部通过。

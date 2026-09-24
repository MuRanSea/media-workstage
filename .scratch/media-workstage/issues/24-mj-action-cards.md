# 24: 前端：按钮条与派生卡

**Blocked by:** 22, 23

**Status:** resolved

- [x] 成功且带按钮的 MJ 图片卡显示按钮条（U 行 / V 行 / 其他；空 label 的 🔄 显示「重绘」）
- [x] 点击后在原卡右侧新建派生卡（标题如「图片 7 · U2」，`derivedFrom` 记录来源卡与来源任务），可撤销，并立即生成
- [x] 派生卡与来源卡之间显示连线，标注动作名
- [x] 派生卡属性面板隐藏比例 / 速度 / 参考图，显示来源

计划：`~/.claude/plans/ok-toasty-milner.md`（分支 `feat/mj-full`）。

## Answer

类型：`TaskActionDto`、`DerivedFrom{cardId, taskId, actionId, label, operation}`，`SpatialCard.resultActions` / `derivedFrom`；`BackendTaskResponse.result_actions` / `result_text`。`applyTaskToCard` 成功时以新结果的按钮替换旧按钮，文本卡写入 `result_text`。复制卡片丢弃结果时一并丢掉 `resultActions`，保留 `derivedFrom`。

`engine/mjActions.ts`：`actionLabel`（🔄 → 「重绘」）、`groupActions`、`spawnActionCard`（原卡右侧 80px，同源派生卡依次错开 40px，沿用服务商/模型/比例，提示词取来源卡的有效提示词）。`compileCardImagePayload` 对派生动作卡输出 `task_mode: action` + `{source_task_id, action_id}`。

UI：图片卡成功且有按钮时显示按钮条（U 行、V 行、其他），同一动作的派生卡生成中时该按钮禁用；点击后新建派生卡（一次撤销步骤）并立即生成——`handleTriggerGenerate(cardId, card?)` + `cardsRef` 解决同一帧新卡找不到的问题。派生连线为紫色虚线、标注动作名、不可断开。属性面板对派生卡只显示来源说明与请求 JSON。

验证：`mjActions.test.ts`（6）、`projectDoc.test.ts` +2、`cardFactory.test.ts` +1、`compiler.test.ts` +1；前端 92 个单测、`tsc` 通过。界面走查放到全部工单完成后统一进行。

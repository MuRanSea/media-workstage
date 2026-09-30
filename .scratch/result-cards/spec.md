# Spec: 生成卡与结果卡（生成结果独立成卡）

Status: ready-for-agent

术语见 [CONTEXT.md](../../CONTEXT.md)（生成卡、结果卡、TaskAsset、MediaTask），决策依据见 [docs/adr/0005-generation-and-result-cards.md](../../docs/adr/0005-generation-and-result-cards.md)。本 spec 只改前端，后端不动。

## Problem Statement

创作者反复生成图片、视频和文本时，每张卡只能保存一个结果：再点「重新生成」就把上一次结果覆盖掉，没法对比、挑选，也没法把某一次满意的结果留下来。

结果也不能像素材一样被下游稳定引用。视频卡引用图片时，只在连线的瞬间快照当时的图片地址；图片重新生成之后，视频卡引用的仍然是旧图，创作者完全看不出来。

一次任务产出多个资产时（Seedream 图层拆分、连环组图），结果都塞在同一张卡里，要靠手动点「展开」才变成画布上的卡片，而且展开出来的卡与原卡之间没有连线，看不出谁来自谁。

## Solution

把「配置一次生成」和「生成出来的东西」拆成两种卡：

- **生成卡**只保存提示词、模型和参数，可以无限次点击「生成」，自己不保存输出。
- **结果卡**恰好保存一个产出（一张图、一段视频或一段文本），自动出现在生成卡右侧，并用一条连线连到生成卡。结果卡就像一张上传的素材：可以被下游卡连线复用，可以留着、对比、删除。
- 一张生成卡可以对应很多张结果卡，靠连线关联。图片、视频、文本（LLM）三类一样。
- 一次任务产出多个资产，就一个资产一张结果卡。
- 旧工程打开时自动迁移成新模型，创作者不需要做任何事。

## User Stories

生成与结果卡：

1. As a creator, I want every generation to leave behind its own result card, so that a new run never overwrites an earlier result.
2. As a creator, I want the result card to appear to the right of the generation card as soon as the task is accepted, so that I can see that my run has started.
3. As a creator, I want the result card to show the task's progress while it is running, so that I know how long to wait.
4. As a creator, I want a result card that fails to keep the error message, so that I can understand what went wrong.
5. As a creator, I want a line drawn from the generation card to each of its result cards, so that I can see which generation produced which result.
6. As a creator, I want to click Generate on the same generation card many times in a row, so that I can quickly try several variations.
7. As a creator, I want several runs of one generation card to be able to run at the same time, each with its own result card, so that I do not have to wait for one to finish.
8. As a creator, I want the generate button to always say "Generate" rather than "Regenerate", so that it is clear that a new result will be added rather than the old one replaced.
9. As a creator, I want the generation card to show how many runs are in progress, so that I know something is still running even when I scroll away.
10. As a creator, I want the generation card to be compact and show only the prompt, model and parameters, so that the canvas is not cluttered with duplicate previews.
11. As a creator, I want errors that happen before the task is accepted (missing prompt, invalid parameters, network error, provider refusal) to show on the generation card without creating a result card, so that my canvas does not fill up with empty failed cards.
12. As a creator, I want a failed result card to be deletable, so that I can clean up and then press Generate again.

多产出任务：

13. As a creator, I want a Seedream layer decomposition to produce one result card for the base image and one for every layer, so that I can use each layer independently.
14. As a creator, I want a Seedream sequential storyboard to produce one result card per frame in frame order, so that I can pick individual frames.
15. As a creator, I want a Midjourney 2×2 grid to stay one result card, so that the grid is not split unexpectedly.
16. As a creator, I want the manual "unpack layers" and "unpack storyboard" buttons to go away, so that there is one consistent way outputs become cards.
17. As a creator, I want multi-output result cards to be arranged in a tidy grid, so that up to 17 new cards do not pile on top of each other.
18. As a creator, I want to select many result cards with a box and delete them together, so that I can throw away the layers I do not need.

文本（LLM）：

19. As a creator, I want each prompt-assistant run to add a text result card, so that I keep every version of generated text.
20. As a creator, I want to edit the text in a text result card, so that I can fix up the model's answer before using it as a prompt.
21. As a creator, I want to see that a prompt-assistant run is in progress on the generation card, so that I know a text result is on its way.
22. As a creator, I want a failed text run to show its error on the generation card, so that I can retry without leaving an empty card behind.

复用与连线：

23. As a creator, I want to connect a chosen image result card to a video generation card as a reference, so that the video uses exactly that image.
24. As a creator, I want the video card's reference to stay pointed at that image result even after I generate more images, so that my video is reproducible.
25. As a creator, I want a video generation card to always read the reference image from the result card itself, so that it never uses a stale copy.
26. As a creator, I want to connect a chosen text result card to an image or video generation card as its prompt source, so that the generation uses exactly that text.
27. As a creator, I want a clear message when the linked text result card is empty or still running, so that I do not accidentally generate with the wrong prompt.
28. As a creator, I want only result cards to have an output port, so that it is obvious what can be connected downstream.
29. As a creator, I want result cards to have no input port, so that I cannot accidentally wire something into a finished result.
30. As a creator, I want video result cards to have no output port for now, so that I am not offered a connection nothing accepts.
31. As a creator, I want image result cards to carry the `@图N` tag, so that I can keep referencing them in video prompts.
32. As a creator, I want generation cards not to show an `@图N` tag, so that tags always mean "an image I can reference".
33. As a creator, I want new tags to keep counting up and never repeat, so that older prompts never point at the wrong image.

参数快照：

34. As a creator, I want each result card to remember the prompt, provider, model and key parameters it was generated with, so that I still know how it was made after I change the generation card.
35. As a creator, I want to see that snapshot when I select a result card, so that I can compare results from different settings.
36. As a creator, I want the snapshot to be read-only, so that I cannot accidentally rewrite history.

布局：

37. As a creator, I want result cards to be placed in the first free slot below the generation card's right-hand column, so that new results never land on top of other cards.
38. As a creator, I want existing cards never to be moved automatically, so that my layout stays where I put it.
39. As a creator, I want to drag a result card anywhere without breaking where the next result appears, so that I can organise freely.

删除、复制、撤销：

40. As a creator, I want deleting a generation card to keep its result cards as standalone cards, so that I do not lose results I paid for.
41. As a creator, I want deleting a result card to remove the connections that lead into it, so that no downstream card keeps pointing at something that is gone.
42. As a creator, I want deleting a still-running result card to just remove the card, so that I can dismiss a run I no longer want.
43. As a creator, I want undo to revert only my own edits and never delete a result card that a task produced, so that undo cannot throw away work already paid for.
44. As a creator, I want deleting a result card to be undoable, so that I can recover from a mistaken delete.
45. As a creator, I want copying a generation card not to copy its results unless I also selected them, so that I can clone settings cheaply.
46. As a creator, I want copying a generation card together with its results to keep the connections between the copies, so that the copied group behaves like the original.
47. As a creator, I want a lone copied result card to become a standalone card, so that it can still be reused as material.
48. As a creator, I want running result cards not to be copyable, so that the copy does not receive progress updates meant for the original.

旧工程迁移：

49. As a creator with existing projects, I want them to open normally with their old results intact, so that I lose nothing when the app updates.
50. As a creator with existing projects, I want each old card that held a result to be split into a generation card and result card(s) automatically, so that I do not migrate by hand.
51. As a creator with existing projects, I want my old `@图3` references in video prompts to keep pointing at the same image, so that old videos can still be regenerated.
52. As a creator with existing projects, I want opening a project twice to give the same result as opening it once, so that migration never duplicates cards.
53. As a creator with existing projects, I want tasks that were still running when I closed the project to continue as running result cards, so that they finish normally.
54. As a creator with existing projects, I want old cards that came from "unpack layers" or "unpack storyboard" to become standalone result cards without duplicates, so that my canvas stays the same.
55. As a creator with existing projects, I want old video cards whose reference image never finished to stay valid, so that the project still opens cleanly.

## Implementation Decisions

**卡片数据模型（`SpatialCard`）**
- 新增显式角色字段，取值「生成卡」或「结果卡」。卡片 `type` 仍是 `image | video | text`。角色不由「是否有来源」推断，因为来源被删的结果卡和将来的上传卡都没有来源。缺少角色字段的卡片就是旧工程卡片，交给迁移处理。
- 结果卡新增来源字段（指向生成卡的 id，可为空）和只读的参数快照（提示词、服务商、模型、关键参数、seed）。
- 结果卡持有恰好一个产出：一个 `TaskAsset`（文本结果卡则持有文本）。已有的按 `TaskAsset` 种类挑选展示资产的逻辑保持可用。
- `tagIndex` 变为可选：只有图片结果卡分配，取全局最大值加一。
- 生成卡不再写入 `taskId`、`resultUrl`、`outputAssets`、`progress`、`errorMessage` 和运行状态；生成卡的「N 个生成中」由指向它的、处于排队或运行中的结果卡计数，文本运行是同步接口，没有占位卡，其进行中的次数记在不落盘的临时状态里。

**生成流程**
- 提交前的校验和提交本身失败，只把错误显示在生成卡上，不建结果卡。
- 后端返回任务并给出 `taskId` 后，立刻在生成卡右侧建一张占位结果卡（带 `taskId`、排队状态、参数快照），随后用最近已知的任务状态（缓冲的 SSE 事件或一次拉取）对账，处理任务在占位卡建立之前就已完成的情况。
- SSE 与打开工程时的补齐只更新按 `taskId` 匹配到的结果卡；找不到匹配卡的事件忽略，任务照常在后台完成并落盘。
- 任务成功后，占位卡变成第一个资产的结果卡，其余资产依次新建。资产顺序：底图在前，图层按 `z_index`，分镜帧按 `asset_index`。额外结果卡的 id 由 `taskId` 与资产序号派生，因此 SSE 与补齐重复送达同一个终态时是幂等的，不会重复建卡。
- 失败、取消、过期的任务保留在占位结果卡上并显示错误，用户可以删除。没有重试按钮，也没有「还原参数到生成卡」。
- 文本生成返回后直接建文本结果卡，内容可手动编辑；图片与视频结果卡不可变。
- 生成按钮只在「请求正在发出」的瞬间禁用，防止双击重复提交；不设并发上限，限流交给后端已有的令牌桶。
- 移除「展开图层」「展开分镜」两个动作及其实现。

**连线规则（`connectCards` 与端口）**
- 只有图片结果卡和文本结果卡有输出端口；生成卡没有输出端口；视频结果卡暂时也没有。
- 结果卡没有输入端口；图片和视频生成卡保留输入端口。
- 文本结果卡可作为图片或视频生成卡的提示词来源；图片结果卡可作为视频生成卡的参考图。图片结果卡到图片生成卡、文本卡之间的连线继续不支持。
- 提示词来源与参考图都固定指向某一张具体的结果卡。所连文本结果卡为空或仍在运行时，生成给出明确提示，不静默使用旧提示词。
- 参考图从所指的图片结果卡上读取资产，不再使用连线时保存的地址快照，该快照字段弃用。
- 生成卡到结果卡的连线由结果卡的来源字段推导，画法与现有连线一致，只是不可手动拖出或拖断；删除结果卡或把它变成独立卡是解除它的唯一方式。

**布局**
- 结果卡落在生成卡右侧一列；从生成卡顶部起向下，取第一个不与任何卡重叠的位置。多产出任务按网格排布，分列数由资产数决定。
- 布局需要每张卡的渲染高度，图片与视频卡的预览高度已按媒体宽高比确定，未知高度时用估计值。
- 绝不自动挪动已有卡片。落点只依赖「哪里有空位」，与用户拖动结果卡的历史无关。
- 结果卡标题默认为「生成卡标题 + 结果序号」。

**删除、复制、撤销**
- 删除生成卡：它的结果卡保留，来源字段清空，变成独立结果卡。
- 删除结果卡：指向它的提示词来源和参考图一并清除（沿用现有清理逻辑）。删除仍在运行的占位卡只是删卡，任务照跑，产物仍下载到工程文件夹，因为后端没有取消接口。
- 复制沿用「连线只在两端都被复制时才保留并重映射」；复制生成卡不带走其结果卡；单独复制结果卡得到独立结果卡；处于排队或运行中的占位卡不可复制。
- 撤销只回退用户的手动编辑：恢复快照后，把快照之后由任务产生的结果卡并回来；用户主动删除结果卡可以撤销，撤销后带着原来的 `taskId` 回来。

**旧工程迁移（在打开工程时的卡片规范化步骤中完成）**
- 判定条件：卡片没有角色字段。迁移是纯函数，重复执行结果一致，下次自动保存即落盘。
- 有结果或有进行中任务的旧图片/视频卡：原卡保留原 id、位置、标题和参数，成为生成卡（清空任务字段、状态归零）；为每个资产生成一张结果卡，id 由原卡 id 与资产派生，按上述布局规则落位。进行中的任务变成占位结果卡并沿用 `taskId`。
- 旧文本卡有非空输出：原卡成为生成卡，输出成为一张文本结果卡。
- 从未运行过的旧卡：直接成为生成卡。
- 旧图片卡的 `@图N` 编号让给它迁移出的结果卡（多资产时底图沿用，其余按全局最大值加一依次分配），生成卡不再持有编号。
- 旧 `references` 的卡片 id 与旧 `promptSourceId` 重指向迁移出的结果卡；所指旧卡没有任何结果时，该连线直接清除（原本就无法生成）。
- 旧的「展开」产物（有结果、没有 `taskId`、id 带有图层或分镜前缀）：原位转为没有来源的结果卡；若其父卡的资产恰好就是这些卡，则把它们连到迁移出的生成卡，且不重复建卡。
- 旧的失败卡：有 `taskId` 的变成失败的结果卡；没有 `taskId` 的（提交阶段的失败）清回空闲状态，不留错误。

**界面**
- 生成卡：不再有大预览区，只有提示词、模型、参数抽屉和「生成」按钮，显示「N 个生成中」。
- 结果卡：图片与视频卡面是预览；文本卡面是可编辑文本；均显示生成中进度或失败错误。
- 检查器：选中结果卡显示只读参数快照与开发用 JSON，没有参数编辑控件。
- 新建卡片的入口（双击、右键、快捷菜单）只创建生成卡；右键「生成」只对生成卡有效。
- 服务商被删除（沿用既有处理）时，只有生成卡显示「服务商已不存在」并禁用生成；结果卡不受影响。

**后端**
- 不改。`project.json` 中的卡片对后端不透明；工程封面取第一张有本地结果的图片卡，结果卡满足；工程列表的卡片计数按 `type` 统计，会同时算入生成卡和结果卡，接受这一点。

## Testing Decisions

- **好测试的标准**：只断言外部可见的行为，即「输入的卡片列表（加任务快照或用户操作）→ 输出的卡片列表」，不断言内部函数如何拆分或私有字段；用「结果卡出现在哪、连到谁、状态是什么」来表达期望，而不是检查实现细节。
- **唯一接缝**：引擎层「卡片列表进、卡片列表出」的纯函数，用 vitest 断言，沿用现有做法。页面按钮、卡面和 SSE 接线只做薄封装，不单独测试，靠最后用真实程序走查。
- **要覆盖的行为**：
  - 任务被接受后建占位结果卡，字段与快照正确；
  - 任务终态回填（成功、失败、取消、过期），重复送达同一终态是幂等的；
  - 多产出任务扩出更多结果卡，顺序正确；
  - 落点布局：第一个空位、不重叠、不移动已有卡、拖走结果卡不影响后续；
  - 连线规则：端口、允许与拒绝的组合、提示词来源为空或运行中时的报错、参考图从结果卡读取资产；
  - 删除、复制（含占位卡不可复制）、撤销时保留任务产生的卡；
  - 旧工程迁移：各类旧卡（有结果、进行中、失败、未运行、文本、展开产物、多资产、引用悬空）、`@图N` 编号继承、连线重指向、重复执行幂等。
- **先例**：`connections.test.ts`（连线规则）、`projectDoc.test.ts`（工程规范化与补齐）、`cardFactory.test.ts`（创建与复制）、`layout.test.ts`（排布）、`expansion.test.ts`（旧的展开逻辑，随功能移除，其用例转化为多产出任务的用例）。
- 后端没有改动，不新增 Go 测试。

## Out of Scope

- 上传卡（结果卡的「无来源」表亲）。数据模型已为它留好位置，但不在本 spec 内做。
- 图片结果卡连到图片生成卡（参考图生图）；文本卡之间的连线。
- 视频结果卡作为参考视频（Seedance 的 `reference_video`），因此视频结果卡暂无输出端口。
- 取消后端任务的能力，以及删除占位卡时取消任务。
- 失败结果卡的重试，以及把参数快照「还原」回生成卡。
- 生成并发上限；工程列表上更精确的卡片计数。
- 下游连线「永远取最新结果」的模式：下游只固定引用具体结果。

## Further Notes

- **从对话推导出、未单独讨论的迁移细节**（可在拆票前否决）：旧的展开产物原位转为无来源结果卡并避免重复；旧失败卡按有无 `taskId` 区分处理；所指旧卡没有结果的旧连线直接清除。
- 已迁移的工程用旧版本应用打开时，会把结果卡当作普通卡片，无法回退；这是 ADR 0005 已接受的代价。
- 提示词助手重新生成后，下游要把提示词线改接到新的文本结果卡，这是「固定引用」带来的取舍，已在 ADR 0005 记录。
- 本 spec 的票据放在 `.scratch/result-cards/issues/`，从 `01` 开始编号，与 `media-workstage` 那一批互不影响。

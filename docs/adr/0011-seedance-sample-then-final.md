# ADR 0011: Seedance 2.5 样片与正式视频是两个独立任务

## 上下文 (Context)
Heighliner 网关为 `doubao-seedance-2-5-260628` 提供样片（draft）流程：`provider_options.volcengine.draft: true` 且显式 `480p` 先出一条便宜的样片；确认后再提交第二个任务，只带 `draft_task_id`（网关的任务 ID）和显式 `1080p`，提示词、参考素材、时长、比例、种子、音频都从样片继承，重传会返回 400。两个阶段各自冻结、结算费用，网关不会在样片完成后自动生成正式视频，样片引用自厂商 `created_at` 起 7 天有效。

模型目录（`GET /media/v1/models`）的 `provider_options_schema` 不一定列出 `draft` / `draft_task_id`，而 ADR 0010 的卡片只发送描述里声明过的字段。

## 决策 (Decision)
- **样片开关在卡片上**：Heighliner 的 Seedance 2.5 视频卡有「样片模式」（`sampleMode`），由模型 ID 决定是否出现，不依赖目录。打开后编译器固定发 `resolution: 480p` 和 `provider_options.volcengine.draft: true`，其余设置照常。`draft` / `draft_task_id` 不进“高级”页的通用控件。
- **正式视频是样片结果卡上的结果操作**（ADR 0006）：适配器在样片成功时（网关返回 `generation_stage: "draft"`，或卡片提交时带了 `draft`）给任务挂上 `finalize` 操作。点「生成正式视频」走既有的“来源任务”通道：服务端校验来源任务属于同一服务商、工程、已成功并提供过该操作，然后把网关任务 ID 填进 `source_provider_task_id`；适配器只发 `model`、`resolution`（默认 1080p）、`draft_task_id` 以及 `watermark` / `return_last_frame`，新任务用自己的 `Idempotency-Key`，因为每次显式提交都是独立生成。
- **正式视频落在样片旁边的新结果卡**，连线指向样片卡，不再是样片。同一条样片可以多次转正式。

## 结果与影响 (Consequences)
- 样片过期（7 天）或原素材被删后，网关返回的 400 原样显示；本地不记时、不预判。
- 正式视频的分辨率固定 1080p（网关要求显式），暂不提供其他档位。
- 同时修正了任务“成功但产物为空且 `error.code = provider_unavailable`”的处理：这是结果暂时读不到，继续轮询同一个任务，不当作失败，也不重新生成。

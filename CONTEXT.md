# Domain Glossary (CONTEXT.md)

This file is the canonical domain model glossary for `media-workstage`. Use these exact terms across code, issues, tickets, and architecture documentation.

---

### Core Concepts

- **CanvasWorkspace (画布工作区)**:
  The top-level interactive infinite spatial canvas containing cards, connections, viewport transform matrix (`zoom`, `panX`, `panY`), and active user selections.

- **SpatialCanvasEngine (空间画布引擎)**:
  The lightweight, zero-dependency canvas transform engine implementing cursor-anchored scaling ($w = (s - \text{pan}_1) / z_1$, $\text{pan}_2 = s - w \cdot z_2$) and fluid multi-ray bezier curve rendering between cards.

- **MediaCardNode (媒体卡片节点)**:
  A visual card on the canvas representing an atomic media generation or transformation unit (Image Generation Card, Video Generation Card). Contains large visual preview, compact summary pill, and collapsible parameter drawers.

- **MediaTask (媒体生成任务)**:
  An asynchronous generation job managed by the local Go backend. Every task transitions through a strictly defined lifecycle state machine (`Queued` → `Running` → `Succeeded` / `Failed` / `Cancelled` / `Expired`).

- **ProviderAdapter (服务商适配器)**:
  The architectural boundary seam that isolates third-party API contracts (Volcengine Ark, MiniMax). Translates generic `MediaTaskRequest` into provider-specific payloads and normalizes polling responses.

- **ArkAdapter (火山方舟适配器)**:
  The concrete provider adapter for Volcengine Ark native APIs (Seedance 2.5/2.0 video generation, Seedream 5.0 image generation).

- **MiniMaxAdapter (海螺适配器)**:
  The concrete provider adapter for MiniMax official video generation APIs (MiniMax-H3, Video-01).

- **LocalAssetStore (本地资产库)**:
  The local filesystem repository responsible for caching uploaded reference assets, downloading finished generation outputs, and serving them via local HTTP endpoints.

- **TaskPoller (任务轮询调度器)**:
  The backend worker pool that queries cloud provider task status endpoints at configured intervals until a terminal state is reached.

---

### Video Task Validation Rules (Ark 5.1 & MiniMax Contract)

1. **3 种互斥场景 (Mutually Exclusive Modes)**:
   - **All-Modal Reference (`all_modal`)**:
     - Supported inputs: 0–30 reference images (`reference_image`), 0–10 videos (`reference_video`), 0–10 audios (`reference_audio`).
     - Frame role assignment: Handled via natural language in Prompt (e.g., `以图1为首帧与主体，图2为背景`).
   - **Strict First & Last Frame (`first_last_frame`)**:
     - Supported inputs: Exactly 1 image (`first_frame`) or 2 images (`first_frame` + `last_frame`).
     - `ratio` parameter must be forced to `adaptive`.
   - **Text-to-Video (`text_to_video`)**:
     - Pure text prompt without reference assets.

2. **Model Capabilities Matrix**:
   - `Seedance 2.5`: Resolutions `480p`, `720p` (default), `1080p` (10-bit H.265); Duration `[4, 30]s` or `-1` (adaptive); Max refs: 30; Audio & MOV support.
   - `Seedance 2.0 Pro`: Resolutions `480p`, `720p`, `1080p`, `4k`; Duration `[4, 15]s` or `-1`; Max refs: 9.
   - `MiniMax-H3`: Resolutions `720P`, `1080P`, `2K`; Duration `5s`, `6s`, `10s`, `15s`; Max refs: 2.
   - `Video-01`: Resolutions `720P`, `1080P`; Duration `6s`.

---

### Image Task Validation Rules (Ark 6.1 Seedream 5.0 Series)

1. **尺寸配置方式互斥规则**:
   - **方式 1（档位预设）**: 指定档位（5.0 Pro: `1K`/`1.5K`/`2K`/`auto`; 5.0 Lite: `2K`/`3K`/`4K`），由 Prompt 自然语言描述宽高比，模型自动映射对应标准像素。
   - **方式 2（显式宽高像素）**: 显式传入 `<width>x<height>` 字符串。
     - 5.0 Pro: 总像素严格限制在 `[921600, 4624220]`，宽高比 `[1/16, 16]`。
     - 5.0 Lite: 总像素严格限制在 `[3686400, 16777216]`，宽高比 `[1/16, 16]`。

2. **特性支持差异**:
   - 5.0 Pro 独占：图层拆分（`layer_decomposition: true`，产出 1 底图 + 最多 16 个带 bounding box 的透明 PNG 图层）。
   - 5.0 Lite 独占：连续组图连环画分镜（`sequential_image_generation: "auto"`，最多 15 张）。

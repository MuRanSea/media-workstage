# Domain Glossary (CONTEXT.md)

This file is the canonical domain model glossary for `media-workstage`. Use these exact terms across code, issues, tickets, and architecture documentation.

---

### Core Concepts

- **Project (工程)**:
  A self-contained folder on disk under the projects root (`./projects` by default) holding one `CanvasWorkspace` (`project.json`: cards + viewport + revision) and the `TaskAsset` files its tasks produced (`assets/`). Card media paths are relative to the project folder, so a project can be copied or moved as a unit. `MediaTask.project_id` links a task to the project whose folder receives its outputs. See ADR 0003.

- **CanvasWorkspace (画布工作区)**:
  The top-level interactive infinite spatial canvas containing cards, connections, viewport transform matrix (`zoom`, `panX`, `panY`), and active user selections.

- **SpatialCanvasEngine (空间画布引擎)**:
  The lightweight, zero-dependency canvas transform engine implementing cursor-anchored scaling ($w = (s - \text{pan}_1) / z_1$, $\text{pan}_2 = s - w \cdot z_2$) and fluid multi-ray bezier curve rendering between cards.

- **MediaCardNode (媒体卡片节点)**:
  A visual card on the canvas representing an atomic media generation or transformation unit (Image Generation Card, Video Generation Card). Contains large visual preview, compact summary pill, and collapsible parameter drawers.

- **MediaTask (媒体生成任务)**:
  An asynchronous generation job managed by the local Go backend (`media_tasks` table). Transitions through `Queued` → `Running` → `Succeeded` / `Failed` / `Cancelled` / `Expired`. Tracks token usage (`usage_tokens`) and billing metadata (`billing_details_json`).

- **TaskAsset (任务产出资产)**:
  A granular output item produced by a `MediaTask` (`task_assets` table). Accommodates single outputs as well as multi-asset outputs:
  - Base Image & Transparent PNG Layers (up to 16 layers with `z_index` and `bounding_box_json` from Seedream 5.0 Pro layer decomposition).
  - Storyboard Image Sequences (up to 15 images from Seedream 5.0 Lite sequential generation).
  - Video File & Output Frame Snapshots.

- **Provider (服务商)**:
  One configured connection the user generates through: a stable ID, a renameable display name, a base URL, a credential and the models bound to it. Every Provider speaks exactly one `Protocol`; several Providers may share a Protocol and offer the same model, told apart by display name. Cards and tasks reference a Provider by its ID. See ADR 0004.
  _Avoid_: channel, 渠道

- **Preset Provider (预置服务商)**:
  A Provider that ships with the app (火山方舟, MiniMax, OpenAI, …) under a fixed legacy ID. It can be renamed and have its credential cleared, but never deleted. User-added Providers are **Custom Providers (自定义服务商)** and can be deleted.

- **Protocol (接入协议)**:
  The API dialect a Provider speaks (Ark native, MiniMax, OpenAI-compatible, Gemini, APIMart, MJ Proxy). Determines which `ProviderAdapter` serves the Provider and which card kinds it can run.
  _Avoid_: provider type, vendor

- **ProviderAdapter (服务商适配器)**:
  The architectural boundary seam that isolates one `Protocol`'s third-party API contract. Translates generic `MediaTaskRequest` into protocol-specific payloads and normalizes polling responses; each Provider gets its own adapter instance.

- **ArkAdapter (火山方舟适配器)**:
  The concrete provider adapter for Volcengine Ark native APIs (Seedance 2.5/2.0 video generation, Seedream 5.0 image generation).

- **MiniMaxAdapter (海螺适配器)**:
  The concrete provider adapter for MiniMax official video generation APIs (MiniMax-H3, Video-01).

- **MidjourneyAdapter (Midjourney 适配器)**:
  The concrete provider adapter for the MJ Proxy protocol (midjourney-proxy's `/mj` API, spoken by self-hosted proxies and new-api style relays). Dispatches on task mode: imagine (the 2×2 grid kept as one image; the card's aspect ratio becomes `--ar` unless the prompt sets its own; connected images go inline as reference images), `action` (a `Result action`), `blend` (2–5 images) and `describe` (prompts as a text result). The card's speed mode is sent as the proxy's `accountFilter.modes`, never added to the prompt.

- **Bot type (MJ 机器人类型)**:
  What an MJ Proxy Provider binds as its models: `MID_JOURNEY` or `NIJI_JOURNEY`, sent as the request's `botType`. Relays like new-api list billing model names (`mj_imagine`) instead; those send no `botType`, leaving the proxy's default.
  _Avoid_: MJ model version (`--v` / `--niji` stay prompt parameters)

- **Result action (结果动作)**:
  A follow-up a provider offers on a finished task's result, such as Midjourney's U1–U4 / V1–V4 / reroll buttons. Stored on the task (`result_actions`) with the provider's own ID; running one creates a new task whose params name the source task and the action, and the server checks the source task offered it.

- **Derived card (派生卡)**:
  A card created by running an operation on another card's result — a `Result action` (an image card) or Midjourney Describe (a text card). It records its source card and source task (`derivedFrom`), is linked to the source by a labelled line, and keeps the source's provider and settings.
  _Avoid_: child card, copy (a copy is "复制一份" and runs the same settings from scratch)

- **LocalAssetStore (本地资产库)**:
  The local filesystem repository responsible for caching uploaded reference assets, downloading finished generation outputs, and serving them via local HTTP endpoints.

- **TaskPoller (任务轮询调度器)**:
  The backend worker pool that queries cloud provider task status endpoints at configured intervals until a terminal state is reached, featuring smart backoff, IPM rate-limiting protection, and startup recovery.

- **SyncEvent (同步事件)**:
  Real-time state broadcast pushed from the backend to the frontend canvas via SSE (`GET /api/tasks/events`).

---

### Billing & Rate Limiting Rules (Ark & MiniMax Contract)

1. **IPM (Images Per Minute) & Concurrency Throttling**:
   - Ark enforces strict account-level IPM limits per model version.
   - **Layer Decomposition Pre-deduction**: Seedream 5.0 Pro layer decomposition pre-deducts **17 IPM** upon task submission, refunded/adjusted post-generation based on actual layer count.
   - Local Poller maintains a local token bucket limiter to prevent triggering cloud QPS/IPM rejection.

2. **Video Generation Metering**:
   - Seedance 2.5/2.0 billing is metered by resolution, output duration, and token usage (`completion_tokens`).
   - For adaptive duration (`duration: -1`), billed duration is calculated based on returned total frames (`frames / 24`).
   - When input includes reference video, minimum token threshold constraints apply.

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

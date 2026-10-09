# Domain Glossary (CONTEXT.md)

This file is the canonical domain model glossary for `media-workstage`. Use these exact terms across code, issues, tickets, and architecture documentation.

---

### Core Concepts

- **Project (工程)**:
  A self-contained folder on disk under the projects root (`./projects` by default) holding one `CanvasWorkspace` (`project.json`: cards + viewport + revision) and the `TaskAsset` files its tasks produced (`assets/`). Card media paths are relative to the project folder, so a project can be copied or moved as a unit. `MediaTask.project_id` links a task to the project whose folder receives its outputs. See ADR 0003.

- **Projects Root (工程目录)**:
  The folder holding every Project, one subfolder each. In the desktop app it is chosen in settings; changing it only switches where the app looks and never moves existing Projects.
  _Avoid_: 工程根目录, workspace dir

- **Data Directory (数据目录)**:
  The folder holding the app's own data that belongs to no Project: the database (Providers, tasks, settings) and outputs of tasks run outside a Project. Chosen in settings in the desktop app; changing it, like the Projects Root, moves nothing.
  _Avoid_: 应用目录, app data

- **Desktop mode / Browser mode (桌面模式 / 浏览器模式)**:
  The two ways the workstage is launched: as the installed desktop app in its own window, or as the standalone backend opened in a web browser. Same UI and data model; only the desktop mode lets the user choose the Projects Root and Data Directory in settings. See ADR 0007.

- **CanvasWorkspace (画布工作区)**:
  The top-level interactive infinite spatial canvas containing cards, connections, viewport transform matrix (`zoom`, `panX`, `panY`), and active user selections.

- **SpatialCanvasEngine (空间画布引擎)**:
  The lightweight, zero-dependency canvas transform engine implementing cursor-anchored scaling ($w = (s - \text{pan}_1) / z_1$, $\text{pan}_2 = s - w \cdot z_2$) and fluid multi-ray bezier curve rendering between cards.

- **MediaCardNode (媒体卡片节点)**:
  Any card on the canvas. Two kinds: a **Generation Card** (where a generation is configured) and a **Result Card** (what a generation produced).

- **Generation Card (生成卡)**:
  A card that holds the prompt, model and parameters of an image, video or text (LLM) generation and can be run any number of times. It holds no output itself: every run yields new Result Cards linked to it.
  _Avoid_: 参数卡

- **Result Card (结果卡)**:
  A card holding exactly one finished output — one image, one video or one text — linked to the Generation Card whose run produced it (or to the Result Card a `Result action` or Midjourney Describe ran on), and the thing other cards connect to and reuse. It appears as soon as the backend accepts the run and shows the run's progress until the output arrives (a text run is synchronous, so its Result Card appears when the text returns). A generation that yields several outputs (layers, storyboard frames) yields one Result Card per output. Image Result Cards carry an `@图N` tag and video Result Cards an `@视频N` tag (one shared counter); text ones carry none. An **Upload Card** is a Result Card with no source. Deleting its Generation Card leaves a Result Card standing on its own, without a source.
  _Avoid_: 素材卡, asset card (collides with `TaskAsset`), 输出卡

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
  The concrete provider adapter for the MJ Proxy protocol (midjourney-proxy's `/mj` API, spoken by self-hosted proxies and new-api style relays). Dispatches on task mode: imagine (the 2×2 grid kept as one image; the card's aspect ratio becomes `--ar` unless the prompt sets its own; connected images go inline as reference images, shrunk to fit the proxy's size limit), `action` (a `Result action`), `blend` (2–5 connected images) and `describe` (an image's prompts, returned as a text Result Card). The card's speed mode is sent as the proxy's `accountFilter.modes`, never added to the prompt.

- **Bot type (MJ 机器人类型)**:
  What an MJ Proxy Provider binds as its models: `MID_JOURNEY` or `NIJI_JOURNEY`, sent as the request's `botType`. Relays like new-api list billing model names (`mj_imagine`) instead; those send no `botType`, leaving the proxy's default.
  _Avoid_: MJ model version (`--v` / `--niji` stay prompt parameters)

- **Upload Card (上传卡片)**:
  A Result Card with no source holding a user-picked image or video (`type: 'upload'`, `mediaKind`). The file is saved into the project (`assets/uploads/`) and can be sent to a Provider's platform for a **Platform Asset ID** (素材库 `asset://<id>`, usable once review turns `Active`, Seedance only) and/or a **File URL** (7-day download link). Wired to a video card it becomes a reference: images as `reference_image` (`@图N`), videos as `reference_video` (`@视频N`, multi-reference mode, on models that take reference videos). A video reference must be uploaded first; images fall back to the saved file. A video Result Card uploads and wires in the same way.

- **Result action (结果动作)**:
  A follow-up a provider offers on a finished task's result, such as Midjourney's U1–U4 / V1–V4 / reroll buttons. Stored on the task (`result_actions`) with the provider's own ID and shown as buttons on the Result Card. Running one submits a new task whose params name the source task and the action (the server checks the source task offered it) and yields a new Result Card sourced from the Result Card it ran on, its line labelled with the action ("U2", "重绘").
  _Avoid_: derived card, 派生卡 (the output is an ordinary Result Card)

- **Asset library reference (素材库参考)**:
  A Seedance video card's reference to an item already in the Ark asset library (素材库 & 虚拟人像库), entered by its asset ID and sent as `asset://<ASSET_ID>` in the image, video or audio slot. Ark protocol and `all_modal` only. The prompt names it by modality and position (`图N`, `视频N`, `音频N`, counted after the connected cards), never by the ID. Files of your own go through an Upload Card instead.
  _Avoid_: asset (alone — collides with `TaskAsset` and `LocalAssetStore`)

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

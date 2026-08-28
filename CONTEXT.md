# Domain Glossary (CONTEXT.md)

This file is the canonical domain model glossary for `media-workstage`. Use these exact terms across code, issues, tickets, and architecture documentation.

---

### Core Concepts

- **CanvasWorkspace (画布工作区)**:
  The top-level interactive infinite canvas containing nodes, cards, connections, viewport state (zoom/pan), and active user selections.

- **MediaCardNode (媒体卡片节点)**:
  A visual node on the canvas representing an atomic media generation or transformation unit (e.g., Text-to-Image, Image-to-Video, Multi-Reference Video, Video Extension).

- **MediaTask (媒体生成任务)**:
  An asynchronous generation job managed by the local backend. Every task transitions through a strictly defined lifecycle state machine (`Queued` → `Running` → `Succeeded` / `Failed` / `Cancelled` / `Expired`).

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

- **SyncEvent (同步事件)**:
  Real-time state broadcast pushed from the backend to the frontend canvas (via SSE or WebSocket) whenever a `MediaTask` updates.

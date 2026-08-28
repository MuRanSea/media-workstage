# Spec: 本地空间无限画布媒体工作台 (Media Workstage)

Status: ready-for-agent

## Problem Statement

现代创作者在使用生成式 AI 制作图像与视频（如火山方舟 Doubao Seedance 2.5/2.0、Seedream 5.0、MiniMax 海螺 H3 等）时，面临分散的网页控制台、复杂的 API 鉴权配置、多图多素材参考难以可视化串联、以及云端生成产物临时链接过期失效等痛点。创作者需要一个纯本地运行、开箱即用、具备现代空间无限画布手感、并能统一调度多模型生成任务的桌面级工作台。

## Solution

构建一个**本地空间无限画布媒体工作台**：
1. **轻量本地服务端**：采用 Go 1.26+ 单二进制架构，内嵌编译好的 React 前端（Single-binary Embedded SPA），纯 Go SQLite 驱动免 CGO 跨平台即开即用。
2. **空间无限画布前端**：自研空间无限画布（Spatial Canvas），实现零漂移光标定点定标缩放、全局素材 `@图N` 自动打标、多图多模态流光射线连接、以及紧凑美观的卡片与全量参数折叠抽屉。
3. **多模型适配层 (ProviderAdapter)**：
   - 原生对接火山方舟（Ark）API：支持 Seedance 2.5/2.0（全模态参考、首尾帧严格、纯文生视频互斥场景）、Seedream 5.0 Pro（1K/1.5K/2K 档位与显式像素互斥、图层拆分）与 Seedream 5.0 Lite（2K/3K/4K 档位、连环组图）。
   - 原生对接 MiniMax 官方 API：支持 MiniMax-H3（2K 高动态、首尾帧）与 Video-01 异步任务。
4. **任务调度、持久化与精准计费**：SQLite 主子表（`media_tasks` + `task_assets`），后台 Goroutine 令牌桶节流轮询器（支持图层拆分 17 IPM 预扣与回退风控），SSE 实时事件推流，以及任务成功后立即流式落盘本地，永久持久化。

---

## User Stories

1. As a creator, I want to launch the media workstage via a single executable binary, so that I don't need to install Node, Python, or complex dependencies.
2. As a creator, I want an infinite spatial canvas that I can pan and zoom fluidly using mouse wheel and trackpad, so that I can freely lay out all my creative assets.
3. As a creator, I want zooming to stay strictly anchored at my mouse cursor position with zero drift, so that the asset I am inspecting remains under my pointer.
4. As a creator, I want standard navigation shortcuts (`0` for Fit View, `1` for 100%, `F` for focus selection, `Space` for hand panning), so that I can navigate large canvases at professional speed.
5. As a creator, I want every generated image on the canvas to display a global `@图N` tag, so that I can easily recognize and reference it across other generation nodes.
6. As a creator, I want to create a Seedream 5.0 Pro image generation card, so that I can generate high-fidelity 2K concept art.
7. As a creator, I want to choose between Method 1 (size tier presets 1K/1.5K/2K) and Method 2 (explicit width x height pixels) on the image card without invalid mixing, so that my request complies with Ark API specifications.
8. As a creator, I want the image card to dynamically display mapped pixel dimensions when selecting aspect ratios, so that I know the exact resolution the model will synthesize.
9. As a creator, I want to enable Layer Decomposition on Seedream 5.0 Pro, so that my single image is decomposed into 1 base image and up to 16 transparent PNG layers on the canvas.
10. As a creator, I want to switch to Seedream 5.0 Lite, so that I can generate sequential storyboards (up to 15 frames) or 4K ultra-detailed images.
11. As a creator, I want to create a Video Generation Card and switch between Seedance 2.5, Seedance 2.0 Pro, MiniMax H3, and Video-01, so that I can leverage the best model for my specific shot.
12. As a creator, I want to switch between All-Modal Reference, Strict First & Last Frame, and Text-to-Video modes on the video card, so that the card strictly enforces the mutual exclusivity rules of the underlying API.
13. As a creator, I want to attach multiple image cards into the video reference pool, so that Seedance 2.5 can ingest up to 30 reference images.
14. As a creator, I want to type `@图1`, `@图2` in the video prompt or click quick-insert pills, so that the model understands which image represents the subject, keyframe, or scene.
15. As a creator, I want visual glowing bezier rays connecting referenced images to the video card with `@图N` badges along the lines, so that data flow is immediately legible.
16. As a creator, I want cards to be compact (~380px) by default with an expandable parameter drawer, so that the canvas is visually pleasing and not cluttered by huge vertical forms.
17. As a creator, I want to inspect the compiled API JSON payload by clicking a `<Code>` button on each card, so that I have full transparency over what is submitted to the cloud API.
18. As a creator, I want tasks to execute asynchronously in the background while I continue editing other canvas cards, so that my workflow is never blocked.
19. As a creator, I want the backend to enforce rate-limiting and handle Seedream's 17 IPM pre-deduction, so that my account is never rejected by cloud API concurrency caps.
20. As a creator, I want the backend to record exact billing details (output duration `output_duration_sec`, token usage `usage_tokens`, generated image counts), so that I have full visibility into my generation costs.
21. As a creator, I want generated video and image files to be automatically downloaded to my local `./assets/` disk upon completion, so that my assets never break when cloud presigned URLs expire.
22. As a creator, I want the local HTTP static server to support RFC 7233 range requests, so that I can scrub video timelines smoothly in the browser.

---

## Implementation Decisions

### 1. Architectural Seams & Boundaries
- **Primary Integration Seam**: `HTTP REST API + SSE Stream (`/api/*`)`
  - All frontend-to-backend communication occurs over standard HTTP endpoints (`POST /api/tasks`, `GET /api/tasks`, `GET /api/tasks/:id/assets`).
  - Real-time updates are streamed over `GET /api/tasks/events` via Server-Sent Events (SSE).
- **Provider Adapter Seam**: `ProviderAdapter` Interface
  - `ArkAdapter`: Implements Volcengine Ark native task creation (`/contents/generations/tasks`), image generation (`/images/generations`), and task polling with Base64 asset compilation.
  - `MiniMaxAdapter`: Implements MiniMax video creation (`/v1/video_generation`), status polling (`/v1/query/video_generation`), and file retrieval (`/v1/files/retrieve`).

### 2. Backend & Runtime Stack
- **Language & Runtime**: Go 1.26+ with Gin framework.
- **Database Engine**: GORM with pure-Go SQLite driver (`github.com/glebarez/sqlite` wrapping `modernc.org/sqlite`).
- **Compilation Guard**: `CGO_ENABLED=0` static compilation with `//go:embed dist/*` for single-binary zero-dependency distribution.

### 3. Database Schema Design (SQLite)
```sql
CREATE TABLE media_tasks (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,          -- 'ark' | 'minimax'
    provider_task_id TEXT,           -- Cloud task ID
    model TEXT NOT NULL,             -- Model identifier
    task_type TEXT NOT NULL,         -- 'video_generation' | 'image_generation'
    task_mode TEXT NOT NULL,         -- 'all_modal' | 'first_last_frame' | 'text_to_video' | 'single' | 'layer_decomp' | 'sequential'
    prompt TEXT NOT NULL,
    params_json TEXT,                -- Serialized parameters (resolution, ratio, duration, audio, size, seed)
    status TEXT NOT NULL,            -- 'queued' -> 'running' -> 'succeeded' | 'failed' | 'cancelled' | 'expired'
    progress INTEGER DEFAULT 0,
    error_code TEXT,
    error_message TEXT,
    usage_tokens INTEGER DEFAULT 0,
    output_duration_sec REAL DEFAULT 0,
    billing_details_json TEXT,       -- Accurate cost and meter logs (pre-deductions, generated counts, frames)
    created_at DATETIME,
    updated_at DATETIME,
    completed_at DATETIME
);

CREATE TABLE task_assets (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES media_tasks(id) ON DELETE CASCADE,
    asset_index INTEGER NOT NULL,
    kind TEXT NOT NULL,              -- 'video' | 'image_base' | 'image_layer' | 'image_frame'
    name TEXT,
    description TEXT,
    z_index INTEGER DEFAULT 0,
    bounding_box_json TEXT,          -- [x, y, w, h] for layer decomposition
    remote_url TEXT,
    local_path TEXT,                 -- Path relative to ./assets/
    file_size_bytes INTEGER DEFAULT 0,
    downloaded_at DATETIME
);
```

### 4. Background Task Poller & Rate Limiter
- **Goroutine Worker Pool**:
  - Independent poller routines managed via Go channels.
  - Image task cadence: 2s initial delay, 2s polling interval, 60s timeout.
  - Video task cadence: 5s initial delay, 6s~8s polling interval, 600s timeout.
- **Startup Recovery**:
  - Scans SQLite on startup for uncompleted tasks (`status IN ('queued', 'running')`) and automatically resumes polling routines.
- **IPM & Concurrency Throttling**:
  - Local token bucket limiter respects account-level IPM limits and accounts for Seedream 5.0 Pro's **17 IPM pre-deduction** per decomposition task.

### 5. Local Asset Store & Streaming Delivery
- **Filesystem Layout**:
  - `./assets/images/{task_id}/`: Contains `base.png`, `layer_manifest.json`, `layer_00..15.png`, `storyboard_00..14.png`.
  - `./assets/videos/{task_id}/`: Contains `output.mp4`, `cover.webp`, `first_frame.png`, `last_frame.png`.
  - `./assets/uploads/{YYYY-MM-DD}/`: Content-addressed user uploads.
- **Gin Static Handler**:
  - Serves `/assets/*filepath` with strict path traversal sanitization, `Accept-Ranges: bytes` RFC 7233 partial content support, and immutable cache headers.

### 6. Frontend Spatial Canvas Engine
- **Atomic Transform Matrix**:
  - Transform state: `{ zoom: number, panX: number, panY: number }`.
  - Cursor-anchored scaling formula: $W = (S - \text{pan}_1) / z_1$, $\text{pan}_2 = S - W \cdot z_2$.
- **Card Aesthetics & Folding Structure**:
  - Default compact height ~380px with dark glassmorphism styling (`#12141e`).
  - Structured Tab drawer: Specs (Resolution/Duration/Ratio/Modes) + Refs (Multi-Image Pool) + Advanced (Audio/Format/Optimizer/Seed).
  - SVG Multi-Ray curved lines with `@图N` connection badges.

---

## Testing Decisions

### 1. What Makes a Good Test
- Tests must verify observable behavioral contracts at external seams, never testing private fields or incidental internal variables.
- All HTTP endpoints, task transitions, and asset ingestion flows must be deterministic, isolated, and safe to run in CI.

### 2. Module Test Boundaries
- **Backend API & SSE End-to-End Suite**:
  - Launch an in-memory Gin HTTP test server against an in-memory SQLite database.
  - Submit mock video and image tasks, verify state machine transitions, SSE event broadcast payload format, and child `task_assets` creation.
- **Provider Adapter Suite**:
  - Unit-test `ArkAdapter` and `MiniMaxAdapter` against recorded HTTP mock fixtures.
  - Verify payload compilation: Ark Base64 content array structure vs MiniMax flat schema, prompt renumbering (`@图N` $\rightarrow$ `图N`), error code extraction, and `output_duration_sec` / `usage_tokens` calculation.
- **Asset Ingestion & Static Server Suite**:
  - Verify range requests (`Accept-Ranges: bytes`, status 206 Partial Content), directory traversal attack rejections, and atomic file downloading.
- **Frontend Canvas Matrix Suite**:
  - Unit-test the cursor-anchored zoom matrix calculation to guarantee zero mathematical drift across extreme zoom factors.

---

## Out of Scope

- Multi-tenant cloud user authentication and billing management (v1 is purely a single-user local workstation).
- ComfyUI-style raw AST node operator compilation and pipeline execution engines.
- Audio-only standalone generation models (audio reference input and video voiceover are in scope).

---

## Further Notes

- Prototype code is preserved on the `prototype/canvas-engine` branch.
- Technical research documents for Ark, MiniMax, and TOS are recorded under `docs/research/`.
- Architecture decisions are recorded under `docs/adr/`.

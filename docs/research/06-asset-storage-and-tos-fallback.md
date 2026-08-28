# Local Asset Storage & Volcengine TOS Fallback Technical Specification

## 1. Directory Structure Hierarchy (Local Filesystem)

The local asset store (`./assets/`) serves as the single source of truth for on-disk media files generated or uploaded during canvas operations.

```
./assets/
├── images/
│   └── {task_id}/                      # UUID-based image generation task directory
│       ├── meta.json                   # Generation params, model, dimensions, prompt, tokens
│       ├── base.png                    # Master base image (single output or decomposition root)
│       ├── layer_manifest.json         # Layer decomposition metadata (Z-index, BoundingBox)
│       ├── layer_00.png                # Transparent layer 0 (Seedream 5.0 Pro)
│       ├── layer_01.png                # Transparent layer 1
│       ├── ...
│       ├── layer_15.png                # Transparent layer 15 (up to 16 layers)
│       ├── storyboard_00.png           # Sequential storyboard frame 0 (Seedream 5.0 Lite)
│       └── storyboard_14.png           # Sequential storyboard frame 14 (up to 15 frames)
│
├── videos/
│   └── {task_id}/                      # UUID-based video generation task directory
│       ├── meta.json                   # Video metadata (resolution, ratio, duration, frames, seed)
│       ├── output.mp4                  # Primary generated video (H.264/H.265 container)
│       ├── cover.webp                  # Generated/extracted poster image for canvas card preview
│       ├── first_frame.png             # First frame snapshot
│       ├── last_frame.png              # Last frame snapshot (if return_last_frame: true)
│       └── audio_track.mp3             # Extracted or standalone audio track (if generated)
│
├── uploads/
│   └── {YYYY-MM-DD}/                   # Date-partitioned reference upload directory
│       └── {sha256_prefix8}_{filename} # Content-addressed uploaded reference assets
│           # e.g., 8f2a1b9c_portrait.png, 4e1c2d3f_motion_ref.mp4, 9b8a7c6e_bgm.wav
│
└── tmp/
    ├── downloads/                      # Scratchpad for streaming cloud downloads
    │   └── {task_id}_{asset_id}.part   # Atomic write buffer before renaming to final destination
    └── tos_checkpoints/                # Resumable multipart upload checkpoint files (*.cp)
```

---

## 2. Static HTTP Server Routing in Go Gin

### Security, Range Requests & Caching Strategy
1. **Security & Path Sanitization**: Strict path sanitization (`filepath.Clean`) preventing directory traversal attacks (`../`).
2. **HTTP Range Requests (`206 Partial Content`)**: Built-in support for `Accept-Ranges: bytes`, essential for smooth timeline scrubbing in HTML5 `<video>` elements and canvas nodes.
3. **Immutable Caching**: Generated task assets (`/assets/images/*`, `/assets/videos/*`) use `Cache-Control: public, max-age=31536000, immutable`. Uploads use `Cache-Control: public, max-age=86400, must-revalidate` with `ETag`.
4. **CORS Headers**: Unrestricted `Access-Control-Allow-Origin: *` to prevent canvas cross-origin tainting when drawing onto `<canvas>` / WebGL textures or decoding with `AudioContext`.

---

## 3. Volcengine TOS Direct Upload & Pre-Signed URL Fallback Mechanism

### Problem Context & Architectural Fit
- **Large Reference Asset Ingestion**: Ark Seedance 2.5 allows up to 10 reference videos (200MB max each), 30 reference images (30MB max each), and 10 audio clips (15MB max each). MiniMax H3 allows up to 20MB reference images.
- **Local Dev vs Cloud Reachability**: In desktop/local environments (`http://localhost:8080`), cloud generation engines cannot access local URLs. The TOS bridge provides public pre-signed GET URLs.
- **Direct Web-to-TOS Upload**: Bypasses local backend disk/network bottlenecks for large video files.

### Go SDK Integration (`github.com/volcengine/ve-tos-golang-sdk/v2/tos`)
- **PreSigned PUT URL**: Browser directly uploads large videos to TOS bucket (`Expires: 1800s`).
- **PreSigned GET URL**: Cloud generation engine (Ark/MiniMax) reads reference asset (`Expires: 7200s`).
- **Resumable Multipart Upload**: Local large files uploaded with checkpointing (`EnableCheckpoint: true`, `PartSize: 20MB`).

---

## 4. Retention & Garbage Collection Policy

| Asset Classification | Storage Location | Retention Policy | GC Trigger |
| :--- | :--- | :--- | :--- |
| **Task Outputs (Images/Videos)** | `./assets/images/{task_id}/`<br>`./assets/videos/{task_id}/` | Retained indefinitely or until LRU threshold exceeded (default: 30 days or 50GB cap) | Cascading Task Deletion / Disk Quota Worker |
| **User Uploads** | `./assets/uploads/{date}/` | 14 days if unreferenced by any task; indefinite if active | Orphan Asset Scanner |
| **Download Chunks (.part)** | `./assets/tmp/downloads/` | 12 hours | Service startup & periodic GC |
| **TOS Upload Checkpoints** | `./assets/tmp/tos_checkpoints/` | 24 hours | Periodic GC |
| **Cloud TOS Storage** | `workstage-uploads/*` | 7 days TTL (Lifecycle rule) | Automated cloud bucket policy |

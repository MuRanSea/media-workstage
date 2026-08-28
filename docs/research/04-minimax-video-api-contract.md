# MiniMax Hailuo Video Generation API Technical Contract & Architecture

## 1. Base URL & Authentication
- **Domestic (China) Base URLs**:
  - Primary: `https://api.minimax.chat/v1` (or `https://api.minimaxi.chat/v1`)
- **Global Base URL**:
  - Primary: `https://api.minimax.io/v1`
- **Headers**:
  - `Authorization: Bearer <MINIMAX_API_KEY>`
  - `Content-Type: application/json`

---

## 2. Model Registry & Capabilities
- `video-01` (Hailuo-01 Base): High-fidelity 720p/1080p generation, 6s/10s duration.
- `video-01-live` (Hailuo-01 Live / Fast): Lower latency generation for rapid preview.
- `MiniMax-Hailuo-02` / `MiniMax-Hailuo-2.3`: Upgraded motion dynamics and camera control.
- `MiniMax-H3`: Next-generation multimodal model supporting up to 2K resolution, native audio simulation, first/last frame, and 5–15s duration.

---

## 3. Video Generation Task Creation (`POST /v1/video_generation`)

### A. Text-to-Video (T2V) Payload
```json
{
  "model": "video-01",
  "prompt": "A cinematic drone shot flying through a neon-lit cyberpunk city in heavy rain, photorealistic 8k.",
  "prompt_optimizer": true
}
```

### B. Image-to-Video (I2V / First Frame) Payload
Supports public HTTPS URLs or Base64 Data URLs (`data:image/jpeg;base64,...`).
```json
{
  "model": "video-01",
  "prompt": "The camera slowly pushes in on the character's face as gentle wind blows their hair.",
  "first_frame_image": "https://cdn.example.com/assets/character_portrait.png",
  "prompt_optimizer": true
}
```

### C. First & Last Frame Generation Payload
```json
{
  "model": "MiniMax-H3",
  "prompt": "Smooth transition showing daytime turning into starry night over the desert canyon.",
  "first_frame_image": "https://cdn.example.com/assets/desert_day.png",
  "last_frame_image": "https://cdn.example.com/assets/desert_night.png",
  "prompt_optimizer": false,
  "duration": 6,
  "resolution": "1080P"
}
```

### D. Task Creation Response (HTTP 200)
```json
{
  "task_id": "106916112212032",
  "base_resp": {
    "status_code": 0,
    "status_msg": "success"
  }
}
```

---

## 4. Status Polling & Video Retrieval

### A. Task Query Endpoint
`GET https://api.minimax.chat/v1/query/video_generation?task_id={task_id}`

### B. Task Lifecycle State Machine
```
[Submit POST] -> "Preparing" -> "Queueing" -> "Processing" -> "Success" (Terminal)
                                                           \-> "Fail"    (Terminal)
```

### C. Query Response (`Success`)
```json
{
  "task_id": "106916112212032",
  "status": "Success",
  "file_id": "176844028768320",
  "video_width": 1920,
  "video_height": 1080,
  "base_resp": {
    "status_code": 0,
    "status_msg": "success"
  },
  "content": {
    "url": "https://file-service.minimax.chat/video/106916112212032.mp4?token=..."
  }
}
```

---

## 5. Architectural Differences: MiniMax Hailuo vs. Volcengine Ark (Seedance)

| Dimension | MiniMax Hailuo | Volcengine Ark (Seedance 2.5 / 2.0) |
| :--- | :--- | :--- |
| **API Endpoints** | `POST /v1/video_generation`<br>`GET /v1/query/video_generation?task_id=` | `POST /api/v3/contents/generations/tasks`<br>`GET /api/v3/contents/generations/tasks/{task_id}` |
| **Model Specification** | Standard model strings (`video-01`, `MiniMax-H3`, etc.) | Custom Endpoint IDs (`ep-2024...`) or managed model aliases |
| **Payload Schema** | Flat top-level parameters (`prompt`, `first_frame_image`, `last_frame_image`) | Unified Content Array schema (`content: [{ type: "text", text: "..." }, ...]`) |
| **Lifecycle Enum** | `Preparing` → `Queueing` → `Processing` → `Success` / `Fail` | `queued` → `running` → `succeeded` / `failed` / `cancelled` |
| **Base64 Direct Upload** | Supports Data URL (`data:image/...;base64,...`) | Supports raw Base64 and Data URL (body limit <= 64MB) |

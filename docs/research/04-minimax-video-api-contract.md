# MiniMax Hailuo Video Generation API Technical Contract & Architecture

## 1. Base URL & Authentication
- **Domestic (China) Base URLs**:
  - Primary: `https://api.minimax.chat/v1` (or `https://api.minimaxi.chat/v1`, `https://api.minimaxi.com/v1`)
- **Global Base URL**:
  - Primary: `https://api.minimax.io/v1`
- **Headers**:
  - `Authorization: Bearer <MINIMAX_API_KEY>` (Standard Bearer token)
  - `Content-Type: application/json`
- **Group ID Handling**:
  - For standard personal/team API keys, `Authorization: Bearer` is sufficient.
  - For legacy multi-tenant or enterprise sub-accounts, pass `GroupId: <group_id>` header or `?GroupId=<group_id>` URL query parameter.

---

## 2. Model Lineup & Capabilities
- `MiniMax-H3` (Flagship): Next-generation multimodal model supporting up to 2K resolution, native audio simulation, first/last frame, and 5–15s duration.
- `video-01` (Hailuo-01 Base): High-fidelity 720p/1080p generation, 6s duration.
- `video-01-live` (Hailuo-01 Live / Fast): Low latency generation for rapid draft preview.
- `MiniMax-Hailuo-2.3` / `MiniMax-Hailuo-02`: Upgraded camera movement and motion dynamics.

---

## 3. Video Generation Task Creation (`POST /v1/video_generation`)

### A. Text-to-Video (T2V) Payload
```json
{
  "model": "MiniMax-H3",
  "prompt": "A cinematic drone shot flying through a neon-lit cyberpunk city in heavy rain, photorealistic 8k.",
  "prompt_optimizer": true
}
```

### B. Image-to-Video (I2V / First Frame) Payload
Supports public HTTPS URLs or Base64 Data URLs (`data:image/jpeg;base64,...` / `data:image/png;base64,...`).
```json
{
  "model": "MiniMax-H3",
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

## 4. Status Polling & Video Download Protocol

### A. Task Query Endpoint
`GET https://api.minimax.chat/v1/query/video_generation?task_id={task_id}`

**Headers**:
- `Authorization: Bearer <MINIMAX_API_KEY>`

### B. Lifecycle State Machine
```
[Submit POST] -> "Preparing" -> "Queueing" -> "Processing" -> "Success" (Terminal)
                                                           \-> "Fail"    (Terminal)
```

### C. Query Response (`Success`)
When generation finishes successfully, the response returns the `file_id` AND a direct signed `content.url`:
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

### D. File Retrieval Protocol (`GET /v1/files/retrieve`)
If `content.url` is omitted or expired (~9 hours validity), query the file service using the returned `file_id`:
`GET https://api.minimax.chat/v1/files/retrieve?file_id={file_id}`

```json
{
  "file": {
    "file_id": "176844028768320",
    "bytes": 14589230,
    "created_at": 1700469398,
    "filename": "output_aigc.mp4",
    "download_url": "https://file-service.minimax.chat/video/106916112212032.mp4?token=..."
  },
  "base_resp": {
    "status_code": 0,
    "status_msg": "success"
  }
}
```

### E. Download Strategy in `MiniMaxAdapter`
1. Check `content.url` in the `Success` query response first.
2. If present, immediately stream/download to local disk (`./assets/videos/{task_id}.mp4`).
3. If `content.url` is expired/missing, fallback to `GET /v1/files/retrieve?file_id={file_id}` to refresh `download_url`.

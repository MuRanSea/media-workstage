# Volcengine Ark Media Generation Technical Contract & Architecture

## 1. Global Authentication & Infrastructure
- **Data Plane Base URL**: `https://ark.cn-beijing.volces.com/api/v3`
- **Control Plane Base URL**: `https://ark.cn-beijing.volcengineapi.com/`
- **HTTP Headers (Data Plane)**:
  - `Authorization: Bearer <ARK_API_KEY>`
  - `Content-Type: application/json`
- **Request Body Max Size**: 64 MB

---

## 2. API Endpoints Overview
| Action | HTTP Method | Endpoint Path | Sync / Async |
| :--- | :--- | :--- | :--- |
| **Create Video Task** | `POST` | `/contents/generations/tasks` | Asynchronous (Returns Task ID) |
| **Query Video Task** | `GET` | `/contents/generations/tasks/{id}` | Status Polling |
| **List Video Tasks** | `GET` | `/contents/generations/tasks` | Query with filters (`filter.status`, etc.) |
| **Cancel / Delete Video Task** | `DELETE` | `/contents/generations/tasks/{id}` | Cancels `queued` tasks or deletes records |
| **Create Image Generation** | `POST` | `/images/generations` | Synchronous / Batch Response / SSE Stream |

---

## 3. Video Generation Task API Contract

### 3.1 Supported Video Models
- `doubao-seedance-2-5-260628` (Seedance 2.5: All-modal reference, 30s direct coherent output, native multi-language)
- `doubao-seedance-2-0-260128` (Seedance 2.0 Pro)
- `doubao-seedance-2-0-fast-260128` (Seedance 2.0 Fast)
- `doubao-seedance-2-0-mini-260128` (Seedance 2.0 Mini)
- `doubao-seedance-1-5-pro-251215` (Seedance 1.5 Pro with Draft support)

### 3.2 Request Body Schema (`POST /contents/generations/tasks`)
```json
{
  "model": "doubao-seedance-2-5-260628",
  "content": [
    {
      "type": "text",
      "text": "Cinematic shot of a cybernetic warrior walking in the rain, ultra-detailed --rs 720p --rt 16:9"
    },
    {
      "type": "image_url",
      "image_url": {
        "url": "https://example.com/character.png"
      },
      "role": "reference_image"
    },
    {
      "type": "video_url",
      "video_url": {
        "url": "https://example.com/motion_ref.mp4"
      },
      "role": "reference_video"
    },
    {
      "type": "audio_url",
      "audio_url": {
        "url": "https://example.com/bgm.mp3"
      },
      "role": "reference_audio"
    }
  ],
  "omni_reference_task_type": "auto",
  "resolution": "720p",
  "ratio": "16:9",
  "duration": 5,
  "generate_audio": true,
  "output_format": "mp4",
  "watermark": false,
  "return_last_frame": false,
  "priority": 0,
  "execution_expires_after": 172800
}
```

### 3.3 Multi-Modal & Content Array (`content`) Specification
| `type` | Field | Supported Roles (`role`) | Model Limits & Constraints |
| :--- | :--- | :--- | :--- |
| `text` | `text` (string) | N/A | Chinese <= 500 chars, English <= 1000 words. Seedance 2.5 supports EN, ZH, ES, ID, PT, JA, MS, TH, AR, VI, KO. |
| `image_url` | `image_url.url` | `reference_image`<br>`first_frame`<br>`last_frame` | **Seedance 2.5**: 0-30 images.<br>**Seedance 2.0**: 0-9 images.<br>**First/Last frame**: 1 or 2 images (`first_frame`, `last_frame`).<br>**Constraints**: JPEG, PNG, WEBP, BMP, TIFF, GIF, HEIC, HEIF; ratio [0.4, 2.5]; dimension [300, 6000] px; size < 30 MB. Direct `data:image/...;base64,...` supported. |
| `video_url` | `video_url.url` | `reference_video` | **Seedance 2.5**: 0-10 videos, [2, 30]s each (edit tasks: [4, 30]s), total duration <= 30s.<br>**Seedance 2.0**: 0-3 videos, [2, 15]s each, total duration <= 15s.<br>**Constraints**: MP4/MOV (H.264/H.265), FPS [24, 60], single size <= 200 MB, total pixels [407696, 8295044]. |
| `audio_url` | `audio_url.url` | `reference_audio` | **Seedance 2.5**: 0-10 audio clips, [2, 30]s each, total <= 30s (can be passed standalone).<br>**Seedance 2.0**: 0-3 audio clips, [2, 15]s each, total <= 15s.<br>**Constraints**: WAV, MP3; single size <= 15 MB. Direct `data:audio/...;base64,...` supported. |

### 3.4 Key Video Generation Parameters
- **`omni_reference_task_type`** (Seedance 2.5): `auto` (default) | `reference` | `edit` | `extend`.
- **`resolution`**: `480p`, `720p` (default), `1080p` (10-bit H.265/HEVC).
- **`ratio`**: `16:9`, `4:3`, `1:1`, `3:4`, `9:16`, `21:9`, `adaptive` (default `adaptive`).
- **`duration`**: `[4, 30]` seconds or `-1` (intelligent length selection).
- **`generate_audio`**: `true` (default) | `false`.
- **`output_format`**: `mp4` (default) | `mov` (Seedance 2.5).
- **`watermark`**: `true` | `false` (default `false`).

---

## 4. Video Generation Polling & Lifecycle (`GET /contents/generations/tasks/{id}`)

### 4.1 State Machine Lifecycle
```
[Submit Task] ---> queued ---> running ---> succeeded (video_url available)
                     |            |
                     +-(DELETE)-> cancelled
                     |            |
                     +-(Error)---> failed (error object populated)
                     |            |
                     +-(Timeout)-> expired (exceeded execution_expires_after)
```

---

## 5. Image Generation API Contract (`POST /images/generations`)

### 5.1 Request Body Schema
```json
{
  "model": "doubao-seedream-5-0-pro-260628",
  "prompt": "A vibrant high-fashion editorial portrait of a model wearing a sculptural hat, Vogue style",
  "image": [
    "https://example.com/reference1.png",
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
  ],
  "size": "2K",
  "response_format": "url",
  "output_format": "jpeg",
  "watermark": false,
  "background": "opaque",
  "layer_decomposition": false
}
```

### 5.2 Key Image Generation Parameters
- **`image`**: Up to 10 reference images (`jpeg`, `png`, `webp`, etc., size <= 30 MB). Supports Base64.
- **`size`**: Tier notation (`1K`, `1.5K`, `2K`) or explicit `<width>x<height>`.
- **`response_format`**: `url` (valid 24h) | `b64_json`.
- **`layer_decomposition`**: (5.0 pro) `true` | `false` (decomposes into transparent layers).

# 06-asset-storage-and-tos-fallback

Type: research
Status: resolved
Blocked by: none

## Question

基于本地文件系统与火山 TOS 文档，设计生成产物（图片 PNG/WebP、视频 MP4）本地保存目录结构、本地静态资源 HTTP 挂载机制、以及针对超大视频素材时启用 TOS 对象存储直传的 Fallback 机制。

## Answer

研究报告已归档至 [docs/research/06-asset-storage-and-tos-fallback.md](../../docs/research/06-asset-storage-and-tos-fallback.md)。

### 核心结论：
1. **本地存储层级规范**：
   - 图片产物：`./assets/images/{task_id}/`（包含 `base.png`、`layer_manifest.json`、`layer_00..15.png`、`storyboard_00..14.png`）。
   - 视频产物：`./assets/videos/{task_id}/`（包含 `output.mp4`、`cover.webp`、`first_frame.png`、`last_frame.png`、`audio_track.mp3`）。
   - 上传素材：`./assets/uploads/{YYYY-MM-DD}/{sha256}_{filename}`。
2. **Go Gin 静态托管与流媒体支持**：
   - 路由：`GET /assets/*filepath`，全面支持 RFC 7233 Range 请求（`Accept-Ranges: bytes`），保障 HTML5 播放器与画布视频节点平滑快进拖拽。
   - 跨域与缓存：全域 CORS 开放，产物文件配置 `immutable` 长期缓存。
3. **火山 TOS 直传与预签名 Fallback**：
   - 小素材优先 Base64 直传；针对 >30MB 图片或超大参考视频，通过 Go SDK 生成 **PreSigned PUT URL** 直传 TOS，并通过 **PreSigned GET URL** 传递给方舟/MiniMax 接口。
4. **生命周期与清理策略**：
   - 支持本地磁盘配额 LRU 扫描与任务级联物理删除，TOS 云端配置 7 天自动过期规则。

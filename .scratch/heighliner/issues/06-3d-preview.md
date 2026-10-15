# 06: 3D 结果卡的交互预览

Parent: [../spec.md](../spec.md)

**Status:** done

**What to build:**
双击 3D 结果卡时，如果有 glb/gltf 文件，打开交互预览：可旋转、缩放、平移，用 three.js 的 GLTFLoader，按需懒加载，不进首屏包。没有 glb/gltf 时，双击改为提示“该格式不支持预览”，并提供“在文件夹中显示”。

**Blocked by:** 05

- [x] glb 结果能在预览里旋转、缩放，关闭后释放 WebGL 资源
- [x] three.js 动态导入，主包体积基本不变（构建产物对比）
- [x] 只有 stl、fbx 的结果卡显示格式不支持的提示
- [x] 开发服务器走查并截图

## Comments

- 2026-10-14 实现记录：
  - 依赖 `three@0.170.0`、`@types/three@0.170.0`。three.js 相关代码都在 `web/src/components/modelScene.ts`，只由 `Model3DViewer` 用 `import()` 加载，构建时单独成块。
  - 场景：GLTFLoader（带 Meshopt 解码）、OrbitControls（左键拖动旋转、滚轮缩放、右键拖动平移，带阻尼）、RoomEnvironment 环境光（强度 0.6）加一盏主光、PBR Neutral 色调映射。模型居中，相机按包围球退到能看全的位置，初始是斜上方 3/4 视角。
  - 关闭时停掉渲染循环和 ResizeObserver，释放 controls、几何体、材质、贴图、环境贴图、PMREM 和 renderer，再调用 `forceContextLoss()` 并移除画布。加载未完成就关闭时，晚到的模型直接释放。
  - 3D 结果卡封面上加一层双击区（悬停显示"双击 3D 预览"或"双击查看"）。`previewFile` 先取 GLB，其次 glTF；两者都没有时，打开同一个全屏层，显示"该格式不支持预览"、已有格式和"在文件夹中显示"。
  - 已知限制：Draco 压缩的 GLB 会提示"模型使用了 Draco 压缩，暂不支持预览"（解码器需要额外的 wasm 文件）；分离式 glTF 引用的外部 .bin 和贴图只有在一起下载时才能加载。
- 2026-10-14 构建对比（`vite build`）：
  - 基线（工单 05 完成后、加 three 前）：主包 index 489.79 kB（gzip 148.88 kB），CSS 51.88 kB。
  - 加 three 后：主包 index 495.23 kB（gzip 150.43 kB，+1.55 kB，是预览组件和卡片改动），CSS 52.10 kB；three.js 单独在 `modelScene-*.js` 608.8 kB（gzip 155.9 kB）。在主包里搜 `WebGLRenderer`、`GLTFLoader` 都是 0 次。
- 2026-10-14 走查记录：
  - **走查环境**：没有真实网关 key（也不应由代理代填），用本地假网关 `127.0.0.1:8099` 代替：它返回仓库里的真实模型目录 `internal/server/testdata/heighliner-media-models.json`，3D 任务两次 running 后成功，产物走签名路径、不带鉴权下载。服务器用隔离的 db/assets/projects 目录启动，浏览器是临时配置的无头 Chrome。截图在 `../walkthrough/`。
  - 双击 GLB 结果卡打开预览，3/4 视角，颜色与材质一致（`06-preview.png`）。
  - 用真实指针事件拖动旋转、滚轮缩放、右键拖动平移，四张对比见 `06-rotate-zoom-pan.png`。
  - Esc 关闭后，预览画布从文档中移除，它的 WebGL2 上下文 `isContextLost() === true`，`webglcontextlost` 事件触发。连续开关 3 次后页面里只剩小地图的画布。
  - 双击只有 STL/FBX 的结果卡，显示"该格式不支持预览"、已有格式和"在文件夹中显示"（`06-unsupported.png`）。

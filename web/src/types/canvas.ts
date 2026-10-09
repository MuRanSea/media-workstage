import type { Protocol, ProviderId } from '../services/api.ts';

export type CardType = 'image' | 'video' | 'text' | 'upload';
/** What an upload card holds. */
export type UploadKind = 'image' | 'video';
/** Review state of an asset uploaded to a provider's asset library. */
export type AssetStatus = 'Processing' | 'Active' | 'Failed';
export type TextPreset = 'image_prompt' | 'video_prompt' | 'free';

export type VideoTaskMode = 'all_modal' | 'first_last_frame' | 'text_to_video';
export type ImageTaskMode = 'single' | 'layer_decomp' | 'sequential';
export type CanvasTool = 'select' | 'hand';
export type MjSpeed = 'FAST' | 'RELAX' | 'TURBO';
/** Midjourney: imagine from the prompt, or blend the reference images. */
export type MjOperation = 'imagine' | 'blend';

export const MJ_SPEED_LABELS: Record<MjSpeed, string> = { FAST: 'Fast', RELAX: 'Relax', TURBO: 'Turbo' };

export interface TaskAssetDto {
  id: string;
  task_id: string;
  asset_index: number;
  kind: 'image_base' | 'image_layer' | 'image_frame' | 'video';
  name?: string;
  description?: string;
  z_index: number;
  bounding_box_json?: string;
  remote_url?: string;
  local_path: string;
  file_size_bytes?: number;
  downloaded_at?: string;
}

/** A follow-up a provider offers on a finished result (Midjourney's U1–U4 / V1–V4 …). */
export interface ResultActionDto {
  /** The provider's own identifier, sent back to run the action. */
  id: string;
  label?: string;
  emoji?: string;
}

/** How a result card came from another result card, rather than from a generation card's settings. */
export interface ResultOrigin {
  /** A result action (Midjourney U/V/reroll) or Midjourney Describe. */
  operation: 'action' | 'describe';
  /** Short name shown on the line from the source ("U2", "重绘", "反推"). */
  label: string;
  /** Result actions: the provider's action id. */
  actionId?: string;
}

/** What an asset-library item is; decides its content slot and the name the prompt uses for it. */
export type AssetKind = 'video' | 'image' | 'audio';

/** An item already in the Ark asset library (素材库 & 虚拟人像库), sent to Seedance as asset://<assetId>. */
export interface AssetRef {
  assetId: string;
  kind: AssetKind;
}

export interface ReferenceItem {
  cardId: string;
  tagIndex: number;
  role: 'reference_image' | 'reference_video' | 'first_frame' | 'last_frame';
  label: string;
}

/**
 * Generation card: holds a prompt, model and parameters and never an output.
 * Result card: holds exactly one output of a run; an upload card is a result
 * card with no source. Cards saved before roles
 * existed are migrated when a project opens (engine/migration.ts).
 */
export type CardRole = 'generation' | 'result';

/** Read-only record of what a result card was generated with. */
export interface ResultSnapshot {
  prompt: string;
  provider?: ProviderId;
  model: string;
  params: Record<string, string | number | boolean>;
  seed?: number;
  /** Video runs: the reference images and videos they were submitted with. */
  references?: Pick<ReferenceItem, 'cardId' | 'tagIndex' | 'role' | 'label'>[];
}

/**
 * A labelled region of the canvas (ADR 0009). Not a card: no ports, no tags.
 * Cards belong to it by position, so it stores no member list.
 */
export interface CanvasSection {
  id: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Shrunk to its title bar, its cards hidden. */
  collapsed?: boolean;
}

export interface SpatialCard {
  id: string;
  role: CardRole;
  /** Result cards: the generation card whose run produced this card, or the result card `origin` ran on. */
  sourceId?: string;
  /** Result cards made by an operation on another result card. */
  origin?: ResultOrigin;
  /** Result cards: the settings the run was submitted with. */
  snapshot?: ResultSnapshot;
  taskId?: string;
  type: CardType;
  title: string;
  /** @图N / @视频N; carried by image and video result cards (uploads included). */
  tagIndex?: number;
  x: number;
  y: number;
  width: number;
  prompt: string;
  /** Provider that runs this card's model; defaults to 'ark' (inferred from the model for legacy video cards). */
  provider?: ProviderId;
  model: string;
  status: 'idle' | 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'expired';
  progress: number;
  errorMessage?: string;
  resultUrl?: string;
  outputAssets?: TaskAssetDto[];
  /** Result cards: follow-ups the finished result offers (Midjourney buttons). */
  resultActions?: ResultActionDto[];

  /** Image/video cards: a text card whose output replaces this card's prompt. */
  promptSourceId?: string;

  // Upload card fields: the picked file lives in the project (resultUrl); the remote
  // fields are what the Upload Platform returned for it. Older projects may still carry
  // an unused uploadProvider: uploads no longer go through a provider (ADR 0008).
  mediaKind?: UploadKind;
  uploadName?: string;
  /** Asset library id (referenced as asset://<id> once status is Active). */
  assetId?: string;
  assetStatus?: AssetStatus;
  assetError?: string;
  /** Download URL from the file upload API, valid until fileExpiresAt (unix seconds). */
  fileUrl?: string;
  fileExpiresAt?: number;
  /** Which copy video cards send when this card is a reference; undefined = automatic. */
  uploadRefMode?: 'asset' | 'url';

  // Text card (LLM) fields: prompt is the user's idea, textOutput the model's answer
  textPreset?: TextPreset;
  textOutput?: string;

  // UI folding & tab state
  isExpanded?: boolean;
  activeParamTab?: 'specs' | 'refs' | 'advanced';

  // Video specific parameters
  mode?: VideoTaskMode;
  resolution?: string;
  duration?: number;
  ratio?: string;
  generateAudio?: boolean;
  outputFormat?: 'mp4' | 'mov';
  promptOptimizer?: boolean;
  /** Kling Omni (APIMart): what the reference video is for; unset = base (edit it). */
  videoReferType?: VideoReferType;
  seed?: number;
  /** Video cards, and Midjourney image cards (reference images to imagine or blend from). */
  references?: ReferenceItem[];
  /** Seedance (Ark protocol), multi-reference mode: items already in the Ark asset library. */
  assetRefs?: AssetRef[];

  // Image parameters for non-Seedream channels (ratio reuses imageRatioPreset)
  imageResolution?: '1K' | '2K' | '4K';
  /** Midjourney speed mode; unset leaves it to the gateway. */
  mjSpeed?: MjSpeed;
  /** Midjourney: imagine from the prompt (default), or blend the reference images. */
  mjOperation?: MjOperation;

  // Image specific parameters (Seedream 5.0 Series)
  imageMode?: ImageTaskMode;
  sizeMode?: 'tier' | 'custom_pixels';
  imageTier?: string;
  imageRatioPreset?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '3:2' | '2:3' | '21:9';
  customPixels?: string;
  imageFormat?: 'jpeg' | 'png';
  watermark?: boolean;
  background?: 'opaque' | 'transparent';
  seedImage?: number;
}

export interface VideoModelDef {
  id: string;
  name: string;
  tag: string;
  /** Protocol whose API these limits describe. */
  protocol: Protocol;
  resolutions: string[];
  durations: number[];
  ratios: string[];
  supportsAudio: boolean;
  supportsMov: boolean;
  maxRefs: number;
  /** Reference audios the model takes in multi-reference mode (Ark asset library); none when omitted. */
  maxAudioRefs?: number;
  /** Task modes the model accepts; all three when omitted. */
  modes?: VideoTaskMode[];
}

export interface ImageModelDef {
  id: string;
  name: string;
  tag: string;
  defaultTier: string;
  tiers: string[];
  minPixels: number;
  maxPixels: number;
  pixelRangeText: string;
  defaultCustomPixel: string;
  supportsLayerDecomp: boolean;
  supportsSequential: boolean;
}

export const VIDEO_MODELS: VideoModelDef[] = [
  {
    id: 'doubao-seedance-2-5-260628',
    name: 'Seedance 2.5',
    tag: '旗舰30s全模态',
    protocol: 'ark',
    resolutions: ['480p', '720p', '1080p'],
    durations: [4, 5, 10, 15, 20, 30, -1],
    ratios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'],
    supportsAudio: true,
    supportsMov: true,
    maxRefs: 30,
    maxAudioRefs: 10
  },
  {
    id: 'doubao-seedance-2-0-260128',
    name: 'Seedance 2.0 Pro',
    tag: '4K专业版',
    protocol: 'ark',
    resolutions: ['480p', '720p', '1080p', '4k'],
    durations: [4, 5, 10, 15, -1],
    ratios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'],
    supportsAudio: true,
    supportsMov: false,
    maxRefs: 9,
    maxAudioRefs: 3
  },
  {
    id: 'MiniMax-H3',
    name: 'MiniMax H3',
    tag: '海螺2K高动态',
    protocol: 'minimax',
    resolutions: ['768P', '2K'],
    durations: [5, 6, 10, 15],
    ratios: ['16:9', '9:16', '1:1'],
    supportsAudio: true,
    supportsMov: false,
    maxRefs: 2
  },
  {
    id: 'video-01',
    name: 'MiniMax Video-01',
    tag: '海螺基础版',
    protocol: 'minimax',
    resolutions: ['720P', '1080P'],
    durations: [6],
    ratios: ['16:9', '9:16'],
    supportsAudio: false,
    supportsMov: false,
    maxRefs: 1
  },
  // Kling through APIMart. Resolution maps to Kling's mode (720p std / 1080p pro / 4k).
  {
    id: 'kling-v3',
    name: 'Kling v3',
    tag: '首尾帧/4K',
    protocol: 'apimart',
    resolutions: ['720p', '1080p', '4k'],
    durations: [3, 5, 10, 15],
    ratios: ['16:9', '9:16', '1:1'],
    supportsAudio: true,
    supportsMov: false,
    maxRefs: 2,
    modes: ['first_last_frame', 'text_to_video']
  },
  {
    id: 'kling-v3-omni',
    name: 'Kling v3 Omni',
    tag: '多图参考/4K',
    protocol: 'apimart',
    resolutions: ['720p', '1080p', '4k'],
    durations: [3, 5, 10, 15],
    ratios: ['16:9', '9:16', '1:1'],
    supportsAudio: true,
    supportsMov: false,
    maxRefs: 7
  },
  {
    id: 'kling-3.0-turbo',
    name: 'Kling 3.0 Turbo',
    tag: '首帧/极速',
    protocol: 'apimart',
    resolutions: ['720p', '1080p'],
    durations: [3, 5, 10, 15],
    ratios: ['16:9', '9:16', '1:1'],
    supportsAudio: false,
    supportsMov: false,
    maxRefs: 1,
    modes: ['first_last_frame', 'text_to_video']
  },
  {
    id: 'kling-v2-6',
    name: 'Kling 2.6',
    tag: '首尾帧',
    protocol: 'apimart',
    resolutions: ['720p', '1080p'],
    durations: [5, 10],
    ratios: ['16:9', '9:16', '1:1'],
    supportsAudio: true,
    supportsMov: false,
    maxRefs: 2,
    modes: ['first_last_frame', 'text_to_video']
  },
  {
    id: 'kling-video-o1',
    name: 'Kling O1',
    tag: '多图参考',
    protocol: 'apimart',
    resolutions: ['720p', '1080p'],
    durations: [5, 10],
    ratios: ['16:9', '9:16', '1:1'],
    supportsAudio: false,
    supportsMov: false,
    maxRefs: 7
  },
  // MiniMax-H3 through APIMart (the MiniMax channel speaks MiniMax's own API instead).
  {
    id: 'MiniMax-H3',
    name: 'MiniMax H3',
    tag: '2K/多图参考',
    protocol: 'apimart',
    resolutions: ['768P', '2K'],
    durations: [4, 5, 6, 8, 10, 15],
    ratios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    supportsAudio: false,
    supportsMov: false,
    maxRefs: 9
  }
];

/** APIMart video models the backend adapter can run: Kling and MiniMax-H3. */
export function isAPIMartVideoModel(modelId: string): boolean {
  const m = modelId.toLowerCase();
  return m.startsWith('kling') || m.startsWith('minimax-h3');
}

/**
 * Parameter limits for a video model on a protocol. Bound models without a built-in
 * definition borrow their protocol's flagship limits (Seedance 2.5 for anything not MiniMax).
 */
export function resolveVideoModelDef(protocol: Protocol | undefined, modelId: string): VideoModelDef {
  const known =
    VIDEO_MODELS.find((m) => m.id === modelId && m.protocol === protocol) ??
    VIDEO_MODELS.find((m) => m.id === modelId);
  if (known) return known;

  let baseId = protocol === 'minimax' ? 'MiniMax-H3' : VIDEO_MODELS[0].id;
  if (protocol === 'apimart' && isAPIMartVideoModel(modelId)) {
    // Unlisted variants take after the family they belong to (as the backend does).
    const m = modelId.toLowerCase();
    baseId = m.startsWith('minimax-h3')
      ? 'MiniMax-H3'
      : m.includes('omni') || m.includes('-o1')
      ? 'kling-v3-omni'
      : m.includes('turbo')
      ? 'kling-3.0-turbo'
      : 'kling-v3';
  }
  const base =
    VIDEO_MODELS.find((m) => m.id === baseId && m.protocol === protocol) ??
    VIDEO_MODELS.find((m) => m.id === baseId) ??
    VIDEO_MODELS[0];
  return { ...base, id: modelId, name: modelId, tag: '' };
}

/**
 * What Kling Omni does with its reference video: `base` edits that video (it keeps its
 * length and shape), `feature` borrows its motion, camera or style for a new one.
 */
export type VideoReferType = 'base' | 'feature';

/** Whether a model is Kling Omni on APIMart, which asks what its reference video is for. */
export function takesVideoReferType(protocol: Protocol | undefined, modelId: string): boolean {
  const m = modelId.toLowerCase();
  return protocol === 'apimart' && m.startsWith('kling') && (m.includes('omni') || m.includes('-o1'));
}

/** How many reference videos a model takes on a protocol; 0 when it takes none. */
export function maxReferenceVideos(protocol: Protocol | undefined, modelId: string): number {
  if (protocol === 'ark') return 10;
  if (takesVideoReferType(protocol, modelId)) return 1;
  if (protocol === 'apimart' && modelId.toLowerCase().startsWith('minimax-h3')) return 3;
  return 0;
}

export function getModelMaxReferences(modelId: string): number {
  const found = VIDEO_MODELS.find(
    (m) => m.id === modelId || m.id.toLowerCase() === modelId.toLowerCase()
  );
  if (found) return found.maxRefs;

  if (modelId.includes('seedance-2-5') || modelId.includes('seedance-2.5')) return 30;
  if (modelId.includes('video-01')) return 1;
  if (modelId.includes('MiniMax') || modelId.includes('h3') || modelId.includes('H3') || modelId.includes('hailuo')) return 2;
  return 9;
}

export const IMAGE_MODELS: ImageModelDef[] = [
  {
    id: 'doubao-seedream-5-0-pro-260628',
    name: 'Seedream 5.0 Pro',
    tag: '2K/图层拆分',
    defaultTier: '2K',
    tiers: ['1K', '1.5K', '2K'],
    minPixels: 921600,
    maxPixels: 4624220,
    pixelRangeText: '92万~462万px',
    defaultCustomPixel: '2048x1024',
    supportsLayerDecomp: true,
    supportsSequential: false
  },
  {
    id: 'doubao-seedream-5-0-lite-260128',
    name: 'Seedream 5.0 Lite',
    tag: '4K超清/连环组图',
    defaultTier: '2K',
    tiers: ['2K', '3K', '4K'],
    minPixels: 3686400,
    maxPixels: 16777216,
    pixelRangeText: '368万~1677万px',
    defaultCustomPixel: '2048x2048',
    supportsLayerDecomp: false,
    supportsSequential: true
  }
];

export const SEEDREAM_PIXEL_MAP: Record<string, Record<string, string>> = {
  '1K': {
    '1:1': '1024x1024',
    '16:9': '1424x800',
    '9:16': '800x1424',
    '4:3': '1152x864',
    '3:4': '864x1152',
    '3:2': '1248x832',
    '2:3': '832x1248',
    '21:9': '1568x672'
  },
  '1.5K': {
    '1:1': '1536x1536',
    '16:9': '2048x1152',
    '9:16': '1152x2048',
    '4:3': '1792x1344',
    '3:4': '1344x1792',
    '3:2': '1872x1248',
    '2:3': '1248x1872',
    '21:9': '2352x1008'
  },
  '2K': {
    '1:1': '2048x2048',
    '16:9': '2816x1584',
    '9:16': '1584x2816',
    '4:3': '2368x1776',
    '3:4': '1776x2368',
    '3:2': '2496x1664',
    '2:3': '1664x2496',
    '21:9': '3136x1344'
  },
  '3K': {
    '1:1': '3072x3072',
    '16:9': '4096x2304',
    '9:16': '2304x4096',
    '4:3': '3456x2592',
    '3:4': '2592x3456'
  },
  '4K': {
    '1:1': '4096x4096',
    '16:9': '5504x3040',
    '9:16': '3040x5504',
    '4:3': '4704x3520',
    '3:4': '3520x4704'
  }
};

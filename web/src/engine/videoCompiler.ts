import { maxReferenceVideos, resolveVideoModelDef, type SpatialCard, type ReferenceItem, type VideoTaskMode } from '../types/canvas.ts';
import type { CreateTaskPayload } from '../services/api.ts';
import { protocolOf } from './providers.ts';
import { refNoun, refTag } from './refTags.ts';
import { sendsUploadedCopy, uploadReference } from './uploadRefs.ts';
import type { Protocol } from '../services/api.ts';

export interface VideoCompilationInput {
  card: SpatialCard;
  allCards?: SpatialCard[];
}

function normalizeLocalPath(p: string): string {
  let clean = p.replace(/^\/+/, '');
  if (!clean.startsWith('assets/')) {
    clean = `assets/${clean}`;
  }
  return clean;
}

function isRemoteOrDataURI(str: string): boolean {
  return str.startsWith('http://') || str.startsWith('https://') || str.startsWith('data:');
}

/**
 * Resolves the local asset path or remote URL of the image card a reference points at.
 * The address saved on the reference when it was linked is ignored, so the video
 * always uses the image the card shows; a result card never changes its image.
 */
export function resolveReferenceAsset(
  ref: ReferenceItem,
  allCards: SpatialCard[] = [],
  protocol: Protocol = 'ark'
): { url?: string; localPath?: string; remoteUrl?: string } {
  const srcCard = allCards.find((c) => c.id === ref.cardId);
  if (!srcCard) {
    throw new Error(`Referenced card ${refTag(ref)} was not found on the canvas`);
  }
  // Upload cards, video results and images the user uploaded send that copy (asset id or link), else the saved image.
  if (sendsUploadedCopy(srcCard)) return uploadReference(srcCard, protocol);

  // The card's primary image asset
  const baseAsset = srcCard.outputAssets?.find(
    (a) => a.kind === 'image_base' || a.kind === 'image_layer' || a.kind === 'image_frame'
  );
  const firstAsset = srcCard.outputAssets?.[0];
  const targetAsset = baseAsset ?? firstAsset;

  if (targetAsset) {
    if (targetAsset.local_path) {
      // The provider's original URL rides along for adapters that need a public URL.
      const remote = targetAsset.remote_url;
      const remoteUrl = remote && /^https?:\/\//.test(remote) ? remote : undefined;
      return { localPath: normalizeLocalPath(targetAsset.local_path), remoteUrl };
    }
    if (targetAsset.remote_url) {
      return { url: targetAsset.remote_url };
    }
  }

  if (srcCard.resultUrl) {
    if (isRemoteOrDataURI(srcCard.resultUrl)) {
      return { url: srcCard.resultUrl };
    }
    return { localPath: normalizeLocalPath(srcCard.resultUrl) };
  }

  throw new Error(
    `Referenced card ${refTag(ref)} ("${srcCard.title}") has no output yet. Please generate it first.`
  );
}

/** Provider for video cards saved before cards carried one: MiniMax models by name, else Ark. */
export function inferVideoProvider(modelId: string): 'ark' | 'minimax' {
  return modelId.includes('MiniMax') || modelId.includes('video-01') ? 'minimax' : 'ark';
}

/**
 * The mode, ratio and references a video card's task is actually sent with:
 * text-to-video drops references, first/last frame takes an adaptive ratio and
 * re-roles images by order (videos cannot be frames), all-modal makes every
 * image a plain reference and keeps videos as reference videos.
 */
export function sentVideoSettings(card: SpatialCard): { mode: VideoTaskMode; ratio: string; references: ReferenceItem[] } {
  const mode: VideoTaskMode = card.mode ?? 'all_modal';
  const references = card.references ?? [];
  if (mode === 'text_to_video') return { mode, ratio: card.ratio ?? '16:9', references: [] };
  if (mode === 'first_last_frame') {
    return {
      mode,
      ratio: 'adaptive',
      references: references
        .filter((ref) => ref.role !== 'reference_video')
        .map((ref, idx) => ({ ...ref, role: idx === 0 ? 'first_frame' : 'last_frame' })),
    };
  }
  return {
    mode,
    ratio: card.ratio ?? '16:9',
    references: references.map((ref) => ({ ...ref, role: ref.role === 'reference_video' ? ref.role : 'reference_image' })),
  };
}

/**
 * Compiles and strictly validates a video generation task payload for Ark (Seedance) or MiniMax.
 * Used identically by both the JSON inspector and POST /api/tasks.
 */
export function compileVideoTaskPayload(
  card: SpatialCard,
  allCards: SpatialCard[] = []
): CreateTaskPayload {
  const provider = card.provider ?? inferVideoProvider(card.model);
  const protocol = protocolOf(provider);
  const isMiniMax = protocol === 'minimax';

  const mode: VideoTaskMode = card.mode ?? 'all_modal';
  const modelDef = resolveVideoModelDef(protocol, card.model);
  if (modelDef.modes && !modelDef.modes.includes(mode)) {
    throw new Error(`Model ${card.model} does not support ${mode} mode`);
  }
  const { ratio, references } = sentVideoSettings(card);
  let compiledPrompt = card.prompt;

  if (!card.prompt || card.prompt.trim() === '') {
    throw new Error('Video generation requires a non-empty prompt');
  }
  if (mode === 'text_to_video') {
    compiledPrompt = compiledPrompt.replace(/@?(图|视频)\d+\s*/g, '').trim();
  } else if (mode === 'first_last_frame') {
    if (references.length === 0) {
      throw new Error('first_last_frame mode requires at least 1 reference image');
    }
    if (references.length > Math.min(2, modelDef.maxRefs)) {
      throw new Error(
        `first_last_frame mode accepts at most ${Math.min(2, modelDef.maxRefs)} reference images for ${card.model}`
      );
    }
  } else if (mode === 'all_modal' && references.length > modelDef.maxRefs) {
    throw new Error(
      `Model ${card.model} supports at most ${modelDef.maxRefs} reference assets, got ${references.length}`
    );
  }

  if (references.some((r) => r.role === 'reference_video') && maxReferenceVideos(protocol, card.model) === 0) {
    throw new Error(`${card.model} 不支持参考视频，请断开视频连线或换用 Seedance、Kling Omni、MiniMax H3`);
  }

  // 2. Resolve assets & renumber prompt from global @图N to sequential 图1, 图2, ...
  const compiledReferenceAssets: Array<{
    card_id: string;
    tag_index: number;
    role: string;
    label: string;
    url?: string;
    local_path?: string;
    remote_url?: string;
  }> = [];

  // Images and videos are numbered separately: 图1, 图2, … and 视频1, …
  const counters = { 图: 0, 视频: 0 };
  references.forEach((ref) => {
    const noun = refNoun(ref.role);
    const cloudIndex = ++counters[noun];
    const resolved = resolveReferenceAsset(ref, allCards, protocol);

    compiledReferenceAssets.push({
      card_id: ref.cardId,
      tag_index: cloudIndex,
      role: ref.role,
      label: ref.label,
      url: resolved.url,
      local_path: resolved.localPath,
      remote_url: resolved.remoteUrl,
    });

    const tagRegex = new RegExp(`@?${noun}${ref.tagIndex}\\b`, 'g');
    compiledPrompt = compiledPrompt.replace(tagRegex, `${noun}${cloudIndex}`);
  });

  compiledPrompt = compiledPrompt.replace(/@(图|视频)(\d+)/g, '$1$2').trim();

  // Asset-library items (Seedance, multi-reference): numbered after the connected cards of their kind.
  const assetRefs = mode === 'all_modal' ? card.assetRefs ?? [] : [];
  if (assetRefs.length) {
    if (protocol !== 'ark') throw new Error('素材库参考只支持火山方舟的 Seedance 模型');
    const counts = { image: counters.图, video: counters.视频, audio: 0 };
    for (const asset of assetRefs) {
      compiledReferenceAssets.push({
        card_id: '',
        tag_index: ++counts[asset.kind],
        role: `reference_${asset.kind}`,
        label: asset.assetId,
        url: `asset://${asset.assetId}`,
      });
    }
    const limits = { image: modelDef.maxRefs, video: maxReferenceVideos(protocol, card.model), audio: modelDef.maxAudioRefs ?? 0 };
    for (const kind of ['image', 'video', 'audio'] as const) {
      if (counts[kind] > limits[kind]) {
        throw new Error(`Model ${card.model} supports at most ${limits[kind]} reference ${kind}s, got ${counts[kind]}`);
      }
    }
  }

  const params: Record<string, unknown> = {
    resolution: card.resolution ?? (isMiniMax ? '1080P' : '720p'),
    duration: card.duration ?? (isMiniMax ? 6 : 5),
    ratio,
    seed: typeof card.seed === 'number' && !isNaN(card.seed) ? card.seed : -1,
  };

  if (!isMiniMax) {
    params.generate_audio = card.generateAudio ?? true;
    params.output_format = card.outputFormat ?? 'mp4';
    params.watermark = card.watermark ?? false;
  } else {
    params.prompt_optimizer = card.promptOptimizer ?? false;
  }

  return {
    provider,
    model: card.model,
    task_type: 'video_generation',
    task_mode: mode,
    prompt: compiledPrompt,
    params,
    reference_assets: compiledReferenceAssets,
  };
}

export function compileCardVideoPayload(
  card: SpatialCard,
  allCards: SpatialCard[] = []
): CreateTaskPayload {
  return compileVideoTaskPayload(card, allCards);
}

import { resolveVideoModelDef, type SpatialCard, type ReferenceItem, type VideoTaskMode } from '../types/canvas.ts';
import type { CreateTaskPayload } from '../services/api.ts';
import { protocolOf } from './providers.ts';

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
 * Resolves the local asset path or remote URL for a referenced image card.
 */
export function resolveReferenceAsset(
  ref: ReferenceItem,
  allCards: SpatialCard[] = []
): { url?: string; localPath?: string; remoteUrl?: string } {
  // 1. If ref has explicit localPath
  if (ref.localPath) {
    if (isRemoteOrDataURI(ref.localPath)) {
      return { url: ref.localPath };
    }
    return { localPath: normalizeLocalPath(ref.localPath) };
  }

  // 2. If ref has url (which might be a relative /assets/ path or remote URL)
  if (ref.url) {
    if (isRemoteOrDataURI(ref.url)) {
      return { url: ref.url };
    }
    return { localPath: normalizeLocalPath(ref.url) };
  }

  const srcCard = allCards.find((c) => c.id === ref.cardId);
  if (!srcCard) {
    throw new Error(`Referenced image card @图${ref.tagIndex} was not found on the canvas`);
  }

  // 3. Find primary asset on source card
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
    `Referenced image card @图${ref.tagIndex} ("${srcCard.title}") has not generated any output image yet. Please generate it first.`
  );
}

/**
 * The file of a referenced video card's result. Seedance only takes reference videos as
 * public URLs, so the provider's result URL rides along; the backend checks it has not expired.
 */
export function resolveReferenceVideo(
  ref: ReferenceItem,
  allCards: SpatialCard[] = []
): { url?: string; localPath?: string; remoteUrl?: string } {
  const srcCard = allCards.find((c) => c.id === ref.cardId);
  if (!srcCard) {
    throw new Error(`参考视频 @视频${ref.tagIndex} 对应的卡片已不在画布上`);
  }
  const asset = srcCard.outputAssets?.find((a) => a.kind === 'video');
  const remote = asset?.remote_url && /^https?:\/\//.test(asset.remote_url) ? asset.remote_url : undefined;
  if (asset?.local_path) return { localPath: normalizeLocalPath(asset.local_path), remoteUrl: remote };
  if (remote) return { url: remote };
  if (srcCard.resultUrl && /^https?:\/\//.test(srcCard.resultUrl)) return { url: srcCard.resultUrl };
  throw new Error(`参考视频 @视频${ref.tagIndex}「${srcCard.title}」还没有生成视频，请先生成`);
}

/** Provider for video cards saved before cards carried one: MiniMax models by name, else Ark. */
export function inferVideoProvider(modelId: string): 'ark' | 'minimax' {
  return modelId.includes('MiniMax') || modelId.includes('video-01') ? 'minimax' : 'ark';
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
  let references = card.references ?? [];
  let ratio = card.ratio ?? '16:9';
  let compiledPrompt = card.prompt;

  if (!card.prompt || card.prompt.trim() === '') {
    throw new Error('Video generation requires a non-empty prompt');
  }
  if (mode === 'text_to_video') {
    references = [];
    compiledPrompt = compiledPrompt.replace(/@?图\d+\s*/g, '').replace(/@视频\d+\s*/g, '').trim();
  } else if (mode === 'first_last_frame') {
    if (references.length === 0) {
      throw new Error('first_last_frame mode requires at least 1 reference image');
    }
    if (references.length > Math.min(2, modelDef.maxRefs)) {
      throw new Error(
        `first_last_frame mode accepts at most ${Math.min(2, modelDef.maxRefs)} reference images for ${card.model}`
      );
    }
    ratio = 'adaptive';
    references = references.map((ref, idx) => ({
      ...ref,
      role: idx === 0 ? 'first_frame' : 'last_frame',
    }));
  } else if (mode === 'all_modal') {
    const maxRefs = modelDef.maxRefs;
    const images = references.length + (card.assetRefs ?? []).filter((a) => a.kind === 'image').length;
    if (images > maxRefs) {
      throw new Error(
        `Model ${card.model} supports at most ${maxRefs} reference assets, got ${images}`
      );
    }
    references = references.map((ref) => ({
      ...ref,
      role: 'reference_image',
    }));
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

  references.forEach((ref, idx) => {
    const cloudIndex = idx + 1;
    const resolved = resolveReferenceAsset(ref, allCards);

    compiledReferenceAssets.push({
      card_id: ref.cardId,
      tag_index: cloudIndex,
      role: ref.role,
      label: ref.label,
      url: resolved.url,
      local_path: resolved.localPath,
      remote_url: resolved.remoteUrl,
    });

    const tagRegex = new RegExp(`@?图${ref.tagIndex}\\b`, 'g');
    compiledPrompt = compiledPrompt.replace(tagRegex, `图${cloudIndex}`);
  });

  // 3. Reference videos from connected video cards (Ark only): @视频N → 视频1, 视频2, ...
  const videoReferences = mode === 'all_modal' ? card.videoReferences ?? [] : [];
  videoReferences.forEach((ref, idx) => {
    const resolved = resolveReferenceVideo(ref, allCards);
    compiledReferenceAssets.push({
      card_id: ref.cardId,
      tag_index: idx + 1,
      role: 'reference_video',
      label: ref.label,
      url: resolved.url,
      local_path: resolved.localPath,
      remote_url: resolved.remoteUrl,
    });
    compiledPrompt = compiledPrompt.replace(new RegExp(`@视频${ref.tagIndex}\\b`, 'g'), `视频${idx + 1}`);
  });

  compiledPrompt = compiledPrompt.replace(/@图(\d+)/g, '图$1').replace(/@视频(\d+)/g, '视频$1').trim();

  // 4. Asset-library references (Ark only), after the connected cards so 图片N / 视频N keep counting on.
  const assetRefs = mode === 'all_modal' ? card.assetRefs ?? [] : [];
  if ((assetRefs.length > 0 || videoReferences.length > 0) && protocol !== 'ark') {
    throw new Error('参考视频和素材库参考只支持火山方舟的 Seedance 模型');
  }
  for (const kind of ['video', 'audio'] as const) {
    const count = assetRefs.filter((a) => a.kind === kind).length + (kind === 'video' ? videoReferences.length : 0);
    const max = (kind === 'video' ? modelDef.maxVideoRefs : modelDef.maxAudioRefs) ?? 0;
    if (count > max) {
      throw new Error(`Model ${card.model} supports at most ${max} reference ${kind}s, got ${count}`);
    }
  }
  const kindCounts = { image: references.length, video: videoReferences.length, audio: 0 };
  for (const asset of assetRefs) {
    compiledReferenceAssets.push({
      card_id: '',
      tag_index: ++kindCounts[asset.kind],
      role: `reference_${asset.kind}`,
      label: asset.assetId,
      url: `asset://${asset.assetId}`,
    });
  }

  const params: Record<string, unknown> = {
    resolution: card.resolution ?? (isMiniMax ? '1080P' : '720p'),
    duration: card.duration ?? (isMiniMax ? 6 : 5),
    ratio: mode === 'first_last_frame' ? 'adaptive' : ratio,
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

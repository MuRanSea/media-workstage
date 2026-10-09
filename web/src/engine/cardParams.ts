import {
  IMAGE_MODELS,
  MJ_SPEED_LABELS,
  maxReferenceVideos,
  type AssetKind,
  type AssetRef,
  resolveVideoModelDef,
  type SpatialCard,
  type VideoModelDef,
  type VideoReferType,
  type VideoTaskMode,
} from '../types/canvas.ts';
import type { ModelOption } from './channelModels.ts';
import { protocolOf } from './providers.ts';
import { refTag } from './refTags.ts';
import { inferVideoProvider } from './videoCompiler.ts';

/**
 * Parameter changes shared by cards and the inspector panel. Each returns the
 * patch to apply to the card, so the rules live in one tested place.
 */

// --- Image ---------------------------------------------------------------------

/** Switching an image card's model: Seedream (Ark protocol) gets its tier defaults, other protocols ratio + resolution. */
export function imageModelPatch(card: SpatialCard, option: ModelOption): Partial<SpatialCard> {
  if (option.protocol === 'ark') {
    const def = IMAGE_MODELS.find((m) => m.id === option.id);
    return {
      provider: option.provider,
      model: option.id,
      imageTier: def?.defaultTier ?? '2K',
      customPixels: def?.defaultCustomPixel ?? '2048x1024',
      imageMode: 'single',
      ...midjourneyOnlyReset(option),
    };
  }
  return {
    provider: option.provider,
    model: option.id,
    imageMode: 'single',
    sizeMode: 'tier',
    imageResolution: card.imageResolution ?? '2K',
    ...midjourneyOnlyReset(option),
  };
}

/** Midjourney-only settings (speed, Blend, reference images) do not carry over to other providers. */
function midjourneyOnlyReset(option: ModelOption): Partial<SpatialCard> {
  return option.protocol === 'midjourney' ? {} : { mjSpeed: undefined, mjOperation: undefined, references: undefined };
}

/** One-line size description, e.g. "2K · 16:9", "2048x1024" or "Blend · 1:1 · Relax" (Midjourney). */
export function imageSizeSummary(card: SpatialCard): string {
  const ratio = card.imageRatioPreset ?? '16:9';
  const protocol = protocolOf(card.provider ?? 'ark');
  if (protocol === 'midjourney') {
    const parts = [card.mjOperation === 'blend' ? 'Blend' : '', ratio, card.mjSpeed ? MJ_SPEED_LABELS[card.mjSpeed] : ''];
    return parts.filter(Boolean).join(' · ');
  }
  if (protocol !== 'ark') return `${card.imageResolution ?? '2K'} · ${ratio}`;
  if (card.sizeMode === 'custom_pixels') return card.customPixels ?? '';
  const def = IMAGE_MODELS.find((m) => m.id === card.model) ?? IMAGE_MODELS[0];
  return `${card.imageTier ?? def.defaultTier} · ${ratio}`;
}

// --- Preview shape -------------------------------------------------------------

/** Width ÷ height from "9:16" or "2048x1024"; undefined for "adaptive" or anything unparsable. */
export function parseAspect(value: string | undefined): number | undefined {
  const m = value?.trim().match(/^(\d+(?:\.\d+)?)\s*[:x×*]\s*(\d+(?:\.\d+)?)$/i);
  if (!m) return undefined;
  const [w, h] = [Number(m[1]), Number(m[2])];
  return w > 0 && h > 0 ? w / h : undefined;
}

/** The shape the card asked for, used to size its preview before a result has loaded. */
export function requestedAspect(card: SpatialCard): number | undefined {
  if (card.type === 'video') return card.mode === 'first_last_frame' ? undefined : parseAspect(card.ratio);
  if (protocolOf(card.provider ?? 'ark') === 'ark' && card.sizeMode === 'custom_pixels') return parseAspect(card.customPixels);
  return parseAspect(card.imageRatioPreset ?? '16:9');
}

/** Width ÷ height of a layer's bounding box (`{"absolute":[left, top, right, bottom]}`); layer images are cropped to it. */
function boundingBoxAspect(json: string | undefined): number | undefined {
  if (!json) return undefined;
  try {
    const [left, top, right, bottom] = (JSON.parse(json) as { absolute?: number[] }).absolute ?? [];
    const [w, h] = [right - left, bottom - top];
    return w > 0 && h > 0 ? w / h : undefined;
  } catch {
    return undefined;
  }
}

/** The shape a card's preview takes before its image has loaded: a layer result's own box, else what was asked for. */
export function previewAspect(card: SpatialCard): number | undefined {
  const assets = card.outputAssets;
  const own = card.role === 'result' && assets?.length === 1 ? boundingBoxAspect(assets[0].bounding_box_json) : undefined;
  return own ?? requestedAspect(card);
}

// --- Video ---------------------------------------------------------------------

export function videoModelDef(card: SpatialCard): VideoModelDef {
  return resolveVideoModelDef(protocolOf(card.provider ?? inferVideoProvider(card.model)), card.model);
}

/** Changing mode drops or re-roles references to fit the mode and the model's limit. */
export function videoModePatch(
  card: SpatialCard,
  mode: VideoTaskMode,
  maxRefs: number,
  ratio = card.ratio
): Partial<SpatialCard> {
  let references = (card.references ?? []).slice(0, maxRefs);
  let nextRatio = ratio;
  if (mode === 'text_to_video') {
    references = [];
  } else if (mode === 'first_last_frame') {
    references = references
      .filter((r) => r.role !== 'reference_video')
      .slice(0, 2)
      .map((r, i) => ({ ...r, role: i === 0 ? 'first_frame' : 'last_frame' }));
    nextRatio = 'adaptive';
  } else {
    references = references.map((r) => ({ ...r, role: r.role === 'reference_video' ? r.role : 'reference_image' }));
  }
  return { mode, ratio: nextRatio, references };
}

/** A model that cannot take reference videos loses the ones already attached (with their prompt tags). */
function dropUnsupportedVideoRefs(card: SpatialCard, option: ModelOption): Partial<SpatialCard> {
  const limit = maxReferenceVideos(option.protocol, option.id);
  const videos = (card.references ?? []).filter((r) => r.role === 'reference_video');
  if (videos.length <= limit) return {};
  const kept = videos.slice(0, limit);
  let prompt = card.prompt;
  for (const dropped of videos.slice(limit)) {
    prompt = prompt.replace(new RegExp(`${refTag(dropped)}\\b`, 'g'), '').replace(/\s{2,}/g, ' ').trim();
  }
  const base = videoModePatch(card, card.mode ?? 'all_modal', Infinity).references ?? [];
  return { prompt, references: base.filter((r) => r.role !== 'reference_video' || kept.some((k) => k.cardId === r.cardId)) };
}

/**
 * Switching a video card's model resets resolution and duration to what the model
 * supports, and moves to a mode it accepts (keeping attached images as frames when possible).
 */
export function videoModelPatch(card: SpatialCard, option: ModelOption): Partial<SpatialCard> {
  const def = resolveVideoModelDef(option.protocol, option.id);
  const current = card.mode ?? 'all_modal';
  let mode = current;
  if (def.modes && !def.modes.includes(current)) {
    const preferred: VideoTaskMode = (card.references?.length ?? 0) > 0 ? 'first_last_frame' : 'text_to_video';
    mode = def.modes.includes(preferred) ? preferred : def.modes[0];
  }
  const patch: Partial<SpatialCard> = {
    provider: option.provider,
    model: option.id,
    resolution: def.resolutions[0],
    duration: def.durations.includes(5) ? 5 : def.durations[0],
    ...videoModePatch(card, mode, def.maxRefs, def.ratios[0]),
    ...dropUnsupportedVideoRefs(card, option),
  };
  // Asset-library items are Seedance's; keep what still fits the new model.
  patch.assetRefs = option.protocol === 'ark' ? fitAssetRefs({ ...card, ...patch }, def) : undefined;
  return patch;
}

/** Removing a reference also removes its @图N tags from the prompt. */
export function removeReferencePatch(card: SpatialCard, refCardId: string): Partial<SpatialCard> {
  const ref = card.references?.find((r) => r.cardId === refCardId);
  const prompt = ref ? card.prompt.replace(new RegExp(`${refTag(ref)}\\b`, 'g'), '').replace(/\s{2,}/g, ' ').trim() : card.prompt;
  return { prompt, references: (card.references ?? []).filter((r) => r.cardId !== refCardId) };
}

/** e.g. "720p · 5s · 16:9"; "自适应" for adaptive duration. */
export function videoSpecSummary(card: SpatialCard): string {
  const duration = card.duration === -1 ? '自适应时长' : `${card.duration ?? 5}s`;
  const ratio = card.mode === 'first_last_frame' ? '随首帧' : card.ratio;
  return [card.resolution, duration, ratio].filter(Boolean).join(' · ');
}

export const VIDEO_MODE_LABELS: Record<VideoTaskMode, { label: string; hint: string }> = {
  all_modal: { label: '多图参考', hint: '引用多张图片，在提示词里用 @图N 说明各自用途' },
  first_last_frame: { label: '首尾帧', hint: '第 1 张作为首帧，第 2 张（可选）作为尾帧，比例跟随首帧' },
  text_to_video: { label: '纯文字', hint: '只根据提示词生成，不使用参考图' },
};

export const VIDEO_REFER_TYPE_LABELS: Record<VideoReferType, { label: string; hint: string }> = {
  base: { label: '编辑这段视频', hint: '在原视频上按提示词修改，时长和比例跟随原视频；最多再带 4 张参考图，生成结果不带声音' },
  feature: { label: '参考特征', hint: '借用原视频的运镜、动作或风格生成新视频；最多带 1 张图作为首帧，生成结果不带声音' },
};

// --- Asset library (Ark 素材库) -------------------------------------------------

export const ASSET_KIND_LABELS: Record<AssetKind, string> = { image: '图片', video: '视频', audio: '音频' };
/** The word the prompt uses for each kind, as for connected cards (图N, 视频N). */
const ASSET_PROMPT_NOUN: Record<AssetKind, string> = { image: '图', video: '视频', audio: '音频' };

/** Asset-library references are Seedance's: only cards on an Ark-protocol provider take them. */
export function supportsAssetRefs(card: SpatialCard): boolean {
  return protocolOf(card.provider ?? inferVideoProvider(card.model)) === 'ark';
}

/** "asset://asset-2026…" or "asset-2026…" → the bare ID; empty when the input is not a usable ID. */
export function normalizeAssetId(input: string): string {
  const id = input.trim().replace(/^asset:\/\//i, '').trim();
  return /^[\w.-]+$/.test(id) ? id : '';
}

/** How many references of `kind` the model takes in multi-reference mode, connected cards and assets together. */
export function kindLimit(card: SpatialCard, kind: AssetKind, def = videoModelDef(card)): number {
  if (kind === 'video') return maxReferenceVideos(protocolOf(card.provider ?? inferVideoProvider(card.model)), card.model);
  if (kind === 'audio') return def.maxAudioRefs ?? 0;
  return def.maxRefs;
}

/** References per kind that come from connected cards. */
function connectedCounts(card: SpatialCard): Record<AssetKind, number> {
  const refs = card.references ?? [];
  const videos = refs.filter((r) => r.role === 'reference_video').length;
  return { image: refs.length - videos, video: videos, audio: 0 };
}

/** References of `kind` the card sends: connected cards plus asset-library items. */
export function referenceCount(card: SpatialCard, kind: AssetKind): number {
  return connectedCounts(card)[kind] + (card.assetRefs ?? []).filter((a) => a.kind === kind).length;
}

/**
 * The name the prompt uses for an asset, e.g. 视频1 or 图3. Seedance numbers each kind
 * in request order, and assets follow the connected cards of their kind.
 */
export function assetPromptName(card: SpatialCard, asset: AssetRef): string {
  const sameKind = (card.assetRefs ?? []).filter((a) => a.kind === asset.kind);
  return `${ASSET_PROMPT_NOUN[asset.kind]}${connectedCounts(card)[asset.kind] + sameKind.indexOf(asset) + 1}`;
}

/** Drops asset references beyond what the model takes, per kind, keeping the earliest. */
function fitAssetRefs(card: SpatialCard, def: VideoModelDef): AssetRef[] | undefined {
  if (!card.assetRefs?.length) return card.assetRefs;
  const connected = connectedCounts(card);
  const used: Record<AssetKind, number> = { image: 0, video: 0, audio: 0 };
  const kept = card.assetRefs.filter((a) => connected[a.kind] + ++used[a.kind] <= kindLimit(card, a.kind, def));
  return kept.length ? kept : undefined;
}

/** Adding an asset reference; a text-only card switches to multi-reference mode, as connecting an image does. */
export function addAssetRefPatch(
  card: SpatialCard,
  input: string,
  kind: AssetKind
): { ok: true; patch: Partial<SpatialCard> } | { ok: false; reason: string } {
  if (!supportsAssetRefs(card)) return { ok: false, reason: '素材库只支持火山方舟的 Seedance 模型' };
  const assetId = normalizeAssetId(input);
  if (!assetId) return { ok: false, reason: '请填入素材 ID，例如 asset-20260401123823-6d4x2' };
  const assets = card.assetRefs ?? [];
  if (assets.some((a) => a.assetId === assetId)) return { ok: false, reason: '这个素材已经添加过了' };

  const mode = card.mode ?? 'all_modal';
  if (mode === 'first_last_frame') return { ok: false, reason: '素材库参考需要「多图参考」模式' };
  const def = videoModelDef(card);
  const limit = kindLimit(card, kind, def);
  if (referenceCount(card, kind) >= limit) {
    return {
      ok: false,
      reason:
        limit === 0
          ? `${def.name} 不支持参考${ASSET_KIND_LABELS[kind]}`
          : `${def.name} 最多 ${limit} 个参考${ASSET_KIND_LABELS[kind]}（含连入的卡片）`,
    };
  }
  return { ok: true, patch: { mode: 'all_modal', assetRefs: [...assets, { assetId, kind }] } };
}

export function removeAssetRefPatch(card: SpatialCard, assetId: string): Partial<SpatialCard> {
  const assetRefs = (card.assetRefs ?? []).filter((a) => a.assetId !== assetId);
  return { assetRefs: assetRefs.length ? assetRefs : undefined };
}

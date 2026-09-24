import {
  IMAGE_MODELS,
  MJ_SPEED_LABELS,
  resolveVideoModelDef,
  type SpatialCard,
  type VideoModelDef,
  type VideoTaskMode,
} from '../types/canvas.ts';
import type { ModelOption } from './channelModels.ts';
import { protocolOf } from './providers.ts';
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

/** Midjourney-only settings (speed, blend, reference images) do not carry over to other channels. */
function midjourneyOnlyReset(option: ModelOption): Partial<SpatialCard> {
  return option.protocol === 'midjourney' ? {} : { mjSpeed: undefined, mjOperation: undefined, references: undefined };
}

/** One-line size description, e.g. "2K · 16:9", "2048x1024" or "16:9 · Relax" (Midjourney). */
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
    references = references.slice(0, 2).map((r, i) => ({ ...r, role: i === 0 ? 'first_frame' : 'last_frame' }));
    nextRatio = 'adaptive';
  } else {
    references = references.map((r) => ({ ...r, role: 'reference_image' }));
  }
  return { mode, ratio: nextRatio, references };
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
  return {
    provider: option.provider,
    model: option.id,
    resolution: def.resolutions[0],
    duration: def.durations.includes(5) ? 5 : def.durations[0],
    ...videoModePatch(card, mode, def.maxRefs, def.ratios[0]),
  };
}

/** Removing a reference also removes its @图N tags from the prompt. */
export function removeReferencePatch(card: SpatialCard, refCardId: string): Partial<SpatialCard> {
  const ref = card.references?.find((r) => r.cardId === refCardId);
  const prompt = ref ? card.prompt.replace(new RegExp(`@图${ref.tagIndex}\\b`, 'g'), '').replace(/\s{2,}/g, ' ').trim() : card.prompt;
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

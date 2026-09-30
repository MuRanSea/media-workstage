import { SEEDREAM_PIXEL_MAP, type MjOperation, type MjSpeed, type ReferenceItem, type SpatialCard } from '../types/canvas.ts';
import type { CreateTaskPayload, ProviderId } from '../services/api.ts';
import { protocolOf } from './providers.ts';
import { MJ_MAX_REFERENCES, MJ_MIN_BLEND_IMAGES, midjourneyReferences } from './midjourney.ts';

export interface ImageCompilationInput {
  /** Provider running the model; defaults to 'ark'. Ark-protocol providers get Seedream rules. */
  provider?: ProviderId;
  model: string;
  prompt: string;
  imageMode?: 'single' | 'layer_decomp' | 'sequential';
  sizeMode?: 'tier' | 'custom_pixels';
  imageTier?: string;
  imageRatioPreset?: string;
  customPixels?: string;
  imageFormat?: 'jpeg' | 'png';
  watermark?: boolean;
  background?: 'opaque' | 'transparent';
  imageResolution?: '1K' | '2K' | '4K';
  mjSpeed?: MjSpeed;
  mjOperation?: MjOperation;
  /** Midjourney reference images, resolved against `allCards`. */
  references?: ReferenceItem[];
  allCards?: SpatialCard[];
}

/**
 * Compiles and strictly validates a Seedream image generation request payload.
 * Used identically by both the JSON inspector and POST /api/tasks.
 */
export function compileImageTaskPayload(input: ImageCompilationInput): CreateTaskPayload {
  const provider = input.provider ?? 'ark';
  if (protocolOf(provider) !== 'ark') {
    return compileChannelImagePayload(provider, input);
  }

  const isLayerDecomp = input.imageMode === 'layer_decomp';
  const isSequential = input.imageMode === 'sequential';

  let finalSize = '2048x2048';

  if (isLayerDecomp) {
    finalSize = 'auto';
  } else if (input.sizeMode === 'custom_pixels') {
    const custom = input.customPixels?.trim();
    if (!custom || !/^\d+\s*[xX]\s*\d+$/.test(custom)) {
      throw new Error(`Invalid custom pixel dimensions: "${input.customPixels}", expected <width>x<height>`);
    }
    finalSize = custom.toLowerCase().replace(/\s+/g, '');
  } else {
    // Method 1: Tier + Aspect Ratio mapping
    const tier = input.imageTier ?? '2K';
    const ratio = input.imageRatioPreset ?? '16:9';

    const tierMap = SEEDREAM_PIXEL_MAP[tier];
    if (!tierMap) {
      throw new Error(`Unsupported Seedream size tier: "${tier}"`);
    }

    const mappedDimension = tierMap[ratio];
    if (!mappedDimension) {
      throw new Error(`Unsupported tier/ratio combination: tier="${tier}", ratio="${ratio}"`);
    }

    finalSize = mappedDimension;
  }

  const taskMode = isLayerDecomp
    ? 'layer_decomp'
    : isSequential
    ? 'sequential'
    : 'single';

  return {
    provider,
    model: input.model,
    task_type: 'image_generation',
    task_mode: taskMode,
    prompt: input.prompt,
    params: {
      size: finalSize,
      response_format: 'url',
      output_format: input.imageFormat ?? 'jpeg',
      watermark: input.watermark ?? false,
      background: input.background ?? 'opaque',
      layer_decomposition: isLayerDecomp,
      sequential_image_generation: isSequential ? 'auto' : 'disabled',
    },
  };
}

/**
 * Compiles the provider-neutral image payload used by non-Ark protocols. The backend
 * adapter maps aspect_ratio + resolution onto each protocol's own size parameters.
 */
function compileChannelImagePayload(provider: ProviderId, input: ImageCompilationInput): CreateTaskPayload {
  const aspect_ratio = input.imageRatioPreset ?? '16:9';
  const payload: CreateTaskPayload = {
    provider,
    model: input.model,
    task_type: 'image_generation',
    task_mode: 'single',
    prompt: input.prompt,
    params: { aspect_ratio, resolution: input.imageResolution ?? '2K' },
  };
  if (protocolOf(provider) !== 'midjourney') return payload;

  // Midjourney has no resolution; its speed picks the proxy account.
  payload.params = { aspect_ratio, ...(input.mjSpeed ? { speed: input.mjSpeed } : {}) };
  const references = input.references ?? [];
  if (references.length > MJ_MAX_REFERENCES) {
    throw new Error(`Midjourney 最多 ${MJ_MAX_REFERENCES} 张参考图，当前 ${references.length} 张`);
  }
  if (references.length) payload.reference_assets = midjourneyReferences(references, input.allCards ?? []);
  if (input.mjOperation === 'blend') {
    if (references.length < MJ_MIN_BLEND_IMAGES) {
      throw new Error(`Blend 需要连入 ${MJ_MIN_BLEND_IMAGES}–${MJ_MAX_REFERENCES} 张图片，当前 ${references.length} 张`);
    }
    // Blend takes no prompt; the backend still records one.
    payload.task_mode = 'blend';
    payload.prompt = input.prompt.trim() || 'Blend';
  } else if (!input.prompt.trim()) {
    throw new Error('请先填写提示词');
  }
  return payload;
}

/**
 * Convenience helper to compile directly from a SpatialCard.
 */
export function compileCardImagePayload(card: SpatialCard, allCards: SpatialCard[] = []): CreateTaskPayload {
  return compileImageTaskPayload({
    provider: card.provider,
    model: card.model,
    prompt: card.prompt,
    imageMode: card.imageMode,
    sizeMode: card.sizeMode,
    imageTier: card.imageTier,
    imageRatioPreset: card.imageRatioPreset,
    customPixels: card.customPixels,
    imageFormat: card.imageFormat,
    watermark: card.watermark,
    background: card.background,
    imageResolution: card.imageResolution,
    mjSpeed: card.mjSpeed,
    mjOperation: card.mjOperation,
    references: card.references,
    allCards,
  });
}

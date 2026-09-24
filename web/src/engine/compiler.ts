import { SEEDREAM_PIXEL_MAP, type MjSpeed, type ReferenceItem, type SpatialCard } from '../types/canvas.ts';
import type { CreateTaskPayload, ProviderId } from '../services/api.ts';
import { protocolOf } from './providers.ts';
import { resolveReferenceAsset } from './videoCompiler.ts';
import { MJ_MAX_REFERENCES } from './connections.ts';

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
  mjOperation?: 'imagine' | 'blend';
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
  if (input.references?.length) payload.reference_assets = compileReferenceImages(input.references, input.allCards);
  if (input.mjOperation === 'blend') {
    const count = input.references?.length ?? 0;
    if (count < 2 || count > MJ_MAX_REFERENCES) throw new Error(`Blend 需要连入 2–5 张图片，当前 ${count} 张`);
    // Blend takes no prompt; the backend still records one.
    payload.task_mode = 'blend';
    payload.prompt = input.prompt.trim() || 'Blend';
  }
  return payload;
}

/** Reference images in connection order; the backend reads the files and sends them inline. */
function compileReferenceImages(references: ReferenceItem[], allCards: SpatialCard[] = []): CreateTaskPayload['reference_assets'] {
  return references.map((ref, idx) => {
    const resolved = resolveReferenceAsset(ref, allCards);
    return {
      card_id: ref.cardId,
      tag_index: idx + 1,
      role: ref.role,
      label: ref.label,
      url: resolved.url,
      local_path: resolved.localPath,
      remote_url: resolved.remoteUrl,
    };
  });
}

/**
 * Convenience helper to compile directly from a SpatialCard.
 */
export function compileCardImagePayload(card: SpatialCard, allCards: SpatialCard[] = []): CreateTaskPayload {
  if (card.derivedFrom?.operation === 'action') return compileActionPayload(card);
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

/**
 * A derived card runs its operation on the source card's task; the backend checks the
 * source task offered that action. The prompt is only recorded (and confirms modals).
 */
function compileActionPayload(card: SpatialCard): CreateTaskPayload {
  const from = card.derivedFrom!;
  if (!from.actionId) throw new Error(`「${card.title}」缺少要执行的操作`);
  return {
    provider: card.provider ?? 'ark',
    model: card.model,
    task_type: 'image_generation',
    task_mode: 'action',
    prompt: card.prompt.trim() || from.label,
    params: { source_task_id: from.taskId, action_id: from.actionId },
  };
}

/** A describe card sends its source image to Midjourney Describe; the prompts come back as text. */
export function compileDescribePayload(card: SpatialCard, allCards: SpatialCard[] = []): CreateTaskPayload {
  if (!card.references?.length) throw new Error(`「${card.title}」没有要反推的图片`);
  return {
    provider: card.provider ?? '',
    model: card.model,
    task_type: 'image_generation',
    task_mode: 'describe',
    prompt: '反推提示词',
    params: {},
    reference_assets: compileReferenceImages(card.references.slice(0, 1), allCards),
  };
}

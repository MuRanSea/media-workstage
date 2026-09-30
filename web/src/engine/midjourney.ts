import type { ReferenceItem, ResultActionDto, SpatialCard } from '../types/canvas.ts';
import type { CreateTaskPayload, ProviderConfigItem, ProviderId } from '../services/api.ts';
import { protocolOf } from './providers.ts';
import { assetStoredPath } from './assetPaths.ts';
import { mediaKindOf } from './uploadRefs.ts';

/** Reference images a Midjourney imagine or Blend takes. */
export const MJ_MAX_REFERENCES = 5;
export const MJ_MIN_BLEND_IMAGES = 2;

/** A card that runs on a Midjourney (MJ Proxy) provider. */
export function isMidjourney(card: Pick<SpatialCard, 'provider'>): boolean {
  return protocolOf(card.provider ?? 'ark') === 'midjourney';
}

/** The saved image file of an image result or an uploaded image, if it has one. */
export function savedImageOf(card: SpatialCard): string | undefined {
  if (mediaKindOf(card) !== 'image') return undefined;
  const path = assetStoredPath(card.outputAssets?.find((a) => a.local_path)) ?? card.resultUrl;
  return path && !/^https?:\/\//.test(path) ? path : undefined;
}

/**
 * Reference images in connection order. The proxy takes them inline, so each goes as
 * its saved file (links from uploads or the provider expire, and the backend reads the file).
 */
export function midjourneyReferences(references: ReferenceItem[], allCards: SpatialCard[]): CreateTaskPayload['reference_assets'] {
  return references.map((ref, idx) => {
    const src = allCards.find((c) => c.id === ref.cardId);
    if (!src) throw new Error(`参考图 @图${ref.tagIndex} 对应的卡片已不在画布上`);
    const localPath = savedImageOf(src);
    if (!localPath) throw new Error(`参考图「${src.title}」还没有图片`);
    return { card_id: ref.cardId, tag_index: idx + 1, role: 'reference_image', label: ref.label, local_path: localPath };
  });
}

/** Runs `action` on the result card `source`'s task; the backend checks the task offered it. */
export function compileActionPayload(source: SpatialCard, action: ResultActionDto, label: string): CreateTaskPayload {
  if (!source.taskId || source.status !== 'succeeded') throw new Error(`「${source.title}」还没有可以操作的生成结果`);
  return {
    provider: source.provider ?? 'ark',
    model: source.model,
    task_type: 'image_generation',
    task_mode: 'action',
    // Only recorded, and used to confirm the proxy's modal when one appears.
    prompt: source.prompt.trim() || label,
    params: { source_task_id: source.taskId, action_id: action.id },
  };
}

/** Sends `source`'s image to Midjourney Describe; the suggested prompts come back as text. */
export function compileDescribePayload(source: SpatialCard, runner: { provider: ProviderId; model: string }): CreateTaskPayload {
  const localPath = savedImageOf(source);
  if (!localPath) throw new Error(`「${source.title}」还没有图片，无法反推提示词`);
  return {
    provider: runner.provider,
    model: runner.model,
    task_type: 'image_generation',
    task_mode: 'describe',
    prompt: '反推提示词',
    params: {},
    reference_assets: [{ card_id: source.id, tag_index: 1, role: 'reference_image', label: source.title, local_path: localPath }],
  };
}

/** The Midjourney provider and image model that runs Describe, if one is configured. */
export function findDescribeProvider(providers: ProviderConfigItem[]): { provider: ProviderId; model: string } | undefined {
  for (const p of providers) {
    if (p.protocol !== 'midjourney' || !p.is_configured) continue;
    const model = p.models.find((m) => m.type === 'image');
    if (model) return { provider: p.id, model: model.id };
  }
  return undefined;
}

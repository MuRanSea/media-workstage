import type { GenerateTextPayload, TextImage } from '../services/api.ts';
import type { SpatialCard } from '../types/canvas.ts';
import { withEffectivePrompt } from './connections.ts';
import { getTextPreset } from './textPresets.ts';
import { resolveReferenceAsset } from './videoCompiler.ts';

/**
 * Builds the request for one run of a text generation card: the prompt (or the
 * output of the text card linked into it) and its connected images, in order.
 * Canvas-wide tags (@图5) become the position the model sees them at (图1).
 * Throws a message for the card when it cannot run yet.
 */
export function compileTextPayload(card: SpatialCard, cards: SpatialCard[]): GenerateTextPayload {
  if (!card.provider || !card.model) throw new Error('请先选择服务商和模型');
  const submitted = withEffectivePrompt(card, cards);
  if (!submitted.prompt.trim()) throw new Error('请先填写想法');

  const position = new Map<number, number>();
  const images: TextImage[] = (card.references ?? []).map((ref, i) => {
    // Any protocol but Ark: an LLM needs a link or the file, never an asset-library id.
    const resolved = resolveReferenceAsset(ref, cards, 'openai_compatible');
    position.set(ref.tagIndex, i + 1);
    return {
      card_id: ref.cardId,
      tag_index: i + 1,
      role: 'reference_image',
      label: ref.label,
      url: resolved.url,
      local_path: resolved.localPath,
    };
  });

  const prompt = submitted.prompt
    .replace(/@?图(\d+)\b/g, (mention, n: string) => {
      const at = position.get(Number(n));
      return at === undefined ? mention : `图${at}`;
    })
    .trim();

  return {
    provider: card.provider,
    model: card.model,
    system: getTextPreset(card.textPreset).system,
    prompt,
    ...(images.length ? { images } : {}),
  };
}

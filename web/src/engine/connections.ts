import { resolveVideoModelDef, type ReferenceItem, type SpatialCard } from '../types/canvas.ts';
import { inferVideoProvider } from './videoCompiler.ts';
import { protocolOf } from './providers.ts';

export type ConnectResult =
  | { ok: true; patch: Partial<SpatialCard> }
  | { ok: false; reason: string };

/** Which card types expose an output port (can be dragged from). */
export function hasOutputPort(card: SpatialCard): boolean {
  return card.type === 'image' || card.type === 'text';
}

/** Which card types expose an input port (can be dropped on). */
export function hasInputPort(card: SpatialCard): boolean {
  return card.type === 'image' || card.type === 'video';
}

/**
 * Works out what dragging a line from `source` onto `target` means and returns the
 * patch for the target card:
 *   text  → image/video : the text card's output becomes the target's prompt
 *   image → video       : the image becomes a reference (as "+ 引入" does)
 *   image → Midjourney image : the image becomes a reference image (垫图)
 */
export function connectCards(source: SpatialCard, target: SpatialCard): ConnectResult {
  if (source.id === target.id) return { ok: false, reason: '不能连接到自己' };

  if (source.type === 'text') {
    if (target.type === 'text') return { ok: false, reason: '文本卡片之间暂不支持连线' };
    if (target.promptSourceId === source.id) return { ok: false, reason: '已经连接过了' };
    return { ok: true, patch: { promptSourceId: source.id } };
  }

  if (source.type === 'image') {
    if (target.type === 'image') {
      if (protocolOf(target.provider ?? 'ark') !== 'midjourney') {
        return { ok: false, reason: '只有 Midjourney 图片卡片支持连入参考图' };
      }
      return attachImageToMidjourney(source, target);
    }
    if (target.type === 'text') return { ok: false, reason: '文本卡片没有输入端口' };
    return attachImageToVideo(source, target);
  }

  return { ok: false, reason: '视频卡片没有输出端口' };
}

/** Midjourney's reference-image limit (midjourney-proxy base64Array). */
export const MJ_MAX_REFERENCES = 5;

/** Midjourney takes reference images as data, so no @图N tag is added to its prompt. */
function attachImageToMidjourney(image: SpatialCard, target: SpatialCard): ConnectResult {
  if (target.derivedFrom) return { ok: false, reason: '派生卡片沿用来源卡片的设置，不能连入参考图' };
  const refs = target.references ?? [];
  if (refs.some((r) => r.cardId === image.id)) return { ok: false, reason: '已经连接过了' };
  if (refs.length >= MJ_MAX_REFERENCES) return { ok: false, reason: `Midjourney 最多 ${MJ_MAX_REFERENCES} 张参考图` };
  const ref: ReferenceItem = {
    cardId: image.id,
    tagIndex: image.tagIndex,
    role: 'reference_image',
    label: image.title.slice(0, 10),
    url: image.resultUrl,
  };
  return { ok: true, patch: { references: [...refs, ref] } };
}

function attachImageToVideo(image: SpatialCard, video: SpatialCard): ConnectResult {
  const refs = video.references ?? [];
  if (refs.some((r) => r.cardId === image.id)) return { ok: false, reason: '已经连接过了' };

  const provider = video.provider ?? inferVideoProvider(video.model);
  const def = resolveVideoModelDef(protocolOf(provider), video.model);
  const supports = (m: NonNullable<SpatialCard['mode']>) => !def.modes || def.modes.includes(m);

  // A text-only card switches to a mode that takes images.
  let mode = video.mode ?? 'all_modal';
  let ratio = video.ratio;
  if (mode === 'text_to_video') {
    mode = supports('all_modal') ? 'all_modal' : 'first_last_frame';
    if (mode === 'first_last_frame') ratio = 'adaptive';
  }

  const limit = mode === 'first_last_frame' ? Math.min(2, def.maxRefs) : def.maxRefs;
  if (refs.length >= limit) {
    return { ok: false, reason: `${def.name} 在当前模式下最多 ${limit} 张参考图` };
  }

  const role: ReferenceItem['role'] =
    mode === 'first_last_frame' ? (refs.length === 0 ? 'first_frame' : 'last_frame') : 'reference_image';
  const newRef: ReferenceItem = {
    cardId: image.id,
    tagIndex: image.tagIndex,
    role,
    label: image.title.slice(0, 10),
    url: image.resultUrl,
  };
  const tag = `@图${image.tagIndex}`;
  const prompt = video.prompt.includes(tag) ? video.prompt : `${video.prompt} ${tag}`.trim();

  return { ok: true, patch: { mode, ratio, prompt, references: [...refs, newRef] } };
}

/** The prompt a card actually generates with: its linked text card's output, if any. */
export function effectivePrompt(card: SpatialCard, cards: SpatialCard[]): string {
  if (!card.promptSourceId) return card.prompt;
  const source = cards.find((c) => c.id === card.promptSourceId);
  return source?.textOutput?.trim() ? source.textOutput.trim() : card.prompt;
}

/** Throws when a linked text card has no output yet, so the user is told instead of silently using the old prompt. */
export function withEffectivePrompt(card: SpatialCard, cards: SpatialCard[]): SpatialCard {
  if (!card.promptSourceId) return card;
  const source = cards.find((c) => c.id === card.promptSourceId);
  if (!source) return { ...card, promptSourceId: undefined };
  if (!source.textOutput?.trim()) {
    throw new Error(`连接的文本卡片「${source.title}」还没有生成内容，请先生成文本`);
  }
  return { ...card, prompt: source.textOutput.trim() };
}

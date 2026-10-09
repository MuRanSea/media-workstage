import { maxReferenceVideos, resolveVideoModelDef, type ReferenceItem, type SpatialCard } from '../types/canvas.ts';
import { inferVideoProvider } from './videoCompiler.ts';
import { protocolOf } from './providers.ts';
import { mentionsTag, refTag, withoutRefTag } from './refTags.ts';
import { MJ_MAX_REFERENCES, isMidjourney } from './midjourney.ts';

export type ConnectResult =
  | { ok: true; patch: Partial<SpatialCard> }
  | { ok: false; reason: string };

/**
 * Which cards expose an output port (can be dragged from): result cards, uploads
 * included. Generation cards hold no output.
 */
export function hasOutputPort(card: SpatialCard): boolean {
  return card.role === 'result';
}

/** Which cards expose an input port (can be dropped on): image and video generation cards. Results are finished. */
export function hasInputPort(card: SpatialCard): boolean {
  return card.role === 'generation' && (card.type === 'image' || card.type === 'video');
}

/**
 * Works out what dragging a line from `source` onto `target` means and returns the
 * patch for the target card:
 *   text  → image/video : the text card's output becomes the target's prompt
 *   image → video       : the image becomes a reference (as "+ 引入" does)
 *   video → video       : the video becomes a reference video
 *   upload → video      : the uploaded image or video becomes a reference
 *   image → Midjourney image card (uploads included): a reference image to imagine or blend from
 */
export function connectCards(source: SpatialCard, target: SpatialCard): ConnectResult {
  if (source.id === target.id) return { ok: false, reason: '不能连接到自己' };
  if (source.role === 'generation') return { ok: false, reason: '生成卡没有输出端口，请从它的结果卡连线' };
  if (target.role === 'result') return { ok: false, reason: '结果卡没有输入端口' };

  if (source.type === 'text') {
    if (target.type === 'text') return { ok: false, reason: '文本卡片之间暂不支持连线' };
    if (target.promptSourceId === source.id) return { ok: false, reason: '已经连接过了' };
    return { ok: true, patch: { promptSourceId: source.id } };
  }

  const isImage = source.type === 'image' || (source.type === 'upload' && source.mediaKind !== 'video');
  if (isImage && target.type === 'image') {
    if (!isMidjourney(target)) return { ok: false, reason: '只有 Midjourney 图片卡片支持连入参考图' };
    return attachImageToMidjourney(source, target);
  }

  if (source.type === 'upload') {
    if (target.type !== 'video') return { ok: false, reason: '上传的视频只能连接到视频卡片' };
    return source.mediaKind === 'video' ? attachVideoToVideo(source, target) : attachImageToVideo(source, target);
  }

  if (source.type === 'image') {
    if (target.type === 'text') return { ok: false, reason: '文本卡片没有输入端口' };
    return attachImageToVideo(source, target);
  }

  if (target.type !== 'video') return { ok: false, reason: '视频只能连接到视频卡片' };
  return attachVideoToVideo(source, target);
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
  if (image.tagIndex === undefined) return { ok: false, reason: '这张图片卡没有 @图 编号，无法引用' };
  const newRef: ReferenceItem = {
    cardId: image.id,
    tagIndex: image.tagIndex,
    role,
    label: image.title.slice(0, 10),
  };
  const tag = refTag(newRef);
  const prompt = mentionsTag(video.prompt, tag) ? video.prompt : `${video.prompt} ${tag}`.trim();

  return { ok: true, patch: { mode, ratio, prompt, references: [...refs, newRef] } };
}

/** A Midjourney card takes up to 5 images; its prompt does not name them, so no tag is added. */
function attachImageToMidjourney(image: SpatialCard, card: SpatialCard): ConnectResult {
  const refs = card.references ?? [];
  if (refs.some((r) => r.cardId === image.id)) return { ok: false, reason: '已经连接过了' };
  if (refs.length >= MJ_MAX_REFERENCES) return { ok: false, reason: `Midjourney 最多 ${MJ_MAX_REFERENCES} 张参考图` };
  if (image.tagIndex === undefined) return { ok: false, reason: '这张图片卡没有 @图 编号，无法引用' };
  const newRef: ReferenceItem = { cardId: image.id, tagIndex: image.tagIndex, role: 'reference_image', label: image.title.slice(0, 10) };
  return { ok: true, patch: { references: [...refs, newRef] } };
}

/** A reference video only goes to models that take one (Ark's Seedance) in the multi-reference mode. */
function attachVideoToVideo(clip: SpatialCard, video: SpatialCard): ConnectResult {
  const refs = video.references ?? [];
  if (refs.some((r) => r.cardId === clip.id)) return { ok: false, reason: '已经连接过了' };

  const provider = video.provider ?? inferVideoProvider(video.model);
  const protocol = protocolOf(provider);
  const def = resolveVideoModelDef(protocol, video.model);
  const maxVideos = maxReferenceVideos(protocol, video.model);
  if (maxVideos === 0) return { ok: false, reason: `${def.name} 不支持参考视频，请换用 Seedance、Kling Omni 或 MiniMax H3` };
  if (refs.filter((r) => r.role === 'reference_video').length >= maxVideos) {
    return { ok: false, reason: `${def.name} 最多 ${maxVideos} 个参考视频` };
  }

  const mode = video.mode ?? 'all_modal';
  if (mode === 'first_last_frame') return { ok: false, reason: '首尾帧模式不能带参考视频，请先切换到「多图参考」' };
  if (refs.length >= def.maxRefs) return { ok: false, reason: `${def.name} 最多 ${def.maxRefs} 个参考素材` };

  if (clip.tagIndex === undefined) return { ok: false, reason: '这段视频没有 @视频 编号，无法引用' };
  const newRef: ReferenceItem = {
    cardId: clip.id,
    tagIndex: clip.tagIndex,
    role: 'reference_video',
    label: clip.title.slice(0, 10),
  };
  const tag = refTag(newRef);
  const prompt = mentionsTag(video.prompt, tag) ? video.prompt : `${video.prompt} ${tag}`.trim();
  return { ok: true, patch: { mode: 'all_modal', prompt, references: [...refs, newRef] } };
}

/** The prompt a card actually generates with: its linked text card's output, if any. */
export function effectivePrompt(card: SpatialCard, cards: SpatialCard[]): string {
  if (!card.promptSourceId) return card.prompt;
  const source = cards.find((c) => c.id === card.promptSourceId);
  return source?.textOutput?.trim() ? source.textOutput.trim() : card.prompt;
}

/**
 * Throws when a linked text card is still running or has no output yet, so the
 * user is told instead of silently using the old prompt.
 */
export function withEffectivePrompt(card: SpatialCard, cards: SpatialCard[]): SpatialCard {
  if (!card.promptSourceId) return card;
  const source = cards.find((c) => c.id === card.promptSourceId);
  if (!source) return { ...card, promptSourceId: undefined };
  if (source.status === 'queued' || source.status === 'running') {
    throw new Error(`连接的文本卡片「${source.title}」还在生成中，请等它完成后再生成`);
  }
  if (!source.textOutput?.trim()) {
    throw new Error(`连接的文本卡片「${source.title}」还没有生成内容，请先生成文本`);
  }
  return { ...card, prompt: source.textOutput.trim() };
}

/**
 * `cards` without the cards in `ids`, and without the prompt sources and references
 * that pointed at them. Result cards of a deleted generation card stay, standalone.
 */
export function removeCards(cards: SpatialCard[], ids: Iterable<string>): SpatialCard[] {
  const gone = new Set(ids);
  return cards
    .filter((c) => !gone.has(c.id))
    .map((c) => {
      const dropped = c.references?.filter((r) => gone.has(r.cardId)) ?? [];
      const promptSourceId = c.promptSourceId && gone.has(c.promptSourceId) ? undefined : c.promptSourceId;
      const sourceId = c.sourceId && gone.has(c.sourceId) ? undefined : c.sourceId;
      if (!dropped.length && promptSourceId === c.promptSourceId && sourceId === c.sourceId) return c;
      // A deleted reference's tag leaves the prompt, as when it is disconnected: left in,
      // it would be sent as 图N and name whichever image is Nth.
      const prompt = dropped.reduce((text, ref) => withoutRefTag(text, ref), c.prompt);
      return { ...c, prompt, references: c.references?.filter((r) => !gone.has(r.cardId)), promptSourceId, sourceId };
    });
}

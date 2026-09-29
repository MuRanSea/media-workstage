import { maxReferenceVideos, resolveVideoModelDef, type ReferenceItem, type SpatialCard } from '../types/canvas.ts';
import { inferVideoProvider } from './videoCompiler.ts';
import { protocolOf } from './providers.ts';
import { refTag } from './refTags.ts';

export type ConnectResult =
  | { ok: true; patch: Partial<SpatialCard> }
  | { ok: false; reason: string };

/** Which card types expose an output port (can be dragged from). */
export function hasOutputPort(card: SpatialCard): boolean {
  return card.type === 'image' || card.type === 'text' || card.type === 'upload';
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
 *   upload → video      : the uploaded image or video becomes a reference
 */
export function connectCards(source: SpatialCard, target: SpatialCard): ConnectResult {
  if (source.id === target.id) return { ok: false, reason: '不能连接到自己' };

  if (source.type === 'text') {
    if (target.type === 'text') return { ok: false, reason: '文本卡片之间暂不支持连线' };
    if (target.promptSourceId === source.id) return { ok: false, reason: '已经连接过了' };
    return { ok: true, patch: { promptSourceId: source.id } };
  }

  if (source.type === 'upload') {
    if (target.type !== 'video') return { ok: false, reason: '上传的素材只能连接到视频卡片' };
    return source.mediaKind === 'video' ? attachVideoToVideo(source, target) : attachImageToVideo(source, target);
  }

  if (source.type === 'image') {
    if (target.type === 'image') return { ok: false, reason: '图片卡片之间暂不支持连线（参考图生图尚未接入）' };
    if (target.type === 'text') return { ok: false, reason: '文本卡片没有输入端口' };
    return attachImageToVideo(source, target);
  }

  return { ok: false, reason: '视频卡片没有输出端口' };
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
  const tag = refTag(newRef);
  const prompt = video.prompt.includes(tag) ? video.prompt : `${video.prompt} ${tag}`.trim();

  return { ok: true, patch: { mode, ratio, prompt, references: [...refs, newRef] } };
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

  const newRef: ReferenceItem = {
    cardId: clip.id,
    tagIndex: clip.tagIndex,
    role: 'reference_video',
    label: clip.title.slice(0, 10),
    url: clip.resultUrl,
  };
  const tag = refTag(newRef);
  const prompt = video.prompt.includes(tag) ? video.prompt : `${video.prompt} ${tag}`.trim();
  return { ok: true, patch: { mode: 'all_modal', prompt, references: [...refs, newRef] } };
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

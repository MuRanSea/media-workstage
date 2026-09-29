import type { ReferenceItem, SpatialCard } from '../types/canvas.ts';

/** Word the prompt uses for a reference: 图 for images, 视频 for videos. */
export function refNoun(role: ReferenceItem['role']): '图' | '视频' {
  return role === 'reference_video' ? '视频' : '图';
}

/** The @ tag a prompt uses to point at a reference, e.g. "@图2" or "@视频1". */
export function refTag(ref: Pick<ReferenceItem, 'role' | 'tagIndex'>): string {
  return `@${refNoun(ref.role)}${ref.tagIndex}`;
}

/** The tag for a source card, by what it holds. */
export function cardTag(card: SpatialCard): string {
  return card.type === 'upload' && card.mediaKind === 'video' ? `@视频${card.tagIndex}` : `@图${card.tagIndex}`;
}


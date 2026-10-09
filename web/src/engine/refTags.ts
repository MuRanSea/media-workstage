import type { ReferenceItem, SpatialCard } from '../types/canvas.ts';
import { mediaKindOf } from './uploadRefs.ts';

/** Word the prompt uses for a reference: 图 for images, 视频 for videos. */
export function refNoun(role: ReferenceItem['role']): '图' | '视频' {
  return role === 'reference_video' ? '视频' : '图';
}

/** The @ tag a prompt uses to point at a reference, e.g. "@图2" or "@视频1". */
export function refTag(ref: Pick<ReferenceItem, 'role' | 'tagIndex'>): string {
  return `@${refNoun(ref.role)}${ref.tagIndex}`;
}

/** `prompt` without its mentions of `ref` (whole tags only: @图1 leaves "@图12"); unchanged when it has none. */
export function withoutRefTag(prompt: string, ref: Pick<ReferenceItem, 'role' | 'tagIndex'>): string {
  const pattern = `${refTag(ref)}\\b`;
  if (!new RegExp(pattern).test(prompt)) return prompt;
  return prompt.replace(new RegExp(pattern, 'g'), '').replace(/\s{2,}/g, ' ').trim();
}

/** Whether `prompt` mentions `tag` itself, not a longer number that starts with it (@图1 in "@图12"). */
export function mentionsTag(prompt: string, tag: string): boolean {
  return new RegExp(`${tag}(?!\\d)`).test(prompt);
}

/** The tag for a source card, by what it holds. */
export function cardTag(card: SpatialCard): string {
  return mediaKindOf(card) === 'video' ? `@视频${card.tagIndex}` : `@图${card.tagIndex}`;
}


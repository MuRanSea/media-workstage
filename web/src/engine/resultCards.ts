import type { SpatialCard } from '../types/canvas.ts';
import { createCard } from './cardFactory.ts';

const GAP = 80;
const STACK_STEP = 560;

/** Where the result card of `source` goes: to its right, stepped down past cards already there. */
function resultPosition(source: SpatialCard, width: number, cards: SpatialCard[]): { x: number; y: number } {
  const x = source.x + source.width + GAP;
  let y = source.y;
  while (cards.some((c) => Math.abs(c.x - x) < width && Math.abs(c.y - y) < STACK_STEP)) y += STACK_STEP;
  return { x, y };
}

/** A succeeded video card whose result has not been given its own card yet. */
function needsResultCard(card: SpatialCard): boolean {
  return card.type === 'video' && card.status === 'succeeded' && !!card.taskId && !!card.resultUrl && card.spawnedTaskId !== card.taskId;
}

/**
 * Gives every freshly generated video its own card to the right of the video card, so it
 * can be wired into another video card as a reference. The video card keeps its own copy.
 * Returns the same array when there is nothing to add.
 */
export function spawnVideoResultCards(cards: SpatialCard[]): SpatialCard[] {
  const pending = cards.filter(needsResultCard);
  if (pending.length === 0) return cards;

  const added: SpatialCard[] = [];
  const marked = cards.map((card) => {
    if (!needsResultCard(card)) return card;
    const all = [...cards, ...added];
    const result = createCard('upload', { x: 0, y: 0 }, all, 'video');
    const pos = resultPosition(card, result.width, all);
    added.push({
      ...result,
      ...pos,
      title: `${card.title} 结果`,
      resultOfCardId: card.id,
      resultUrl: card.resultUrl,
      uploadName: `${card.title}.mp4`,
      status: 'succeeded',
    });
    return { ...card, spawnedTaskId: card.taskId };
  });
  return [...marked, ...added];
}

/** Cards loaded from disk already have their results: mark them so opening a project spawns nothing. */
export function markExistingResults(cards: SpatialCard[]): SpatialCard[] {
  return cards.map((c) => (needsResultCard(c) ? { ...c, spawnedTaskId: c.taskId } : c));
}

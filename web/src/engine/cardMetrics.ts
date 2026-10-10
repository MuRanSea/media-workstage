import type { SpatialCard } from '../types/canvas.ts';
import { estimateCardHeight } from './resultCards.ts';

/**
 * Rendered heights of the cards. The page measures them (a card's height
 * depends on its media and parameters, not on the document), so they are never
 * saved with the project. A card scrolled out of view keeps its last height.
 */
export interface CardMetrics {
  get(id: string): number | undefined;
  set(id: string, height: number): void;
  remove(id: string): void;
  /** Forgets every card not in `ids` (deleted cards). */
  retain(ids: ReadonlySet<string>): void;
}

export function createCardMetrics(): CardMetrics {
  const heights = new Map<string, number>();
  return {
    get: (id) => heights.get(id),
    set: (id, height) => {
      // A card laid out at zero height is hidden or unmounting: keep the last real height.
      if (height > 0) heights.set(id, height);
    },
    remove: (id) => {
      heights.delete(id);
    },
    retain: (ids) => {
      for (const id of heights.keys()) if (!ids.has(id)) heights.delete(id);
    },
  };
}

/** A card's height: what was measured when it is on screen, an estimate from its preview's shape otherwise. */
export function cardHeight(metrics: CardMetrics, card: SpatialCard): number {
  return metrics.get(card.id) ?? estimateCardHeight(card);
}

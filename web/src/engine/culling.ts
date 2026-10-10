import type { SpatialCard } from '../types/canvas.ts';
import type { CanvasTransform, Rect, ViewportSize } from './matrix.ts';
import { isRectIntersecting } from './layout.ts';

/** Screen pixels around the viewport that still count as visible, so cards appear before they scroll in. */
export const CULL_MARGIN_PX = 400;

/** The world rectangle the viewport shows, grown by `marginPx` screen pixels on every side. */
export function visibleWorldRect(transform: CanvasTransform, viewport: ViewportSize, marginPx = CULL_MARGIN_PX): Rect {
  const margin = marginPx / transform.zoom;
  return {
    x: (0 - transform.panX) / transform.zoom - margin,
    y: (0 - transform.panY) / transform.zoom - margin,
    width: viewport.width / transform.zoom + 2 * margin,
    height: viewport.height / transform.zoom + 2 * margin,
  };
}

/** A card waiting on a task holds its progress on screen. */
export function isAwaitingTask(card: SpatialCard): boolean {
  return card.status === 'queued' || card.status === 'running';
}

/**
 * Cards to mount: those overlapping `area`, plus every card `keep` asks for
 * (selected or being dragged, waiting on a task) wherever it is. Order is kept,
 * so stacking does not change as cards scroll in and out.
 */
export function cardsToRender(
  cards: SpatialCard[],
  area: Rect,
  heightOf: (card: SpatialCard) => number,
  keep: (card: SpatialCard) => boolean
): SpatialCard[] {
  return cards.filter(
    (c) => keep(c) || isRectIntersecting(area, { x: c.x, y: c.y, width: c.width, height: heightOf(c) })
  );
}

/** Whether a connection line between two points (with its curve's horizontal bulge) may cross `area`. */
export function lineMayCross(area: Rect, x1: number, y1: number, x2: number, y2: number, bulge: number): boolean {
  const minX = Math.min(x1, x2) - bulge;
  const maxX = Math.max(x1, x2) + bulge;
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  return isRectIntersecting(area, { x: minX, y: minY, width: maxX - minX, height: Math.max(1, maxY - minY) });
}

/** Whether two sets hold the same ids. */
export function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

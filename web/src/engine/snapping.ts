import type { Rect } from './matrix.ts';

/** Snapping reaches this many screen pixels, whatever the zoom. */
export const SNAP_THRESHOLD_PX = 6;

/** An alignment line drawn while dragging: vertical (`x`) or horizontal (`y`), in world coordinates. */
export interface SnapGuide {
  axis: 'x' | 'y';
  /** x of a vertical line, y of a horizontal one. */
  at: number;
  /** Extent along the line. */
  from: number;
  to: number;
}

export interface SnapResult {
  /** Correction to add to the drag offset. */
  dx: number;
  dy: number;
  guides: SnapGuide[];
}

/** Left, centre and right (or top, middle, bottom) of a box along one axis. */
const linesOf = (r: Rect, axis: 'x' | 'y'): number[] =>
  axis === 'x' ? [r.x, r.x + r.width / 2, r.x + r.width] : [r.y, r.y + r.height / 2, r.y + r.height];

/** The nearest pairing of the moving box's lines with any target's lines on one axis, if within `threshold`. */
function nearestOnAxis(moving: Rect, targets: Rect[], axis: 'x' | 'y', threshold: number): { delta: number; at: number; matches: Rect[] } | null {
  let best: { delta: number; at: number; matches: Rect[] } | null = null;
  const own = linesOf(moving, axis);
  for (const target of targets) {
    for (const line of linesOf(target, axis)) {
      for (const mine of own) {
        const delta = line - mine;
        if (Math.abs(delta) > threshold) continue;
        if (!best || Math.abs(delta) < Math.abs(best.delta) - 1e-9) best = { delta, at: line, matches: [target] };
        // Same correction and same line: another card aligned there too, so the guide spans both.
        else if (Math.abs(delta - best.delta) < 1e-9 && line === best.at && !best.matches.includes(target)) best.matches.push(target);
      }
    }
  }
  return best;
}

/**
 * Snaps a dragged box to the edges and centre lines of other cards. Each axis
 * snaps on its own to the nearest line within `threshold` (world units); the
 * guides show which lines the box now shares with which cards.
 */
export function snapBox(moving: Rect, targets: Rect[], threshold: number): SnapResult {
  const x = nearestOnAxis(moving, targets, 'x', threshold);
  const y = nearestOnAxis(moving, targets, 'y', threshold);
  const dx = x?.delta ?? 0;
  const dy = y?.delta ?? 0;
  const snapped: Rect = { ...moving, x: moving.x + dx, y: moving.y + dy };
  const guides: SnapGuide[] = [];
  if (x) {
    const boxes = [snapped, ...x.matches];
    guides.push({ axis: 'x', at: x.at, from: Math.min(...boxes.map((b) => b.y)), to: Math.max(...boxes.map((b) => b.y + b.height)) });
  }
  if (y) {
    const boxes = [snapped, ...y.matches];
    guides.push({ axis: 'y', at: y.at, from: Math.min(...boxes.map((b) => b.x)), to: Math.max(...boxes.map((b) => b.x + b.width)) });
  }
  return { dx, dy, guides };
}

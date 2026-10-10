import type { CanvasTransform, Point, Rect, ViewportSize } from './matrix.ts';

/** How the minimap draws the world: world point p lands at (p - origin) * scale + offset. */
export interface MinimapFrame {
  scale: number;
  originX: number;
  originY: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Fits the cards and the viewport's own rectangle into a minimap of `size`,
 * keeping proportions and centring the content, `padding` pixels from the edges.
 */
export function minimapFrame(rects: Rect[], view: Rect, size: ViewportSize, padding = 6): MinimapFrame {
  const all = [...rects, view];
  const minX = Math.min(...all.map((r) => r.x));
  const minY = Math.min(...all.map((r) => r.y));
  const maxX = Math.max(...all.map((r) => r.x + r.width));
  const maxY = Math.max(...all.map((r) => r.y + r.height));
  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  const scale = Math.min((size.width - 2 * padding) / width, (size.height - 2 * padding) / height);
  return {
    scale,
    originX: minX,
    originY: minY,
    offsetX: (size.width - width * scale) / 2,
    offsetY: (size.height - height * scale) / 2,
  };
}

export function worldToMinimap(p: Point, f: MinimapFrame): Point {
  return { x: (p.x - f.originX) * f.scale + f.offsetX, y: (p.y - f.originY) * f.scale + f.offsetY };
}

export function minimapToWorld(p: Point, f: MinimapFrame): Point {
  return { x: (p.x - f.offsetX) / f.scale + f.originX, y: (p.y - f.offsetY) / f.scale + f.originY };
}

/** The world rectangle the canvas viewport shows. */
export function viewportWorldRect(t: CanvasTransform, viewport: ViewportSize): Rect {
  return { x: (0 - t.panX) / t.zoom, y: (0 - t.panY) / t.zoom, width: viewport.width / t.zoom, height: viewport.height / t.zoom };
}

/** Pans (zoom unchanged) so `world` sits at the centre of the viewport. */
export function centerOn(world: Point, t: CanvasTransform, viewport: ViewportSize): CanvasTransform {
  return { zoom: t.zoom, panX: viewport.width / 2 - world.x * t.zoom, panY: viewport.height / 2 - world.y * t.zoom };
}

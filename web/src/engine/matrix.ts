export interface CanvasTransform {
  zoom: number;
  panX: number;
  panY: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

/**
 * Clamps a number between min and max bounds.
 */
export function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

/**
 * Transforms screen pixel coordinates (e.g. mouse clientX/clientY) into world canvas coordinates.
 * W = (S - pan) / zoom
 */
export function screenToWorld(
  screenPoint: Point,
  transform: CanvasTransform,
  containerOrigin: Point = { x: 0, y: 0 }
): Point {
  const sX = screenPoint.x - containerOrigin.x;
  const sY = screenPoint.y - containerOrigin.y;
  return {
    x: (sX - transform.panX) / transform.zoom,
    y: (sY - transform.panY) / transform.zoom,
  };
}

/**
 * Transforms world canvas coordinates into screen pixel coordinates.
 * S = W * zoom + pan
 */
export function worldToScreen(
  worldPoint: Point,
  transform: CanvasTransform,
  containerOrigin: Point = { x: 0, y: 0 }
): Point {
  return {
    x: worldPoint.x * transform.zoom + transform.panX + containerOrigin.x,
    y: worldPoint.y * transform.zoom + transform.panY + containerOrigin.y,
  };
}

/**
 * Calculates updated CanvasTransform when zooming towards an arbitrary screen anchor point S.
 * Guarantees zero mathematical drift: the world coordinate under the pointer remains identical before and after zoom.
 * W = (S - pan1) / z1
 * pan2 = S - W * z2
 */
export function calculateZoomAtPoint(
  current: CanvasTransform,
  targetZoom: number,
  screenPoint: Point,
  containerOrigin: Point = { x: 0, y: 0 },
  minZoom = 0.25,
  maxZoom = 2.5
): CanvasTransform {
  const nextZoom = clamp(targetZoom, minZoom, maxZoom);
  if (nextZoom === current.zoom) {
    return current;
  }

  const sX = screenPoint.x - containerOrigin.x;
  const sY = screenPoint.y - containerOrigin.y;

  // Calculate world anchor under cursor using initial zoom
  const worldX = (sX - current.panX) / current.zoom;
  const worldY = (sY - current.panY) / current.zoom;

  // Calculate new pan to keep world anchor at the exact same screen position
  const nextPanX = sX - worldX * nextZoom;
  const nextPanY = sY - worldY * nextZoom;

  return {
    zoom: nextZoom,
    panX: nextPanX,
    panY: nextPanY,
  };
}

/**
 * Calculates transform to fit all cards into the current viewport with generous padding.
 */
export function calculateFitView(
  rects: Rect[],
  viewport: ViewportSize,
  padding = 120,
  minZoom = 0.35,
  maxZoom = 1.2
): CanvasTransform {
  if (rects.length === 0 || viewport.width <= 0 || viewport.height <= 0) {
    return { zoom: 1, panX: 0, panY: 0 };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const r of rects) {
    minX = Math.min(minX, r.x);
    maxX = Math.max(maxX, r.x + r.width);
    minY = Math.min(minY, r.y);
    maxY = Math.max(maxY, r.y + r.height);
  }

  const contentWidth = Math.max(1, maxX - minX);
  const contentHeight = Math.max(1, maxY - minY);

  const availableW = Math.max(100, viewport.width - padding * 2);
  const availableH = Math.max(100, viewport.height - padding * 2);

  const scaleW = availableW / contentWidth;
  const scaleH = availableH / contentHeight;
  const targetZoom = clamp(Math.min(scaleW, scaleH), minZoom, maxZoom);

  const targetPanX = (viewport.width - contentWidth * targetZoom) / 2 - minX * targetZoom;
  const targetPanY = (viewport.height - contentHeight * targetZoom) / 2 - minY * targetZoom;

  return {
    zoom: targetZoom,
    panX: targetPanX,
    panY: targetPanY,
  };
}

/**
 * Calculates transform to center a specific selected card or region in the viewport.
 */
export function calculateFocusSelection(
  rect: Rect,
  viewport: ViewportSize,
  targetZoom = 1.0,
  minZoom = 0.25,
  maxZoom = 2.5
): CanvasTransform {
  const zoom = clamp(targetZoom, minZoom, maxZoom);
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;

  const targetPanX = viewport.width / 2 - centerX * zoom;
  const targetPanY = viewport.height / 2 - centerY * zoom;

  return {
    zoom,
    panX: targetPanX,
    panY: targetPanY,
  };
}

import { describe, it, expect } from 'vitest';
import {
  screenToWorld,
  worldToScreen,
  calculateZoomAtPoint,
  calculateFitView,
  calculateFocusSelection,
  calculateFocusRects,
  clamp,
  wheelZoomFactor,
  MIN_ZOOM,
  MAX_ZOOM,
  type CanvasTransform,
  type Point,
  type Rect,
} from './matrix.ts';
import { normalizeViewport } from './projectDoc.ts';

describe('Spatial Canvas Matrix Transformations', () => {
  it('converts between screen and world coordinates without drift', () => {
    const transform: CanvasTransform = {
      zoom: 1.5,
      panX: 120,
      panY: -45,
    };
    const origin: Point = { x: 50, y: 30 };

    const screenP: Point = { x: 450, y: 320 };
    const worldP = screenToWorld(screenP, transform, origin);
    const roundTripScreenP = worldToScreen(worldP, transform, origin);

    expect(roundTripScreenP.x).toBeCloseTo(screenP.x, 6);
    expect(roundTripScreenP.y).toBeCloseTo(screenP.y, 6);
  });

  it('guarantees zero cursor drift when zooming at an arbitrary anchor point', () => {
    const initialTransform: CanvasTransform = {
      zoom: 0.8,
      panX: 200,
      panY: 150,
    };
    const cursorScreen: Point = { x: 640, y: 360 };
    const origin: Point = { x: 0, y: 0 };

    // World coordinate before zoom
    const initialWorldAnchor = screenToWorld(cursorScreen, initialTransform, origin);

    // Zoom in to 1.6
    const zoomedInTransform = calculateZoomAtPoint(
      initialTransform,
      1.6,
      cursorScreen,
      origin
    );

    // World coordinate under cursor after zoom must be strictly identical
    const worldAnchorAfterZoomIn = screenToWorld(cursorScreen, zoomedInTransform, origin);
    expect(worldAnchorAfterZoomIn.x).toBeCloseTo(initialWorldAnchor.x, 8);
    expect(worldAnchorAfterZoomIn.y).toBeCloseTo(initialWorldAnchor.y, 8);

    // Zoom out to 0.4
    const zoomedOutTransform = calculateZoomAtPoint(
      zoomedInTransform,
      0.4,
      cursorScreen,
      origin
    );

    const worldAnchorAfterZoomOut = screenToWorld(cursorScreen, zoomedOutTransform, origin);
    expect(worldAnchorAfterZoomOut.x).toBeCloseTo(initialWorldAnchor.x, 8);
    expect(worldAnchorAfterZoomOut.y).toBeCloseTo(initialWorldAnchor.y, 8);
  });

  it('preserves world anchor across 100 consecutive zoom steps with container offset', () => {
    let currentTransform: CanvasTransform = {
      zoom: 1.0,
      panX: 50,
      panY: 50,
    };
    const cursorScreen: Point = { x: 800, y: 500 };
    const origin: Point = { x: 100, y: 100 };

    const originalWorldPoint = screenToWorld(cursorScreen, currentTransform, origin);

    // Perform multiple zoom in and out steps
    for (let i = 0; i < 50; i++) {
      currentTransform = calculateZoomAtPoint(currentTransform, currentTransform.zoom * 1.05, cursorScreen, origin);
    }
    for (let i = 0; i < 50; i++) {
      currentTransform = calculateZoomAtPoint(currentTransform, currentTransform.zoom / 1.05, cursorScreen, origin);
    }

    const finalWorldPoint = screenToWorld(cursorScreen, currentTransform, origin);
    expect(finalWorldPoint.x).toBeCloseTo(originalWorldPoint.x, 6);
    expect(finalWorldPoint.y).toBeCloseTo(originalWorldPoint.y, 6);
  });

  it('calculates fitView to center all content in viewport', () => {
    const cards: Rect[] = [
      { x: 100, y: 100, width: 300, height: 400 },
      { x: 600, y: 200, width: 400, height: 400 },
    ];
    const viewport = { width: 1920, height: 1080 };

    const fitTransform = calculateFitView(cards, viewport, 100);

    // Bounding box of content is x: 100..1000 (width 900), y: 100..600 (height 500)
    // Center of content in world coordinates: (550, 350)
    const contentCenterWorld: Point = { x: 550, y: 350 };
    const screenCenter = worldToScreen(contentCenterWorld, fitTransform);

    // Screen center should be exactly at viewport center (960, 540)
    expect(screenCenter.x).toBeCloseTo(viewport.width / 2, 2);
    expect(screenCenter.y).toBeCloseTo(viewport.height / 2, 2);
  });

  it('calculates focusSelection to center target card in viewport', () => {
    const targetCard: Rect = { x: 400, y: 300, width: 360, height: 480 };
    const viewport = { width: 1600, height: 900 };

    const focusTransform = calculateFocusSelection(targetCard, viewport, 1.0);

    // Target card center is (400 + 180 = 580, 300 + 240 = 540)
    const cardCenterWorld: Point = { x: 580, y: 540 };
    const screenPos = worldToScreen(cardCenterWorld, focusTransform);

    expect(screenPos.x).toBeCloseTo(viewport.width / 2, 2);
    expect(screenPos.y).toBeCloseTo(viewport.height / 2, 2);
  });

  it('correctly clamps zoom values within min and max boundaries', () => {
    expect(clamp(0.1, 0.25, 2.5)).toBe(0.25);
    expect(clamp(3.5, 0.25, 2.5)).toBe(2.5);
    expect(clamp(1.2, 0.25, 2.5)).toBe(1.2);
  });
});

describe('zoom range and wheel zoom', () => {
  it('uses one zoom range for wheel, fit view and saved viewports', () => {
    expect(calculateZoomAtPoint({ zoom: 1, panX: 0, panY: 0 }, 0.001, { x: 0, y: 0 }).zoom).toBe(MIN_ZOOM);
    expect(calculateZoomAtPoint({ zoom: 1, panX: 0, panY: 0 }, 99, { x: 0, y: 0 }).zoom).toBe(MAX_ZOOM);
    expect(normalizeViewport({ zoom: 0.01, panX: 0, panY: 0 }).zoom).toBe(MIN_ZOOM);
    expect(normalizeViewport({ zoom: 50, panX: 0, panY: 0 }).zoom).toBe(MAX_ZOOM);
  });

  it('fits a canvas of many cards that needs more than the old 0.35 floor', () => {
    // 300 cards in a 20-wide grid: about 8000 x 9000 world pixels.
    const rects: Rect[] = Array.from({ length: 300 }, (_, i) => ({ x: (i % 20) * 400, y: Math.floor(i / 20) * 600, width: 360, height: 500 }));
    const viewport = { width: 1600, height: 900 };
    const t = calculateFitView(rects, viewport, 140);
    expect(t.zoom).toBeLessThan(0.35);
    expect(t.zoom).toBeGreaterThanOrEqual(MIN_ZOOM);
    const bottomRight = worldToScreen({ x: 19 * 400 + 360, y: 14 * 600 + 500 }, t);
    expect(bottomRight.x).toBeLessThanOrEqual(viewport.width);
    expect(bottomRight.y).toBeLessThanOrEqual(viewport.height);
  });

  it('zooms in proportion to the wheel distance, capped per event', () => {
    expect(wheelZoomFactor(-2)).toBeGreaterThan(1);
    expect(wheelZoomFactor(-2)).toBeLessThan(wheelZoomFactor(-40));
    expect(wheelZoomFactor(40)).toBeLessThan(1);
    expect(wheelZoomFactor(-10000)).toBe(1.25);
    expect(wheelZoomFactor(10000)).toBe(1 / 1.25);
    expect(wheelZoomFactor(0)).toBe(1);
    // A line-mode notch counts like its pixel equivalent.
    expect(wheelZoomFactor(3, 1)).toBeCloseTo(wheelZoomFactor(48), 10);
  });
});

describe('calculateFocusRects', () => {
  const viewport = { width: 1600, height: 900 };

  it('centres a single card at 100%', () => {
    const t = calculateFocusRects([{ x: 400, y: 300, width: 360, height: 480 }], viewport)!;
    expect(t.zoom).toBe(1);
    const c = worldToScreen({ x: 580, y: 540 }, t);
    expect(c.x).toBeCloseTo(800, 2);
    expect(c.y).toBeCloseTo(450, 2);
  });

  it('frames the whole selection, zooming out when it does not fit at 100%', () => {
    const rects = [
      { x: 0, y: 0, width: 360, height: 400 },
      { x: 3000, y: 2000, width: 360, height: 400 },
    ];
    const t = calculateFocusRects(rects, viewport)!;
    expect(t.zoom).toBeLessThan(1);
    const tl = worldToScreen({ x: 0, y: 0 }, t);
    const br = worldToScreen({ x: 3360, y: 2400 }, t);
    expect(tl.x).toBeGreaterThanOrEqual(0);
    expect(tl.y).toBeGreaterThanOrEqual(0);
    expect(br.x).toBeLessThanOrEqual(viewport.width);
    expect(br.y).toBeLessThanOrEqual(viewport.height);
  });

  it('does nothing without a selection', () => {
    expect(calculateFocusRects([], viewport)).toBeNull();
  });
});

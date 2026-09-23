import { describe, it, expect } from 'vitest';
import {
  screenToWorld,
  worldToScreen,
  calculateZoomAtPoint,
  calculateFitView,
  calculateFocusSelection,
  clamp,
  type CanvasTransform,
  type Point,
  type Rect,
} from './matrix.ts';

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

import { describe, it, expect } from 'vitest';
import {
  isRectIntersecting,
  getMarqueeRect,
  alignCards,
  autoArrangeGrid,
  type LayoutCard,
} from './layout.ts';

describe('Spatial Canvas Layout & Selection Math', () => {
  it('correctly calculates axis-aligned rectangle intersections for marquee box selection', () => {
    const cardRect = { x: 100, y: 100, width: 200, height: 200 };

    // Full overlap
    expect(isRectIntersecting(cardRect, { x: 50, y: 50, width: 300, height: 300 })).toBe(true);

    // Partial corner overlap
    expect(isRectIntersecting(cardRect, { x: 250, y: 250, width: 100, height: 100 })).toBe(true);

    // Outside (disjoint)
    expect(isRectIntersecting(cardRect, { x: 400, y: 400, width: 50, height: 50 })).toBe(false);

    // Horizontal overlap but vertical disjoint
    expect(isRectIntersecting(cardRect, { x: 150, y: 400, width: 100, height: 100 })).toBe(false);
  });

  it('normalizes drag start and end into positive bounding box marquee rect', () => {
    // Drag from bottom-right (500, 400) to top-left (100, 200)
    const rect = getMarqueeRect({ x: 500, y: 400 }, { x: 100, y: 200 });

    expect(rect.x).toBe(100);
    expect(rect.y).toBe(200);
    expect(rect.width).toBe(400);
    expect(rect.height).toBe(200);
  });

  it('aligns multiple selected cards to left, right, top, and center', () => {
    const cards: LayoutCard[] = [
      { id: 'c1', x: 100, y: 100, width: 200, height: 300 },
      { id: 'c2', x: 300, y: 200, width: 200, height: 300 },
      { id: 'c3', x: 600, y: 150, width: 200, height: 300 },
    ];
    const selectedIds = new Set(['c1', 'c2', 'c3']);

    // Align Left: All should have x = 100
    const leftAligned = alignCards(cards, selectedIds, 'left');
    expect(leftAligned.map((c) => c.x)).toEqual([100, 100, 100]);

    // Align Top: All should have y = 100
    const topAligned = alignCards(cards, selectedIds, 'top');
    expect(topAligned.map((c) => c.y)).toEqual([100, 100, 100]);

    // Align Right: Bounding box right is 600 + 200 = 800. All cards width 200 -> x = 600
    const rightAligned = alignCards(cards, selectedIds, 'right');
    expect(rightAligned.map((c) => c.x)).toEqual([600, 600, 600]);
  });

  it('auto-arranges selected cards in a clean multi-column grid', () => {
    const cards: LayoutCard[] = [
      { id: 'c1', x: 500, y: 800, width: 200, height: 200 },
      { id: 'c2', x: 100, y: 100, width: 200, height: 200 },
      { id: 'c3', x: 900, y: 300, width: 200, height: 200 },
      { id: 'c4', x: 300, y: 600, width: 200, height: 200 },
    ];
    const selectedIds = new Set(['c1', 'c2', 'c3', 'c4']);

    // Auto arrange 2 columns with 40px gap
    const gridCards = autoArrangeGrid(cards, selectedIds, 40, 2);

    const c2 = gridCards.find((c) => c.id === 'c2')!;
    const c1 = gridCards.find((c) => c.id === 'c1')!;
    const c3 = gridCards.find((c) => c.id === 'c3')!;
    const c4 = gridCards.find((c) => c.id === 'c4')!;

    // Top-left starting anchor is (100, 100)
    expect(c1.x).toBe(100);
    expect(c1.y).toBe(100);

    expect(c2.x).toBe(100 + 200 + 40); // 340
    expect(c2.y).toBe(100);

    expect(c3.x).toBe(100);
    expect(c3.y).toBe(100 + 200 + 40); // 340

    expect(c4.x).toBe(340);
    expect(c4.y).toBe(340);
  });
});

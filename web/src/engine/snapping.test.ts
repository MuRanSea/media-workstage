import { describe, expect, it } from 'vitest';
import { snapBox } from './snapping.ts';

const box = (x: number, y: number, width = 100, height = 100) => ({ x, y, width, height });

describe('snapBox', () => {
  it('snaps a left edge onto another card left edge and draws a vertical guide', () => {
    const r = snapBox(box(204, 300), [box(200, 0)], 6);
    expect(r.dx).toBe(-4);
    expect(r.dy).toBe(0);
    expect(r.guides).toEqual([{ axis: 'x', at: 200, from: 0, to: 400 }]);
  });

  it('snaps edge to opposite edge, so cards can sit flush side by side', () => {
    const r = snapBox(box(303, 0), [box(200, 0)], 6);
    expect(r.dx).toBe(-3);
  });

  it('snaps centre lines', () => {
    // A narrower card: only its centre (x = 252) is near a target line (centre 250).
    const r = snapBox(box(222, 500, 60, 50), [box(200, 0)], 6);
    expect(r.dx).toBe(-2);
    expect(r.guides[0]).toMatchObject({ axis: 'x', at: 250 });
  });

  it('does nothing beyond the threshold', () => {
    expect(snapBox(box(210, 300), [box(200, 0)], 6)).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it('snaps both axes at once', () => {
    const r = snapBox(box(205, 103), [box(200, 0, 100, 100), box(600, 100)], 6);
    expect(r.dx).toBe(-5);
    expect(r.dy).toBe(-3);
    expect(r.guides.map((g) => g.axis).sort()).toEqual(['x', 'y']);
  });

  it('takes the nearest of several candidates', () => {
    const r = snapBox(box(203, 0), [box(198, 500), box(202, 900)], 6);
    expect(r.dx).toBe(-1);
  });

  it('spans the guide over every card sharing the line', () => {
    const r = snapBox(box(102, 400), [box(100, 0), box(100, 900)], 6);
    expect(r.guides).toEqual([{ axis: 'x', at: 100, from: 0, to: 1000 }]);
  });

  it('treats a selection bounding box like a single card', () => {
    // A group spanning 0..500 wide snaps its right edge to a card at 503.
    const r = snapBox(box(0, 0, 500, 300), [box(503, 1000)], 6);
    expect(r.dx).toBe(3);
  });
});

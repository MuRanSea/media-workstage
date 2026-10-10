import { describe, expect, it } from 'vitest';
import { centerOn, minimapFrame, minimapToWorld, viewportWorldRect, worldToMinimap } from './minimap.ts';

describe('minimap', () => {
  const size = { width: 200, height: 140 };

  it('fits cards and the viewport inside the minimap, keeping proportions', () => {
    const rects = [
      { x: 0, y: 0, width: 300, height: 200 },
      { x: 1700, y: 900, width: 300, height: 200 },
    ];
    const view = { x: 0, y: 0, width: 800, height: 600 };
    const f = minimapFrame(rects, view, size, 0);
    // Content is 2000 x 1100: width limits, 200 / 2000.
    expect(f.scale).toBeCloseTo(0.1);
    const tl = worldToMinimap({ x: 0, y: 0 }, f);
    const br = worldToMinimap({ x: 2000, y: 1100 }, f);
    expect(tl.x).toBeCloseTo(0);
    expect(br.x).toBeCloseTo(200);
    // Centred vertically: 110 tall in 140.
    expect(tl.y).toBeCloseTo(15);
    expect(br.y).toBeCloseTo(125);
  });

  it('grows to include a viewport far from every card', () => {
    const f = minimapFrame([{ x: 0, y: 0, width: 100, height: 100 }], { x: 5000, y: 0, width: 1000, height: 700 }, size, 0);
    expect(worldToMinimap({ x: 6000, y: 0 }, f).x).toBeLessThanOrEqual(200.0001);
  });

  it('maps minimap points back to the same world points', () => {
    const f = minimapFrame([{ x: -300, y: 50, width: 400, height: 300 }], { x: 0, y: 0, width: 1000, height: 600 }, size);
    const w = { x: 123, y: 456 };
    const back = minimapToWorld(worldToMinimap(w, f), f);
    expect(back.x).toBeCloseTo(123);
    expect(back.y).toBeCloseTo(456);
  });

  it('works with an empty canvas', () => {
    const f = minimapFrame([], { x: 0, y: 0, width: 1000, height: 600 }, size);
    expect(Number.isFinite(f.scale)).toBe(true);
  });

  it('reads the viewport rectangle and centres the view on a point', () => {
    const t = { zoom: 0.5, panX: 100, panY: -50 };
    const vp = { width: 1000, height: 800 };
    expect(viewportWorldRect(t, vp)).toEqual({ x: -200, y: 100, width: 2000, height: 1600 });
    const c = centerOn({ x: 400, y: 300 }, t, vp);
    expect(c.zoom).toBe(0.5);
    const r = viewportWorldRect(c, vp);
    expect(r.x + r.width / 2).toBeCloseTo(400);
    expect(r.y + r.height / 2).toBeCloseTo(300);
  });
});

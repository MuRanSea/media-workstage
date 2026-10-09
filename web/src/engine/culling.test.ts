import { describe, expect, it } from 'vitest';
import type { SpatialCard } from '../types/canvas.ts';
import { cardsToRender, isAwaitingTask, lineMayCross, sameIds, visibleWorldRect } from './culling.ts';

const card = (id: string, x: number, y: number, over: Partial<SpatialCard> = {}): SpatialCard =>
  ({ id, type: 'image', role: 'generation', title: id, x, y, width: 300, status: 'idle', ...over }) as SpatialCard;
const height = () => 200;
const none = () => false;

describe('visibleWorldRect', () => {
  it('maps the viewport into world coordinates with the margin', () => {
    expect(visibleWorldRect({ zoom: 1, panX: 0, panY: 0 }, { width: 1000, height: 800 }, 0)).toEqual({ x: 0, y: 0, width: 1000, height: 800 });
    expect(visibleWorldRect({ zoom: 0.5, panX: 100, panY: -50 }, { width: 1000, height: 800 }, 100)).toEqual({
      x: -200 - 200,
      y: 100 - 200,
      width: 2000 + 400,
      height: 1600 + 400,
    });
  });
});

describe('cardsToRender', () => {
  const area = visibleWorldRect({ zoom: 1, panX: 0, panY: 0 }, { width: 1000, height: 800 }, 0);

  it('keeps cards overlapping the area, even partly, and drops the rest', () => {
    const cards = [card('in', 100, 100), card('edge', 900, 700), card('out', 3000, 3000), card('left', -500, 0)];
    expect(cardsToRender(cards, area, height, none).map((c) => c.id)).toEqual(['in', 'edge']);
  });

  it('uses each card height, so a tall card reaching into view is mounted', () => {
    const tall = card('tall', 100, -1000);
    expect(cardsToRender([tall], area, height, none)).toEqual([]);
    expect(cardsToRender([tall], area, () => 1200, none)).toEqual([tall]);
  });

  it('keeps selected, dragged and waiting cards wherever they are', () => {
    const far = card('far', 5000, 5000);
    const waiting = card('waiting', -5000, 0, { role: 'result', status: 'running' });
    const selected = new Set(['far']);
    const out = cardsToRender([far, waiting], area, height, (c) => selected.has(c.id) || isAwaitingTask(c));
    expect(out.map((c) => c.id)).toEqual(['far', 'waiting']);
  });

  it('sees more of the canvas as it zooms out', () => {
    const cards = [card('a', 1500, 100)];
    expect(cardsToRender(cards, area, height, none)).toEqual([]);
    const zoomedOut = visibleWorldRect({ zoom: 0.5, panX: 0, panY: 0 }, { width: 1000, height: 800 }, 0);
    expect(cardsToRender(cards, zoomedOut, height, none)).toEqual(cards);
  });
});

describe('isAwaitingTask', () => {
  it('is true only while queued or running', () => {
    expect(isAwaitingTask(card('a', 0, 0, { status: 'queued' }))).toBe(true);
    expect(isAwaitingTask(card('a', 0, 0, { status: 'running' }))).toBe(true);
    expect(isAwaitingTask(card('a', 0, 0, { status: 'succeeded' }))).toBe(false);
    expect(isAwaitingTask(card('a', 0, 0, { status: 'idle' }))).toBe(false);
  });
});

describe('lineMayCross', () => {
  const area = { x: 0, y: 0, width: 1000, height: 800 };
  it('keeps a line passing through the area although both ends are outside', () => {
    expect(lineMayCross(area, -500, 400, 1500, 400, 80)).toBe(true);
  });
  it('drops a line entirely outside', () => {
    expect(lineMayCross(area, 2000, 100, 3000, 200, 80)).toBe(false);
  });
  it('counts the curve bulge', () => {
    expect(lineMayCross(area, 1050, 100, 1100, 200, 80)).toBe(true);
  });
});

describe('sameIds', () => {
  it('compares membership, not order', () => {
    expect(sameIds(new Set(['a', 'b']), new Set(['b', 'a']))).toBe(true);
    expect(sameIds(new Set(['a']), new Set(['a', 'b']))).toBe(false);
    expect(sameIds(new Set(['a', 'c']), new Set(['a', 'b']))).toBe(false);
  });
});

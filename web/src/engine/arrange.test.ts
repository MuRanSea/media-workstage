import { describe, expect, it } from 'vitest';
import type { CanvasSection, SpatialCard } from '../types/canvas.ts';
import { arrangeCards } from './arrange.ts';
import { SECTION_HEADER } from './sections.ts';

const card = (id: string, x: number, y: number, over: Partial<SpatialCard> = {}): SpatialCard =>
  ({ id, type: 'image', role: 'generation', title: id, x, y, width: 300, prompt: '', model: '', status: 'idle', progress: 0, ...over }) as SpatialCard;
const h = (c: SpatialCard) => (c.id.startsWith('tall') ? 500 : 200);
const all = (cards: SpatialCard[]) => new Set(cards.map((c) => c.id));
const apply = (cards: SpatialCard[], positions: Map<string, { x: number; y: number }>) =>
  cards.map((c) => ({ ...c, ...(positions.get(c.id) ?? {}) }));
const overlaps = (cards: SpatialCard[]) =>
  cards.some((a, i) =>
    cards.slice(i + 1).some((b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + h(b) && a.y + h(a) > b.y)
  );

describe('arrangeCards', () => {
  // text → generation → two results; plus a loose upload and a loose video card.
  const cards = [
    card('res2', 50, 900, { role: 'result', sourceId: 'gen' }),
    card('gen', 700, 0, { promptSourceId: 'txt' }),
    card('txt', 300, 400, { type: 'text', role: 'result' }),
    card('res1', 10, 10, { role: 'result', sourceId: 'gen' }),
    card('up', 2000, 2000, { type: 'upload', role: 'result' }),
    card('vid', 1500, 50, { type: 'video' }),
  ];

  it('puts sources left of what uses them, one column per step', () => {
    const { positions } = arrangeCards(cards, all(cards), [], h);
    const x = (id: string) => positions.get(id)!.x;
    expect(x('txt')).toBeLessThan(x('gen'));
    expect(x('gen')).toBeLessThan(x('res1'));
    expect(x('res1')).toBe(x('res2'));
  });

  it('keeps the current top-to-bottom order inside a column', () => {
    const { positions } = arrangeCards(cards, all(cards), [], h);
    expect(positions.get('res1')!.y).toBeLessThan(positions.get('res2')!.y);
  });

  it('starts from the top-left of the arranged cards', () => {
    const { positions } = arrangeCards(cards, all(cards), [], h);
    const xs = [...positions.values()].map((p) => p.x);
    const ys = [...positions.values()].map((p) => p.y);
    expect(Math.min(...xs)).toBe(10);
    expect(Math.min(...ys)).toBe(0);
  });

  it('groups loose cards by type to the right of the connected cards', () => {
    const { positions } = arrangeCards(cards, all(cards), [], h);
    const connectedRight = Math.max(...['txt', 'gen', 'res1', 'res2'].map((id) => positions.get(id)!.x + 300));
    expect(positions.get('vid')!.x).toBeGreaterThan(connectedRight);
    expect(positions.get('up')!.x).toBeGreaterThan(positions.get('vid')!.x);
  });

  it('leaves no cards overlapping, using each card height', () => {
    const tall = [card('tall-a', 0, 0), card('b', 0, 100, { role: 'result', sourceId: 'tall-a' }), card('c', 0, 200, { role: 'result', sourceId: 'tall-a' })];
    const out = apply(tall, arrangeCards(tall, all(tall), [], h).positions);
    expect(overlaps(out)).toBe(false);
    expect(overlaps(apply(cards, arrangeCards(cards, all(cards), [], h).positions))).toBe(false);
  });

  it('is stable: arranging again changes nothing', () => {
    const once = apply(cards, arrangeCards(cards, all(cards), [], h).positions);
    const twice = apply(once, arrangeCards(once, all(once), [], h).positions);
    expect(twice).toEqual(once);
  });

  it('moves only the cards asked for', () => {
    const { positions } = arrangeCards(cards, new Set(['gen', 'res1']), [], h);
    expect([...positions.keys()].sort()).toEqual(['gen', 'res1']);
  });

  it('arranges a section’s cards inside it, growing the section when they need more room', () => {
    const section: CanvasSection = { id: 's', title: 's', x: 1000, y: 1000, width: 400, height: 300 };
    const inside = [card('a', 1050, 1100), card('b', 1100, 1150, { role: 'result', sourceId: 'a' })];
    const { positions, sections } = arrangeCards(inside, all(inside), [section], h);
    expect(positions.get('a')).toEqual({ x: 1040, y: 1000 + SECTION_HEADER + 40 });
    const grown = sections[0];
    for (const c of apply(inside, positions)) {
      expect(c.x).toBeGreaterThanOrEqual(grown.x);
      expect(c.x + c.width).toBeLessThanOrEqual(grown.x + grown.width);
      expect(c.y + h(c)).toBeLessThanOrEqual(grown.y + grown.height);
    }
  });

  it('leaves cards in collapsed sections where they are', () => {
    const shut: CanvasSection = { id: 's', title: 's', x: 0, y: 0, width: 1000, height: 1000, collapsed: true };
    const inside = [card('a', 100, 100), card('free', 3000, 3000)];
    const { positions } = arrangeCards(inside, all(inside), [shut], h);
    expect(positions.has('a')).toBe(false);
    expect(positions.has('free')).toBe(true);
  });
});

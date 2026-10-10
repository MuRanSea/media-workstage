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

describe('arrangeCards around sections', () => {
  // Loose cards left of a section: their type grid would reach into it.
  const section: CanvasSection = { id: 's', title: 's', x: 500, y: 0, width: 800, height: 700 };
  const cards = [
    card('txt', 0, 100, { type: 'text', role: 'result' }),
    card('v1', 100, 900, { type: 'video' }),
    card('v2', 0, 1200, { type: 'video' }),
    card('in-a', 600, 100),
    card('in-b', 900, 100, { role: 'result', sourceId: 'in-a' }),
  ];
  const inside = (c: SpatialCard, s: CanvasSection) => c.x + c.width / 2 > s.x && c.x + c.width / 2 < s.x + s.width && c.y + h(c) / 2 > s.y && c.y + h(c) / 2 < s.y + s.height;

  it('keeps cards outside sections out of them and off the section cards', () => {
    const { positions, sections } = arrangeCards(cards, all(cards), [section], h);
    const out = apply(cards, positions);
    const grownSection = sections[0] ?? section;
    for (const id of ['txt', 'v1', 'v2']) expect(inside(out.find((c) => c.id === id)!, grownSection)).toBe(false);
    for (const id of ['in-a', 'in-b']) expect(inside(out.find((c) => c.id === id)!, grownSection)).toBe(true);
    expect(overlaps(out)).toBe(false);
  });

  it('is stable with a section present', () => {
    const first = arrangeCards(cards, all(cards), [section], h);
    const once = apply(cards, first.positions);
    const sectionsOnce = [first.sections[0] ?? section];
    const twice = apply(once, arrangeCards(once, all(once), sectionsOnce, h).positions);
    expect(twice).toEqual(once);
  });

  it('keeps clear of cards that are not being arranged', () => {
    const blocker = card('blocker', 400, 0);
    const loose = [card('a', 0, 0), card('b', 0, 400)];
    const out = apply([...loose, blocker], arrangeCards([...loose, blocker], new Set(['a', 'b']), [], h).positions);
    expect(overlaps(out)).toBe(false);
  });
});

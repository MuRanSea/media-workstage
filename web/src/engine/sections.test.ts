import { describe, expect, it } from 'vitest';
import type { CanvasSection, SpatialCard } from '../types/canvas.ts';
import {
  DEFAULT_SECTION_TITLE,
  collapsedSectionOf,
  hiddenCardIds,
  SECTION_HEADER,
  duplicateSections,
  emptySection,
  membersBySection,
  normalizeSections,
  sectionAround,
  sectionOf,
  sectionRect,
} from './sections.ts';

const card = (id: string, x: number, y: number): SpatialCard =>
  ({ id, type: 'image', role: 'generation', title: id, x, y, width: 200, prompt: '', model: '', status: 'idle', progress: 0 }) as SpatialCard;
const h = () => 100;
const section = (id: string, x: number, y: number, width: number, height: number, over: Partial<CanvasSection> = {}): CanvasSection => ({
  id,
  title: id,
  x,
  y,
  width,
  height,
  ...over,
});

describe('sectionAround', () => {
  it('wraps the cards with padding and room for the title bar', () => {
    const s = sectionAround([card('a', 100, 200), card('b', 500, 400)], h)!;
    expect(s.title).toBe(DEFAULT_SECTION_TITLE);
    expect(s.x).toBe(60);
    expect(s.y).toBe(200 - 40 - SECTION_HEADER);
    expect(s.x + s.width).toBe(700 + 40);
    expect(s.y + s.height).toBe(500 + 40);
  });

  it('needs at least one card', () => {
    expect(sectionAround([], h)).toBeNull();
  });
});

describe('sectionOf', () => {
  const big = section('big', 0, 0, 2000, 2000);
  const small = section('small', 0, 0, 600, 600);

  it('owns a card whose centre is inside', () => {
    expect(sectionOf(card('a', 100, 100), [big], h)?.id).toBe('big');
  });

  it('does not own a card that only overlaps it partly, centre outside', () => {
    expect(sectionOf(card('a', 1950, 100), [big], h)).toBeUndefined();
  });

  it('gives a card in two overlapping sections to the smaller one', () => {
    expect(sectionOf(card('a', 100, 100), [small, big], h)?.id).toBe('small');
    expect(sectionOf(card('a', 100, 100), [big, small], h)?.id).toBe('small');
  });

  it('gives a card in two equal sections to the later one', () => {
    const twin = section('twin', 0, 0, 600, 600);
    expect(sectionOf(card('a', 100, 100), [small, twin], h)?.id).toBe('twin');
  });

  it('keeps cards in a collapsed section, by its full area', () => {
    expect(sectionOf(card('a', 100, 300), [section('c', 0, 0, 600, 600, { collapsed: true })], h)?.id).toBe('c');
  });
});

describe('membersBySection', () => {
  it('lists each section with its cards, empty ones included', () => {
    const out = membersBySection(
      [card('in', 100, 100), card('out', 5000, 5000)],
      [section('s', 0, 0, 1000, 1000), section('empty', 3000, 0, 500, 500)],
      h
    );
    expect(out.get('s')).toEqual(['in']);
    expect(out.get('empty')).toEqual([]);
  });
});

describe('sectionRect', () => {
  it('is the title bar alone while collapsed', () => {
    expect(sectionRect(section('s', 1, 2, 300, 400)).height).toBe(400);
    expect(sectionRect(section('s', 1, 2, 300, 400, { collapsed: true })).height).toBe(SECTION_HEADER);
  });
});

describe('normalizeSections', () => {
  it('keeps valid sections and repairs broken fields', () => {
    const out = normalizeSections([
      { id: 's1', title: '分镜', x: 1, y: 2, width: 800, height: 600, collapsed: true },
      { id: 's2', title: '  ', x: 'x', width: 10 },
      { title: 'no id' },
      null,
    ]);
    expect(out).toEqual([
      { id: 's1', title: '分镜', x: 1, y: 2, width: 800, height: 600, collapsed: true },
      { id: 's2', title: DEFAULT_SECTION_TITLE, x: 0, y: 0, width: 240, height: 480 },
    ]);
  });

  it('reads a missing list as no sections', () => {
    expect(normalizeSections(undefined)).toEqual([]);
  });
});

describe('emptySection and duplicateSections', () => {
  it('centres an empty section on the point', () => {
    const s = emptySection({ x: 1000, y: 1000 });
    expect(s.x + s.width / 2).toBe(1000);
    expect(s.y + s.height / 2).toBe(1000);
  });

  it('copies sections with new ids, moved by the offset', () => {
    const [copy] = duplicateSections([section('s', 10, 20, 300, 300)], { x: 40, y: 40 });
    expect(copy.id).not.toBe('s');
    expect(copy).toMatchObject({ x: 50, y: 60, width: 300, height: 300, title: 's 副本' });
  });
});

describe('collapsed sections', () => {
  const open = section('open', 0, 0, 1000, 1000);
  const shut = section('shut', 2000, 0, 1000, 1000, { collapsed: true });
  const cards = [card('a', 100, 100), card('b', 2100, 100), card('c', 2400, 300), card('free', 5000, 0)];
  const members = membersBySection(cards, [open, shut], h);

  it('hides exactly the cards of collapsed sections', () => {
    expect([...hiddenCardIds([open, shut], members)].sort()).toEqual(['b', 'c']);
  });

  it('tells which collapsed section hides a card', () => {
    expect(collapsedSectionOf('b', [open, shut], members)?.id).toBe('shut');
    expect(collapsedSectionOf('a', [open, shut], members)).toBeUndefined();
    expect(collapsedSectionOf('free', [open, shut], members)).toBeUndefined();
  });

  it('hides a connection when either end is hidden', () => {
    const hidden = hiddenCardIds([open, shut], members);
    const shown = (from: string, to: string) => !hidden.has(from) && !hidden.has(to);
    expect(shown('a', 'free')).toBe(true);
    expect(shown('a', 'b')).toBe(false);
    expect(shown('c', 'free')).toBe(false);
  });
});

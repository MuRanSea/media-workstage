import type { CanvasSection, SpatialCard } from '../types/canvas.ts';
import type { Point, Rect } from './matrix.ts';
import { getCardsBoundingBox } from './layout.ts';

/** Height of a section's title bar (world px); a collapsed section is just this bar. */
export const SECTION_HEADER = 36;
/** Space between a section's edge and the cards it was drawn around. */
const SECTION_PADDING = 40;
export const SECTION_MIN_WIDTH = 240;
export const SECTION_MIN_HEIGHT = 140;
/** An empty section added from a menu. */
const EMPTY_SECTION = { width: 720, height: 480 };
export const DEFAULT_SECTION_TITLE = '未命名分区';

let counter = 0;
export function newSectionId(): string {
  counter = (counter + 1) % 1000;
  return `section-${Date.now().toString(36)}-${counter}-${Math.random().toString(36).slice(2, 6)}`;
}

/** A section drawn around `cards`, with room for its title bar. */
export function sectionAround(cards: SpatialCard[], heightOf: (c: SpatialCard) => number): CanvasSection | null {
  const box = getCardsBoundingBox(cards, heightOf);
  if (!box) return null;
  return {
    id: newSectionId(),
    title: DEFAULT_SECTION_TITLE,
    x: Math.round(box.x - SECTION_PADDING),
    y: Math.round(box.y - SECTION_PADDING - SECTION_HEADER),
    width: Math.round(box.width + 2 * SECTION_PADDING),
    height: Math.round(box.height + 2 * SECTION_PADDING + SECTION_HEADER),
  };
}

/** An empty section centred on `at`. */
export function emptySection(at: Point): CanvasSection {
  return {
    id: newSectionId(),
    title: DEFAULT_SECTION_TITLE,
    x: Math.round(at.x - EMPTY_SECTION.width / 2),
    y: Math.round(at.y - EMPTY_SECTION.height / 2),
    ...EMPTY_SECTION,
  };
}

/** The rectangle a section occupies on screen: its title bar alone while collapsed. */
export function sectionRect(s: CanvasSection): Rect {
  return { x: s.x, y: s.y, width: s.width, height: s.collapsed ? SECTION_HEADER : s.height };
}

const contains = (s: CanvasSection, p: Point) => p.x >= s.x && p.x <= s.x + s.width && p.y >= s.y && p.y <= s.y + s.height;

/**
 * The section a card belongs to: the one its centre lies in. Where sections
 * overlap, the smaller one wins, then the later one (drawn on top). Collapsed
 * sections still own their cards (by their full, expanded area).
 */
export function sectionOf(card: SpatialCard, sections: CanvasSection[], heightOf: (c: SpatialCard) => number): CanvasSection | undefined {
  const centre = { x: card.x + card.width / 2, y: card.y + heightOf(card) / 2 };
  let best: CanvasSection | undefined;
  for (const s of sections) {
    if (!contains(s, centre)) continue;
    if (!best || s.width * s.height <= best.width * best.height) best = s;
  }
  return best;
}

/** Ids of the cards in each section. */
export function membersBySection(
  cards: SpatialCard[],
  sections: CanvasSection[],
  heightOf: (c: SpatialCard) => number
): Map<string, string[]> {
  const out = new Map<string, string[]>(sections.map((s) => [s.id, []]));
  if (sections.length === 0) return out;
  for (const card of cards) {
    const s = sectionOf(card, sections, heightOf);
    if (s) out.get(s.id)!.push(card.id);
  }
  return out;
}

/** Sections from project.json: drops entries that are not sections, fixes broken numbers. */
export function normalizeSections(raw: unknown): CanvasSection[] {
  if (!Array.isArray(raw)) return [];
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  return raw.flatMap((r): CanvasSection[] => {
    if (!r || typeof r !== 'object' || typeof (r as CanvasSection).id !== 'string') return [];
    const s = r as Partial<CanvasSection> & { id: string };
    return [
      {
        id: s.id,
        title: typeof s.title === 'string' && s.title.trim() ? s.title : DEFAULT_SECTION_TITLE,
        x: num(s.x, 0),
        y: num(s.y, 0),
        width: Math.max(SECTION_MIN_WIDTH, num(s.width, EMPTY_SECTION.width)),
        height: Math.max(SECTION_MIN_HEIGHT, num(s.height, EMPTY_SECTION.height)),
        ...(s.collapsed ? { collapsed: true } : {}),
      },
    ];
  });
}

/** Copies of `sections` moved by `offset`, with new ids. */
export function duplicateSections(sections: CanvasSection[], offset: Point): CanvasSection[] {
  return sections.map((s) => ({
    ...s,
    id: newSectionId(),
    title: `${s.title} 副本`,
    x: Math.round(s.x + offset.x),
    y: Math.round(s.y + offset.y),
  }));
}

/** Cards hidden because their section is collapsed. */
export function hiddenCardIds(sections: CanvasSection[], members: ReadonlyMap<string, string[]>): Set<string> {
  const hidden = new Set<string>();
  for (const s of sections) if (s.collapsed) for (const id of members.get(s.id) ?? []) hidden.add(id);
  return hidden;
}

/** The collapsed section hiding `cardId`, if any. */
export function collapsedSectionOf(cardId: string, sections: CanvasSection[], members: ReadonlyMap<string, string[]>): CanvasSection | undefined {
  return sections.find((s) => s.collapsed && (members.get(s.id) ?? []).includes(cardId));
}

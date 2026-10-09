import type { CanvasSection, SpatialCard } from '../types/canvas.ts';
import type { Point } from './matrix.ts';
import { SECTION_HEADER, sectionOf, sectionRect } from './sections.ts';
import { firstFreeSlotBelow } from './layout.ts';

/** Space between columns of connected cards. */
const COLUMN_GAP = 100;
/** Space between cards in a column, and between rows of a grid. */
const ROW_GAP = 40;
/** Space between separate connected groups, and between the connected block and loose cards. */
const BLOCK_GAP = 120;
/** Loose cards of one type are laid out this many to a row. */
const LOOSE_COLUMNS = 3;
/** Inside a section: distance from its edges (below the title bar). */
const SECTION_INSET = 40;

const TYPE_ORDER: SpatialCard['type'][] = ['text', 'image', 'video', 'upload'];

export interface ArrangeResult {
  /** New top-left of every card that moved. */
  positions: Map<string, Point>;
  /** Sections that grew to hold their arranged cards. */
  sections: CanvasSection[];
}

/** Links between cards, source → user: prompt source, references, generation → result. */
function linksOf(cards: SpatialCard[]): [string, string][] {
  const links: [string, string][] = [];
  for (const c of cards) {
    if (c.promptSourceId) links.push([c.promptSourceId, c.id]);
    for (const r of c.references ?? []) links.push([r.cardId, c.id]);
    if (c.sourceId) links.push([c.sourceId, c.id]);
  }
  return links;
}

const byPosition = (a: SpatialCard, b: SpatialCard) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id);

/**
 * Lays out one group of cards from `origin`: connected cards in columns, sources
 * left of what uses them, one connected group under the next; loose cards by
 * type in small grids to the right. Order follows the cards' current positions,
 * so arranging an arranged group changes nothing.
 */
function layoutGroup(group: SpatialCard[], allLinks: [string, string][], heightOf: (c: SpatialCard) => number, origin: Point): Map<string, Point> {
  const ids = new Set(group.map((c) => c.id));
  const links = allLinks.filter(([a, b]) => a !== b && ids.has(a) && ids.has(b));
  const preds = new Map<string, string[]>(group.map((c) => [c.id, []]));
  const neighbours = new Map<string, string[]>(group.map((c) => [c.id, []]));
  for (const [a, b] of links) {
    preds.get(b)!.push(a);
    neighbours.get(a)!.push(b);
    neighbours.get(b)!.push(a);
  }
  const byId = new Map(group.map((c) => [c.id, c]));
  const positions = new Map<string, Point>();

  // Connected groups, in the order of their top-left-most card.
  const sorted = [...group].sort(byPosition);
  const seen = new Set<string>();
  const components: SpatialCard[][] = [];
  const loose: SpatialCard[] = [];
  for (const start of sorted) {
    if (seen.has(start.id)) continue;
    if (neighbours.get(start.id)!.length === 0) {
      seen.add(start.id);
      loose.push(start);
      continue;
    }
    const component: SpatialCard[] = [];
    const queue = [start.id];
    seen.add(start.id);
    while (queue.length) {
      const id = queue.shift()!;
      component.push(byId.get(id)!);
      for (const n of neighbours.get(id)!) if (!seen.has(n)) (seen.add(n), queue.push(n));
    }
    components.push(component.sort(byPosition));
  }

  // Column of each card: one right of its furthest source. Links form no cycles in practice;
  // the pass limit keeps a malformed project from looping.
  const layer = new Map<string, number>(group.map((c) => [c.id, 0]));
  for (let pass = 0, changed = true; changed && pass < group.length; pass++) {
    changed = false;
    for (const [a, b] of links) {
      if (layer.get(b)! < layer.get(a)! + 1) {
        layer.set(b, layer.get(a)! + 1);
        changed = true;
      }
    }
  }

  let y = origin.y;
  let connectedRight = origin.x;
  for (const component of components) {
    const columns: SpatialCard[][] = [];
    for (const c of component) (columns[layer.get(c.id)!] ??= []).push(c);
    let x = origin.x;
    let bottom = y;
    for (const column of columns) {
      if (!column) continue;
      let cy = y;
      for (const c of column) {
        positions.set(c.id, { x, y: cy });
        cy += heightOf(c) + ROW_GAP;
      }
      bottom = Math.max(bottom, cy - ROW_GAP);
      x += Math.max(...column.map((c) => c.width)) + COLUMN_GAP;
    }
    connectedRight = Math.max(connectedRight, x - COLUMN_GAP);
    y = bottom + BLOCK_GAP;
  }

  // Loose cards by type, right of the connected block.
  let lx = components.length ? connectedRight + BLOCK_GAP : origin.x;
  for (const type of TYPE_ORDER) {
    const ofType = loose.filter((c) => c.type === type);
    if (ofType.length === 0) continue;
    const cellWidth = Math.max(...ofType.map((c) => c.width));
    let ry = origin.y;
    for (let i = 0; i < ofType.length; i += LOOSE_COLUMNS) {
      const row = ofType.slice(i, i + LOOSE_COLUMNS);
      row.forEach((c, j) => positions.set(c.id, { x: lx + j * (cellWidth + ROW_GAP), y: ry }));
      ry += Math.max(...row.map(heightOf)) + ROW_GAP;
    }
    lx += Math.min(LOOSE_COLUMNS, ofType.length) * (cellWidth + ROW_GAP) - ROW_GAP + BLOCK_GAP;
  }
  return positions;
}

/**
 * Tidies `targets` (ids of the cards to arrange). Cards are arranged within the
 * section they are in, from its top-left corner; cards outside sections from
 * where the top-left-most of them is now, moved down where needed to keep clear
 * of sections and of cards left in place. Cards in collapsed sections stay put.
 * A section grows when its arranged cards need more room.
 */
export function arrangeCards(
  cards: SpatialCard[],
  targets: ReadonlySet<string>,
  sections: CanvasSection[],
  heightOf: (c: SpatialCard) => number
): ArrangeResult {
  const links = linksOf(cards);
  const groups = new Map<string, SpatialCard[]>();
  for (const c of cards) {
    if (!targets.has(c.id)) continue;
    const section = sectionOf(c, sections, heightOf);
    if (section?.collapsed) continue;
    const key = section?.id ?? '';
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(c);
  }

  const positions = new Map<string, Point>();
  const grown: CanvasSection[] = [];
  // Sections first: they may grow, and the cards outside them must then keep clear of them.
  const order = [...groups.keys()].sort((a, b) => (a === '' ? 1 : 0) - (b === '' ? 1 : 0));
  for (const key of order) {
    const group = groups.get(key)!;
    const section = sections.find((s) => s.id === key);
    if (section) {
      const origin = { x: section.x + SECTION_INSET, y: section.y + SECTION_HEADER + SECTION_INSET };
      const placed = layoutGroup(group, links, heightOf, origin);
      for (const [id, p] of placed) positions.set(id, { x: Math.round(p.x), y: Math.round(p.y) });
      const right = Math.max(...group.map((c) => placed.get(c.id)!.x + c.width)) + SECTION_INSET;
      const bottom = Math.max(...group.map((c) => placed.get(c.id)!.y + heightOf(c))) + SECTION_INSET;
      const width = Math.max(section.width, Math.round(right - section.x));
      const height = Math.max(section.height, Math.round(bottom - section.y));
      if (width !== section.width || height !== section.height) grown.push({ ...section, width, height });
      continue;
    }

    // Cards outside sections: laid out from their top-left, then moved down as one block
    // until it overlaps no section and no card that is not being arranged.
    const origin = { x: Math.min(...group.map((c) => c.x)), y: Math.min(...group.map((c) => c.y)) };
    const placed = layoutGroup(group, links, heightOf, origin);
    const moving = new Set(group.map((c) => c.id));
    const grownById = new Map(grown.map((s) => [s.id, s]));
    const obstacles = [
      ...sections.map((s) => ({ id: s.id, ...sectionRect(grownById.get(s.id) ?? s) })),
      ...cards.filter((c) => !moving.has(c.id) && !positions.has(c.id)).map((c) => ({ id: c.id, x: c.x, y: c.y, width: c.width, height: heightOf(c) })),
      ...cards.filter((c) => positions.has(c.id)).map((c) => ({ id: c.id, ...positions.get(c.id)!, width: c.width, height: heightOf(c) })),
    ];
    const right = Math.max(...group.map((c) => placed.get(c.id)!.x + c.width));
    const bottom = Math.max(...group.map((c) => placed.get(c.id)!.y + heightOf(c)));
    const slot = firstFreeSlotBelow(origin, { width: right - origin.x, height: bottom - origin.y }, obstacles);
    for (const [id, p] of placed) positions.set(id, { x: Math.round(p.x + slot.x - origin.x), y: Math.round(p.y + slot.y - origin.y) });
  }
  return { positions, sections: grown };
}

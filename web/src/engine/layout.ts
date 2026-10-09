import type { Point, Rect } from './matrix.ts';

export interface LayoutCard {
  id: string;
  x: number;
  y: number;
  width: number;
  height?: number;
}

/** Height assumed for a card that carries none and has no measurement; callers on the canvas pass real heights. */
export const DEFAULT_CARD_HEIGHT = 380;

/** A card's rendered height. */
export type CardHeightOf<T> = (card: T) => number;

const ownHeight = (card: LayoutCard) => card.height ?? DEFAULT_CARD_HEIGHT;

/**
 * Checks whether two 2D axis-aligned bounding boxes intersect.
 */
export function isRectIntersecting(r1: Rect, r2: Rect): boolean {
  return (
    r1.x < r2.x + r2.width &&
    r1.x + r1.width > r2.x &&
    r1.y < r2.y + r2.height &&
    r1.y + r1.height > r2.y
  );
}

/**
 * Normalizes any two points (e.g. drag start and drag end) into a positive bounding box Rect.
 */
export function getMarqueeRect(p1: Point, p2: Point): Rect {
  const x = Math.min(p1.x, p2.x);
  const y = Math.min(p1.y, p2.y);
  const width = Math.abs(p2.x - p1.x);
  const height = Math.abs(p2.y - p1.y);
  return { x, y, width, height };
}

/**
 * Computes bounding box encompassing all specified cards.
 */
export function getCardsBoundingBox<T extends LayoutCard>(cards: T[], heightOf: CardHeightOf<T> = ownHeight): Rect | null {
  if (cards.length === 0) return null;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const c of cards) {
    const h = heightOf(c);
    minX = Math.min(minX, c.x);
    maxX = Math.max(maxX, c.x + c.width);
    minY = Math.min(minY, c.y);
    maxY = Math.max(maxY, c.y + h);
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

export type AlignmentType =
  | 'left'
  | 'right'
  | 'top'
  | 'bottom'
  | 'center-h'
  | 'center-v';

/**
 * Aligns selected cards relative to their collective bounding box.
 */
export function alignCards<T extends LayoutCard>(
  cards: T[],
  selectedIds: Set<string>,
  alignment: AlignmentType,
  heightOf: CardHeightOf<T> = ownHeight
): T[] {
  if (selectedIds.size <= 1) return cards;

  const selectedCards = cards.filter((c) => selectedIds.has(c.id));
  const bbox = getCardsBoundingBox(selectedCards, heightOf);
  if (!bbox) return cards;

  return cards.map((card) => {
    if (!selectedIds.has(card.id)) return card;

    const cardHeight = heightOf(card);
    let nextX = card.x;
    let nextY = card.y;

    switch (alignment) {
      case 'left':
        nextX = bbox.x;
        break;
      case 'right':
        nextX = bbox.x + bbox.width - card.width;
        break;
      case 'top':
        nextY = bbox.y;
        break;
      case 'bottom':
        nextY = bbox.y + bbox.height - cardHeight;
        break;
      case 'center-h':
        nextX = bbox.x + (bbox.width - card.width) / 2;
        break;
      case 'center-v':
        nextY = bbox.y + (bbox.height - cardHeight) / 2;
        break;
    }

    return { ...card, x: nextX, y: nextY };
  });
}

/**
 * Arranges selected cards into a clean multi-column grid layout.
 */
export function autoArrangeGrid<T extends LayoutCard>(
  cards: T[],
  selectedIds: Set<string>,
  gap = 40,
  columns = 3,
  heightOf: CardHeightOf<T> = ownHeight
): T[] {
  if (selectedIds.size <= 1) return cards;

  const selectedCards = cards.filter((c) => selectedIds.has(c.id));
  const bbox = getCardsBoundingBox(selectedCards, heightOf);
  if (!bbox) return cards;

  const startX = bbox.x;
  const startY = bbox.y;

  let col = 0;
  let row = 0;
  let maxColWidth = 0;
  let maxRowHeight = 0;

  const positions = new Map<string, { x: number; y: number }>();

  // Determine uniform grid cell bounds
  for (const c of selectedCards) {
    maxColWidth = Math.max(maxColWidth, c.width);
    maxRowHeight = Math.max(maxRowHeight, heightOf(c));
  }

  for (const card of selectedCards) {
    const x = startX + col * (maxColWidth + gap);
    const y = startY + row * (maxRowHeight + gap);
    positions.set(card.id, { x, y });

    col++;
    if (col >= columns) {
      col = 0;
      row++;
    }
  }

  return cards.map((card) => {
    const newPos = positions.get(card.id);
    if (newPos) {
      return { ...card, x: newPos.x, y: newPos.y };
    }
    return card;
  });
}

/**
 * Top-left of the first free `size` slot in the column one `gap` right of
 * `anchor`, scanning down from the anchor's top. Only free space decides the
 * slot: nothing is moved, and where earlier cards were once placed is irrelevant.
 */
export function firstFreeSlotRight(
  anchor: LayoutCard,
  size: { width: number; height: number },
  cards: LayoutCard[],
  gap = 40
): Point {
  return firstFreeSlotBelow({ x: anchor.x + anchor.width + gap, y: anchor.y }, size, cards, gap);
}

/**
 * Top-left of the first free `size` slot in the column at `start.x`, scanning
 * down from `start.y`, keeping `gap` clear of every card.
 */
export function firstFreeSlotBelow(
  start: Point,
  size: { width: number; height: number },
  cards: LayoutCard[],
  gap = 40
): Point {
  const { x } = start;
  let { y } = start;
  // Each blocked try moves below a card, so this ends after at most cards.length steps.
  for (;;) {
    const slot: Rect = { x: x - gap, y: y - gap, width: size.width + 2 * gap, height: size.height + 2 * gap };
    const blockers = cards.filter((c) => isRectIntersecting(slot, { x: c.x, y: c.y, width: c.width, height: ownHeight(c) }));
    if (blockers.length === 0) return { x, y };
    y = Math.max(...blockers.map((c) => c.y + ownHeight(c))) + gap;
  }
}

import type { Point, Rect } from './matrix.ts';

export interface LayoutCard {
  id: string;
  x: number;
  y: number;
  width: number;
  height?: number;
}

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
export function getCardsBoundingBox(cards: LayoutCard[]): Rect | null {
  if (cards.length === 0) return null;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const c of cards) {
    const h = c.height ?? 380;
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
  alignment: AlignmentType
): T[] {
  if (selectedIds.size <= 1) return cards;

  const selectedCards = cards.filter((c) => selectedIds.has(c.id));
  const bbox = getCardsBoundingBox(selectedCards);
  if (!bbox) return cards;

  return cards.map((card) => {
    if (!selectedIds.has(card.id)) return card;

    const cardHeight = card.height ?? 380;
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
  columns = 3
): T[] {
  if (selectedIds.size <= 1) return cards;

  const selectedCards = cards.filter((c) => selectedIds.has(c.id));
  const bbox = getCardsBoundingBox(selectedCards);
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
    maxRowHeight = Math.max(maxRowHeight, c.height ?? 380);
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

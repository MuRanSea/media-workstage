import type { SpatialCard } from '../types/canvas.ts';
import type { Point } from './matrix.ts';
import { cascadeFrom, createCard } from './cardFactory.ts';
import { connectCards } from './connections.ts';

/** Generation card kinds a line dropped on empty canvas can create. */
const CREATABLE = ['text', 'image', 'video'] as const;
export type DropCardType = (typeof CREATABLE)[number];

/** What the new card will do with the source's output. */
export type DropRole = 'prompt' | 'reference_image' | 'reference_video' | 'read_image';

export interface DropOption {
  type: DropCardType;
  role: DropRole;
  /** The new generation card, already connected to the source. */
  card: SpatialCard;
}

/** The new card's top-left: its input side at the drop point, its first slot near the cursor. */
const DROP_OFFSET_Y = 40;

/**
 * New cards a connection dragged from `source` and dropped at `at` (world) can
 * create: every generation card kind the connection rules accept, each one
 * fresh and wired to the source exactly as dropping on an existing card would.
 */
export function dropOptions(source: SpatialCard, at: Point, cards: SpatialCard[]): DropOption[] {
  const options: DropOption[] = [];
  for (const type of CREATABLE) {
    const fresh = { ...createCard(type, at, cards), ...cascadeFrom({ x: at.x, y: at.y - DROP_OFFSET_Y }, cards) };
    const res = connectCards(source, fresh);
    if (!res.ok) continue;
    const role: DropRole = res.patch.promptSourceId
      ? 'prompt'
      : type === 'text'
        ? 'read_image'
        : source.type === 'video' || (source.type === 'upload' && source.mediaKind === 'video')
          ? 'reference_video'
          : 'reference_image';
    options.push({ type, role, card: { ...fresh, ...res.patch } });
  }
  return options;
}

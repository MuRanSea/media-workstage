import type { SpatialCard } from '../types/canvas.ts';
import type { ProjectViewport } from '../services/projects.ts';
import { isTerminalStatus } from './taskSync.ts';
import { migrateLegacyCards, type SavedCard } from './migration.ts';
import { MAX_ZOOM, MIN_ZOOM } from './matrix.ts';

export const DEFAULT_VIEWPORT: ProjectViewport = { zoom: 0.85, panX: 60, panY: 40 };


function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Viewport from project.json, falling back to defaults for missing or broken values. */
export function normalizeViewport(raw: unknown): ProjectViewport {
  const v = (raw ?? {}) as Partial<ProjectViewport>;
  return {
    zoom: isFiniteNumber(v.zoom) ? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom)) : DEFAULT_VIEWPORT.zoom,
    panX: isFiniteNumber(v.panX) ? v.panX : DEFAULT_VIEWPORT.panX,
    panY: isFiniteNumber(v.panY) ? v.panY : DEFAULT_VIEWPORT.panY,
  };
}

/** Hint texts that older versions stored as the actual prompt of new cards. */
const LEGACY_PLACEHOLDER_PROMPTS = new Set(['输入画面主体与氛围描述...', '运镜描述，输入 @图1 @图2 引用素材...']);

/**
 * Cards from project.json. Drops entries that are not cards, resets cards whose
 * submit never returned a task id (the page closed mid-request) to idle since
 * nothing will ever update them, clears legacy placeholder prompts, and
 * migrates cards saved before generation and result cards (see migration.ts).
 */
export function normalizeCards(raw: unknown): SpatialCard[] {
  if (!Array.isArray(raw)) return [];
  const cards = raw
    .filter(
      (c): c is SavedCard =>
        !!c && typeof c === 'object' && typeof (c as SavedCard).id === 'string' && typeof (c as SavedCard).type === 'string'
    )
    .map((c) => {
      let card = c;
      if (!card.taskId && (card.status === 'queued' || card.status === 'running')) card = { ...card, status: 'idle', progress: 0 };
      if (LEGACY_PLACEHOLDER_PROMPTS.has(card.prompt)) card = { ...card, prompt: '' };
      return card;
    });
  return migrateLegacyCards(cards);
}

/** Cards whose task may have finished while the project was closed. */
export function cardsAwaitingTask(cards: SpatialCard[]): SpatialCard[] {
  return cards.filter((c) => c.taskId && !isTerminalStatus(c.status) && c.status !== 'idle');
}

/**
 * Cards in `restored` still waiting on a task that were not in `before`: a
 * placeholder brought back by undo missed the task events sent while it was gone.
 */
export function restoredAwaitingTask(restored: SpatialCard[], before: SpatialCard[]): SpatialCard[] {
  const had = new Set(before.map((c) => c.id));
  return cardsAwaitingTask(restored).filter((c) => !had.has(c.id));
}

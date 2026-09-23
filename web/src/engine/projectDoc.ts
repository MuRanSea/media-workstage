import type { SpatialCard } from '../types/canvas.ts';
import type { ProjectViewport } from '../services/projects.ts';
import { isTerminalStatus } from './taskSync.ts';

export const DEFAULT_VIEWPORT: ProjectViewport = { zoom: 0.85, panX: 60, panY: 40 };

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 8;

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

/**
 * Cards from project.json. Drops entries that are not cards, and resets cards
 * whose submit never returned a task id (the page closed mid-request) to idle,
 * since nothing will ever update them.
 */
export function normalizeCards(raw: unknown): SpatialCard[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (c): c is SpatialCard =>
        !!c && typeof c === 'object' && typeof (c as SpatialCard).id === 'string' && typeof (c as SpatialCard).type === 'string'
    )
    .map((c) =>
      !c.taskId && (c.status === 'queued' || c.status === 'running') ? { ...c, status: 'idle', progress: 0 } : c
    );
}

/** Cards whose task may have finished while the project was closed. */
export function cardsAwaitingTask(cards: SpatialCard[]): SpatialCard[] {
  return cards.filter((c) => c.taskId && !isTerminalStatus(c.status) && c.status !== 'idle');
}

import { useCallback, useRef, useState } from 'react';
import type { SpatialCard } from '../types/canvas.ts';
import { isTaskResult } from './resultCards.ts';

const LIMIT = 50;

/** Fields written by the task pipeline (SSE / polling), not by the user. */
const TASK_FIELDS = ['taskId', 'status', 'progress', 'errorMessage', 'resultUrl', 'outputAssets'] as const;

/**
 * A restored snapshot with each surviving card's task state taken from `current`,
 * so undoing an edit never rolls back a generation that finished meanwhile. Result
 * cards that tasks added since the snapshot are kept, except those in `dropped`:
 * redo passes the cards the redone edit deleted, so redoing a delete removes them
 * again. A kept result whose generation card is not restored becomes standalone.
 */
export function mergeTaskState(
  restored: SpatialCard[],
  current: SpatialCard[],
  dropped: ReadonlySet<string> = new Set()
): SpatialCard[] {
  const byId = new Map(current.map((c) => [c.id, c]));
  const restoredIds = new Set(restored.map((c) => c.id));
  const added = current.filter((c) => isTaskResult(c) && !restoredIds.has(c.id) && !dropped.has(c.id));
  const merged = restored.map((card) => {
    const live = byId.get(card.id);
    if (!live) return card;
    const next: SpatialCard = { ...card };
    for (const f of TASK_FIELDS) {
      (next as unknown as Record<string, unknown>)[f] = live[f];
    }
    return next;
  });
  const ids = new Set([...restoredIds, ...added.map((c) => c.id)]);
  return merged.concat(added.map((c) => (c.sourceId && !ids.has(c.sourceId) ? { ...c, sourceId: undefined } : c)));
}

/**
 * Undo/redo over card snapshots. Call `record(before)` with the cards as they
 * were just before a user edit; `undo`/`redo` return the cards to show.
 */
export function useHistory() {
  const past = useRef<SpatialCard[][]>([]);
  // Each redo step also keeps the snapshot its undo restored, to tell which cards the edit deleted.
  const future = useRef<{ cards: SpatialCard[]; restoredByUndo: SpatialCard[] }[]>([]);
  // Bumped so canUndo/canRedo re-render.
  const [, setVersion] = useState(0);

  const record = useCallback((before: SpatialCard[]) => {
    past.current.push(before);
    if (past.current.length > LIMIT) past.current.shift();
    future.current = [];
    setVersion((v) => v + 1);
  }, []);

  const undo = useCallback((current: SpatialCard[]): SpatialCard[] | null => {
    const prev = past.current.pop();
    if (!prev) return null;
    future.current.push({ cards: current, restoredByUndo: prev });
    setVersion((v) => v + 1);
    return mergeTaskState(prev, current);
  }, []);

  const redo = useCallback((current: SpatialCard[]): SpatialCard[] | null => {
    const next = future.current.pop();
    if (!next) return null;
    past.current.push(current);
    setVersion((v) => v + 1);
    const kept = new Set(next.cards.map((c) => c.id));
    const dropped = new Set(next.restoredByUndo.filter((c) => !kept.has(c.id)).map((c) => c.id));
    return mergeTaskState(next.cards, current, dropped);
  }, []);

  return {
    record,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  };
}

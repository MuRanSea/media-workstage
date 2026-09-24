import { useCallback, useRef, useState } from 'react';
import type { SpatialCard } from '../types/canvas.ts';

const LIMIT = 50;

/** Fields written by the task pipeline (SSE / polling), not by the user. */
const TASK_FIELDS = ['taskId', 'status', 'progress', 'errorMessage', 'resultUrl', 'outputAssets'] as const;

/**
 * A restored snapshot with each surviving card's task state taken from `current`,
 * so undoing an edit never rolls back a generation that finished meanwhile.
 */
export function mergeTaskState(restored: SpatialCard[], current: SpatialCard[]): SpatialCard[] {
  const byId = new Map(current.map((c) => [c.id, c]));
  return restored.map((card) => {
    const live = byId.get(card.id);
    if (!live) return card;
    const merged: SpatialCard = { ...card };
    for (const f of TASK_FIELDS) {
      (merged as unknown as Record<string, unknown>)[f] = live[f];
    }
    return merged;
  });
}

/**
 * Undo/redo over card snapshots. Call `record(before)` with the cards as they
 * were just before a user edit; `undo`/`redo` return the cards to show.
 */
export function useHistory() {
  const past = useRef<SpatialCard[][]>([]);
  const future = useRef<SpatialCard[][]>([]);
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
    future.current.push(current);
    setVersion((v) => v + 1);
    return mergeTaskState(prev, current);
  }, []);

  const redo = useCallback((current: SpatialCard[]): SpatialCard[] | null => {
    const next = future.current.pop();
    if (!next) return null;
    past.current.push(current);
    setVersion((v) => v + 1);
    return mergeTaskState(next, current);
  }, []);

  return {
    record,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  };
}

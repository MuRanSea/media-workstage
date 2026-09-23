import { useCallback, useEffect, useRef, useState } from 'react';
import type { SpatialCard } from '../types/canvas.ts';
import { apiSaveProject, ProjectConflictError, type ProjectViewport } from '../services/projects.ts';

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict';

const AUTOSAVE_DELAY_MS = 1000;

interface UseAutosaveArgs {
  projectId: string;
  /** Revision of the loaded document; null until the project has loaded. */
  initialRevision: number | null;
  cards: SpatialCard[];
}

/**
 * Debounced autosave of a project's cards and viewport, plus Ctrl+S and a
 * keepalive save when the page closes. Saves are serialized: a change made
 * while a save is in flight is written right after it. A 409 (another tab
 * saved first) stops autosave so neither side silently overwrites the other.
 */
export function useAutosave({ projectId, initialRevision, cards }: UseAutosaveArgs) {
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [lastError, setLastError] = useState<string | null>(null);

  const revisionRef = useRef<number | null>(initialRevision);
  const cardsRef = useRef(cards);
  const viewportRef = useRef<ProjectViewport | null>(null);
  const dirtyRef = useRef(false);
  const inFlightRef = useRef(false);
  const conflictRef = useRef(false);
  const timerRef = useRef<number | undefined>(undefined);

  const flush = useCallback(async () => {
    window.clearTimeout(timerRef.current);
    if (conflictRef.current || revisionRef.current === null || !dirtyRef.current || inFlightRef.current) return;
    inFlightRef.current = true;
    setSaveState('saving');
    try {
      // Loop so edits made during a save are written without waiting for another debounce.
      while (dirtyRef.current) {
        dirtyRef.current = false;
        const resp = await apiSaveProject(projectId, {
          revision: revisionRef.current!,
          viewport: viewportRef.current ?? { zoom: 0.85, panX: 60, panY: 40 },
          cards: cardsRef.current,
        });
        revisionRef.current = resp.revision;
      }
      setSaveState('saved');
      setLastError(null);
    } catch (err) {
      dirtyRef.current = true;
      if (err instanceof ProjectConflictError) {
        conflictRef.current = true;
        setSaveState('conflict');
      } else {
        setSaveState('error');
      }
      setLastError((err as Error).message);
    } finally {
      inFlightRef.current = false;
    }
  }, [projectId]);

  const markDirty = useCallback(() => {
    if (revisionRef.current === null || conflictRef.current) return;
    dirtyRef.current = true;
    if (!inFlightRef.current) setSaveState('dirty');
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void flush(), AUTOSAVE_DELAY_MS);
  }, [flush]);

  // Arm once the document has loaded.
  useEffect(() => {
    if (initialRevision !== null && revisionRef.current === null) {
      revisionRef.current = initialRevision;
    }
  }, [initialRevision]);

  // Every card change after load is a save candidate; the first run is the load itself.
  const seenCardsRef = useRef(false);
  useEffect(() => {
    cardsRef.current = cards;
    if (revisionRef.current === null) return;
    if (!seenCardsRef.current) {
      seenCardsRef.current = true;
      return;
    }
    markDirty();
  }, [cards, markDirty]);

  const onViewportChange = useCallback(
    (viewport: ProjectViewport) => {
      const prev = viewportRef.current;
      viewportRef.current = viewport;
      if (prev && (prev.zoom !== viewport.zoom || prev.panX !== viewport.panX || prev.panY !== viewport.panY)) {
        markDirty();
      }
    },
    [markDirty]
  );

  // Ctrl/Cmd+S saves immediately, even while typing in a card.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (!conflictRef.current) {
          dirtyRef.current = true;
          void flush();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [flush]);

  // Closing the tab or leaving the project: write pending changes with keepalive.
  useEffect(() => {
    const saveOnExit = () => {
      if (!dirtyRef.current || inFlightRef.current || conflictRef.current || revisionRef.current === null) return;
      dirtyRef.current = false;
      void apiSaveProject(
        projectId,
        { revision: revisionRef.current, viewport: viewportRef.current ?? { zoom: 0.85, panX: 60, panY: 40 }, cards: cardsRef.current },
        { keepalive: true }
      ).catch(() => {});
    };
    window.addEventListener('beforeunload', saveOnExit);
    return () => {
      window.removeEventListener('beforeunload', saveOnExit);
      window.clearTimeout(timerRef.current);
      saveOnExit();
    };
  }, [projectId]);

  return { saveState, lastError, onViewportChange, saveNow: flush };
}

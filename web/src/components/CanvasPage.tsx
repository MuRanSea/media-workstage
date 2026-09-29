import { useCallback, useEffect, useRef, useState } from 'react';
import { type SpatialCard } from '../types/canvas.ts';
import { SpatialCanvas } from './SpatialCanvas.tsx';
import { ProjectSwitcher } from './ProjectSwitcher.tsx';
import {
  apiCreateTask,
  apiGenerateText,
  apiGetTask,
  getBufferedTaskEvent,
  subscribeTaskEvents,
} from '../services/api.ts';
import { apiGetProject, apiRenameProject, type ProjectDocument } from '../services/projects.ts';
import { navigate } from '../services/router.ts';
import { useProjectActions } from './useProjectActions.ts';
import { Button, useToast } from './ui/index.ts';
import { compileCardImagePayload } from '../engine/compiler.ts';
import { compileCardVideoPayload } from '../engine/videoCompiler.ts';
import { withEffectivePrompt } from '../engine/connections.ts';
import { getTextPreset } from '../engine/textPresets.ts';
import { MISSING_PROVIDER_HINT, isProviderMissing } from '../engine/channelModels.ts';
import { useChannels } from '../services/channels.ts';
import { applyTaskToCard } from '../engine/taskSync.ts';
import { addPendingResult, applyTaskToCards, type HeightOf } from '../engine/resultCards.ts';
import type { BackendTaskResponse } from '../services/api.ts';
import { cardsAwaitingTask, normalizeCards, normalizeViewport } from '../engine/projectDoc.ts';
import { setActiveProjectId } from '../engine/assetPaths.ts';
import { useAutosave } from '../engine/useAutosave.ts';

/** A card's rendered height (unaffected by canvas zoom), when it is on screen. */
const measuredHeight: HeightOf = (card) =>
  document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(card.id)}"]`)?.offsetHeight;

/** Loads a project, then mounts its canvas. */
export function CanvasPage({ projectId }: { projectId: string }) {
  const [doc, setDoc] = useState<ProjectDocument | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiGetProject(projectId)
      .then((d) => !cancelled && setDoc(d))
      .catch((err) => !cancelled && setError((err as Error).message));
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (error) {
    return (
      <div className="w-screen h-screen flex flex-col items-center justify-center gap-4 bg-canvas-bg text-slate-300">
        <p className="text-sm">无法打开工程：{error}</p>
        <Button onClick={() => navigate('/')}>返回工程列表</Button>
      </div>
    );
  }
  if (!doc) {
    return (
      <div className="w-screen h-screen flex items-center justify-center bg-canvas-bg text-xs text-slate-500">
        正在打开工程…
      </div>
    );
  }
  return <ProjectCanvas doc={doc} />;
}

function ProjectCanvas({ doc }: { doc: ProjectDocument }) {
  const projectId = doc.id;
  // Card media paths resolve against this project's folder.
  setActiveProjectId(projectId);

  const [cards, setCards] = useState<SpatialCard[]>(() => normalizeCards(doc.cards));
  const [initialViewport] = useState(() => normalizeViewport(doc.viewport));
  const [name, setName] = useState(doc.name);
  const toast = useToast();
  const providers = useChannels();
  const { create: createProject } = useProjectActions();
  const { saveState, lastError, onViewportChange } = useAutosave({
    projectId,
    initialRevision: doc.revision,
    cards,
  });

  useEffect(() => {
    document.title = `${name} · Media Workstage`;
  }, [name]);

  const updateTaskCards = useCallback((task: BackendTaskResponse) => {
    setCards((prev) => applyTaskToCards(prev, task));
  }, []);

  // Generation cards whose submit request is in flight: a double click must not submit twice.
  // The ref guards synchronously; the state disables the button.
  const submittingRef = useRef(new Set<string>());
  const [submittingIds, setSubmittingIds] = useState<ReadonlySet<string>>(() => new Set());
  const setSubmitting = (cardId: string, on: boolean) => {
    if (on) submittingRef.current.add(cardId);
    else submittingRef.current.delete(cardId);
    setSubmittingIds(new Set(submittingRef.current));
  };

  // Tasks that finished while the project was closed never reached us over SSE.
  useEffect(() => {
    for (const card of cardsAwaitingTask(cards)) {
      apiGetTask(card.taskId!)
        .then(updateTaskCards)
        .catch(() => {});
    }
    // Only on open: later updates arrive over SSE.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Subscribe to SSE backend push events
  useEffect(() => {
    return subscribeTaskEvents((eventType, task) => {
      if (eventType === 'task.progress' || eventType === 'task.succeeded' || eventType === 'task.failed') {
        updateTaskCards(task);
      }
    });
  }, [updateTaskCards]);

  const handleRename = async (next: string) => {
    const prev = name;
    setName(next);
    try {
      await apiRenameProject(projectId, next);
    } catch (err) {
      setName(prev);
      toast(`重命名失败：${(err as Error).message}`, { tone: 'error' });
    }
  };

  const handleGenerateText = async (card: SpatialCard) => {
    const update = (patch: Partial<SpatialCard>) =>
      setCards((prev) => prev.map((c) => (c.id === card.id ? { ...c, ...patch } : c)));

    if (!card.provider || !card.model) {
      update({ status: 'failed', errorMessage: '请先选择服务商和模型' });
      return;
    }
    update({ status: 'running', errorMessage: undefined });
    try {
      const { text } = await apiGenerateText({
        provider: card.provider,
        model: card.model,
        system: getTextPreset(card.textPreset).system,
        prompt: card.prompt,
      });
      update({ status: 'succeeded', textOutput: text });
    } catch (err) {
      update({ status: 'failed', errorMessage: (err as Error).message || '文本生成失败' });
    }
  };

  const handleTriggerGenerate = async (cardId: string) => {
    const targetCard = cards.find((c) => c.id === cardId);
    // Result cards are finished outputs: only their generation card runs again.
    if (!targetCard || targetCard.role === 'result') return;
    // Also reached from the context menu, which does not know the provider is gone.
    if (isProviderMissing(providers, targetCard.provider)) {
      toast(MISSING_PROVIDER_HINT, { tone: 'error' });
      return;
    }
    if (targetCard.type === 'text') {
      await handleGenerateText(targetCard);
      return;
    }
    if (targetCard.role === 'generation') {
      await submitGeneration(targetCard);
      return;
    }

    // Set card status to queued
    setCards((prev) =>
      prev.map((c) =>
        c.id === cardId ? { ...c, status: 'queued', progress: 5, errorMessage: undefined } : c
      )
    );
    try {
      // A connected text card supplies the prompt.
      const effectiveCard = withEffectivePrompt(targetCard, cards);
      const payload =
        effectiveCard.type === 'image'
          ? compileCardImagePayload(effectiveCard)
          : compileCardVideoPayload(effectiveCard, cards);

      const backendTask = await apiCreateTask({ ...payload, project_id: projectId });
      const taskId = backendTask.id;

      // Reconcile: Check event buffer or fast fetch if poller completed immediately
      const buffered = getBufferedTaskEvent(taskId);
      let latestTask = backendTask;

      if (buffered && buffered.task) {
        latestTask = buffered.task;
      } else if (backendTask.status === 'queued') {
        try {
          const fresh = await apiGetTask(taskId);
          if (fresh && fresh.status !== 'queued') {
            latestTask = fresh;
          }
        } catch {
          // ignore
        }
      }

      setCards((prev) =>
        prev.map((c) =>
          c.id === cardId
            ? applyTaskToCard({ ...c, progress: Math.max(c.progress, 10) }, latestTask)
            : c
        )
      );
    } catch (err) {
      setCards((prev) =>
        prev.map((c) =>
          c.id === cardId
            ? {
                ...c,
                status: 'failed',
                errorMessage: (err as Error).message || '提交任务失败',
              }
            : c
        )
      );
    }
  };

  /**
   * Runs a generation card once. The card keeps no task state: once the backend
   * accepts the task a result card appears next to it and takes all updates.
   * Errors before that point stay on the generation card.
   */
  const submitGeneration = async (card: SpatialCard) => {
    if (submittingRef.current.has(card.id)) return;
    setSubmitting(card.id, true);
    const setError = (errorMessage: string | undefined) =>
      setCards((prev) => prev.map((c) => (c.id === card.id ? { ...c, errorMessage } : c)));
    try {
      // A connected text card supplies the prompt.
      const submitted = withEffectivePrompt(card, cards);
      if (!submitted.prompt.trim()) throw new Error('请先填写提示词');
      const accepted = await apiCreateTask({ ...compileCardImagePayload(submitted), project_id: projectId });
      setCards((prev) =>
        addPendingResult(prev, submitted, accepted, measuredHeight).map((c) =>
          c.id === card.id && c.errorMessage ? { ...c, errorMessage: undefined } : c
        )
      );

      // The task may have moved on before its result card existed.
      const latest =
        getBufferedTaskEvent(accepted.id)?.task ??
        (accepted.status === 'queued' ? await apiGetTask(accepted.id).catch(() => undefined) : undefined);
      if (latest) updateTaskCards(latest);
    } catch (err) {
      setError((err as Error).message || '提交任务失败');
    } finally {
      setSubmitting(card.id, false);
    }
  };

  return (
    <SpatialCanvas
      cards={cards}
      setCards={setCards}
      onTriggerGenerate={handleTriggerGenerate}
      submittingIds={submittingIds}
      initialViewport={initialViewport}
      onViewportChange={onViewportChange}
      headerSlot={
        <ProjectSwitcher
          projectId={projectId}
          name={name}
          saveState={saveState}
          saveError={lastError}
          onRename={handleRename}
          onCreateProject={() => void createProject()}
        />
      }
    />
  );
}

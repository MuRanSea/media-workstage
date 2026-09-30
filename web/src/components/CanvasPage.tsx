import { useCallback, useEffect, useRef, useState } from 'react';
import { type ResultActionDto, type SpatialCard } from '../types/canvas.ts';
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
import {
  actionKey,
  actionLabel,
  addOriginResult,
  addPendingResult,
  applyTaskToCards,
  settleTextRun,
  type HeightOf,
  type TextRunOutcome,
} from '../engine/resultCards.ts';
import { compileActionPayload, compileDescribePayload, findDescribeProvider, isMidjourney } from '../engine/midjourney.ts';
import type { BackendTaskResponse } from '../services/api.ts';
import { cardsAwaitingTask, normalizeCards, normalizeViewport, restoredAwaitingTask } from '../engine/projectDoc.ts';
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
    setCards((prev) => applyTaskToCards(prev, task, measuredHeight));
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

  // Prompt-assistant requests in flight per generation card. Text runs are synchronous
  // and have no placeholder card, so the count lives here and is never saved.
  const [textRuns, setTextRuns] = useState<ReadonlyMap<string, number>>(() => new Map());
  const countTextRun = (cardId: string, delta: number) =>
    setTextRuns((prev) => {
      const next = new Map(prev);
      const n = (next.get(cardId) ?? 0) + delta;
      if (n > 0) next.set(cardId, n);
      else next.delete(cardId);
      return next;
    });

  /** Catches `awaiting` cards up with their tasks' latest state. */
  const fetchTasks = useCallback(
    (awaiting: SpatialCard[]) => {
      for (const card of awaiting) {
        apiGetTask(card.taskId!)
          .then(updateTaskCards)
          .catch(() => {});
      }
    },
    [updateTaskCards]
  );

  // Tasks that finished while the project was closed never reached us over SSE.
  useEffect(() => {
    fetchTasks(cardsAwaitingTask(cards));
    // Only on open: later updates arrive over SSE.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A placeholder brought back by undo missed the events sent while it was deleted.
  const fetchRestoredTasks = useCallback(
    (restored: SpatialCard[], before: SpatialCard[]) => fetchTasks(restoredAwaitingTask(restored, before)),
    [fetchTasks]
  );

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

  /** Runs a prompt-assistant generation card once; each returned text becomes its own result card. */
  const runTextGeneration = async (card: SpatialCard) => {
    const settle = (outcome: TextRunOutcome) =>
      setCards((prev) => settleTextRun(prev, card, outcome, measuredHeight));
    if (!card.provider || !card.model) return settle({ error: '请先选择服务商和模型' });
    if (!card.prompt.trim()) return settle({ error: '请先填写想法' });
    countTextRun(card.id, 1);
    try {
      const { text } = await apiGenerateText({
        provider: card.provider,
        model: card.model,
        system: getTextPreset(card.textPreset).system,
        prompt: card.prompt,
      });
      settle({ text });
    } catch (err) {
      settle({ error: (err as Error).message || '文本生成失败' });
    } finally {
      countTextRun(card.id, -1);
    }
  };

  const handleTriggerGenerate = async (cardId: string) => {
    const targetCard = cards.find((c) => c.id === cardId);
    // Result cards are finished outputs: only their generation card runs again.
    if (!targetCard || targetCard.role !== 'generation') return;
    // Also reached from the context menu, which does not know the provider is gone.
    if (isProviderMissing(providers, targetCard.provider)) {
      toast(MISSING_PROVIDER_HINT, { tone: 'error' });
      return;
    }
    await (targetCard.type === 'text' ? runTextGeneration(targetCard) : submitGeneration(targetCard));
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
      // A Midjourney Blend mixes its images and needs no prompt.
      const blending = isMidjourney(submitted) && submitted.mjOperation === 'blend';
      if (!blending && !submitted.prompt.trim()) throw new Error('请先填写提示词');
      const payload =
        submitted.type === 'video' ? compileCardVideoPayload(submitted, cards) : compileCardImagePayload(submitted, cards);
      const accepted = await apiCreateTask({ ...payload, project_id: projectId });
      setCards((prev) =>
        addPendingResult(prev, submitted, accepted, measuredHeight).map((c) =>
          c.id === card.id && c.errorMessage ? { ...c, errorMessage: undefined } : c
        )
      );
      await catchUp(accepted);
    } catch (err) {
      setError((err as Error).message || '提交任务失败');
    } finally {
      setSubmitting(card.id, false);
    }
  };

  /** The task may have moved on before its result card existed. */
  const catchUp = async (accepted: BackendTaskResponse) => {
    const latest =
      getBufferedTaskEvent(accepted.id)?.task ??
      (accepted.status === 'queued' ? await apiGetTask(accepted.id).catch(() => undefined) : undefined);
    if (latest) updateTaskCards(latest);
  };

  /**
   * Runs an operation on the result card `sourceId` (a result action, or Describe).
   * Like a generation, its output lands on a new result card once the backend accepts
   * the task; a refusal before that is only reported.
   */
  const runOnResult = async (
    sourceId: string,
    key: string,
    submit: (source: SpatialCard) => Promise<{ accepted: BackendTaskResponse; add: (cards: SpatialCard[], source: SpatialCard) => SpatialCard[] }>
  ) => {
    const source = cards.find((c) => c.id === sourceId);
    if (!source || submittingRef.current.has(key)) return;
    setSubmitting(key, true);
    try {
      const { accepted, add } = await submit(source);
      // The source may have moved while the request was in flight.
      setCards((prev) => add(prev, prev.find((c) => c.id === sourceId) ?? source));
      await catchUp(accepted);
    } catch (err) {
      toast((err as Error).message || '提交任务失败', { tone: 'error' });
    } finally {
      setSubmitting(key, false);
    }
  };

  const handleRunAction = (sourceId: string, action: ResultActionDto) =>
    runOnResult(sourceId, actionKey(sourceId, action.id), async (source) => {
      if (isProviderMissing(providers, source.provider)) throw new Error(MISSING_PROVIDER_HINT);
      const label = actionLabel(action);
      const accepted = await apiCreateTask({ ...compileActionPayload(source, action, label), project_id: projectId });
      const runner = { type: 'image' as const, provider: source.provider, model: source.model };
      return {
        accepted,
        add: (all, src) => addOriginResult(all, src, { operation: 'action', label, actionId: action.id }, runner, accepted, measuredHeight),
      };
    });

  const handleDescribe = (sourceId: string) =>
    runOnResult(sourceId, actionKey(sourceId, 'describe'), async (source) => {
      const runner = findDescribeProvider(providers);
      if (!runner) throw new Error('没有配置好的 Midjourney 服务商，无法反推提示词');
      const accepted = await apiCreateTask({ ...compileDescribePayload(source, runner), project_id: projectId });
      return {
        accepted,
        add: (all, src) => addOriginResult(all, src, { operation: 'describe', label: '反推' }, { type: 'text', ...runner }, accepted, measuredHeight),
      };
    });

  return (
    <SpatialCanvas
      cards={cards}
      setCards={setCards}
      onTriggerGenerate={handleTriggerGenerate}
      onRunAction={(sourceId, action) => void handleRunAction(sourceId, action)}
      onDescribe={(sourceId) => void handleDescribe(sourceId)}
      submittingIds={submittingIds}
      textRuns={textRuns}
      initialViewport={initialViewport}
      onViewportChange={onViewportChange}
      onRestore={fetchRestoredTasks}
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

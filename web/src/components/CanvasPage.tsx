import { useCallback, useEffect, useState } from 'react';
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
import { apiCreateProject, apiGetProject, apiRenameProject, type ProjectDocument } from '../services/projects.ts';
import { navigate, projectHref } from '../services/router.ts';
import { compileCardImagePayload } from '../engine/compiler.ts';
import { compileCardVideoPayload } from '../engine/videoCompiler.ts';
import { withEffectivePrompt } from '../engine/connections.ts';
import { getTextPreset } from '../engine/textPresets.ts';
import { applyTaskToCard } from '../engine/taskSync.ts';
import { cardsAwaitingTask, normalizeCards, normalizeViewport } from '../engine/projectDoc.ts';
import { setActiveProjectId } from '../engine/assetPaths.ts';
import { useAutosave } from '../engine/useAutosave.ts';

/** Next free @图N: one past the highest tag, so deleted cards never cause duplicates. */
function nextTagIndex(cards: SpatialCard[]): number {
  return cards.reduce((max, c) => Math.max(max, c.tagIndex), 0) + 1;
}

/** Asks for a name, creates the project and opens it. */
export async function promptCreateProject(): Promise<void> {
  const name = window.prompt('新工程名称', '未命名工程');
  if (name === null) return;
  try {
    const doc = await apiCreateProject(name);
    navigate(projectHref(doc.id));
  } catch (err) {
    window.alert(`新建工程失败：${(err as Error).message}`);
  }
}

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
      <div className="w-screen h-screen flex flex-col items-center justify-center gap-4 bg-[#08090f] text-slate-300">
        <p className="text-sm">无法打开工程：{error}</p>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="px-3 py-1.5 rounded-lg border border-slate-700 text-xs hover:bg-slate-800"
        >
          返回工程列表
        </button>
      </div>
    );
  }
  if (!doc) {
    return (
      <div className="w-screen h-screen flex items-center justify-center bg-[#08090f] text-xs text-slate-500">
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
  const { saveState, lastError, onViewportChange } = useAutosave({
    projectId,
    initialRevision: doc.revision,
    cards,
  });

  useEffect(() => {
    document.title = `${name} · Media Workstage`;
  }, [name]);

  const updateTaskCards = useCallback((task: Parameters<typeof applyTaskToCard>[1]) => {
    setCards((prev) => prev.map((c) => (c.taskId === task.id || c.id === task.id ? applyTaskToCard(c, task) : c)));
  }, []);

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
      window.alert(`重命名失败：${(err as Error).message}`);
    }
  };

  const handleAddImageCard = () => {
    const nextIndex = nextTagIndex(cards);
    const newCard: SpatialCard = {
      id: `card-${Date.now()}`,
      type: 'image',
      title: `原画构思 ${nextIndex}`,
      tagIndex: nextIndex,
      x: 300 + Math.random() * 80,
      y: 200 + Math.random() * 80,
      width: 340,
      prompt: '输入画面主体与氛围描述...',
      provider: 'ark',
      model: 'doubao-seedream-5-0-pro-260628',
      status: 'idle',
      progress: 0,
      isExpanded: false,
      activeParamTab: 'specs',
      imageMode: 'single',
      sizeMode: 'tier',
      imageTier: '2K',
      imageRatioPreset: '16:9',
      imageFormat: 'jpeg',
      watermark: false,
      background: 'opaque',
    };
    setCards((prev) => [...prev, newCard]);
  };

  const handleAddVideoCard = () => {
    const nextIndex = nextTagIndex(cards);
    const newCard: SpatialCard = {
      id: `card-${Date.now()}`,
      type: 'video',
      title: `镜头 ${nextIndex}`,
      tagIndex: nextIndex,
      x: 500 + Math.random() * 80,
      y: 200 + Math.random() * 80,
      width: 460,
      prompt: '运镜描述，输入 @图1 @图2 引用素材...',
      provider: 'ark',
      model: 'doubao-seedance-2-5-260628',
      status: 'idle',
      progress: 0,
      isExpanded: false,
      activeParamTab: 'specs',
      mode: 'all_modal',
      resolution: '720p',
      duration: 5,
      ratio: '16:9',
      generateAudio: true,
      outputFormat: 'mp4',
      promptOptimizer: true,
      references: [],
    };
    setCards((prev) => [...prev, newCard]);
  };

  const handleAddTextCard = () => {
    const nextIndex = nextTagIndex(cards);
    const newCard: SpatialCard = {
      id: `card-${Date.now()}`,
      type: 'text',
      title: `提示词助手 ${nextIndex}`,
      tagIndex: nextIndex,
      x: 60 + Math.random() * 80,
      y: 200 + Math.random() * 80,
      width: 340,
      prompt: '',
      model: '',
      status: 'idle',
      progress: 0,
      textPreset: 'image_prompt',
      textOutput: '',
    };
    setCards((prev) => [...prev, newCard]);
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
    if (!targetCard) return;
    if (targetCard.type === 'text') {
      await handleGenerateText(targetCard);
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

  return (
    <SpatialCanvas
      cards={cards}
      setCards={setCards}
      onAddImageCard={handleAddImageCard}
      onAddVideoCard={handleAddVideoCard}
      onAddTextCard={handleAddTextCard}
      onTriggerGenerate={handleTriggerGenerate}
      initialViewport={initialViewport}
      onViewportChange={onViewportChange}
      headerSlot={
        <ProjectSwitcher
          projectId={projectId}
          name={name}
          saveState={saveState}
          saveError={lastError}
          onRename={handleRename}
          onCreateProject={() => void promptCreateProject()}
        />
      }
    />
  );
}

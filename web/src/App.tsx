import { useState, useEffect } from 'react';
import { type SpatialCard } from './types/canvas.ts';
import { SpatialCanvas } from './components/SpatialCanvas.tsx';
import {
  apiCreateTask,
  apiGenerateText,
  apiGetTask,
  getBufferedTaskEvent,
  subscribeTaskEvents,
} from './services/api.ts';
import { compileCardImagePayload } from './engine/compiler.ts';
import { compileCardVideoPayload } from './engine/videoCompiler.ts';
import { withEffectivePrompt } from './engine/connections.ts';
import { getTextPreset } from './engine/textPresets.ts';

/** Next free @图N: one past the highest tag, so deleted cards never cause duplicates. */
function nextTagIndex(cards: SpatialCard[]): number {
  return cards.reduce((max, c) => Math.max(max, c.tagIndex), 0) + 1;
}

export function App() {
  const [cards, setCards] = useState<SpatialCard[]>([]);

  // Subscribe to SSE backend push events
  useEffect(() => {
    const unsubscribe = subscribeTaskEvents((eventType, task) => {
      setCards((prev) =>
        prev.map((c) => {
          if (c.taskId === task.id || c.id === task.id) {
            if (eventType === 'task.progress') {
              return {
                ...c,
                status: 'running',
                progress: task.progress,
              };
            } else if (eventType === 'task.succeeded') {
              const baseAsset = task.assets?.find((a) => a.kind === 'image_base');
              const firstAsset = task.assets?.[0];
              const displayAsset = baseAsset ?? firstAsset;
              const resultUrl = displayAsset?.local_path
                ? displayAsset.local_path.startsWith('/') ||
                  displayAsset.local_path.startsWith('assets/')
                  ? `/${displayAsset.local_path.replace(/^\/+/, '')}`
                  : `/assets/${displayAsset.local_path}`
                : displayAsset?.remote_url;

              return {
                ...c,
                status: 'succeeded',
                progress: 100,
                outputAssets: task.assets,
                resultUrl: resultUrl ?? c.resultUrl,
              };
            } else if (eventType === 'task.failed') {
              return {
                ...c,
                status: 'failed',
                errorMessage: task.error_message || task.error_code || '生成失败',
              };
            }
          }
          return c;
        })
      );
    });

    return () => {
      unsubscribe();
    };
  }, []);

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

      const backendTask = await apiCreateTask(payload);
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

      const videoAsset = latestTask.assets?.find((a) => a.kind === 'video');
      const baseAsset = latestTask.assets?.find((a) => a.kind === 'image_base');
      const firstAsset = latestTask.assets?.[0];
      const displayAsset = videoAsset ?? baseAsset ?? firstAsset;
      const resultUrl = displayAsset?.local_path
        ? displayAsset.local_path.startsWith('/') ||
          displayAsset.local_path.startsWith('assets/')
          ? `/${displayAsset.local_path.replace(/^\/+/, '')}`
          : `/assets/${displayAsset.local_path}`
        : displayAsset?.remote_url;
      setCards((prev) =>
        prev.map((c) =>
          c.id === cardId
            ? {
                ...c,
                taskId: taskId,
                status: latestTask.status || 'running',
                progress: latestTask.progress || 10,
                outputAssets: latestTask.assets ?? c.outputAssets,
                resultUrl: resultUrl ?? c.resultUrl,
                errorMessage: latestTask.error_message,
              }
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
    />
  );
}

export default App;

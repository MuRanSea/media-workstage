import { describe, it, expect } from 'vitest';
import { migrateLegacyCards } from './migration.ts';
import { applyTaskToCards, resultCardsOf, estimateCardHeight } from './resultCards.ts';
import { cardsAwaitingTask } from './projectDoc.ts';
import { isRectIntersecting } from './layout.ts';
import type { SpatialCard, TaskAssetDto } from '../types/canvas.ts';
import type { BackendTaskResponse } from '../services/api.ts';

/** A card as older versions saved it: no role, results written back onto it. */
const legacy = (patch: Partial<SpatialCard>): SpatialCard => ({
  id: 'img',
  type: 'image',
  title: '图片 1',
  tagIndex: 1,
  x: 0,
  y: 0,
  width: 340,
  prompt: '雨夜霓虹街道',
  provider: 'ark',
  model: 'doubao-seedream-5-0-pro-260628',
  imageMode: 'single',
  sizeMode: 'tier',
  imageTier: '2K',
  imageRatioPreset: '16:9',
  status: 'idle',
  progress: 0,
  ...patch,
});

const asset = (taskId: string, patch: Partial<TaskAssetDto> = {}): TaskAssetDto => ({
  id: `${taskId}-a0`,
  task_id: taskId,
  asset_index: 0,
  kind: 'image_base',
  z_index: 0,
  local_path: `images/${taskId}/base.png`,
  ...patch,
});

/** A legacy image card that finished task `taskId`. */
const doneImage = (patch: Partial<SpatialCard> = {}): SpatialCard => {
  const taskId = patch.taskId ?? 'task-img';
  return legacy({
    taskId,
    status: 'succeeded',
    progress: 100,
    resultUrl: `/assets/images/${taskId}/base.png`,
    outputAssets: [asset(taskId)],
    ...patch,
  });
};

const doneVideo = (patch: Partial<SpatialCard> = {}): SpatialCard =>
  legacy({
    id: 'vid',
    type: 'video',
    title: '视频 1',
    tagIndex: 2,
    x: 0,
    y: 1000,
    width: 460,
    prompt: '镜头推进 @图1',
    model: 'doubao-seedance-2-5-260628',
    mode: 'all_modal',
    resolution: '720p',
    duration: 5,
    ratio: '16:9',
    taskId: 'task-vid',
    status: 'succeeded',
    progress: 100,
    resultUrl: '/assets/videos/task-vid/output.mp4',
    outputAssets: [
      asset('task-vid', { id: 'v0', kind: 'image_frame', local_path: 'videos/task-vid/last.png' }),
      asset('task-vid', { id: 'v1', asset_index: 1, kind: 'video', local_path: 'videos/task-vid/output.mp4' }),
    ],
    references: [{ cardId: 'img', tagIndex: 1, role: 'reference_image', label: '图片 1', url: '/assets/images/task-img/base.png' }],
    ...patch,
  });

const task = (patch: Partial<BackendTaskResponse>): BackendTaskResponse => ({
  id: 'task-run',
  provider: 'ark',
  provider_task_id: '',
  model: 'm',
  task_type: 'image_generation',
  task_mode: 'single',
  prompt: '',
  params_json: '',
  status: 'running',
  progress: 0,
  created_at: '',
  updated_at: '',
  ...patch,
});

const byId = (cards: SpatialCard[], id: string) => cards.find((c) => c.id === id)!;
const results = (cards: SpatialCard[]) => cards.filter((c) => c.role === 'result');

describe('migrateLegacyCards: which cards migrate', () => {
  it('leaves cards that already have a role untouched', () => {
    const cards: SpatialCard[] = [
      { ...legacy({ id: 'g' }), role: 'generation', tagIndex: undefined },
      { ...doneImage({ id: 'r' }), role: 'result', sourceId: 'g' },
    ];
    expect(migrateLegacyCards(cards)).toEqual(cards);
  });

  it('turns a card that never ran into a generation card without a tag', () => {
    const [g] = migrateLegacyCards([legacy({ id: 'new', title: '草稿', x: 12, y: 34 })]);
    expect(g).toMatchObject({ id: 'new', role: 'generation', title: '草稿', x: 12, y: 34, status: 'idle', prompt: '雨夜霓虹街道' });
    expect(g.tagIndex).toBeUndefined();
  });
});

describe('migrateLegacyCards: an image or video card with a result', () => {
  it('keeps the card as an idle generation card with its settings and no output', () => {
    const cards = migrateLegacyCards([doneImage({ x: 10, y: 20, imageRatioPreset: '1:1', errorMessage: '旧错误' })]);
    const g = byId(cards, 'img');
    expect(g).toMatchObject({
      role: 'generation',
      title: '图片 1',
      x: 10,
      y: 20,
      prompt: '雨夜霓虹街道',
      imageRatioPreset: '1:1',
      status: 'idle',
      progress: 0,
    });
    for (const field of ['taskId', 'resultUrl', 'outputAssets', 'errorMessage', 'tagIndex'] as const) {
      expect(g[field]).toBeUndefined();
    }
  });

  it('moves the output into a result card linked to the generation card', () => {
    const cards = migrateLegacyCards([doneImage()]);
    expect(cards).toHaveLength(2);
    const [r] = resultCardsOf(cards, 'img');
    expect(r).toMatchObject({
      role: 'result',
      type: 'image',
      sourceId: 'img',
      taskId: 'task-img',
      status: 'succeeded',
      progress: 100,
      title: '图片 1 #1',
      resultUrl: '/assets/images/task-img/base.png',
      outputAssets: [asset('task-img')],
      width: 340,
      imageRatioPreset: '16:9',
    });
    expect(r.snapshot).toMatchObject({ prompt: '雨夜霓虹街道', provider: 'ark', model: 'doubao-seedream-5-0-pro-260628' });
  });

  it('derives the result card id from the old card id', () => {
    const [, r] = migrateLegacyCards([doneImage({ id: 'abc' })]);
    expect(r.id).toBe('abc-result');
  });

  it('hands the old @图N tag to the image result card', () => {
    const cards = migrateLegacyCards([doneImage({ tagIndex: 3 })]);
    expect(results(cards)[0].tagIndex).toBe(3);
    expect(byId(cards, 'img').tagIndex).toBeUndefined();
  });

  it('gives a video result card the video, not the saved last frame, and no tag', () => {
    const cards = migrateLegacyCards([doneVideo({ references: [] })]);
    const [r] = resultCardsOf(cards, 'vid');
    expect(r).toMatchObject({ type: 'video', resultUrl: '/assets/videos/task-vid/output.mp4', status: 'succeeded' });
    expect(r.outputAssets?.map((a) => a.kind)).toEqual(['video']);
    expect(r.tagIndex).toBeUndefined();
    expect(r.snapshot?.params).toMatchObject({ mode: 'all_modal', resolution: '720p', duration: 5, ratio: '16:9' });
  });

  it('keeps a result that only has an address', () => {
    const cards = migrateLegacyCards([doneImage({ outputAssets: undefined, resultUrl: 'https://x/y.png' })]);
    expect(results(cards)[0]).toMatchObject({ resultUrl: 'https://x/y.png', status: 'succeeded' });
  });

  it('places the result card in the first free slot right of the generation card', () => {
    const g = doneImage({ x: 100, y: 200 });
    const [, r] = migrateLegacyCards([g]);
    expect(r.x).toBeGreaterThanOrEqual(g.x + g.width);
    expect(r.y).toBe(200);
  });

  it('never moves existing cards and never lands on one', () => {
    const blocker = legacy({ id: 'blocker', x: 380, y: 0, tagIndex: 9 });
    const input = [doneImage({ x: 0, y: 0 }), blocker, doneImage({ id: 'img2', taskId: 't2', x: 0, y: 2000 })];
    const cards = migrateLegacyCards(input);
    for (const original of input) expect(byId(cards, original.id)).toMatchObject({ x: original.x, y: original.y });

    const rect = (c: SpatialCard) => ({ x: c.x, y: c.y, width: c.width, height: estimateCardHeight(c) });
    for (const r of results(cards)) {
      for (const other of cards.filter((c) => c.id !== r.id)) {
        expect(isRectIntersecting(rect(r), rect(other))).toBe(false);
      }
    }
  });
});

describe('migrateLegacyCards: a card with a task in progress', () => {
  it('becomes a generation card with a placeholder result card that keeps the task', () => {
    const cards = migrateLegacyCards([legacy({ taskId: 'task-run', status: 'running', progress: 40 })]);
    const g = byId(cards, 'img');
    expect(g).toMatchObject({ role: 'generation', status: 'idle' });
    expect(g.taskId).toBeUndefined();
    const [r] = resultCardsOf(cards, 'img');
    expect(r).toMatchObject({ role: 'result', taskId: 'task-run', status: 'running', progress: 40, tagIndex: 1 });
    expect(cardsAwaitingTask(cards).map((c) => c.id)).toEqual([r.id]);
  });

  it('lets task events finish the placeholder', () => {
    const cards = migrateLegacyCards([legacy({ taskId: 'task-run', status: 'queued' })]);
    const done = applyTaskToCards(cards, task({ status: 'succeeded', assets: [asset('task-run')] }));
    expect(resultCardsOf(done, 'img')[0]).toMatchObject({ status: 'succeeded', resultUrl: '/assets/images/task-run/base.png' });
    expect(byId(done, 'img').status).toBe('idle');
  });

  it('keeps an earlier output as its own result card next to the placeholder', () => {
    // A rerun keeps showing the previous task's output until it finishes.
    const rerun = { ...doneImage(), taskId: 'task-run', status: 'running' as const, progress: 30, tagIndex: 4 };
    const cards = migrateLegacyCards([rerun]);
    const [earlier, running] = resultCardsOf(cards, 'img');
    expect(earlier).toMatchObject({ status: 'succeeded', taskId: 'task-img', resultUrl: '/assets/images/task-img/base.png', tagIndex: 4 });
    expect(running).toMatchObject({ status: 'running', taskId: 'task-run', tagIndex: 5 });
    expect(running.resultUrl).toBeUndefined();
    expect(running.outputAssets).toBeUndefined();
  });

  it('resets a submit that never got a task id to idle, without a result card', () => {
    const cards = migrateLegacyCards([legacy({ status: 'queued', progress: 5 })]);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ role: 'generation', status: 'idle', progress: 0 });
  });
});

describe('migrateLegacyCards: text cards', () => {
  const text = (patch: Partial<SpatialCard> = {}): SpatialCard =>
    legacy({
      id: 'txt',
      type: 'text',
      title: '提示词助手 1',
      tagIndex: 5,
      prompt: '一只猫',
      provider: 'openai',
      model: 'gpt',
      textPreset: 'image_prompt',
      textOutput: '一只橘猫趴在窗台上',
      status: 'succeeded',
      progress: 100,
      ...patch,
    });

  it('moves a non-empty output into an editable text result card', () => {
    const cards = migrateLegacyCards([text()]);
    const g = byId(cards, 'txt');
    expect(g).toMatchObject({ role: 'generation', prompt: '一只猫', textPreset: 'image_prompt', status: 'idle' });
    expect(g.textOutput).toBeUndefined();
    expect(g.tagIndex).toBeUndefined();
    const [r] = resultCardsOf(cards, 'txt');
    expect(r).toMatchObject({ id: 'txt-result', type: 'text', role: 'result', textOutput: '一只橘猫趴在窗台上', status: 'succeeded', title: '提示词助手 1 #1' });
    expect(r.tagIndex).toBeUndefined();
    expect(r.snapshot).toMatchObject({ prompt: '一只猫', model: 'gpt', params: { textPreset: 'image_prompt' } });
  });

  it('turns a text card with an empty output into a generation card only', () => {
    const cards = migrateLegacyCards([text({ textOutput: '  ', status: 'idle' })]);
    expect(cards).toHaveLength(1);
    expect(cards[0].role).toBe('generation');
  });
});

describe('migrateLegacyCards: links', () => {
  it('points a video reference at the image result card, keeping @图N and dropping the saved address', () => {
    const cards = migrateLegacyCards([doneImage({ tagIndex: 3 }), doneVideo({ prompt: '镜头推进 @图3', references: [{ cardId: 'img', tagIndex: 3, role: 'first_frame', label: '图片 1', url: '/x.png', localPath: 'x.png' }] })]);
    const video = byId(cards, 'vid');
    expect(video.references).toEqual([{ cardId: 'img-result', tagIndex: 3, role: 'first_frame', label: '图片 1' }]);
    expect(video.prompt).toBe('镜头推进 @图3');
    expect(byId(cards, 'img-result').tagIndex).toBe(3);
  });

  it('points the video result snapshot references at the image result card too', () => {
    const cards = migrateLegacyCards([doneImage(), doneVideo()]);
    expect(resultCardsOf(cards, 'vid')[0].snapshot?.references?.map((r) => r.cardId)).toEqual(['img-result']);
  });

  it('points a prompt source at the text result card', () => {
    const cards = migrateLegacyCards([
      legacy({ id: 'txt', type: 'text', textOutput: '橘猫', status: 'succeeded', x: 2000 }),
      doneImage({ promptSourceId: 'txt' }),
    ]);
    expect(byId(cards, 'img').promptSourceId).toBe('txt-result');
  });

  it('drops links to old cards that never produced anything', () => {
    const cards = migrateLegacyCards([
      legacy({ id: 'img' }),
      legacy({ id: 'txt', type: 'text', textOutput: '', x: 2000 }),
      doneVideo({ promptSourceId: 'txt' }),
    ]);
    const video = byId(cards, 'vid');
    expect(video.references).toEqual([]);
    expect(video.promptSourceId).toBeUndefined();
  });

  it('drops links to cards that no longer exist', () => {
    const cards = migrateLegacyCards([doneVideo({ promptSourceId: 'gone' })]);
    expect(byId(cards, 'vid')).toMatchObject({ references: [], promptSourceId: undefined });
  });

  it('points a reference at a still-running image through its placeholder', () => {
    const cards = migrateLegacyCards([legacy({ taskId: 'task-run', status: 'running' }), doneVideo()]);
    expect(byId(cards, 'vid').references?.map((r) => r.cardId)).toEqual(['img-run']);
  });

  it('keeps links to cards that already have a role', () => {
    const r: SpatialCard = { ...doneImage({ id: 'r' }), role: 'result' };
    const cards = migrateLegacyCards([r, doneVideo({ references: [{ cardId: 'r', tagIndex: 1, role: 'reference_image', label: 'x' }] })]);
    expect(byId(cards, 'vid').references?.map((ref) => ref.cardId)).toEqual(['r']);
  });
});

describe('migrateLegacyCards: repeatability', () => {
  const project = () => [
    doneImage({ tagIndex: 1 }),
    legacy({ id: 'img-b', x: 0, y: 700, tagIndex: 2, taskId: 'task-b', status: 'running' }),
    legacy({ id: 'txt', type: 'text', textOutput: '橘猫', status: 'succeeded', x: 1500, tagIndex: 3 }),
    doneVideo({ promptSourceId: 'txt', y: 1500 }),
    legacy({ id: 'never', x: 3000 }),
  ];

  it('gives the same output for the same old data', () => {
    expect(migrateLegacyCards(project())).toEqual(migrateLegacyCards(project()));
  });

  it('changes nothing when run on its own output', () => {
    const once = migrateLegacyCards(project());
    expect(migrateLegacyCards(once)).toEqual(once);
  });
});

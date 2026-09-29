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

// --- Multi-asset outputs, unpacked cards and failures (ticket 09) ---

const layerTask = 'task-layers';
const baseAsset = asset(layerTask, { id: 'base', local_path: 'images/task-layers/base.png' });
const layerAsset = (n: number, z: number) =>
  asset(layerTask, {
    id: `layer${n}`,
    asset_index: n,
    kind: 'image_layer',
    z_index: z,
    local_path: `images/task-layers/layer_${n}.png`,
    bounding_box_json: '{"absolute":[0,0,100,200]}',
  });

/** An old layer decomposition card: base plus layers, saved in backend order. */
const layered = (patch: Partial<SpatialCard> = {}) =>
  doneImage({
    id: 'P',
    taskId: layerTask,
    imageMode: 'layer_decomp',
    tagIndex: 2,
    resultUrl: '/assets/images/task-layers/base.png',
    outputAssets: [baseAsset, layerAsset(1, 2), layerAsset(2, 1)],
    ...patch,
  });

const frameTask = 'task-frames';
const frameAsset = (n: number) =>
  asset(frameTask, { id: `f${n}`, asset_index: n, kind: 'image_frame', local_path: `images/task-frames/frame_${n}.png` });

const storyboard = (patch: Partial<SpatialCard> = {}) =>
  doneImage({
    id: 'S',
    taskId: frameTask,
    imageMode: 'sequential',
    tagIndex: 3,
    resultUrl: '/assets/images/task-frames/frame_0.png',
    outputAssets: [frameAsset(0), frameAsset(1), frameAsset(2)],
    ...patch,
  });

/** A card the old "unpack" button made from `parent`'s asset: a result, no task, id prefixed by kind. */
const unpacked = (kind: 'layer' | 'frame', parentId: string, a: TaskAssetDto, patch: Partial<SpatialCard> = {}) =>
  legacy({
    id: `${kind}-${a.id}-${parentId}`,
    title: `旧展开 ${a.id}`,
    tagIndex: 20,
    x: 5000,
    y: 5000,
    width: 330,
    status: 'succeeded',
    progress: 100,
    resultUrl: `/assets/${a.local_path}`,
    ...patch,
  });

describe('migrateLegacyCards: a card with several outputs', () => {
  it('gives each asset of a layer decomposition its own result card, base first then layers by z_index', () => {
    const cards = migrateLegacyCards([layered()]);
    const rs = resultCardsOf(cards, 'P');
    expect(rs.map((r) => r.outputAssets?.[0].id)).toEqual(['base', 'layer2', 'layer1']);
    expect(rs.map((r) => r.id)).toEqual(['P-result', 'P-result-2', 'P-result-1']);
    expect(rs.map((r) => r.resultUrl)).toEqual([
      '/assets/images/task-layers/base.png',
      '/assets/images/task-layers/layer_2.png',
      '/assets/images/task-layers/layer_1.png',
    ]);
    expect(rs.map((r) => r.title)).toEqual(['图片 1 #1', '图片 1 #1 · 图层 1', '图片 1 #1 · 图层 2']);
    expect(rs.every((r) => r.status === 'succeeded' && r.taskId === layerTask)).toBe(true);
  });

  it('lets the base keep the old @图N and numbers the rest one past the highest tag', () => {
    const cards = migrateLegacyCards([layered(), legacy({ id: 'other', tagIndex: 7, x: -3000 })]);
    expect(resultCardsOf(cards, 'P').map((r) => r.tagIndex)).toEqual([2, 8, 9]);
  });

  it('gives each storyboard frame its own result card in frame order', () => {
    const cards = migrateLegacyCards([storyboard({ outputAssets: [frameAsset(2), frameAsset(0), frameAsset(1)] })]);
    const rs = resultCardsOf(cards, 'S');
    expect(rs.map((r) => r.outputAssets?.[0].id)).toEqual(['f0', 'f1', 'f2']);
    expect(rs.map((r) => r.tagIndex)).toEqual([3, 4, 5]);
  });

  it('lays the cards out in a grid that overlaps nothing and moves nothing', () => {
    const frames = Array.from({ length: 9 }, (_, i) => frameAsset(i));
    const input = [storyboard({ outputAssets: frames }), legacy({ id: 'n', x: 400, y: 600, tagIndex: 1 })];
    const cards = migrateLegacyCards(input);
    for (const original of input) expect(byId(cards, original.id)).toMatchObject({ x: original.x, y: original.y });
    const rs = resultCardsOf(cards, 'S');
    expect(new Set(rs.map((r) => r.x)).size).toBe(3);
    const rect = (c: SpatialCard) => ({ x: c.x, y: c.y, width: c.width, height: estimateCardHeight(c) });
    for (const r of rs) {
      for (const other of cards.filter((c) => c.id !== r.id)) expect(isRectIntersecting(rect(r), rect(other))).toBe(false);
    }
  });

  it('points links at the base image', () => {
    const cards = migrateLegacyCards([
      layered(),
      doneVideo({ prompt: '推进 @图2', references: [{ cardId: 'P', tagIndex: 2, role: 'reference_image', label: 'x' }] }),
    ]);
    expect(byId(cards, 'vid').references?.map((r) => [r.cardId, r.tagIndex])).toEqual([['P-result', 2]]);
  });
});

describe('migrateLegacyCards: cards made by the old unpack buttons', () => {
  it('turns an unpacked layer into a result card in place, linked to the migrated generation card', () => {
    const layerCard = unpacked('layer', 'P', layerAsset(1, 2), { tagIndex: 11 });
    const cards = migrateLegacyCards([layered(), layerCard]);
    const r = byId(cards, layerCard.id);
    expect(r).toMatchObject({
      role: 'result',
      sourceId: 'P',
      x: 5000,
      y: 5000,
      title: '旧展开 layer1',
      tagIndex: 11,
      resultUrl: '/assets/images/task-layers/layer_1.png',
      status: 'succeeded',
    });
    expect(r.taskId).toBeUndefined();
    expect(r.outputAssets?.map((a) => a.id)).toEqual(['layer1']);
  });

  it('does not make a second card for an asset that was already unpacked', () => {
    const cards = migrateLegacyCards([layered(), unpacked('layer', 'P', layerAsset(1, 2)), unpacked('layer', 'P', layerAsset(2, 1))]);
    const rs = resultCardsOf(cards, 'P');
    expect(rs).toHaveLength(3);
    expect(rs.map((r) => r.outputAssets?.[0].id).sort()).toEqual(['base', 'layer1', 'layer2']);
    expect(cards).toHaveLength(4);
  });

  it('keeps the card count and content of a fully unpacked storyboard, adding only the generation link', () => {
    const input = [storyboard(), unpacked('frame', 'S', frameAsset(0)), unpacked('frame', 'S', frameAsset(1)), unpacked('frame', 'S', frameAsset(2))];
    const cards = migrateLegacyCards(input);
    expect(cards).toHaveLength(4);
    for (const card of input.slice(1)) {
      expect(byId(cards, card.id)).toMatchObject({ role: 'result', sourceId: 'S', resultUrl: card.resultUrl, tagIndex: card.tagIndex });
    }
  });

  it('points links to a storyboard at its first frame even when that frame was unpacked', () => {
    const first = unpacked('frame', 'S', frameAsset(0), { tagIndex: 30 });
    const cards = migrateLegacyCards([
      storyboard(),
      first,
      doneVideo({ prompt: '推进 @图3', references: [{ cardId: 'S', tagIndex: 3, role: 'reference_image', label: 'x' }] }),
    ]);
    const video = byId(cards, 'vid');
    expect(video.references?.map((r) => [r.cardId, r.tagIndex])).toEqual([[first.id, 30]]);
    expect(video.prompt).toBe('推进 @图30');
    // The storyboard's old @图3 meant frame 1; no other frame takes it over.
    expect(resultCardsOf(cards, 'S').map((r) => r.tagIndex)).toEqual([30, 31, 32]);
  });

  it('turns an unpacked card whose parent is gone into a standalone result card', () => {
    const orphan = unpacked('frame', 'deleted', frameAsset(0));
    const [r] = migrateLegacyCards([orphan]);
    expect(r).toMatchObject({ id: orphan.id, role: 'result', status: 'succeeded', x: 5000, y: 5000, tagIndex: 20 });
    expect(r.sourceId).toBeUndefined();
  });

  it('keeps links to unpacked cards', () => {
    const layerCard = unpacked('layer', 'P', layerAsset(1, 2));
    const cards = migrateLegacyCards([
      layered(),
      layerCard,
      doneVideo({ references: [{ cardId: layerCard.id, tagIndex: 20, role: 'reference_image', label: 'x' }] }),
    ]);
    expect(byId(cards, 'vid').references?.map((r) => r.cardId)).toEqual([layerCard.id]);
  });

  it('is repeatable', () => {
    const project = () => [layered(), unpacked('layer', 'P', layerAsset(1, 2)), storyboard({ x: 0, y: 3000 }), unpacked('frame', 'S', frameAsset(1))];
    const once = migrateLegacyCards(project());
    expect(migrateLegacyCards(project())).toEqual(once);
    expect(migrateLegacyCards(once)).toEqual(once);
    expect(once.filter((c) => c.id.startsWith('layer-'))).toHaveLength(1);
    expect(once.filter((c) => c.id.startsWith('frame-'))).toHaveLength(1);
  });
});

describe('migrateLegacyCards: failed cards', () => {
  it('turns a task that failed into a failed result card that keeps the error', () => {
    const cards = migrateLegacyCards([legacy({ taskId: 'task-bad', status: 'failed', errorMessage: '内容违规' })]);
    expect(byId(cards, 'img')).toMatchObject({ role: 'generation', status: 'idle' });
    expect(byId(cards, 'img').errorMessage).toBeUndefined();
    const [r] = resultCardsOf(cards, 'img');
    expect(r).toMatchObject({ id: 'img-failed', role: 'result', taskId: 'task-bad', status: 'failed', errorMessage: '内容违规' });
    expect(cardsAwaitingTask(cards)).toEqual([]);
  });

  it.each(['cancelled', 'expired'] as const)('does the same for a %s task', (status) => {
    const cards = migrateLegacyCards([legacy({ id: 'v', type: 'video', taskId: 't', status, errorMessage: 'x' })]);
    expect(resultCardsOf(cards, 'v')).toMatchObject([{ status, errorMessage: 'x' }]);
  });

  it('keeps an earlier output next to a rerun that failed', () => {
    const cards = migrateLegacyCards([{ ...doneImage(), taskId: 'task-bad', status: 'failed' as const, errorMessage: '超时' }]);
    expect(resultCardsOf(cards, 'img').map((r) => [r.id, r.status, r.taskId])).toEqual([
      ['img-result', 'succeeded', 'task-img'],
      ['img-failed', 'failed', 'task-bad'],
    ]);
  });

  it('clears a failure that happened before any task existed', () => {
    const cards = migrateLegacyCards([legacy({ status: 'failed', errorMessage: '缺少提示词' })]);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ role: 'generation', status: 'idle' });
    expect(cards[0].errorMessage).toBeUndefined();
  });

  it('drops links to a card whose only run failed', () => {
    const cards = migrateLegacyCards([legacy({ taskId: 'task-bad', status: 'failed' }), doneVideo()]);
    expect(byId(cards, 'vid').references).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { addPendingResult, applyTaskToCards, isTaskResult, settleTextRun, estimateCardHeight, runsInProgress, resultCardsOf, snapshotOf } from './resultCards.ts';
import { createCard } from './cardFactory.ts';
import type { SpatialCard } from '../types/canvas.ts';
import type { BackendTaskResponse } from '../services/api.ts';

const gen = (patch: Partial<SpatialCard> = {}): SpatialCard => ({
  ...createCard('image', { x: 170, y: 120 }, []),
  id: 'g1',
  title: '街景',
  prompt: '雨夜霓虹街道',
  x: 0,
  y: 0,
  ...patch,
});

const task = (patch: Partial<BackendTaskResponse> = {}): BackendTaskResponse => ({
  id: 'task-1',
  provider: 'ark',
  provider_task_id: '',
  model: 'm',
  task_type: 'image_generation',
  task_mode: 'single',
  prompt: '',
  params_json: '',
  status: 'queued',
  progress: 0,
  created_at: '',
  updated_at: '',
  ...patch,
});

const base = (taskId: string, path: string) => ({
  id: `${taskId}-a0`,
  task_id: taskId,
  asset_index: 0,
  kind: 'image_base' as const,
  z_index: 0,
  local_path: path,
});

const results = (cards: SpatialCard[]) => cards.filter((c) => c.role === 'result');

describe('new image cards', () => {
  it('are generation cards without a tag', () => {
    const card = createCard('image', { x: 0, y: 0 }, []);
    expect(card.role).toBe('generation');
    expect(card.tagIndex).toBeUndefined();
  });
});

describe('addPendingResult', () => {
  it('adds a queued result card linked to its generation card, with a snapshot', () => {
    const g = gen({ imageRatioPreset: '1:1' });
    const cards = addPendingResult([g], g, task());
    const [r] = results(cards);

    expect(cards).toHaveLength(2);
    expect(r).toMatchObject({
      role: 'result',
      type: 'image',
      sourceId: 'g1',
      taskId: 'task-1',
      status: 'queued',
      tagIndex: 1,
      title: '街景 #1',
    });
    expect(r.snapshot).toMatchObject({
      prompt: '雨夜霓虹街道',
      provider: 'ark',
      model: g.model,
      params: { imageRatioPreset: '1:1', imageMode: 'single' },
    });
    // The generation card itself is untouched.
    expect(cards[0]).toBe(g);
  });

  it('snapshots the prompt the task was submitted with, not the card field', () => {
    const g = gen({ prompt: '' });
    const [r] = results(addPendingResult([g], { ...g, prompt: '来自文本卡的提示词' }, task()));
    expect(r.snapshot?.prompt).toBe('来自文本卡的提示词');
  });

  it('keeps the snapshot when the generation card changes afterwards', () => {
    const g = gen();
    const cards = addPendingResult([g], g, task()).map((c) => (c.id === 'g1' ? { ...c, prompt: '改过了' } : c));
    expect(results(cards)[0].snapshot?.prompt).toBe('雨夜霓虹街道');
  });

  it('keeps the snapshot params and seed when the generation card is re-tuned afterwards', () => {
    const g = gen({ imageRatioPreset: '9:16', seedImage: 42 });
    const cards = addPendingResult([g], g, task()).map((c) =>
      c.id === 'g1' ? { ...c, imageRatioPreset: '1:1' as const, seedImage: 7, model: 'other', provider: 'x' } : c
    );
    expect(results(cards)[0].snapshot).toMatchObject({
      prompt: '雨夜霓虹街道',
      provider: 'ark',
      model: g.model,
      params: { imageRatioPreset: '9:16' },
      seed: 42,
    });
  });

  it('gives each run the snapshot it was submitted with', () => {
    const g = gen();
    let cards = addPendingResult([g], g, task({ id: 'task-1' }));
    const edited = { ...cards[0], prompt: '晴天海边' };
    cards = addPendingResult([edited, ...cards.slice(1)], edited, task({ id: 'task-2' }));
    expect(results(cards).map((c) => c.snapshot?.prompt)).toEqual(['雨夜霓虹街道', '晴天海边']);
  });

  it('reconciles with a task that already finished before the placeholder existed', () => {
    const g = gen();
    const done = task({ status: 'succeeded', assets: [base('task-1', 'images/task-1/base.png')] });
    const [r] = results(addPendingResult([g], g, done));
    expect(r).toMatchObject({ status: 'succeeded', progress: 100, resultUrl: '/assets/images/task-1/base.png' });
  });

  it('gives every run its own result card and leaves the generation card idle', () => {
    const g = gen();
    let cards = addPendingResult([g], g, task({ id: 'task-1' }));
    cards = addPendingResult(cards, g, task({ id: 'task-2' }));
    cards = addPendingResult(cards, g, task({ id: 'task-3' }));

    expect(resultCardsOf(cards, 'g1').map((c) => c.taskId)).toEqual(['task-1', 'task-2', 'task-3']);
    expect(results(cards).map((c) => c.title)).toEqual(['街景 #1', '街景 #2', '街景 #3']);
    const g1 = cards.find((c) => c.id === 'g1')!;
    expect(g1.status).toBe('idle');
    expect(g1.taskId).toBeUndefined();
  });

  it('is idempotent for the same task', () => {
    const g = gen();
    const once = addPendingResult([g], g, task());
    expect(addPendingResult(once, g, task())).toBe(once);
  });

  it('tags image results one past the highest tag, never reusing a number', () => {
    const g = gen();
    const legacy: SpatialCard = { ...gen({ id: 'old', role: undefined }), tagIndex: 5, x: 5000 };
    let cards = addPendingResult([g, legacy], g, task({ id: 'task-1' }));
    cards = addPendingResult(cards, g, task({ id: 'task-2' }));
    expect(results(cards).map((c) => c.tagIndex)).toEqual([6, 7]);
  });

  it('places results in the column right of the generation card, in the first free slot', () => {
    const g = gen({ x: 100, y: 200, width: 340 });
    let cards = addPendingResult([g], g, task({ id: 'task-1' }));
    cards = addPendingResult(cards, g, task({ id: 'task-2' }));
    const [r1, r2] = results(cards);

    expect(r1.x).toBeGreaterThanOrEqual(g.x + g.width);
    expect(r2.x).toBe(r1.x);
    expect(r1.y).toBe(g.y);
    expect(r2.y).toBeGreaterThan(r1.y);
  });

  it('never moves existing cards and is not affected by dragging an earlier result away', () => {
    const g = gen({ x: 0, y: 0, width: 340 });
    const first = addPendingResult([g], g, task({ id: 'task-1' }));
    const [r1] = results(first);
    // The user drags the first result far away: its slot is free again.
    const dragged = first.map((c) => (c.id === r1.id ? { ...c, x: 5000, y: 5000 } : c));
    const next = addPendingResult(dragged, g, task({ id: 'task-2' }));

    expect(next.slice(0, 2)).toEqual(dragged);
    const r2 = next.find((c) => c.taskId === 'task-2')!;
    expect({ x: r2.x, y: r2.y }).toEqual({ x: r1.x, y: r1.y });
  });
});

describe('applyTaskToCards', () => {
  const pending = () => {
    const g = gen();
    return addPendingResult([g], g, task());
  };

  it('tracks progress on the matching result card', () => {
    const cards = applyTaskToCards(pending(), task({ status: 'running', progress: 40 }));
    expect(results(cards)[0]).toMatchObject({ status: 'running', progress: 40 });
  });

  it('shows the image when the task succeeds', () => {
    const cards = applyTaskToCards(
      pending(),
      task({ status: 'succeeded', assets: [base('task-1', 'images/task-1/base.png')] })
    );
    expect(results(cards)[0]).toMatchObject({
      status: 'succeeded',
      progress: 100,
      resultUrl: '/assets/images/task-1/base.png',
    });
  });

  it.each(['failed', 'cancelled', 'expired'] as const)('keeps the error when the task is %s', (status) => {
    const cards = applyTaskToCards(pending(), task({ status, error_message: '内容违规' }));
    expect(results(cards)[0]).toMatchObject({ status, errorMessage: '内容违规' });
  });

  it('never writes task state onto the generation card', () => {
    const cards = applyTaskToCards(pending(), task({ status: 'failed', error_message: 'x' }));
    expect(cards[0].status).toBe('idle');
    expect(cards[0].errorMessage).toBeUndefined();
    expect(cards[0].taskId).toBeUndefined();
  });

  it('ignores events for tasks with no matching card', () => {
    const cards = pending();
    expect(applyTaskToCards(cards, task({ id: 'other', status: 'succeeded' }))).toEqual(cards);
  });

  it('does not let a stale snapshot roll back a finished result', () => {
    const done = applyTaskToCards(pending(), task({ status: 'succeeded', assets: [base('task-1', 'images/task-1/base.png')] }));
    const cards = applyTaskToCards(done, task({ status: 'running', progress: 30 }));
    expect(results(cards)[0]).toMatchObject({ status: 'succeeded', progress: 100 });
  });

  it('still updates legacy cards (no role) the old way', () => {
    const legacy: SpatialCard = { ...gen({ id: 'old' }), role: undefined, tagIndex: 1, taskId: 'task-9', status: 'running' };
    const cards = applyTaskToCards([legacy], task({ id: 'task-9', status: 'failed', error_code: 'X' }));
    expect(cards[0]).toMatchObject({ status: 'failed', errorMessage: 'X' });
  });
});

describe('runsInProgress', () => {
  it('counts the queued and running result cards pointing at a generation card', () => {
    const g = gen();
    let cards = addPendingResult([g], g, task({ id: 'task-1' }));
    cards = addPendingResult(cards, g, task({ id: 'task-2' }));
    cards = addPendingResult(cards, g, task({ id: 'task-3' }));
    expect(runsInProgress(cards, 'g1')).toBe(3);

    cards = applyTaskToCards(cards, task({ id: 'task-1', status: 'running', progress: 20 }));
    cards = applyTaskToCards(cards, task({ id: 'task-2', status: 'succeeded', assets: [base('task-2', 'b.png')] }));
    cards = applyTaskToCards(cards, task({ id: 'task-3', status: 'failed', error_message: 'x' }));
    expect(runsInProgress(cards, 'g1')).toBe(1);
  });

  it('is zero with nothing running, and ignores other generation cards', () => {
    const g = gen();
    const other = gen({ id: 'g2', x: 3000 });
    const cards = addPendingResult([g, other], other, task({ id: 'task-9' }));
    expect(runsInProgress(cards, 'g1')).toBe(0);
    expect(runsInProgress(cards, 'g2')).toBe(1);
  });
});

describe('estimateCardHeight', () => {
  it('gives generation cards no preview area', () => {
    const g = gen({ imageRatioPreset: '9:16' });
    expect(estimateCardHeight(g)).toBeLessThan(estimateCardHeight({ ...g, role: 'result' }));
    expect(estimateCardHeight(g)).toBe(estimateCardHeight({ ...g, imageRatioPreset: '16:9' }));
  });
});

describe('video result cards', () => {
  const videoGen = (patch: Partial<SpatialCard> = {}): SpatialCard => ({
    ...createCard('video', { x: 230, y: 120 }, []),
    id: 'v1',
    title: '镜头',
    prompt: '镜头缓缓推进',
    x: 0,
    y: 0,
    ...patch,
  });
  const videoAsset = (taskId: string, path: string) => ({
    id: `${taskId}-a0`,
    task_id: taskId,
    asset_index: 0,
    kind: 'video' as const,
    z_index: 0,
    local_path: path,
  });

  it('new video cards are generation cards without a tag', () => {
    const card = createCard('video', { x: 0, y: 0 }, []);
    expect(card.role).toBe('generation');
    expect(card.tagIndex).toBeUndefined();
  });

  it('adds a queued, untagged video result card with a video snapshot', () => {
    const g = videoGen({ mode: 'text_to_video', resolution: '1080p', duration: 10, ratio: '9:16', generateAudio: false, seed: 42 });
    const cards = addPendingResult([g], g, task({ task_type: 'video_generation' }));
    const [r] = results(cards);

    expect(r).toMatchObject({
      role: 'result',
      type: 'video',
      sourceId: 'v1',
      taskId: 'task-1',
      status: 'queued',
      title: '镜头 #1',
      ratio: '9:16',
    });
    expect(r.tagIndex).toBeUndefined();
    expect(r.references).toBeUndefined();
    expect(r.snapshot).toEqual({
      prompt: '镜头缓缓推进',
      provider: 'ark',
      model: g.model,
      params: { mode: 'text_to_video', resolution: '1080p', duration: 10, ratio: '9:16', generateAudio: false },
      seed: 42,
    });
    expect(r.x).toBeGreaterThanOrEqual(g.x + g.width);
  });

  it('summarises the reference images the run used', () => {
    const img: SpatialCard = { ...gen({ id: 'img-r' }), role: 'result', tagIndex: 3, title: '街景 #1', x: -2000 };
    const g = videoGen({
      mode: 'first_last_frame',
      prompt: '从 @图3 开始',
      references: [{ cardId: 'img-r', tagIndex: 3, role: 'first_frame', label: '街景 #1', url: '/assets/images/x.png' }],
    });
    const cards = addPendingResult([img, g], g, task());
    const r = cards.find((c) => c.id === 'result-task-1')!;

    expect(r.snapshot?.references).toEqual([{ cardId: 'img-r', tagIndex: 3, role: 'first_frame', label: '街景 #1' }]);
    expect(r.snapshot?.params.mode).toBe('first_last_frame');
    // A result card has no input port, so it holds no live references itself.
    expect(r.references).toBeUndefined();
    // Later edits to the generation card's references do not reach the snapshot.
    g.references!.push({ cardId: 'other', tagIndex: 9, role: 'last_frame', label: 'x' });
    expect(r.snapshot?.references).toHaveLength(1);
  });

  it('records the ratio and reference roles the mode actually sends', () => {
    const ref = (cardId: string, role: 'first_frame' | 'last_frame' | 'reference_image') =>
      ({ cardId, tagIndex: 1, role, label: cardId });
    const refs = [ref('a', 'reference_image'), ref('b', 'reference_image')];

    const flf = snapshotOf(videoGen({ mode: 'first_last_frame', ratio: '16:9', references: refs }));
    expect(flf.params.ratio).toBe('adaptive');
    expect(flf.references?.map((r) => r.role)).toEqual(['first_frame', 'last_frame']);

    const allModal = snapshotOf(videoGen({ mode: 'all_modal', references: [ref('a', 'first_frame')] }));
    expect(allModal.references?.map((r) => r.role)).toEqual(['reference_image']);

    expect(snapshotOf(videoGen({ mode: 'text_to_video', references: refs })).references).toBeUndefined();
  });

  it('plays the video once the task succeeds and keeps the error on failure', () => {
    const g = videoGen();
    let cards = addPendingResult([g], g, task({ id: 'task-1' }));
    cards = addPendingResult(cards, g, task({ id: 'task-2' }));
    expect(results(cards)).toHaveLength(2);

    cards = applyTaskToCards(cards, task({ id: 'task-1', status: 'running', progress: 55 }));
    expect(runsInProgress(cards, 'v1')).toBe(2);
    cards = applyTaskToCards(cards, task({ id: 'task-1', status: 'succeeded', assets: [videoAsset('task-1', 'videos/task-1/out.mp4')] }));
    cards = applyTaskToCards(cards, task({ id: 'task-2', status: 'expired', error_message: '任务过期' }));

    expect(results(cards)[0]).toMatchObject({ status: 'succeeded', progress: 100, resultUrl: '/assets/videos/task-1/out.mp4' });
    expect(results(cards)[1]).toMatchObject({ status: 'expired', errorMessage: '任务过期' });
    expect(cards[0]).toBe(g);
    expect(runsInProgress(cards, 'v1')).toBe(0);
  });

  it('sizes the placeholder from the requested ratio so a second result lands below it', () => {
    const g = videoGen({ ratio: '9:16' });
    let cards = addPendingResult([g], g, task({ id: 'task-1' }));
    cards = addPendingResult(cards, g, task({ id: 'task-2' }));
    const [a, b] = results(cards);
    expect(b.x).toBe(a.x);
    expect(b.y).toBeGreaterThanOrEqual(a.y + estimateCardHeight(a));
    expect(estimateCardHeight(a)).toBeGreaterThan(estimateCardHeight({ ...a, ratio: '16:9' }));
  });
});

describe('text result cards', () => {
  const textGen = (patch: Partial<SpatialCard> = {}): SpatialCard => ({
    ...createCard('text', { x: 170, y: 120 }, []),
    id: 't1',
    title: '提示词助手 1',
    prompt: '雨夜的街道',
    provider: 'openai',
    model: 'gpt-x',
    textPreset: 'image_prompt',
    x: 0,
    y: 0,
    ...patch,
  });

  it('new prompt-assistant cards are generation cards without a tag', () => {
    const card = createCard('text', { x: 0, y: 0 }, []);
    expect(card.role).toBe('generation');
    expect(card.tagIndex).toBeUndefined();
  });

  it('adds a finished, editable text result card right of the generation card', () => {
    const g = textGen();
    const cards = settleTextRun([g], g, { text: '赛博朋克街道，霓虹灯，雨' }, () => 200);
    const [r] = results(cards);

    expect(cards).toHaveLength(2);
    expect(r).toMatchObject({
      role: 'result',
      type: 'text',
      sourceId: 't1',
      status: 'succeeded',
      textOutput: '赛博朋克街道，霓虹灯，雨',
      title: '提示词助手 1 #1',
      x: g.x + g.width + 40,
      y: 0,
    });
    expect(r.tagIndex).toBeUndefined();
    expect(r.taskId).toBeUndefined();
    expect(r.snapshot).toEqual({
      prompt: '雨夜的街道',
      provider: 'openai',
      model: 'gpt-x',
      params: { textPreset: 'image_prompt' },
    });
    expect(isTaskResult(r)).toBe(true);
    expect(cards[0]).toBe(g);
  });

  it('gives every run its own card, stacked below the previous one', () => {
    const g = textGen();
    const height = () => 200;
    const once = settleTextRun([g], g, { text: '第一版' }, height);
    const twice = settleTextRun(once, g, { text: '第二版' }, height);
    const [a, b] = results(twice);

    expect(results(twice)).toHaveLength(2);
    expect(a.id).not.toBe(b.id);
    expect([a.textOutput, b.textOutput]).toEqual(['第一版', '第二版']);
    expect(b.title).toBe('提示词助手 1 #2');
    expect(b.x).toBe(a.x);
    expect(b.y).toBe(a.y + 200 + 40);
  });

  it('snapshots the settings it was submitted with, not later edits', () => {
    const g = textGen();
    const edited = { ...g, prompt: '改过的想法', textPreset: 'free' as const };
    const [r] = results(settleTextRun([edited], g, { text: 'x' }));
    expect(r.snapshot).toMatchObject({ prompt: '雨夜的街道', params: { textPreset: 'image_prompt' } });
  });

  it('keeps a failure on the generation card and adds no card', () => {
    const g = textGen();
    const cards = settleTextRun([g], g, { error: '额度不足' });
    expect(results(cards)).toHaveLength(0);
    expect(cards[0]).toMatchObject({ id: 't1', errorMessage: '额度不足', status: 'idle' });
  });

  it('clears the generation card error on the next successful run', () => {
    const g = textGen();
    const failed = settleTextRun([g], g, { error: '额度不足' });
    const cards = settleTextRun(failed, failed[0], { text: 'ok' });
    expect(cards[0].errorMessage).toBeUndefined();
    expect(results(cards)).toHaveLength(1);
  });

  it('still lands next to the generation card if it was deleted meanwhile', () => {
    const g = textGen();
    const cards = settleTextRun([], g, { text: 'ok' });
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ role: 'result', sourceId: 't1', x: g.x + g.width + 40 });
  });
});

describe('multi-output tasks', () => {
  type Asset = NonNullable<BackendTaskResponse['assets']>[number];
  const asset = (taskId: string, i: number, kind: Asset['kind'], patch: Partial<Asset> = {}): Asset => ({
    id: `${taskId}-a${i}`,
    task_id: taskId,
    asset_index: i,
    kind,
    z_index: 0,
    local_path: `images/${taskId}/${kind}_${i}.png`,
    ...patch,
  });
  // Seedream returns the base first; shuffle so the order has to come from z_index.
  const layered = (taskId: string, layers: number) => [
    ...Array.from({ length: layers }, (_, k) =>
      asset(taskId, layers - k, 'image_layer', {
        z_index: layers - k,
        bounding_box_json: JSON.stringify({ absolute: [0, 0, 1200 + 200 * (k % 3), 800] }),
      })
    ),
    asset(taskId, 0, 'image_base'),
  ];
  const frames = (taskId: string, n: number) =>
    Array.from({ length: n }, (_, k) => asset(taskId, n - 1 - k, 'image_frame', { z_index: 0 }));

  const pendingLayered = () => {
    const g = gen({ imageMode: 'layer_decomp', imageRatioPreset: '1:1' });
    return addPendingResult([g], g, task());
  };
  const overlaps = (cards: SpatialCard[]) => {
    const rect = (c: SpatialCard) => ({ x: c.x, y: c.y, w: c.width, h: estimateCardHeight(c) });
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        const a = rect(cards[i]);
        const b = rect(cards[j]);
        if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) return [cards[i].id, cards[j].id];
      }
    }
    return null;
  };

  it('turns a layer decomposition into one result card for the base and one per layer', () => {
    const cards = applyTaskToCards(pendingLayered(), task({ status: 'succeeded', assets: layered('task-1', 16) }));
    const rs = results(cards);

    expect(rs).toHaveLength(17);
    // The placeholder becomes the base image's card.
    expect(rs[0]).toMatchObject({ id: 'result-task-1', status: 'succeeded', resultUrl: '/assets/images/task-1/image_base_0.png' });
    expect(rs.every((c) => c.outputAssets?.length === 1)).toBe(true);
    expect(rs.map((c) => c.outputAssets![0].kind)).toEqual(['image_base', ...Array(16).fill('image_layer')]);
    expect(rs.slice(1).map((c) => c.outputAssets![0].z_index)).toEqual(Array.from({ length: 16 }, (_, k) => k + 1));
    expect(rs.slice(1).map((c) => c.resultUrl)).toEqual(
      Array.from({ length: 16 }, (_, k) => `/assets/images/task-1/image_layer_${k + 1}.png`)
    );
  });

  it('turns a sequential storyboard into one result card per frame, in frame order', () => {
    const g = gen({ imageMode: 'sequential' });
    const cards = applyTaskToCards(addPendingResult([g], g, task()), task({ status: 'succeeded', assets: frames('task-1', 15) }));
    const rs = results(cards);
    expect(rs).toHaveLength(15);
    expect(rs.map((c) => c.outputAssets![0].asset_index)).toEqual(Array.from({ length: 15 }, (_, k) => k));
    expect(rs[0].id).toBe('result-task-1');
  });

  it('keeps a Midjourney 2×2 grid as a single result card', () => {
    const g = gen({ provider: 'mj' });
    const cards = applyTaskToCards(
      addPendingResult([g], g, task()),
      task({ status: 'succeeded', assets: [asset('task-1', 0, 'image_base')] })
    );
    expect(results(cards)).toHaveLength(1);
  });

  it('keeps a video with its returned last frame as one video result card', () => {
    const g: SpatialCard = { ...createCard('video', { x: 0, y: 0 }, []), id: 'v1' };
    const cards = applyTaskToCards(
      addPendingResult([g], g, task({ task_type: 'video_generation' })),
      task({ status: 'succeeded', assets: [asset('task-1', 0, 'video'), asset('task-1', 1, 'image_frame')] })
    );
    expect(results(cards)).toHaveLength(1);
    expect(results(cards)[0].outputAssets?.map((a) => a.kind)).toEqual(['video']);
  });

  it('gives every extra card the task, source, snapshot and a consecutive tag', () => {
    const pending = pendingLayered();
    const cards = applyTaskToCards(pending, task({ status: 'succeeded', assets: layered('task-1', 3) }));
    const rs = results(cards);
    const first = rs[0];

    expect(rs.map((c) => c.tagIndex)).toEqual([1, 2, 3, 4]);
    for (const r of rs.slice(1)) {
      expect(r).toMatchObject({ role: 'result', type: 'image', taskId: 'task-1', sourceId: 'g1', status: 'succeeded' });
      expect(r.snapshot).toEqual(first.snapshot);
      expect(r.title.startsWith(first.title)).toBe(true);
      expect(isTaskResult(r)).toBe(true);
    }
    expect(new Set(rs.map((c) => c.id)).size).toBe(4);
    expect(rs.slice(1).every((c) => c.id.includes('task-1'))).toBe(true);
    expect(runsInProgress(cards, 'g1')).toBe(0);
  });

  it('is idempotent when the same terminal state arrives twice', () => {
    const done = task({ status: 'succeeded', assets: layered('task-1', 16) });
    const once = applyTaskToCards(pendingLayered(), done);
    expect(applyTaskToCards(once, done)).toEqual(once);
  });

  it('gives the same cards whether the task finished before or after the placeholder existed', () => {
    const g = gen({ imageMode: 'layer_decomp', imageRatioPreset: '1:1' });
    const done = task({ status: 'succeeded', assets: layered('task-1', 5) });
    const early = addPendingResult([g], g, done);
    const late = applyTaskToCards(addPendingResult([g], g, task()), done);
    expect(early).toEqual(late);
    // …and a catch-up fetch after that changes nothing.
    expect(applyTaskToCards(early, done)).toEqual(early);
  });

  it('does not bring back an extra card the user deleted when the state is resent', () => {
    const done = task({ status: 'succeeded', assets: layered('task-1', 3) });
    const once = applyTaskToCards(pendingLayered(), done);
    const trimmed = once.filter((c) => c.id !== results(once)[2].id);
    expect(results(applyTaskToCards(trimmed, done))).toHaveLength(3);
  });

  it('lays the cards out in a grid from the first free slot, without overlaps or moving anything', () => {
    const g = gen({ imageMode: 'layer_decomp', imageRatioPreset: '1:1', x: 0, y: 0, width: 340 });
    // Something already sits where the grid's second row would go.
    const obstacle: SpatialCard = { ...gen({ id: 'other', role: undefined }), x: 760, y: 500, width: 340 };
    const pending = addPendingResult([g, obstacle], g, task());
    const first = results(pending)[0];
    const cards = applyTaskToCards(pending, task({ status: 'succeeded', assets: layered('task-1', 16) }));
    const rs = results(cards);

    expect({ x: rs[0].x, y: rs[0].y }).toEqual({ x: first.x, y: first.y });
    expect(cards.find((c) => c.id === 'other')).toEqual(obstacle);
    expect(cards.find((c) => c.id === 'g1')).toEqual(g);
    expect(overlaps(cards)).toBeNull();
    // A grid: several columns right of the generation card, no card left of the first one.
    const columns = new Set(rs.map((c) => c.x));
    expect(columns.size).toBeGreaterThan(1);
    expect(columns.size).toBeLessThan(17);
    expect(rs.every((c) => c.x >= first.x && c.y >= first.y)).toBe(true);
  });

  it('sizes each layer card from its own bounding box', () => {
    const cards = applyTaskToCards(pendingLayered(), task({ status: 'succeeded', assets: layered('task-1', 3) }));
    const heights = results(cards).map((c) => estimateCardHeight(c));
    // 1:1 base; layers 1200/1400/1600 wide by 800 tall.
    expect(new Set(heights).size).toBe(4);
    expect(heights[1]).toBeLessThan(heights[0]);
  });
});

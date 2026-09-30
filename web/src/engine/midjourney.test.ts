import { describe, it, expect } from 'vitest';
import type { BackendTaskResponse } from '../services/api.ts';
import type { ReferenceItem, SpatialCard } from '../types/canvas.ts';
import { compileCardImagePayload, compileImageTaskPayload } from './compiler.ts';
import { connectCards } from './connections.ts';
import { imageModelPatch, imageSizeSummary } from './cardParams.ts';
import { duplicateCards } from './cardFactory.ts';
import { compileActionPayload, compileDescribePayload, findDescribeProvider } from './midjourney.ts';
import {
  actionLabel,
  runningActionIds,
  addOriginResult,
  addPendingResult,
  applyTaskToCards,
  groupActions,
  resultIdFor,
} from './resultCards.ts';

const card = (p: Partial<SpatialCard> & Pick<SpatialCard, 'id' | 'type'>): SpatialCard => ({
  role: 'generation',
  title: p.id,
  x: 0,
  y: 0,
  width: 330,
  prompt: '',
  model: '',
  status: 'idle',
  progress: 0,
  ...p,
});

/** A Midjourney image generation card. */
const mjCard = (patch: Partial<SpatialCard> = {}) =>
  card({ id: 'g1', type: 'image', title: '图片 1', provider: 'midjourney', model: 'mj_imagine', prompt: 'a red fox', imageRatioPreset: '16:9', ...patch });

/** A finished image result card, with the grid's buttons when it came from Midjourney. */
const imageResult = (patch: Partial<SpatialCard> = {}) =>
  card({
    id: 'r1',
    role: 'result',
    type: 'image',
    title: '图片 1 #1',
    tagIndex: 3,
    sourceId: 'g1',
    x: 400,
    provider: 'midjourney',
    model: 'mj_imagine',
    prompt: 'a red fox',
    imageRatioPreset: '16:9',
    status: 'succeeded',
    progress: 100,
    taskId: 'task-grid',
    resultUrl: '/assets/images/task-grid/base.png',
    outputAssets: [{ id: 'a', task_id: 'task-grid', asset_index: 0, kind: 'image_base', z_index: 0, local_path: 'images/task-grid/base.png', remote_url: 'https://cdn.discordapp.com/x.png' }],
    ...patch,
  });

const uploadImage = (patch: Partial<SpatialCard> = {}) =>
  card({ id: 'u1', role: 'result', type: 'upload', mediaKind: 'image', title: '上传图片 2', tagIndex: 2, resultUrl: '/assets/uploads/a.png', status: 'succeeded', fileUrl: 'https://files/a.png', ...patch });

const ref = (c: SpatialCard): ReferenceItem => ({ cardId: c.id, tagIndex: c.tagIndex!, role: 'reference_image', label: c.title });

const task = (patch: Partial<BackendTaskResponse>): BackendTaskResponse => ({
  id: 'task-u2',
  provider: 'midjourney',
  provider_task_id: 'p',
  model: 'mj_imagine',
  task_type: 'image_generation',
  task_mode: 'action',
  prompt: '',
  params_json: '{}',
  status: 'queued',
  progress: 0,
  created_at: '',
  updated_at: '',
  ...patch,
});

const U2 = { id: 'MJ::JOB::upsample::2::h', label: 'U2' };

describe('Midjourney generation payload', () => {
  it('sends the ratio and the chosen speed, never a resolution', () => {
    const input = { provider: 'midjourney', model: 'mj_imagine', prompt: 'a fox', imageRatioPreset: '3:2', imageResolution: '4K' as const };
    expect(compileImageTaskPayload(input).params).toEqual({ aspect_ratio: '3:2' });
    expect(compileImageTaskPayload({ ...input, mjSpeed: 'RELAX' }).params).toEqual({ aspect_ratio: '3:2', speed: 'RELAX' });
  });

  it('sends connected images as their saved files, even when an upload has a link', () => {
    const result = imageResult();
    const upload = uploadImage();
    const payload = compileCardImagePayload(mjCard({ references: [ref(result), ref(upload)] }), [result, upload]);
    expect(payload.task_mode).toBe('single');
    expect(payload.reference_assets).toEqual([
      { card_id: 'r1', tag_index: 1, role: 'reference_image', label: '图片 1 #1', local_path: '/assets/images/task-grid/base.png' },
      { card_id: 'u1', tag_index: 2, role: 'reference_image', label: '上传图片 2', local_path: '/assets/uploads/a.png' },
    ]);
  });

  it('blends two to five images with no prompt needed', () => {
    const images = [1, 2, 3].map((n) => imageResult({ id: `r${n}`, tagIndex: n }));
    const blend = mjCard({ prompt: '', mjOperation: 'blend', mjSpeed: 'FAST', references: images.map(ref) });
    const payload = compileCardImagePayload(blend, images);
    expect(payload.task_mode).toBe('blend');
    expect(payload.prompt).toBe('Blend');
    expect(payload.params).toEqual({ aspect_ratio: '16:9', speed: 'FAST' });
    expect(payload.reference_assets).toHaveLength(3);
    expect(() => compileCardImagePayload({ ...blend, references: [ref(images[0])] }, images)).toThrow('2–5 张');
  });

  it('needs a prompt to imagine', () => {
    expect(() => compileCardImagePayload(mjCard({ prompt: ' ' }))).toThrow('提示词');
  });
});

describe('Midjourney settings on the card', () => {
  const option = (provider: string, protocol: 'midjourney' | 'ark' | 'gemini') => ({ provider, protocol, id: 'm', label: 'm', ready: true }) as never;

  it('drops speed, Blend and reference images when the card leaves Midjourney', () => {
    const configured = mjCard({ mjSpeed: 'RELAX', mjOperation: 'blend', references: [ref(imageResult())] });
    expect(imageModelPatch(configured, option('google', 'gemini'))).toMatchObject({ mjSpeed: undefined, mjOperation: undefined, references: undefined });
    expect(imageModelPatch(configured, option('midjourney', 'midjourney'))).not.toHaveProperty('references');
  });

  it('summarises the operation, ratio and speed', () => {
    expect(imageSizeSummary(mjCard({ mjSpeed: 'RELAX' }))).toBe('16:9 · Relax');
    expect(imageSizeSummary(mjCard({ mjOperation: 'blend', imageRatioPreset: '1:1' }))).toBe('Blend · 1:1');
  });

  it('records speed and reference images on the result card', () => {
    const result = imageResult();
    const submitted = mjCard({ mjSpeed: 'TURBO', references: [ref(result)] });
    const [, added] = addPendingResult([submitted], submitted, task({ id: 't9', task_mode: 'single' }));
    expect(added.snapshot?.params).toMatchObject({ mjSpeed: 'TURBO', imageRatioPreset: '16:9' });
    expect(added.snapshot?.references).toEqual([{ cardId: 'r1', tagIndex: 3, role: 'reference_image', label: '图片 1 #1' }]);
  });
});

describe('connecting images to Midjourney cards', () => {
  it('takes image results and uploaded images as reference images, without prompt tags', () => {
    const res = connectCards(imageResult(), mjCard());
    expect(res).toEqual({ ok: true, patch: { references: [{ cardId: 'r1', tagIndex: 3, role: 'reference_image', label: '图片 1 #1' }] } });
    expect(connectCards(uploadImage(), mjCard()).ok).toBe(true);
  });

  it('refuses other image cards, duplicates and a sixth image', () => {
    expect(connectCards(imageResult(), mjCard({ provider: 'ark', model: 'doubao-seedream-5-0-pro-260628' }))).toMatchObject({ ok: false });
    const linked = mjCard({ references: [ref(imageResult())] });
    expect(connectCards(imageResult(), linked)).toEqual({ ok: false, reason: '已经连接过了' });
    const full = mjCard({ references: [1, 2, 3, 4, 5].map((n) => ref(imageResult({ id: `r${n}0`, tagIndex: n }))) });
    expect(connectCards(imageResult(), full)).toMatchObject({ ok: false, reason: expect.stringContaining('最多 5 张') });
  });
});

describe('result actions', () => {
  it('names and groups the grid buttons', () => {
    const actions = [
      { id: 'u1', label: 'U1' },
      { id: 'v1', label: 'V1' },
      { id: 'r', emoji: '🔄' },
      { id: 'u2', label: 'U2' },
    ];
    expect(groupActions(actions)).toEqual({
      upscale: [actions[0], actions[3]],
      variation: [actions[1]],
      other: [actions[2]],
    });
    expect(actionLabel(actions[2])).toBe('重绘');
  });

  it('runs an action on the source result card task', () => {
    expect(compileActionPayload(imageResult(), U2, 'U2')).toEqual({
      provider: 'midjourney',
      model: 'mj_imagine',
      task_type: 'image_generation',
      task_mode: 'action',
      prompt: 'a red fox',
      params: { source_task_id: 'task-grid', action_id: U2.id },
    });
    expect(() => compileActionPayload(imageResult({ status: 'running' }), U2, 'U2')).toThrow('还没有可以操作');
  });

  it('adds a result card linked to the card the action ran on, right of it', () => {
    const source = imageResult();
    const cards = [mjCard(), source];
    const next = addOriginResult(cards, source, { operation: 'action', label: 'U2', actionId: U2.id }, { type: 'image', provider: 'midjourney', model: 'mj_imagine' }, task({}));
    const added = next.find((c) => c.id === resultIdFor('task-u2'))!;
    expect(added).toMatchObject({
      role: 'result',
      type: 'image',
      sourceId: 'r1',
      origin: { operation: 'action', label: 'U2', actionId: U2.id },
      title: '图片 1 #1 · U2',
      tagIndex: 4,
      taskId: 'task-u2',
      status: 'queued',
      prompt: 'a red fox',
    });
    expect(added.x).toBeGreaterThanOrEqual(source.x + source.width);
    expect(addOriginResult(next, source, added.origin!, { type: 'image', model: 'mj_imagine' }, task({}))).toBe(next);
    expect(runningActionIds(next, 'r1')).toEqual(new Set([U2.id]));
  });

  it('drops the buttons from a copy, which has no task to run them on', () => {
    const [copy] = duplicateCards([imageResult({ resultActions: [U2] })], { x: 0, y: 0 }, []);
    expect(copy.taskId).toBeUndefined();
    expect(copy.resultActions).toBeUndefined();
  });

  it('keeps the buttons the finished result offers', () => {
    const source = imageResult();
    const running = addOriginResult([source], source, { operation: 'action', label: 'U2', actionId: U2.id }, { type: 'image', model: 'mj_imagine' }, task({}));
    const done = applyTaskToCards(
      running,
      task({
        status: 'succeeded',
        assets: [{ id: 'b', task_id: 'task-u2', asset_index: 0, kind: 'image_base', z_index: 0, local_path: 'images/task-u2/base.png' }],
        result_actions: [{ id: 'up', label: 'Upscale (Subtle)' }],
      })
    );
    const added = done.find((c) => c.id === resultIdFor('task-u2'))!;
    expect(added.resultActions).toEqual([{ id: 'up', label: 'Upscale (Subtle)' }]);
    expect(added.resultUrl).toBe('/assets/images/task-u2/base.png');
    expect(runningActionIds(done, 'r1').size).toBe(0);
  });
});

describe('Midjourney Describe', () => {
  const runner = { provider: 'midjourney', model: 'mj_imagine' };

  it('finds a configured Midjourney provider with an image model', () => {
    expect(
      findDescribeProvider([
        { id: 'google', protocol: 'gemini', is_configured: true, models: [{ id: 'g', type: 'image' }] },
        { id: 'mj2', protocol: 'midjourney', is_configured: false, models: [{ id: 'x', type: 'image' }] },
        { id: 'mj', protocol: 'midjourney', is_configured: true, models: [{ id: 'mj_imagine', type: 'image' }] },
      ] as never)
    ).toEqual({ provider: 'mj', model: 'mj_imagine' });
  });

  it('sends the saved image of the source card', () => {
    expect(compileDescribePayload(uploadImage(), runner)).toEqual({
      provider: 'midjourney',
      model: 'mj_imagine',
      task_type: 'image_generation',
      task_mode: 'describe',
      prompt: '反推提示词',
      params: {},
      reference_assets: [{ card_id: 'u1', tag_index: 1, role: 'reference_image', label: '上传图片 2', local_path: '/assets/uploads/a.png' }],
    });
  });

  it('puts the suggested prompts on a text result card linked to the image', () => {
    const source = uploadImage();
    const pending = addOriginResult([source], source, { operation: 'describe', label: '反推' }, { type: 'text', ...runner }, task({ id: 'task-d' }));
    const done = applyTaskToCards(pending, task({ id: 'task-d', status: 'succeeded', result_text: '1️⃣ a red fox --ar 3:2' }));
    expect(done.find((c) => c.id === resultIdFor('task-d'))).toMatchObject({
      role: 'result',
      type: 'text',
      sourceId: 'u1',
      tagIndex: undefined,
      title: '上传图片 2 · 反推',
      status: 'succeeded',
      textOutput: '1️⃣ a red fox --ar 3:2',
    });
  });
});

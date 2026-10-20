import { describe, it, expect } from 'vitest';
import type { ReferenceItem, SpatialCard } from '../types/canvas.ts';
import { compileCardImagePayload } from './compiler.ts';
import { connectCards } from './connections.ts';
import { imageModelPatch, imageModePatch, imageReferenceLimit } from './cardParams.ts';

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

const LITE = 'doubao-seedream-5-0-lite-260128';

const seedream = (patch: Partial<SpatialCard> = {}) =>
  card({ id: 'g1', type: 'image', provider: 'ark', model: 'doubao-seedream-5-0-pro-260628', prompt: '换成夜景', ...patch });

const imageResult = (n: number, patch: Partial<SpatialCard> = {}) =>
  card({
    id: `r${n}`,
    role: 'result',
    type: 'image',
    title: `图片 ${n}`,
    tagIndex: n,
    status: 'succeeded',
    resultUrl: `/assets/images/t${n}/base.png`,
    ...patch,
  });

const ref = (c: SpatialCard): ReferenceItem => ({ cardId: c.id, tagIndex: c.tagIndex!, role: 'reference_image', label: c.title });

describe('Seedream image-to-image', () => {
  it('connects an image result as a reference and tags it in the prompt', () => {
    const res = connectCards(imageResult(2), seedream());
    expect(res.ok && res.patch.references).toEqual([{ cardId: 'r2', tagIndex: 2, role: 'reference_image', label: '图片 2' }]);
    expect(res.ok && res.patch.prompt).toBe('换成夜景 @图2');
  });

  it('refuses duplicates and a reference past the model limit (10 on 5.0 pro, 14 on lite)', () => {
    const r1 = imageResult(1);
    expect(connectCards(r1, seedream({ references: [ref(r1)] }))).toEqual({ ok: false, reason: '已经连接过了' });
    const refs = (n: number) => Array.from({ length: n }, (_, i) => ref(imageResult(i + 10)));
    expect(connectCards(imageResult(30), seedream({ references: refs(10) }))).toMatchObject({ ok: false, reason: expect.stringContaining('最多 10 张') });
    expect(connectCards(imageResult(30), seedream({ model: LITE, references: refs(10) }))).toMatchObject({ ok: true });
    expect(connectCards(imageResult(30), seedream({ model: LITE, references: refs(14) }))).toMatchObject({ ok: false, reason: expect.stringContaining('最多 14 张') });
  });

  it('sends the saved files and renumbers the prompt in send order', () => {
    const [a, b] = [imageResult(5), imageResult(2)];
    const payload = compileCardImagePayload(seedream({ prompt: '把 @图2 的风格用到 @图5', references: [ref(a), ref(b)] }), [a, b]);
    expect(payload.prompt).toBe('把 图2 的风格用到 图1');
    expect(payload.reference_assets).toEqual([
      { card_id: 'r5', tag_index: 1, role: 'reference_image', label: '图片 5', local_path: '/assets/images/t5/base.png' },
      { card_id: 'r2', tag_index: 2, role: 'reference_image', label: '图片 2', local_path: '/assets/images/t2/base.png' },
    ]);
  });

  it('sends no references when none are connected', () => {
    expect(compileCardImagePayload(seedream()).reference_assets).toBeUndefined();
  });

  it('refuses references past the model limit and an unfinished reference', () => {
    const many = Array.from({ length: 15 }, (_, i) => imageResult(i + 1));
    expect(() => compileCardImagePayload(seedream({ references: many.slice(0, 11).map(ref) }), many)).toThrow('最多 10 张');
    expect(() => compileCardImagePayload(seedream({ model: LITE, references: many.map(ref) }), many)).toThrow('最多 14 张');
    const pending = imageResult(1, { resultUrl: undefined, status: 'running' });
    expect(() => compileCardImagePayload(seedream({ references: [ref(pending)] }), [pending])).toThrow('还没有图片');
  });

  it('layer decomposition takes exactly one image', () => {
    const [a, b] = [imageResult(1), imageResult(2)];
    const layered = seedream({ imageMode: 'layer_decomp', prompt: '' });
    expect(() => compileCardImagePayload(layered, [a])).toThrow('需要连入一张图片');
    expect(() => compileCardImagePayload({ ...layered, references: [ref(a), ref(b)] }, [a, b])).toThrow('需要连入一张图片');
    const ok = compileCardImagePayload({ ...layered, references: [ref(a)] }, [a]);
    expect(ok.task_mode).toBe('layer_decomp');
    expect(ok.reference_assets).toHaveLength(1);
  });

  it('limits references to one in layer decomposition and trims them when switching to it', () => {
    const [a, b] = [imageResult(1), imageResult(2)];
    const card2 = seedream({ prompt: '拆 @图1 @图2', references: [ref(a), ref(b)] });
    expect(imageReferenceLimit(card2)).toBe(10);
    expect(imageReferenceLimit({ ...card2, model: LITE })).toBe(14);
    expect(imageReferenceLimit({ ...card2, imageMode: 'layer_decomp' })).toBe(1);
    expect(connectCards(imageResult(3), { ...card2, imageMode: 'layer_decomp', references: [ref(a)] })).toMatchObject({
      ok: false,
      reason: '拆分图层只能连入一张图片',
    });
    const patch = imageModePatch(card2, 'layer_decomp');
    expect(patch.references).toEqual([ref(a)]);
    expect(patch.prompt).toBe('拆 @图1');
    expect(imageModePatch(card2, 'sequential')).toEqual({ imageMode: 'sequential' });
  });

  it('keeps references when switching between Seedream models', () => {
    const a = imageResult(1);
    const option = { provider: 'ark', protocol: 'ark', id: 'doubao-seedream-5-0-lite-260128', label: 'lite', ready: true } as never;
    expect(imageModelPatch(seedream({ references: [ref(a)] }), option).references).toEqual([ref(a)]);
  });
});

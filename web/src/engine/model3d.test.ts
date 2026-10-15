import { beforeAll, describe, expect, it } from 'vitest';
import catalog from '../../../internal/server/testdata/heighliner-media-models.json';
import type { BackendTaskResponse, CapabilityDescriptor, ProviderConfigItem } from '../services/api.ts';
import type { SpatialCard, TaskAssetDto } from '../types/canvas.ts';
import { capabilityOf, rememberProviders } from './providers.ts';
import { buildProviderGroups } from './channelModels.ts';
import { effectiveOptions, optionGroups, specFields } from './capability.ts';
import { capViews, fitViews, model3DPatch, modelFiles, previewFile, setViewPatch, spec3DSummary } from './model3d.ts';
import { connectCards, hasInputPort, hasOutputPort } from './connections.ts';
import { compileHeighliner3DPayload } from './heighlinerCompiler.ts';
import { createCard, duplicateCards } from './cardFactory.ts';
import { addPendingResult, applyTaskToCards, snapshotOf } from './resultCards.ts';

const descriptors = (catalog as unknown as { data: CapabilityDescriptor[] }).data;
const HL = 'hl-1';
const HY30 = 'hy-3d-3.0';
const HY31 = 'hy-3d-3.1';
const EXPRESS = 'hy-3d-express';
const TRIPO_P1 = 'tripo-3d-p1';

const providers: ProviderConfigItem[] = [
  {
    id: 'ark',
    name: '火山方舟',
    protocol: 'ark',
    preset: true,
    base_url: '',
    is_configured: false,
    can_list_models: false,
    models: [{ id: 'doubao-seedream-5-0-pro-260628', type: 'image' }],
  },
  {
    id: HL,
    name: 'Heighliner',
    protocol: 'heighliner',
    preset: false,
    base_url: 'https://platform.sgt.site',
    is_configured: true,
    can_list_models: true,
    models: descriptors.map((d) => ({ id: d.id, type: d.type, capability: d })),
  },
];

beforeAll(() => rememberProviders(providers));

const cap = (id: string) => capabilityOf(HL, id)!;

const card = (p: Partial<SpatialCard> & Pick<SpatialCard, 'id' | 'type'>): SpatialCard => ({
  role: 'generation',
  title: p.id,
  x: 0,
  y: 0,
  width: 300,
  prompt: '',
  model: '',
  status: 'idle',
  progress: 0,
  ...p,
});

const image = (id: string, tagIndex: number, resultUrl = `/assets/images/${id}/base.png`) =>
  card({ id, type: 'image', role: 'result', tagIndex, status: 'succeeded', resultUrl, provider: 'ark', model: 'x' });
const model3d = (model: string, extra: Partial<SpatialCard> = {}) => card({ id: 'm1', type: '3d', provider: HL, model, ...extra });

/** Connects each image to the 3D card in turn, as dragging lines onto it would. */
function connectAll(target: SpatialCard, ...images: SpatialCard[]): SpatialCard {
  return images.reduce((acc, img) => {
    const res = connectCards(img, acc);
    if (!res.ok) throw new Error(res.reason);
    return { ...acc, ...res.patch };
  }, target);
}

describe('3D model choices', () => {
  it('lists only Heighliner 3D models, and nothing without a Heighliner provider', () => {
    const groups = buildProviderGroups(providers, '3d');
    expect(groups.map((g) => g.provider)).toEqual([HL]);
    expect(groups[0].options.map((o) => o.id).sort()).toEqual(['hy-3d-3.0', 'hy-3d-3.1', 'hy-3d-express', 'tripo-3d-3.1', 'tripo-3d-p1']);
    expect(groups[0].options.every((o) => o.ready)).toBe(true);
    expect(buildProviderGroups([], '3d')).toEqual([]);
    expect(buildProviderGroups([providers[0]], '3d')).toEqual([]);
  });

  it('starts a new 3D card on the first Heighliner 3D model', () => {
    const fresh = createCard('3d', { x: 0, y: 0 }, []);
    expect(fresh).toMatchObject({ type: '3d', role: 'generation', provider: HL, title: '3D 1', references: [] });
    expect(capabilityOf(HL, fresh.model)?.type).toBe('3d');
  });
});

describe('3D panels from the descriptor', () => {
  it('shows output format on 混元 and the Tencent options on 高级, LowPoly included on 3.0', () => {
    expect(specFields(cap(HY30)).map((f) => f.name)).toEqual(['output_format']);
    const tencent = optionGroups(cap(HY30)).find((g) => g.ns === 'tencent')!;
    const byName = Object.fromEntries(tencent.fields.map((f) => [f.name, f.param]));
    expect(Object.keys(byName).sort()).toEqual(['enable_pbr', 'face_count', 'generate_type', 'polygon_type']);
    expect(byName.generate_type.enum).toContain('LowPoly');
    expect(optionGroups(cap(HY31))[0].fields.find((f) => f.name === 'generate_type')!.param.enum).not.toContain('LowPoly');
  });

  it('gives Tripo P1 a face limit of 50–20000 and its negative prompt and seed', () => {
    const faceLimit = optionGroups(cap(TRIPO_P1))[0].fields.find((f) => f.name === 'face_limit')!.param;
    expect([faceLimit.minimum, faceLimit.maximum]).toEqual([50, 20000]);
    expect(specFields(cap(TRIPO_P1)).map((f) => f.name)).toEqual(['seed', 'negative_prompt']);
  });
});

describe('views', () => {
  it('offers the views a model declares, 主图 first', () => {
    expect(capViews(cap(HY30))).toEqual([
      'reference',
      'multi_view_front',
      'multi_view_left',
      'multi_view_right',
      'multi_view_back',
      'multi_view_top',
      'multi_view_bottom',
      'multi_view_left_front',
      'multi_view_right_front',
    ]);
    expect(capViews(cap(TRIPO_P1))).toEqual(['reference', 'multi_view_front', 'multi_view_left', 'multi_view_right', 'multi_view_back']);
    expect(capViews(cap(EXPRESS))).toEqual(['reference']);
  });

  it('makes the first image the main one and gives later ones the next free view, with no prompt tag', () => {
    const out = connectAll(model3d(HY30), image('a', 1), image('b', 2));
    expect(out.references?.map((r) => [r.cardId, r.view])).toEqual([
      ['a', 'reference'],
      ['b', 'multi_view_front'],
    ]);
    expect(out.prompt).toBe('');
  });

  it('refuses an image twice, and a second image where the model takes only a main one', () => {
    const one = connectAll(model3d(HY30), image('a', 1));
    expect(connectCards(image('a', 1), one)).toMatchObject({ ok: false, reason: '已经连接过了' });
    const express = connectAll(model3d(EXPRESS), image('a', 1));
    const res = connectCards(image('b', 2), express);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toContain('最多 1 张参考图');
  });

  it('accepts uploaded images but not videos', () => {
    const upload = card({ id: 'u1', type: 'upload', role: 'result', tagIndex: 5, mediaKind: 'image', resultUrl: '/assets/uploads/u1.png' });
    expect(connectCards(upload, model3d(HY30)).ok).toBe(true);
    const clip = card({ id: 'v1', type: 'video', role: 'result', tagIndex: 6, resultUrl: '/assets/videos/v1.mp4' });
    expect(connectCards(clip, model3d(HY30))).toMatchObject({ ok: false, reason: '3D 卡片只接收图片' });
  });

  it('swaps views when one is picked that another image holds', () => {
    const out = connectAll(model3d(HY30), image('a', 1), image('b', 2));
    const left = { ...out, ...setViewPatch(out, 'b', 'multi_view_left') };
    expect(left.references?.map((r) => r.view)).toEqual(['reference', 'multi_view_left']);
    const swapped = { ...left, ...setViewPatch(left, 'b', 'reference') };
    expect(swapped.references?.map((r) => [r.cardId, r.view])).toEqual([
      ['a', 'multi_view_left'],
      ['b', 'reference'],
    ]);
  });

  it('refits views and options when the model changes', () => {
    const start = connectAll(model3d(HY30), image('a', 1), image('b', 2), image('c', 3));
    const withViews = { ...start, ...setViewPatch(start, 'c', 'multi_view_top'), capOptions: { tencent: { generate_type: 'LowPoly', face_count: 5000 } } };
    const tripo = { ...withViews, ...model3DPatch(withViews, { provider: HL, id: TRIPO_P1 }) };
    // Tripo has no top view: that image takes the first free one.
    expect(tripo.references?.map((r) => [r.cardId, r.view])).toEqual([
      ['a', 'reference'],
      ['b', 'multi_view_front'],
      ['c', 'multi_view_left'],
    ]);
    expect(effectiveOptions(cap(TRIPO_P1), tripo.capOptions).tencent).not.toHaveProperty('generate_type');
    const express = { ...tripo, ...model3DPatch(tripo, { provider: HL, id: EXPRESS }) };
    expect(express.references?.map((r) => r.cardId)).toEqual(['a']);
  });

  it('fits saved references without a view as the main image', () => {
    const refs = [{ cardId: 'a', tagIndex: 1, role: 'reference_image' as const, label: 'a' }];
    expect(fitViews(refs, ['reference'])[0].view).toBe('reference');
  });
});

describe('compiling a 3D card', () => {
  it('sends each image as its view role, with only declared fields', () => {
    const a = image('a', 1);
    const b = image('b', 2);
    let c = connectAll(model3d(HY30, { prompt: '' }), a, b);
    c = { ...c, ...setViewPatch(c, 'b', 'multi_view_left'), capParams: { output_format: 'fbx', aspect_ratio: '16:9' }, capOptions: { tencent: { generate_type: 'LowPoly' } } };
    const payload = compileHeighliner3DPayload(c, [a, b, c]);
    expect(payload).toMatchObject({ provider: HL, model: HY30, task_type: '3d_generation', prompt: '' });
    expect(payload.params).toEqual({
      parameters: { output_format: 'fbx' },
      provider_options: { tencent: { generate_type: 'LowPoly', enable_pbr: false } },
    });
    expect(payload.reference_assets?.map((r) => [r.card_id, r.role, r.type, r.local_path])).toEqual([
      ['a', 'reference', 'image', 'assets/images/a/base.png'],
      ['b', 'multi_view_left', 'image', 'assets/images/b/base.png'],
    ]);
    expect(JSON.stringify(payload)).not.toContain('null');
  });

  it('runs from the prompt alone, and asks for a prompt or images when it has neither', () => {
    const textOnly = compileHeighliner3DPayload(model3d(EXPRESS, { prompt: ' 一只木椅 ' }));
    expect(textOnly.prompt).toBe('一只木椅');
    expect(textOnly.reference_assets).toBeUndefined();
    expect(() => compileHeighliner3DPayload(model3d(EXPRESS))).toThrow('请先填写提示词，或连入参考图');
  });

  it('refuses a view the model does not take', () => {
    const a = image('a', 1);
    const c = model3d(EXPRESS, { references: [{ cardId: 'a', tagIndex: 1, role: 'reference_image', label: 'a', view: 'multi_view_left' }] });
    expect(() => compileHeighliner3DPayload(c, [a, c])).toThrow('不支持「左」视角的参考图');
  });

  it('needs the model descriptor', () => {
    expect(() => compileHeighliner3DPayload(model3d('hy-3d-9.9', { prompt: 'x' }))).toThrow('没有能力描述');
  });

  it('summarises format and references', () => {
    expect(spec3DSummary(model3d(HY30, { capParams: { output_format: 'fbx' } }))).toBe('FBX · 文生 3D');
    expect(spec3DSummary(connectAll(model3d(TRIPO_P1), image('a', 1)))).toBe('1 张参考图');
  });
});

describe('3D result cards', () => {
  const gen = () => connectAll(model3d(HY30, { prompt: '木椅', capParams: { output_format: 'fbx' } }), image('a', 1));
  const asset = (index: number, kind: TaskAssetDto['kind'], path: string): TaskAssetDto => ({
    id: `as${index}`,
    task_id: 't1',
    asset_index: index,
    kind,
    z_index: 0,
    local_path: path,
  });
  const task = (status: BackendTaskResponse['status'], assets: TaskAssetDto[] = []): BackendTaskResponse =>
    ({ id: 't1', provider: HL, provider_task_id: 'p1', model: HY30, task_type: '3d_generation', status, progress: 40, assets }) as BackendTaskResponse;

  it('is one untagged card holding every file, the cover as its face', () => {
    const g = gen();
    let cards = addPendingResult([image('a', 1), g], g, task('queued'));
    const result = cards.find((c) => c.role === 'result' && c.type === '3d')!;
    expect(result.tagIndex).toBeUndefined();
    expect(result.snapshot?.references).toEqual([{ cardId: 'a', tagIndex: 1, role: 'reference_image', label: 'a', view: 'reference' }]);
    expect(result.snapshot?.capParams).toEqual({ output_format: 'fbx' });

    const files = [
      asset(0, 'model3d', 'models/t1/model_00.fbx'),
      asset(1, 'model3d', 'models/t1/model_01.glb'),
      asset(2, 'cover', 'models/t1/cover_02.png'),
    ];
    cards = applyTaskToCards(cards, task('succeeded', files));
    const done = cards.filter((c) => c.type === '3d' && c.role === 'result');
    expect(done).toHaveLength(1);
    expect(done[0].outputAssets).toHaveLength(3);
    expect(done[0].resultUrl).toBe('/assets/models/t1/cover_02.png');
    expect(modelFiles(done[0]).map((f) => f.format)).toEqual(['FBX', 'GLB']);
  });

  it('has no output port and is never a reference', () => {
    const result = card({ id: 'r1', type: '3d', role: 'result', status: 'succeeded', resultUrl: '/assets/models/t1/cover_02.png' });
    expect(hasOutputPort(result)).toBe(false);
    expect(hasInputPort(model3d(HY30))).toBe(true);
    const video = card({ id: 'v', type: 'video', provider: 'ark', model: 'doubao-seedance-2-5-260628', mode: 'all_modal' });
    expect(connectCards(result, video)).toMatchObject({ ok: false, reason: '3D 结果卡不能连接到其他卡片' });
    expect(connectCards(result, model3d(HY30)).ok).toBe(false);
  });

  it('keeps views when copied with its images', () => {
    const a = image('a', 1);
    const g = { ...gen(), id: 'g1' };
    const [copyA, copyG] = duplicateCards([a, g], { x: 0, y: 0 }, [a, g]);
    expect(copyG.references).toEqual([{ cardId: copyA.id, tagIndex: copyA.tagIndex, role: 'reference_image', label: 'a', view: 'reference' }]);
  });

  it('previews a GLB first, then a glTF, and never STL/FBX or the turntable video', () => {
    const files = (...paths: string[]) => ({ outputAssets: paths.map((p, i) => asset(i, p.endsWith('.mp4') ? 'video' : 'model3d', p)) });
    expect(previewFile(files('models/t1/model_00.gltf', 'models/t1/model_01.glb'))?.local_path).toBe('models/t1/model_01.glb');
    expect(previewFile(files('models/t1/model_00.fbx', 'models/t1/model_01.GLTF'))?.local_path).toBe('models/t1/model_01.GLTF');
    expect(previewFile(files('models/t1/model_00.stl', 'models/t1/model_01.fbx', 'models/t1/preview_02.mp4'))).toBeUndefined();
    expect(previewFile({})).toBeUndefined();
    // An unnamed file from an older run is tried last, after any named GLB.
    expect(previewFile(files('models/t1/model_00.zip', 'models/t1/model_02.bin'))?.local_path).toBe('models/t1/model_02.bin');
    expect(previewFile(files('models/t1/model_00.bin', 'models/t1/model_01.glb'))?.local_path).toBe('models/t1/model_01.glb');
  });

  it('records no built-in image settings in its snapshot', () => {
    const snap = snapshotOf({ ...gen(), imageRatioPreset: '16:9', seedImage: 7 });
    expect(snap.params).toEqual({});
    expect(snap.seed).toBeUndefined();
  });
});

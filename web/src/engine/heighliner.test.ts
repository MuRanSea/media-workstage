import { beforeAll, describe, expect, it } from 'vitest';
import catalog from '../../../internal/server/testdata/heighliner-media-models.json';
import type { CapabilityDescriptor, ProviderConfigItem } from '../services/api.ts';
import type { SpatialCard } from '../types/canvas.ts';
import { rememberProviders, capabilityOf } from './providers.ts';
import { buildProviderGroups, findModelOption, isModelReady, type MediaKind, type ModelOption } from './channelModels.ts';
import {
  capAssetKinds,
  capReferenceLimit,
  capVideoDef,
  capVideoModes,
  effectiveOptions,
  effectiveParams,
  optionGroups,
  specFields,
} from './capability.ts';
import {
  addAssetRefPatch,
  imageModelPatch,
  imageSizeSummary,
  supportsAssetRefs,
  videoModePatch,
  videoModelPatch,
  videoSpecSummary,
} from './cardParams.ts';
import { connectCards } from './connections.ts';
import { compileCardImagePayload } from './compiler.ts';
import { compileCardVideoPayload } from './videoCompiler.ts';
import { snapshotOf } from './resultCards.ts';

// The gateway's real media catalog, as GET /media/v1/models returned it (shared with the Go tests).
const descriptors = (catalog as unknown as { data: CapabilityDescriptor[] }).data;

const HL = 'hl-1';
const LITE = 'doubao-seedream-5-0-lite-260128';
const PRO = 'doubao-seedream-5-0-pro-260628';
const SEEDANCE_25 = 'doubao-seedance-2-5-260628';
const KLING = 'kling-3.0';
const KLING_TURBO = 'kling-3.0-turbo';
const KLING_OMNI = 'kling-3.0-omni';
const H3 = 'MiniMax-H3';

const providers: ProviderConfigItem[] = [
  {
    id: HL,
    name: 'Heighliner',
    protocol: 'heighliner',
    preset: false,
    base_url: 'https://platform.sgt.site',
    is_configured: true,
    can_list_models: true,
    models: descriptors
      .filter((d) => d.type === 'image' || d.type === 'video')
      .map((d) => ({ id: d.id, type: d.type as 'image' | 'video', capability: d })),
  },
];

beforeAll(() => rememberProviders(providers));

const cap = (id: string) => capabilityOf(HL, id)!;
const option = (kind: MediaKind, id: string): ModelOption => findModelOption(buildProviderGroups(providers, kind), HL, id)!;

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
const imageCard = (patch: Partial<SpatialCard> = {}) =>
  card({ id: 'g1', type: 'image', provider: HL, model: LITE, prompt: '一只猫', ...patch });
const videoCard = (patch: Partial<SpatialCard> = {}) =>
  card({ id: 'v1', type: 'video', provider: HL, model: SEEDANCE_25, prompt: '镜头推进', mode: 'all_modal', ...patch });
/** A generated image's result card, saved in the project. */
const imageResult = (id: string, tagIndex: number) =>
  card({
    id,
    type: 'image',
    role: 'result',
    tagIndex,
    status: 'succeeded',
    outputAssets: [{ id: `${id}-a`, task_id: 't', asset_index: 0, kind: 'image_base', local_path: `images/${id}.png`, z_index: 0 }],
  } as Partial<SpatialCard> & Pick<SpatialCard, 'id' | 'type'>);
const uploadVideo = (patch: Partial<SpatialCard> = {}) =>
  card({ id: 'u2', type: 'upload', role: 'result', mediaKind: 'video', tagIndex: 4, title: '动作', resultUrl: '/assets/uploads/m.mp4', ...patch });

/** Applies a connection, failing the test when it is refused. */
function connect(source: SpatialCard, target: SpatialCard): SpatialCard {
  const res = connectCards(source, target);
  if (!res.ok) throw new Error(res.reason);
  return { ...target, ...res.patch };
}

describe('Heighliner panels from capability descriptors', () => {
  it('shows only the common parameters a model declares, never size', () => {
    const lite = specFields(cap(LITE));
    expect(lite.map((f) => f.name)).toEqual(['aspect_ratio', 'resolution', 'n', 'output_format']);
    expect(lite.find((f) => f.name === 'n')?.param).toMatchObject({ minimum: 1, maximum: 15 });
    expect(lite.find((f) => f.name === 'resolution')?.param.enum).toEqual(['2K', '3K', '4K']);
    expect(specFields(cap(PRO)).find((f) => f.name === 'n')?.param).toMatchObject({ minimum: 1, maximum: 1 });
  });

  it('offers Seedance 2.5 durations -1 and 4–30, adaptive ratio by default, and no audio switch on Kling Turbo', () => {
    const duration = specFields(cap(SEEDANCE_25)).find((f) => f.name === 'duration')!.param;
    expect(duration.enum).toEqual([-1, ...Array.from({ length: 27 }, (_, i) => i + 4)]);
    expect(effectiveParams(cap(SEEDANCE_25), undefined).aspect_ratio).toBe('adaptive');
    expect(specFields(cap(KLING_TURBO)).map((f) => f.name)).not.toContain('generate_audio');
    expect(capVideoDef(cap(KLING_TURBO), KLING_TURBO).supportsAudio).toBe(false);
  });

  it('lists vendor options by namespace for the advanced page', () => {
    const names = (id: string) => optionGroups(cap(id)).flatMap((g) => g.fields.map((f) => `${g.ns}.${f.name}`));
    expect(names(LITE)).toEqual(['volcengine.watermark']);
    expect(names(KLING)).toEqual(['kling.multi_shot', 'kling.watermark']);
    expect(names(SEEDANCE_25)).toContain('volcengine.return_last_frame');
  });

  it('starts from the defaults and leaves fields without one unset', () => {
    expect(effectiveParams(cap(SEEDANCE_25), undefined)).toEqual({
      aspect_ratio: 'adaptive',
      duration: 5,
      generate_audio: true,
      resolution: '720p',
    });
    // Kling's watermark has no default: not sent until chosen.
    expect(effectiveOptions(cap(KLING), undefined)).toEqual({});
    expect(effectiveOptions(cap(LITE), undefined)).toEqual({ volcengine: { watermark: false } });
  });

  it('borrows built-in names for matching model IDs and runs image and video models', () => {
    expect(option('video', SEEDANCE_25).label).toBe('Seedance 2.5');
    expect(option('image', PRO).label).not.toBe(PRO);
    expect(option('video', 'doubao-seedance-2-0-mini-260615').label).toBe('doubao-seedance-2-0-mini-260615');
    expect(isModelReady('image', HL, LITE)).toBe(true);
    expect(isModelReady('video', HL, H3)).toBe(true);
  });
});

describe('Heighliner model switching', () => {
  it('resets values out of the new range and drops fields the new model lacks', () => {
    const before = videoCard({
      capParams: { duration: 30, resolution: '1080p', aspect_ratio: 'adaptive', seed: 42, generate_audio: true },
      capOptions: { volcengine: { watermark: true, return_last_frame: true } },
    });
    const after = { ...before, ...videoModelPatch(before, option('video', KLING)) };
    expect(after.capParams).toEqual({ aspect_ratio: '16:9', duration: 5, generate_audio: true, resolution: '1080p' });
    expect(after.capOptions).toEqual({});
  });

  it('fits image counts and resolutions to the new tier', () => {
    const lite = imageCard({ capParams: { n: 4, resolution: '4K', aspect_ratio: '16:9' } });
    const pro = { ...lite, ...imageModelPatch(lite, option('image', PRO)) };
    expect(pro.capParams).toEqual({ n: 1, resolution: '1K', aspect_ratio: '16:9' });
    expect(imageSizeSummary(lite)).toBe('4K · 16:9 · 4 张');
  });

  it('moves to a mode the new model opens and keeps what its roles take', () => {
    const images = [imageResult('i1', 1), imageResult('i2', 2), imageResult('i3', 3)];
    let seedance = videoCard({ prompt: '@图1 @图2 @图3' });
    for (const img of images) seedance = connect(img, seedance);
    // Kling Turbo has no reference role and only a first frame.
    const turbo = { ...seedance, ...videoModelPatch(seedance, option('video', KLING_TURBO)) };
    expect(turbo.mode).toBe('first_last_frame');
    expect(turbo.references?.map((r) => [r.cardId, r.role])).toEqual([['i1', 'first_frame']]);
    expect(turbo.prompt).toBe('@图1');
  });

  it('drops asset items the new model cannot take by ID', () => {
    const seedance = videoCard({ assetRefs: [{ assetId: 'asset-a', kind: 'audio' }] });
    const h3 = { ...seedance, ...videoModelPatch(seedance, option('video', H3)) };
    expect(h3.assetRefs ?? []).toEqual([]);
  });
});

describe('Heighliner reference roles', () => {
  it('opens video modes by role: first/last frame needs first_frame, multi-reference needs reference', () => {
    expect(capVideoModes(cap(H3))).toEqual(['all_modal', 'first_last_frame', 'text_to_video']);
    expect(capVideoModes(cap(KLING))).toEqual(['first_last_frame', 'text_to_video']);
    expect(capReferenceLimit(cap(KLING), 'first_last_frame', 'image')).toBe(2);
    expect(capReferenceLimit(cap(KLING_TURBO), 'first_last_frame', 'image')).toBe(1);
    expect(capReferenceLimit(cap(KLING_OMNI), 'all_modal', 'video')).toBe(1);
  });

  it('offers the audio asset entry on Seedance but not on H3', () => {
    expect(capAssetKinds(cap(SEEDANCE_25))).toEqual(['image', 'video', 'audio']);
    expect(capAssetKinds(cap(H3))).toEqual([]);
    expect(supportsAssetRefs(videoCard({ model: H3 }))).toBe(false);
    expect(addAssetRefPatch(videoCard({ model: H3 }), 'asset-x', 'audio').ok).toBe(false);
    const added = addAssetRefPatch(videoCard(), 'asset://asset-x', 'audio');
    expect(added.ok && added.patch.assetRefs).toEqual([{ assetId: 'asset-x', kind: 'audio' }]);
  });

  it('caps connected images at the role max_count', () => {
    let turbo = videoCard({ model: KLING_TURBO, mode: 'text_to_video' });
    turbo = connect(imageResult('i1', 1), turbo);
    expect(turbo.mode).toBe('first_last_frame');
    expect(connectCards(imageResult('i2', 2), turbo)).toMatchObject({ ok: false });
    expect(connectCards(uploadVideo(), videoCard({ model: KLING }))).toMatchObject({ ok: false, reason: expect.stringContaining('不支持参考视频') });
  });

  it('takes images on image cards as reference, up to max_count', () => {
    let pro = imageCard({ model: PRO });
    for (let i = 1; i <= 10; i++) pro = connect(imageResult(`i${i}`, i), pro);
    expect(connectCards(imageResult('i11', 11), pro)).toMatchObject({ ok: false, reason: expect.stringContaining('最多 10') });
  });

  it('switching to first/last frame keeps images as frames and drops videos', () => {
    let seedance = videoCard({ prompt: '' });
    seedance = connect(uploadVideo(), seedance);
    seedance = connect(imageResult('i1', 1), seedance);
    const frames = { ...seedance, ...videoModePatch(seedance, 'first_last_frame', 0) };
    expect(frames.references?.map((r) => r.role)).toEqual(['first_frame']);
    expect(frames.prompt).toBe('@图1');
  });
});

describe('Heighliner compilation', () => {
  const noNulls = (payload: unknown) => expect(JSON.stringify(payload)).not.toContain('null');

  it('sends declared parameters and namespaced options only', () => {
    const payload = compileCardImagePayload(
      imageCard({
        capParams: { n: 4, resolution: '3K', aspect_ratio: '16:9', size: '2048x2048', seed: 7 },
        capOptions: { volcengine: { watermark: true, bogus: 1 }, kling: { multi_shot: true } },
      })
    );
    expect(payload).toMatchObject({ provider: HL, model: LITE, task_type: 'image_generation', task_mode: 'single', prompt: '一只猫' });
    expect(payload.params).toEqual({
      parameters: { n: 4, resolution: '3K', aspect_ratio: '16:9' },
      provider_options: { volcengine: { watermark: true } },
    });
    noNulls(payload);
  });

  it('sends image references with the gateway role and renumbered tags', () => {
    const img = imageResult('i7', 7);
    const g = connect(img, imageCard({ prompt: '参考 @图7 的配色' }));
    const payload = compileCardImagePayload(g, [img]);
    expect(payload.prompt).toBe('参考 图1 的配色');
    expect(payload.reference_assets).toEqual([
      { card_id: 'i7', tag_index: 1, role: 'reference', type: 'image', label: 'i7', local_path: 'assets/images/i7.png' },
    ]);
  });

  it('requires a prompt where the model declares it required', () => {
    expect(() => compileCardImagePayload(imageCard({ prompt: ' ' }))).toThrow('提示词');
  });

  it('sends multi-reference video with gateway roles, types and asset IDs', () => {
    const img = imageResult('i1', 1);
    const clip = uploadVideo({ fileUrl: 'https://cdn.example/m.mp4' });
    let v = videoCard({ prompt: '按 @视频4 的动作，让 @图1 跳舞', capOptions: { volcengine: { watermark: true } } });
    v = connect(clip, v);
    v = connect(img, v);
    v = { ...v, assetRefs: [{ assetId: 'asset-voice', kind: 'audio' }] };
    const payload = compileCardVideoPayload(v, [img, clip]);
    expect(payload.prompt).toBe('按 视频1 的动作，让 图1 跳舞');
    expect(payload.reference_assets).toEqual([
      { card_id: 'u2', tag_index: 1, role: 'reference', type: 'video', label: '动作', url: 'https://cdn.example/m.mp4' },
      { card_id: 'i1', tag_index: 1, role: 'reference', type: 'image', label: 'i1', local_path: 'assets/images/i1.png' },
      { card_id: '', tag_index: 1, role: 'voice', type: 'audio', label: 'asset-voice', url: 'asset://asset-voice' },
    ]);
    expect(payload.params).toEqual({
      parameters: { aspect_ratio: 'adaptive', duration: 5, generate_audio: true, resolution: '720p' },
      provider_options: { volcengine: { watermark: true } },
    });
    noNulls(payload);
  });

  it('uploads a video file the card holds instead of asking for a link', () => {
    const clip = uploadVideo();
    const v = connect(clip, videoCard({ prompt: '' }));
    expect(compileCardVideoPayload(v, [clip]).reference_assets?.[0]).toMatchObject({
      role: 'reference',
      type: 'video',
      local_path: '/assets/uploads/m.mp4',
    });
  });

  it('sends first/last frames by role, with the ratio left to the frame', () => {
    const frames = [imageResult('i1', 1), imageResult('i2', 2)];
    let kling = videoCard({ model: KLING, mode: 'first_last_frame', capParams: { aspect_ratio: '9:16' } });
    for (const f of frames) kling = connect(f, kling);
    const payload = compileCardVideoPayload(kling, frames);
    expect(payload.reference_assets?.map((r) => [r.role, r.type])).toEqual([
      ['first_frame', 'image'],
      ['last_frame', 'image'],
    ]);
    expect((payload.params as { parameters: Record<string, unknown> }).parameters).not.toHaveProperty('aspect_ratio');

    let seedance = videoCard({ mode: 'first_last_frame' });
    seedance = connect(frames[0], seedance);
    expect((compileCardVideoPayload(seedance, frames).params as { parameters: Record<string, unknown> }).parameters.aspect_ratio).toBe(
      'adaptive'
    );
  });

  it('refuses asset IDs on roles that do not take them', () => {
    const v = videoCard({ model: H3, assetRefs: [{ assetId: 'asset-a', kind: 'audio' }] });
    expect(() => compileCardVideoPayload(v, [])).toThrow('不支持素材 ID');
  });

  it('refuses a model with no descriptor', () => {
    expect(() => compileCardVideoPayload(videoCard({ model: 'unknown-model' }), [])).toThrow('能力描述');
  });

  it('records the values sent on the result snapshot', () => {
    const v = videoCard({ model: KLING, mode: 'text_to_video', capParams: { duration: 8 } });
    const snapshot = snapshotOf(v);
    expect(snapshot.capParams).toEqual({ aspect_ratio: '16:9', duration: 8, generate_audio: false, resolution: '720p' });
    expect(snapshot.params).toEqual({ mode: 'text_to_video' });
    expect(videoSpecSummary(v)).toBe('720p · 8s · 16:9');
  });
});

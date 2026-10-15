import { beforeAll, describe, expect, it } from 'vitest';
import catalog from '../../../internal/server/testdata/heighliner-media-models.json';
import type { CapabilityDescriptor, ProviderConfigItem } from '../services/api.ts';
import type { SpatialCard } from '../types/canvas.ts';
import { capabilityOf, rememberProviders } from './providers.ts';
import { connectCards } from './connections.ts';
import { compileCardImagePayload } from './compiler.ts';
import { compileCardVideoPayload } from './videoCompiler.ts';
import { compileHeighliner3DPayload } from './heighlinerCompiler.ts';
import { setViewPatch } from './model3d.ts';
import { PROMPT_MAX_CHARS_3D, apply3DRules, documentedCapability, tripoFaceLimitRange } from './heighlinerRules.ts';

// The gateway's real media catalog (shared with the Go tests), checked against what the docs add.
const descriptors = (catalog as unknown as { data: CapabilityDescriptor[] }).data;

const HL = 'hl-1';
const LITE = 'doubao-seedream-5-0-lite-260128';
const KLING = 'kling-3.0';
const KLING_OMNI = 'kling-3.0-omni';
const H3 = 'MiniMax-H3';
const HY30 = 'hy-3d-3.0';
const EXPRESS = 'hy-3d-express';
const TRIPO_31 = 'tripo-3d-3.1';
const TRIPO_P1 = 'tripo-3d-p1';

const providers: ProviderConfigItem[] = [
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
const image = (id: string, tagIndex: number) =>
  card({ id, type: 'image', role: 'result', tagIndex, status: 'succeeded', resultUrl: `/assets/images/${id}/base.png`, provider: 'ark', model: 'x' });
const clip = () =>
  card({ id: 'u1', type: 'upload', role: 'result', mediaKind: 'video', tagIndex: 9, title: '动作', resultUrl: '/assets/uploads/m.mp4' });

function connect(target: SpatialCard, ...sources: SpatialCard[]): SpatialCard {
  return sources.reduce((acc, src) => {
    const res = connectCards(src, acc);
    if (!res.ok) throw new Error(res.reason);
    return { ...acc, ...res.patch };
  }, target);
}

const paramsOf = (p: { params?: unknown }) => (p.params as { parameters: Record<string, unknown> }).parameters;
const optionsOf = (p: { params?: unknown }) => (p.params as { provider_options?: Record<string, Record<string, unknown>> }).provider_options;

describe('documented capability', () => {
  it('drops 3K from Seedream 4.5 and 4.0, which list it but reject it', () => {
    const lite = cap(LITE);
    for (const id of ['doubao-seedream-4-5-251128', 'doubao-seedream-4-0-250828']) {
      const fixed = documentedCapability({
        ...lite,
        id,
        parameters: { ...lite.parameters, resolution: { type: 'string', enum: ['2K', '3K', '4K'], default: '3K' } },
      });
      expect(fixed.parameters?.resolution).toMatchObject({ enum: ['2K', '4K'], default: '2K' });
    }
    expect(cap(LITE).parameters?.resolution?.enum).toEqual(['2K', '3K', '4K']);
  });

  it('caps every 3D prompt at 1024 characters', () => {
    expect(cap(HY30).parameters?.prompt?.maxLength).toBe(PROMPT_MAX_CHARS_3D);
    expect(cap(TRIPO_P1).parameters?.prompt?.maxLength).toBe(PROMPT_MAX_CHARS_3D);
    const long = card({ id: 'm1', type: '3d', provider: HL, model: EXPRESS, prompt: '椅'.repeat(1025) });
    expect(() => compileHeighliner3DPayload(long)).toThrow('提示词最长 1024 个字');
  });
});

describe('every media prompt', () => {
  it('stops at 32,000 bytes, counted in UTF-8', () => {
    // 10,700 Chinese characters are 32,100 bytes, within Seedream's character count.
    const g = card({ id: 'g1', type: 'image', provider: HL, model: LITE, prompt: '猫'.repeat(10700) });
    expect(() => compileCardImagePayload(g)).toThrow('提示词最长 32000 字节，当前 32100 字节');
    expect(() => compileCardImagePayload({ ...g, prompt: '猫'.repeat(10000) })).not.toThrow();
  });
});

describe('Seedream', () => {
  it('takes at most 15 images counting what it makes and the references', () => {
    const refs = Array.from({ length: 12 }, (_, i) => image(`r${i}`, i + 1));
    const g = connect(card({ id: 'g1', type: 'image', provider: HL, model: LITE, prompt: '一只猫', capParams: { n: 4 } }), ...refs);
    expect(() => compileCardImagePayload(g, refs)).toThrow('张数加参考图最多 15 张，当前 4 张 + 12 张参考图');
    expect(() => compileCardImagePayload({ ...g, capParams: { n: 3 } }, refs)).not.toThrow();
  });
});

describe('Kling', () => {
  const video = (patch: Partial<SpatialCard>) =>
    card({ id: 'v1', type: 'video', provider: HL, model: KLING_OMNI, prompt: '让 @图1 照着 @视频9 跳舞', mode: 'all_modal', ...patch });

  it('turns multi_shot on exactly when Omni has a reference video', () => {
    const img = image('i1', 1);
    const withVideo = connect(video({ capOptions: { kling: { watermark: true } } }), img, clip());
    const payload = compileCardVideoPayload(withVideo, [img, clip()]);
    expect(optionsOf(payload)).toEqual({ kling: { watermark: true, multi_shot: true } });

    const imagesOnly = connect(video({ prompt: '@图1 跳舞', capOptions: { kling: { multi_shot: true } } }), img);
    expect(optionsOf(compileCardVideoPayload(imagesOnly, [img]))).toBeUndefined();
  });

  it('names images as <<<image_N>>> in an Omni prompt, in send order', () => {
    const a = image('a', 3);
    const b = image('b', 7);
    const v = connect(video({ prompt: '@图7 追着 @图3 跑' }), a, b);
    expect(compileCardVideoPayload(v, [a, b]).prompt).toBe('<<<image_2>>> 追着 <<<image_1>>> 跑');
  });

  it('refuses more than four images or generated audio alongside a reference video', () => {
    const imgs = Array.from({ length: 5 }, (_, i) => image(`i${i}`, i + 1));
    const many = connect(video({}), ...imgs, clip());
    expect(() => compileCardVideoPayload(many, [...imgs, clip()])).toThrow('带参考视频时最多 4 张参考图，当前 5 张');

    const loud = connect(video({ capParams: { generate_audio: true } }), imgs[0], clip());
    expect(() => compileCardVideoPayload(loud, [imgs[0], clip()])).toThrow('带参考视频时不能生成音频');
  });

  it('never sends multi_shot from kling-3.0, even one a card saved earlier', () => {
    const v = card({ id: 'v1', type: 'video', provider: HL, model: KLING, prompt: '日落', mode: 'text_to_video', capOptions: { kling: { multi_shot: true } } });
    expect(optionsOf(compileCardVideoPayload(v))).toBeUndefined();
  });
});

describe('MiniMax H3', () => {
  it('leaves the ratio to the model in text mode instead of sending adaptive', () => {
    const v = card({ id: 'v1', type: 'video', provider: HL, model: H3, prompt: '日落', mode: 'text_to_video', capParams: { aspect_ratio: 'adaptive' } });
    expect(paramsOf(compileCardVideoPayload(v))).not.toHaveProperty('aspect_ratio');
    expect(paramsOf(compileCardVideoPayload({ ...v, capParams: { aspect_ratio: '16:9' } })).aspect_ratio).toBe('16:9');
  });
});

describe('Hunyuan 3D', () => {
  const m = (model: string, patch: Partial<SpatialCard> = {}) => card({ id: 'm1', type: '3d', provider: HL, model, prompt: '木椅', ...patch });

  it('sends the prompt or the images, never both, except in Sketch mode which needs both', () => {
    const a = image('a', 1);
    const withImage = connect(m(HY30), a);
    expect(compileHeighliner3DPayload(withImage, [a]).prompt).toBe('');
    expect(compileHeighliner3DPayload(m(HY30)).prompt).toBe('木椅');

    const sketch = { ...withImage, capOptions: { tencent: { generate_type: 'Sketch' } } };
    expect(compileHeighliner3DPayload(sketch, [a]).prompt).toBe('木椅');
    expect(() => compileHeighliner3DPayload({ ...sketch, prompt: '' }, [a])).toThrow('需要同时提供提示词和主图');
    expect(() => compileHeighliner3DPayload({ ...m(HY30), capOptions: sketch.capOptions })).toThrow('需要同时提供提示词和主图');
  });

  it('needs exactly one main image for multi-view', () => {
    const [a, b] = [image('a', 1), image('b', 2)];
    let c = connect(m(HY30), a, b);
    c = { ...c, ...setViewPatch(c, 'a', 'multi_view_left') };
    c = { ...c, ...setViewPatch(c, 'b', 'multi_view_right') };
    expect(() => compileHeighliner3DPayload(c, [a, b])).toThrow('多视图需要一张主图');

    c = { ...c, ...setViewPatch(c, 'a', 'reference') };
    c = { ...c, ...setViewPatch(c, 'b', 'multi_view_front') };
    expect(() => compileHeighliner3DPayload(c, [a, b])).toThrow('只能有一张主图');
  });

  it('drops face_count for LowPoly, and refuses an OBJ white model on Express', () => {
    const low = compileHeighliner3DPayload(m(HY30, { capOptions: { tencent: { generate_type: 'LowPoly', face_count: 5000 } } }));
    expect(optionsOf(low)?.tencent).toMatchObject({ generate_type: 'LowPoly' });
    expect(optionsOf(low)?.tencent).not.toHaveProperty('face_count');

    const white = m(EXPRESS, { capParams: { output_format: 'obj' }, capOptions: { tencent: { enable_geometry: true } } });
    expect(() => compileHeighliner3DPayload(white)).toThrow('不能输出 OBJ');
    expect(() => compileHeighliner3DPayload({ ...white, capParams: { output_format: 'glb' } })).not.toThrow();
  });
});

describe('Tripo', () => {
  const m = (model: string, patch: Partial<SpatialCard> = {}) => card({ id: 'm1', type: '3d', provider: HL, model, prompt: '木椅', ...patch });

  it('leaves the prompt out with images, and sends a main image among views as the front', () => {
    const [a, b] = [image('a', 1), image('b', 2)];
    let c = connect(m(TRIPO_P1), a, b);
    c = { ...c, ...setViewPatch(c, 'b', 'multi_view_back') };
    const payload = compileHeighliner3DPayload(c, [a, b]);
    expect(payload.prompt).toBe('');
    expect(payload.reference_assets?.map((r) => r.role)).toEqual(['multi_view_front', 'multi_view_back']);

    const single = connect(m(TRIPO_P1), a);
    expect(compileHeighliner3DPayload(single, [a]).reference_assets?.map((r) => r.role)).toEqual(['reference']);
  });

  it('refuses a main image next to a front view', () => {
    const [a, b] = [image('a', 1), image('b', 2)];
    let c = connect(m(TRIPO_P1), a, b);
    c = { ...c, ...setViewPatch(c, 'b', 'multi_view_front') };
    expect(() => compileHeighliner3DPayload(c, [a, b])).toThrow('多视图不单独要主图');
  });

  it('turns texture, pbr and quad off for generate_parts', () => {
    const parts = m(TRIPO_31, { capOptions: { tencent: { generate_parts: true, texture: true, pbr: true } } });
    expect(optionsOf(compileHeighliner3DPayload(parts))?.tencent).toMatchObject({
      generate_parts: true,
      texture: false,
      pbr: false,
      quad: false,
    });
  });

  it('checks face_limit against the range its geometry options allow', () => {
    expect(tripoFaceLimitRange({})).toEqual([1, 1500000]);
    expect(tripoFaceLimitRange({ geometry_quality: 'detailed' })).toEqual([1, 2000000]);
    expect(tripoFaceLimitRange({ quad: true })).toEqual([1, 150000]);
    expect(tripoFaceLimitRange({ smart_low_poly: true })).toEqual([500, 20000]);
    expect(tripoFaceLimitRange({ smart_low_poly: true, quad: true })).toEqual([500, 10000]);

    const low = m(TRIPO_31, { capOptions: { tencent: { smart_low_poly: true, face_limit: 30000 } } });
    expect(() => compileHeighliner3DPayload(low)).toThrow('面数上限须在 500–20000 之间，当前 30000');
    expect(() => compileHeighliner3DPayload({ ...low, capOptions: { tencent: { smart_low_poly: true, face_limit: 8000 } } })).not.toThrow();
    // P1 has no geometry options; its descriptor's own range is enough.
    expect(() => compileHeighliner3DPayload(m(TRIPO_P1, { capOptions: { tencent: { face_limit: 20000 } } }))).not.toThrow();
  });

  it('fits options in place without leaving an empty namespace', () => {
    const options: Record<string, Record<string, unknown>> = { tencent: { generate_type: 'LowPoly', face_count: 5000 } };
    apply3DRules(cap(HY30), { prompt: 'x', roles: [], parameters: {}, options: options as never });
    expect(options).toEqual({ tencent: { generate_type: 'LowPoly' } });
  });
});

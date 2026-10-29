import { beforeAll, describe, expect, it } from 'vitest';
import catalog from '../../../internal/server/testdata/heighliner-media-models.json';
import type { CapabilityDescriptor, ProviderConfigItem } from '../services/api.ts';
import type { SpatialCard } from '../types/canvas.ts';
import { capabilityOf, rememberProviders } from './providers.ts';
import { connectCards } from './connections.ts';
import { videoModePatch, videoSpecSummary, generatesAudio } from './cardParams.ts';
import { activeCapability, capReferenceLimit, capVideoModes, effectiveOptions, modeCapability, optionGroups, specFields } from './capability.ts';
import { compileCardVideoPayload } from './videoCompiler.ts';
import { snapshotOf } from './resultCards.ts';

// Kling Omni's edit (operation=edit): one source video, up to four reference images.
const descriptors = (catalog as unknown as { data: CapabilityDescriptor[] }).data;

const HL = 'hl-1';
const KLING = 'kling-3.0';
const KLING_OMNI = 'kling-3.0-omni';

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
const clip = (id = 'u1', tagIndex = 9) =>
  card({ id, type: 'upload', role: 'result', mediaKind: 'video', tagIndex, title: '原片', resultUrl: `/assets/uploads/${id}.mp4` });
const edit = (patch: Partial<SpatialCard> = {}) =>
  card({ id: 'v1', type: 'video', provider: HL, model: KLING_OMNI, prompt: '给 @视频9 里的人物手中加一束 @图1', mode: 'video_edit', ...patch });

function connect(target: SpatialCard, ...sources: SpatialCard[]): SpatialCard {
  return sources.reduce((acc, src) => {
    const res = connectCards(src, acc);
    if (!res.ok) throw new Error(res.reason);
    return { ...acc, ...res.patch };
  }, target);
}

const paramsOf = (p: { params?: unknown }) => (p.params as { parameters: Record<string, unknown> }).parameters;
const optionsOf = (p: { params?: unknown }) => (p.params as { provider_options?: Record<string, Record<string, unknown>> }).provider_options;

describe('video edit mode', () => {
  it('is offered by Kling Omni only', () => {
    expect(capVideoModes(cap(KLING_OMNI))).toContain('video_edit');
    expect(capVideoModes(cap(KLING))).not.toContain('video_edit');
    expect(capVideoModes(cap('kling-3.0-turbo'))).not.toContain('video_edit');
    expect(capReferenceLimit(cap(KLING_OMNI), 'video_edit', 'video')).toBe(1);
    expect(capReferenceLimit(cap(KLING_OMNI), 'video_edit', 'image')).toBe(4);
  });

  it('follows the edit operation a descriptor declares, and is absent when it lists operations without one', () => {
    const base = cap(KLING_OMNI);
    const declared: CapabilityDescriptor = {
      ...base,
      operations: {
        edit: {
          references: [
            { role: 'source', types: ['video'], max_count: 1 },
            { role: 'reference', types: ['image'], max_count: 2 },
          ],
        },
      },
    };
    expect(capReferenceLimit(declared, 'video_edit', 'image')).toBe(2);
    const generateOnly: CapabilityDescriptor = { ...base, operations: { generate: {} } };
    expect(capVideoModes(generateOnly)).not.toContain('video_edit');
  });

  it('swaps generated audio for the edit sound option', () => {
    const view = modeCapability(cap(KLING_OMNI), 'video_edit')!;
    expect(specFields(view).map((f) => f.name)).not.toContain('generate_audio');
    expect(specFields(cap(KLING_OMNI)).map((f) => f.name)).toContain('generate_audio');
    const audio = optionGroups(view).find((g) => g.ns === 'kling')!.fields.find((f) => f.name === 'audio');
    expect(audio?.param.enum).toEqual(['off', 'original']);
    // Other modes see the model unchanged.
    expect(modeCapability(cap(KLING_OMNI), 'all_modal')).toBe(cap(KLING_OMNI));
    expect(activeCapability(edit())).toEqual(view);
  });

  it('sends operation=edit with the video as source and images as reference', () => {
    const img = image('i1', 1);
    const v = connect(edit({ capOptions: { kling: { audio: 'original', watermark: true } } }), clip(), img);
    const payload = compileCardVideoPayload(v, [clip(), img]);
    expect(payload).toMatchObject({ task_type: 'video_generation', task_mode: 'video_edit', prompt: '给 视频1 里的人物手中加一束 <<<image_1>>>' });
    expect(payload.reference_assets?.map((r) => [r.role, r.type])).toEqual([
      ['source', 'video'],
      ['reference', 'image'],
    ]);
    expect(paramsOf(payload)).toMatchObject({ operation: 'edit', duration: 5, aspect_ratio: '16:9' });
    expect(optionsOf(payload)).toEqual({ kling: { audio: 'original', watermark: true } });
  });

  it('never sends multi_shot or generate_audio, even ones the card saved in another mode', () => {
    const v = connect(edit({ capParams: { generate_audio: true }, capOptions: { kling: { multi_shot: true } } }), clip());
    const payload = compileCardVideoPayload(v, [clip()]);
    expect(paramsOf(payload)).not.toHaveProperty('generate_audio');
    // The sound option's default (off) is sent explicitly; nothing else is.
    expect(optionsOf(payload)).toEqual({ kling: { audio: 'off' } });
  });

  it('needs exactly one source video, a prompt, and at most four images', () => {
    expect(() => compileCardVideoPayload(edit({ prompt: '换成夜景' }))).toThrow('需要连入 1 段要编辑的视频');

    const noPrompt = connect(edit({ prompt: '' }), clip());
    expect(() => compileCardVideoPayload(noPrompt, [clip()])).toThrow('视频编辑需要提示词');

    const imgs = Array.from({ length: 5 }, (_, i) => image(`i${i}`, i + 1));
    const res = connectCards(imgs[0], edit());
    expect(res.ok).toBe(true);
    const full = connect(edit(), ...imgs.slice(0, 4));
    expect(connectCards(imgs[4], full)).toMatchObject({ ok: false, reason: expect.stringContaining('最多 4 张参考图') });
  });

  it('keeps the card in edit mode when a clip is connected, and takes one clip only', () => {
    const res = connectCards(clip(), edit());
    expect(res).toMatchObject({ ok: true, patch: { references: [{ role: 'reference_video' }] } });
    expect(res.ok && res.patch.mode).toBeUndefined();
    const withClip = connect(edit(), clip());
    expect(connectCards(clip('u2', 10), withClip)).toMatchObject({ ok: false, reason: expect.stringContaining('1 段') });
  });

  it('is refused by models without an edit operation', () => {
    const v = card({ id: 'v1', type: 'video', provider: HL, model: KLING, prompt: '换成夜景', mode: 'video_edit' });
    expect(() => compileCardVideoPayload(v)).toThrow('不支持「视频编辑」模式');
  });

  it('switching to edit keeps one clip and up to four images, and marks the run in its snapshot', () => {
    const imgs = Array.from({ length: 6 }, (_, i) => image(`i${i}`, i + 1));
    const ref = (id: string, tagIndex: number, role: 'reference_image' | 'reference_video') => ({ cardId: id, tagIndex, role, label: id });
    const multi = edit({
      mode: 'all_modal',
      prompt: '',
      references: [
        ...imgs.slice(0, 5).map((c, i) => ref(c.id, i + 1, 'reference_image')),
        ref('u1', 9, 'reference_video'),
        ref('u2', 10, 'reference_video'),
      ],
    });
    const patch = videoModePatch(multi, 'video_edit', 0);
    expect(patch.mode).toBe('video_edit');
    expect(patch.references?.filter((r) => r.role === 'reference_video')).toHaveLength(1);
    expect(patch.references?.filter((r) => r.role === 'reference_image')).toHaveLength(4);

    const submitted = { ...multi, ...patch, prompt: '换成夜景', capOptions: { kling: { audio: 'original' } } };
    const snapshot = snapshotOf(submitted);
    expect(snapshot.params.mode).toBe('video_edit');
    expect(snapshot.capOptions).toEqual({ kling: { audio: 'original' } });
    expect(snapshot.capParams).not.toHaveProperty('generate_audio');
    expect(generatesAudio(submitted)).toBe(true);
    expect(effectiveOptions(activeCapability(submitted), { kling: { audio: 'bogus' } })).toEqual({ kling: { audio: 'off' } });
    expect(videoSpecSummary(submitted)).toBe('720p · 5s · 16:9');
  });
});

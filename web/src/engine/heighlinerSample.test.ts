import { beforeAll, describe, expect, it } from 'vitest';
import catalog from '../../../internal/server/testdata/heighliner-media-models.json';
import type { BackendTaskResponse, CapabilityDescriptor, ProviderConfigItem } from '../services/api.ts';
import type { SpatialCard } from '../types/canvas.ts';
import { capabilityOf, rememberProviders } from './providers.ts';
import { optionGroups, supportsSample } from './capability.ts';
import { compileFinalizePayload } from './heighlinerCompiler.ts';
import { compileCardVideoPayload } from './videoCompiler.ts';
import { videoSpecSummary } from './cardParams.ts';
import { addOriginResult, addPendingResult, snapshotOf } from './resultCards.ts';

const descriptors = (catalog as unknown as { data: CapabilityDescriptor[] }).data;
const HL = 'hl-1';
const SEEDANCE_25 = 'doubao-seedance-2-5-260628';
const SEEDANCE_20 = 'doubao-seedance-2-0-260128';

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

const videoCard = (patch: Partial<SpatialCard> = {}): SpatialCard => ({
  id: 'v1',
  type: 'video',
  role: 'generation',
  title: '镜头',
  x: 0,
  y: 0,
  width: 300,
  prompt: '蓝色杯子，镜头缓慢拉远',
  provider: HL,
  model: SEEDANCE_25,
  mode: 'text_to_video',
  status: 'idle',
  progress: 0,
  ...patch,
});

const task = (patch: Partial<BackendTaskResponse> = {}): BackendTaskResponse => ({
  id: 'task-1',
  provider: HL,
  provider_task_id: 'hl-task',
  model: SEEDANCE_25,
  task_type: 'video_generation',
  task_mode: 'text_to_video',
  prompt: '',
  params_json: '',
  status: 'queued',
  progress: 0,
  created_at: '',
  updated_at: '',
  ...patch,
});

describe('Seedance 2.5 sample (样片) cards', () => {
  it('are offered on Seedance 2.5 only', () => {
    expect(supportsSample(videoCard())).toBe(true);
    expect(supportsSample(videoCard({ model: 'kling-3.0' }))).toBe(false);
    expect(supportsSample(videoCard({ provider: 'ark' }))).toBe(false);
    if (descriptors.some((d) => d.id === SEEDANCE_20)) expect(supportsSample(videoCard({ model: SEEDANCE_20 }))).toBe(false);
  });

  it('send draft and a fixed 480p, keeping the other settings', () => {
    const payload = compileCardVideoPayload(
      videoCard({ sampleMode: true, capParams: { resolution: '1080p', duration: 4, generate_audio: false }, capOptions: { volcengine: { watermark: true } } })
    );
    expect(payload.params).toEqual({
      parameters: expect.objectContaining({ resolution: '480p', duration: 4, generate_audio: false }),
      provider_options: { volcengine: { watermark: true, draft: true } },
    });
  });

  it('send nothing sample-like when the switch is off, or the model cannot', () => {
    const plain = compileCardVideoPayload(videoCard({ capParams: { resolution: '1080p' } }));
    expect(plain.params).toMatchObject({ parameters: { resolution: '1080p' } });
    expect(JSON.stringify(plain.params)).not.toContain('draft');

    const kling = compileCardVideoPayload(videoCard({ model: 'kling-3.0', sampleMode: true, capParams: { resolution: '720p' } }));
    expect(JSON.stringify(kling.params)).not.toContain('draft');
    expect(kling.params).toMatchObject({ parameters: { resolution: '720p' } });
  });

  it('keep draft options out of the generic advanced controls', () => {
    const base = capabilityOf(HL, SEEDANCE_25)!;
    const withDraft: CapabilityDescriptor = {
      ...base,
      provider_options_schema: {
        type: 'object',
        properties: {
          volcengine: {
            type: 'object',
            properties: { watermark: { type: 'boolean' }, draft: { type: 'boolean' }, draft_task_id: { type: 'string' } },
          },
        },
      },
    };
    expect(optionGroups(withDraft).flatMap((g) => g.fields.map((f) => f.name))).toEqual(['watermark']);
  });

  it('record themselves on the result card and its settings', () => {
    const card = videoCard({ sampleMode: true, capParams: { resolution: '1080p' } });
    const snapshot = snapshotOf(card);
    expect(snapshot.params.sampleMode).toBe(true);
    expect(snapshot.capParams).toMatchObject({ resolution: '480p' });
    expect(snapshot.capOptions).toEqual({ volcengine: { draft: true } });
    expect(videoSpecSummary(card)).toMatch(/^样片 · 480p/);

    const added = addPendingResult([card], card, task());
    expect(added.find((c) => c.role === 'result')).toMatchObject({ sampleMode: true });
  });
});

describe('生成正式视频 from a sample', () => {
  const sample = (patch: Partial<SpatialCard> = {}): SpatialCard => ({
    ...videoCard({ id: 'result-task-1', role: 'result', sourceId: 'v1', taskId: 'task-1', status: 'succeeded', sampleMode: true, capParams: { resolution: '480p', duration: 4 } }),
    ...patch,
  });
  const action = { id: 'finalize', label: '生成正式视频' };

  it('compiles to the sample task and an explicit 1080p, with nothing the sample already fixed', () => {
    const payload = compileFinalizePayload(sample(), action);
    expect(payload).toMatchObject({
      provider: HL,
      model: SEEDANCE_25,
      task_type: 'video_generation',
      task_mode: 'action',
      params: { parameters: { resolution: '1080p' }, source_task_id: 'task-1', action_id: 'finalize' },
    });
    expect(payload.reference_assets).toBeUndefined();
    expect(JSON.stringify(payload.params)).not.toMatch(/duration|aspect_ratio|seed|generate_audio/);
  });

  it('needs a finished sample', () => {
    expect(() => compileFinalizePayload(sample({ status: 'running' }), action)).toThrow('还没有可以操作的生成结果');
    expect(() => compileFinalizePayload(sample({ taskId: undefined }), action)).toThrow();
  });

  it('lands on its own video result card linked to the sample, no longer a sample', () => {
    const cards = addOriginResult(
      [sample()],
      sample(),
      { operation: 'action', label: action.label, actionId: action.id },
      { type: 'video', provider: HL, model: SEEDANCE_25 },
      task({ id: 'task-2' })
    );
    const final = cards.find((c) => c.taskId === 'task-2')!;
    expect(final).toMatchObject({ type: 'video', role: 'result', sourceId: 'result-task-1', origin: { actionId: 'finalize' } });
    expect(final.sampleMode).toBeFalsy();
    expect(final.capParams).toMatchObject({ resolution: '1080p', duration: 4 });
    expect(final.snapshot?.capOptions).toBeUndefined();
  });
});

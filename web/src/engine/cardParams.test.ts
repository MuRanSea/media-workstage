import { describe, it, expect } from 'vitest';
import {
  imageModelPatch,
  imageSizeSummary,
  parseAspect,
  removeReferencePatch,
  requestedAspect,
  videoModePatch,
  videoModelPatch,
  videoSpecSummary,
} from './cardParams.ts';
import type { SpatialCard } from '../types/canvas.ts';
import type { ModelOption } from './channelModels.ts';
import { protocolOf } from './providers.ts';

const base = (patch: Partial<SpatialCard>): SpatialCard => ({
  id: 'c',
  type: 'video',
  title: 't',
  tagIndex: 1,
  x: 0,
  y: 0,
  width: 300,
  prompt: '',
  model: 'doubao-seedance-2-5-260628',
  provider: 'ark',
  status: 'idle',
  progress: 0,
  ...patch,
});

const opt = (provider: ModelOption['provider'], id: string): ModelOption => ({
  provider,
  protocol: protocolOf(provider)!,
  id,
  label: id,
  ready: true,
});

const refs = [
  { cardId: 'a', tagIndex: 1, role: 'reference_image' as const, label: 'a' },
  { cardId: 'b', tagIndex: 2, role: 'reference_image' as const, label: 'b' },
  { cardId: 'c', tagIndex: 3, role: 'reference_image' as const, label: 'c' },
];

describe('image params', () => {
  it('gives Seedream its tier defaults and other channels ratio + resolution', () => {
    const card = base({ type: 'image', model: 'x', imageResolution: '4K' });
    expect(imageModelPatch(card, opt('ark', 'doubao-seedream-5-0-lite-260128'))).toMatchObject({
      provider: 'ark',
      imageMode: 'single',
    });
    expect(imageModelPatch(card, opt('openai', 'gpt-image-2'))).toEqual({
      provider: 'openai',
      model: 'gpt-image-2',
      imageMode: 'single',
      sizeMode: 'tier',
      imageResolution: '4K',
    });
  });

  it('summarizes size per channel', () => {
    expect(imageSizeSummary(base({ type: 'image', provider: 'openai', imageResolution: '1K', imageRatioPreset: '1:1' }))).toBe('1K · 1:1');
    expect(imageSizeSummary(base({ type: 'image', provider: 'ark', sizeMode: 'custom_pixels', customPixels: '2048x1024' }))).toBe('2048x1024');
    expect(imageSizeSummary(base({ type: 'image', provider: 'ark', imageTier: '2K', imageRatioPreset: '9:16' }))).toBe('2K · 9:16');
  });
});

describe('video params', () => {
  it('first/last frame keeps two frames and forces adaptive ratio', () => {
    const patch = videoModePatch(base({ references: refs, ratio: '16:9' }), 'first_last_frame', 30);
    expect(patch.ratio).toBe('adaptive');
    expect(patch.references?.map((r) => r.role)).toEqual(['first_frame', 'last_frame']);
  });

  it('text-to-video drops references; all-modal re-roles them', () => {
    expect(videoModePatch(base({ references: refs }), 'text_to_video', 30).references).toEqual([]);
    const back = videoModePatch(base({ references: [{ ...refs[0], role: 'first_frame' }] }), 'all_modal', 30);
    expect(back.references?.[0].role).toBe('reference_image');
  });

  it('switching model resets specs and trims references to the new limit', () => {
    const patch = videoModelPatch(base({ references: refs, mode: 'all_modal' }), opt('minimax', 'MiniMax-H3'));
    expect(patch.provider).toBe('minimax');
    expect(patch.references!.length).toBeLessThanOrEqual(2);
    expect(patch.duration).toBeDefined();
  });

  it('removing a reference strips its tag from the prompt', () => {
    const patch = removeReferencePatch(base({ references: refs, prompt: '以 @图1 为主体，@图2 为背景' }), 'a');
    expect(patch.prompt).toBe('以 为主体，@图2 为背景');
    expect(patch.references?.map((r) => r.cardId)).toEqual(['b', 'c']);
  });

  it('summarizes specs', () => {
    expect(videoSpecSummary(base({ resolution: '720p', duration: 5, ratio: '16:9', mode: 'all_modal' }))).toBe('720p · 5s · 16:9');
    expect(videoSpecSummary(base({ resolution: '1080p', duration: -1, mode: 'first_last_frame' }))).toBe('1080p · 自适应时长 · 随首帧');
  });
});

describe('preview shape', () => {
  it('parses ratios and pixel sizes', () => {
    expect(parseAspect('9:16')).toBeCloseTo(9 / 16);
    expect(parseAspect('2048x1024')).toBe(2);
    expect(parseAspect('adaptive')).toBeUndefined();
    expect(parseAspect('0:1')).toBeUndefined();
    expect(parseAspect(undefined)).toBeUndefined();
  });

  it('uses the ratio the card asked for', () => {
    expect(requestedAspect(base({ type: 'image', provider: 'openai', imageRatioPreset: '9:16' }))).toBeCloseTo(9 / 16);
    expect(requestedAspect(base({ type: 'image', provider: 'ark', sizeMode: 'custom_pixels', customPixels: '1024x2048' }))).toBe(0.5);
    expect(requestedAspect(base({ type: 'video', ratio: '9:16' }))).toBeCloseTo(9 / 16);
    expect(requestedAspect(base({ type: 'video', mode: 'first_last_frame', ratio: '16:9' }))).toBeUndefined();
  });
});

import { describe, it, expect } from 'vitest';
import {
  addAssetRefPatch,
  assetPromptName,
  imageModelPatch,
  imageSizeSummary,
  parseAspect,
  normalizeAssetId,
  removeAssetRefPatch,
  removeReferencePatch,
  requestedAspect,
  videoModePatch,
  videoModelPatch,
  videoSpecSummary,
} from './cardParams.ts';
import type { AssetRef, SpatialCard } from '../types/canvas.ts';
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

  it('gives Midjourney a ratio and speed instead of a resolution', () => {
    expect(imageSizeSummary(base({ type: 'image', provider: 'midjourney', imageResolution: '4K', imageRatioPreset: '3:2' }))).toBe('3:2');
    expect(imageSizeSummary(base({ type: 'image', provider: 'midjourney', imageRatioPreset: '3:2', mjSpeed: 'RELAX' }))).toBe('3:2 · Relax');
    expect(imageSizeSummary(base({ type: 'image', provider: 'midjourney', imageRatioPreset: '1:1', mjOperation: 'blend' }))).toBe('Blend · 1:1');
  });

  it('drops the Midjourney speed when switching to another channel', () => {
    const card = base({ type: 'image', provider: 'midjourney', model: 'mj_imagine', mjSpeed: 'TURBO' });
    expect(imageModelPatch(card, opt('openai', 'gpt-image-2')).mjSpeed).toBeUndefined();
    expect('mjSpeed' in imageModelPatch(card, opt('openai', 'gpt-image-2'))).toBe(true);
    expect('mjSpeed' in imageModelPatch(card, opt('midjourney', 'NIJI_JOURNEY'))).toBe(false);
  });

  it('drops reference images when switching away from Midjourney', () => {
    const card = base({
      type: 'image',
      provider: 'midjourney',
      model: 'mj_imagine',
      references: [{ cardId: 'i1', tagIndex: 3, role: 'reference_image', label: 'a' }],
    });
    expect(imageModelPatch(card, opt('openai', 'gpt-image-2')).references).toBeUndefined();
    expect('mjOperation' in imageModelPatch(card, opt('openai', 'gpt-image-2'))).toBe(true);
    expect('references' in imageModelPatch(card, opt('openai', 'gpt-image-2'))).toBe(true);
    expect('references' in imageModelPatch(card, opt('ark', 'doubao-seedream-5-0-lite-260128'))).toBe(true);
    expect('references' in imageModelPatch(card, opt('midjourney', 'NIJI_JOURNEY'))).toBe(false);
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

describe('asset library references', () => {
  const vids = (n: number): AssetRef[] => Array.from({ length: n }, (_, i) => ({ assetId: `asset-v${i}`, kind: 'video' as const }));

  it('accepts a bare ID or an asset:// URL and rejects anything else', () => {
    expect(normalizeAssetId('  asset://asset-20260401123823-6d4x2 ')).toBe('asset-20260401123823-6d4x2');
    expect(normalizeAssetId('asset-20260401123823-6d4x2')).toBe('asset-20260401123823-6d4x2');
    expect(normalizeAssetId('asset://')).toBe('');
    expect(normalizeAssetId('https://example.com/a.mp4')).toBe('');
  });

  it('adds an asset and moves a text-only card to 多图参考', () => {
    const res = addAssetRefPatch(base({ mode: 'text_to_video' }), 'asset://asset-1', 'video');
    expect(res).toEqual({ ok: true, patch: { mode: 'all_modal', assetRefs: [{ assetId: 'asset-1', kind: 'video' }] } });
  });

  it('refuses duplicates, first/last frame mode, other protocols and the model limit', () => {
    const withOne = base({ assetRefs: [{ assetId: 'asset-1', kind: 'video' }] });
    expect(addAssetRefPatch(withOne, 'asset-1', 'video').ok).toBe(false);
    expect(addAssetRefPatch(base({ mode: 'first_last_frame' }), 'asset-1', 'video').ok).toBe(false);
    expect(addAssetRefPatch(base({ provider: 'minimax', model: 'MiniMax-H3' }), 'asset-1', 'video').ok).toBe(false);
    const seedance20 = base({ model: 'doubao-seedance-2-0-260128', assetRefs: vids(3) });
    expect(addAssetRefPatch(seedance20, 'asset-x', 'video')).toEqual({ ok: false, reason: 'Seedance 2.0 Pro 最多 3 个参考视频（含连入的视频卡片）' });
    expect(addAssetRefPatch(seedance20, 'asset-x', 'audio').ok).toBe(true);
  });

  it('asset images share the image limit with connected image cards', () => {
    const full = base({ model: 'doubao-seedance-2-0-260128', references: Array.from({ length: 9 }, (_, i) => ({ ...refs[0], cardId: `r${i}` })) });
    expect(addAssetRefPatch(full, 'asset-x', 'image')).toEqual({ ok: false, reason: 'Seedance 2.0 Pro 最多 9 张参考图（含连入的图片卡片）' });
  });

  it('names assets per kind, images after the connected image cards', () => {
    const card = base({
      references: refs.slice(0, 2),
      assetRefs: [
        { assetId: 'v', kind: 'video' },
        { assetId: 'i', kind: 'image' },
        { assetId: 'v2', kind: 'video' },
        { assetId: 'a', kind: 'audio' },
      ],
    });
    expect(card.assetRefs!.map((a) => assetPromptName(card, a))).toEqual(['视频1', '图片3', '视频2', '音频1']);
  });

  it('keeps assets only in 多图参考 and trims them to a new model', () => {
    const card = base({ mode: 'all_modal', assetRefs: vids(5) });
    expect(videoModePatch(card, 'first_last_frame', 30).assetRefs).toBeUndefined();
    expect(videoModePatch(card, 'all_modal', 30).assetRefs).toHaveLength(5);
    expect(videoModelPatch(card, opt('ark', 'doubao-seedance-2-0-260128')).assetRefs).toEqual(vids(3));
    expect(videoModelPatch(card, opt('minimax', 'MiniMax-H3')).assetRefs).toBeUndefined();
  });

  it('connected video cards share the video limit and count before asset videos', () => {
    const clips = [1, 2].map((n) => ({ cardId: `c${n}`, tagIndex: n, role: 'reference_video' as const, label: 'c' }));
    const card = base({ model: 'doubao-seedance-2-0-260128', videoReferences: clips, assetRefs: vids(1) });
    expect(assetPromptName(card, card.assetRefs![0])).toBe('视频3');
    expect(addAssetRefPatch(card, 'asset-x', 'video').ok).toBe(false);
    // Seedance 2.0 takes 3 videos: 4 connected clips keep 3, and no asset video fits.
    const four = base({ videoReferences: [...clips, ...clips.map((c) => ({ ...c, cardId: `${c.cardId}b` }))], assetRefs: vids(1) });
    const patch = videoModelPatch(four, opt('ark', 'doubao-seedance-2-0-260128'));
    expect(patch.videoReferences).toHaveLength(3);
    expect(patch.assetRefs).toEqual([]);
    expect(videoModePatch(four, 'text_to_video', 30).videoReferences).toBeUndefined();
  });

  it('removing the last asset clears the list', () => {
    expect(removeAssetRefPatch(base({ assetRefs: vids(1) }), 'asset-v0')).toEqual({ assetRefs: undefined });
  });
});

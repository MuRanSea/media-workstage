import { describe, it, expect } from 'vitest';
import type { SpatialCard } from '../types/canvas.ts';
import { addAssetRefPatch, assetPromptName, normalizeAssetId, removeAssetRefPatch, videoModelPatch } from './cardParams.ts';
import { compileCardVideoPayload } from './videoCompiler.ts';

const seedance = (patch: Partial<SpatialCard> = {}): SpatialCard => ({
  id: 'v1',
  role: 'generation',
  type: 'video',
  title: '视频 1',
  x: 0,
  y: 0,
  width: 460,
  prompt: '图1 里的人按 视频1 的动作跳舞，配上 音频1',
  provider: 'ark',
  model: 'doubao-seedance-2-5-260628',
  mode: 'all_modal',
  status: 'idle',
  progress: 0,
  ...patch,
});

const image = { id: 'i1', role: 'result', type: 'image', title: '人物', tagIndex: 3, x: 0, y: 0, width: 330, prompt: '', model: '', status: 'succeeded', progress: 100, resultUrl: '/assets/images/t1/base.png' } as SpatialCard;

describe('asset library references (Seedance)', () => {
  it('accepts an id with or without asset://', () => {
    expect(normalizeAssetId(' asset://asset-2026-abc ')).toBe('asset-2026-abc');
    expect(normalizeAssetId('asset-2026-abc')).toBe('asset-2026-abc');
    expect(normalizeAssetId('not an id')).toBe('');
  });

  it('adds items by kind, switching a text-only card to multi-reference mode', () => {
    const res = addAssetRefPatch(seedance({ mode: 'text_to_video' }), 'asset://asset-v', 'video');
    expect(res).toEqual({ ok: true, patch: { mode: 'all_modal', assetRefs: [{ assetId: 'asset-v', kind: 'video' }] } });
  });

  it('refuses duplicates, first/last frame mode and non-Seedance models', () => {
    const card = seedance({ assetRefs: [{ assetId: 'asset-v', kind: 'video' }] });
    expect(addAssetRefPatch(card, 'asset-v', 'video')).toMatchObject({ ok: false, reason: '这个素材已经添加过了' });
    expect(addAssetRefPatch(seedance({ mode: 'first_last_frame' }), 'asset-v', 'video')).toMatchObject({ ok: false });
    expect(addAssetRefPatch(seedance({ provider: 'apimart', model: 'kling-v3-omni' }), 'asset-v', 'video')).toMatchObject({
      ok: false,
      reason: expect.stringContaining('Seedance'),
    });
  });

  it('names items after the connected cards of their kind', () => {
    const card = seedance({
      references: [{ cardId: 'i1', tagIndex: 3, role: 'reference_image', label: '人物' }],
      assetRefs: [
        { assetId: 'asset-i', kind: 'image' },
        { assetId: 'asset-v', kind: 'video' },
        { assetId: 'asset-a', kind: 'audio' },
      ],
    });
    expect(card.assetRefs!.map((a) => assetPromptName(card, a))).toEqual(['图2', '视频1', '音频1']);
  });

  it('sends items as asset:// after the connected cards, in multi-reference mode only', () => {
    const card = seedance({
      prompt: '@图3 里的人按 视频1 的动作跳舞，配上 音频1',
      references: [{ cardId: 'i1', tagIndex: 3, role: 'reference_image', label: '人物' }],
      assetRefs: [
        { assetId: 'asset-v', kind: 'video' },
        { assetId: 'asset-a', kind: 'audio' },
      ],
    });
    const payload = compileCardVideoPayload(card, [image]);
    expect(payload.prompt).toBe('图1 里的人按 视频1 的动作跳舞，配上 音频1');
    expect(payload.reference_assets?.slice(1)).toEqual([
      { card_id: '', tag_index: 1, role: 'reference_video', label: 'asset-v', url: 'asset://asset-v' },
      { card_id: '', tag_index: 1, role: 'reference_audio', label: 'asset-a', url: 'asset://asset-a' },
    ]);
    expect(compileCardVideoPayload({ ...card, mode: 'first_last_frame' }, [image]).reference_assets).toHaveLength(1);
  });

  it('is dropped when the card moves off Seedance, and trimmed to the new model', () => {
    const card = seedance({ assetRefs: [1, 2, 3, 4].map((n) => ({ assetId: `a${n}`, kind: 'audio' as const })) });
    const toKling = videoModelPatch(card, { provider: 'apimart', protocol: 'apimart', id: 'kling-v3-omni', label: '', ready: true } as never);
    expect(toKling.assetRefs).toBeUndefined();
    const toPro = videoModelPatch(card, { provider: 'ark', protocol: 'ark', id: 'doubao-seedance-2-0-260128', label: '', ready: true } as never);
    expect(toPro.assetRefs?.map((a) => a.assetId)).toEqual(['a1', 'a2', 'a3']);
  });

  it('removes an item', () => {
    const card = seedance({ assetRefs: [{ assetId: 'asset-v', kind: 'video' }] });
    expect(removeAssetRefPatch(card, 'asset-v')).toEqual({ assetRefs: undefined });
  });
});

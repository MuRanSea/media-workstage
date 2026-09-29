import { describe, it, expect } from 'vitest';
import { markExistingResults, spawnVideoResultCards } from './resultCards.ts';
import { uploadReference, uploadRefKind } from './uploadRefs.ts';
import type { SpatialCard } from '../types/canvas.ts';

const card = (p: Partial<SpatialCard> & Pick<SpatialCard, 'id' | 'type'>): SpatialCard => ({
  title: p.id,
  tagIndex: 1,
  x: 0,
  y: 0,
  width: 460,
  prompt: '',
  model: '',
  status: 'idle',
  progress: 0,
  ...p,
});

const done = (p: Partial<SpatialCard> = {}) =>
  card({ id: 'v1', type: 'video', title: '视频 1', x: 100, y: 50, status: 'succeeded', taskId: 't1', resultUrl: '/assets/videos/t1/output.mp4', ...p });

describe('spawnVideoResultCards', () => {
  it('adds a playable video card to the right of a finished video card, once', () => {
    const first = spawnVideoResultCards([done()]);
    expect(first).toHaveLength(2);
    const [source, result] = first;
    expect(source.spawnedTaskId).toBe('t1');
    expect(result).toMatchObject({
      type: 'upload',
      mediaKind: 'video',
      title: '视频 1 结果',
      resultUrl: '/assets/videos/t1/output.mp4',
      status: 'succeeded',
      x: 100 + 460 + 80,
      y: 50,
    });
    // Nothing more is added on later passes.
    expect(spawnVideoResultCards(first)).toBe(first);
  });

  it('spawns again for a regeneration and stacks below earlier results', () => {
    const once = spawnVideoResultCards([done()]);
    const regenerated = once.map((c) => (c.id === 'v1' ? { ...c, taskId: 't2', resultUrl: '/assets/videos/t2/output.mp4' } : c));
    const twice = spawnVideoResultCards(regenerated);
    expect(twice).toHaveLength(3);
    expect(twice[2].resultUrl).toBe('/assets/videos/t2/output.mp4');
    expect(twice[2].y).toBeGreaterThan(twice[1].y);
  });

  it('ignores unfinished or failed videos and other card types', () => {
    const cards = [done({ status: 'running' }), done({ id: 'v2', status: 'failed' }), card({ id: 'i', type: 'image', status: 'succeeded', taskId: 'x', resultUrl: '/a.png' })];
    expect(spawnVideoResultCards(cards)).toBe(cards);
  });

  it('marks results already on disk so opening a project adds nothing', () => {
    const loaded = markExistingResults([done()]);
    expect(loaded[0].spawnedTaskId).toBe('t1');
    expect(spawnVideoResultCards(loaded)).toBe(loaded);
  });
});

describe('uploadReference choice', () => {
  const clip = (p: Partial<SpatialCard> = {}) =>
    card({
      id: 'u',
      type: 'upload',
      mediaKind: 'video',
      title: '素材',
      resultUrl: '/assets/uploads/m.mp4',
      assetId: 'a1',
      assetStatus: 'Active',
      fileUrl: 'https://t/m.mp4',
      fileExpiresAt: Math.floor(Date.now() / 1000) + 3600,
      ...p,
    });

  it('automatic: asset id for Ark, link for everything else', () => {
    expect(uploadReference(clip(), 'ark')).toEqual({ url: 'asset://a1' });
    expect(uploadReference(clip(), 'apimart')).toEqual({ url: 'https://t/m.mp4' });
    expect(uploadRefKind(clip(), 'ark')).toBe('asset');
    expect(uploadRefKind(clip(), 'apimart')).toBe('url');
  });

  it('honours the user choice, even on Ark', () => {
    expect(uploadReference(clip({ uploadRefMode: 'url' }), 'ark')).toEqual({ url: 'https://t/m.mp4' });
    expect(uploadReference(clip({ uploadRefMode: 'asset' }), 'ark')).toEqual({ url: 'asset://a1' });
  });

  it('explains when the choice cannot be honoured', () => {
    expect(() => uploadReference(clip({ uploadRefMode: 'asset' }), 'apimart')).toThrow(/仅 Seedance/);
    expect(() => uploadReference(clip({ uploadRefMode: 'asset', assetStatus: 'Processing' }), 'ark')).toThrow(/审核中/);
    expect(() => uploadReference(clip({ uploadRefMode: 'asset', assetId: undefined }), 'ark')).toThrow(/还没有上传到素材库/);
    expect(() => uploadReference(clip({ uploadRefMode: 'url', fileUrl: undefined }), 'ark')).toThrow(/还没有获取链接/);
    expect(() => uploadReference(clip({ uploadRefMode: 'url', fileExpiresAt: 1 }), 'ark')).toThrow(/已过期/);
    expect(uploadRefKind(clip({ uploadRefMode: 'url', fileUrl: undefined }), 'ark')).toBeUndefined();
  });
});

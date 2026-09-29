import { describe, it, expect } from 'vitest';
import { connectCards } from './connections.ts';
import { compileCardVideoPayload } from './videoCompiler.ts';
import { videoModePatch, videoModelPatch } from './cardParams.ts';
import { createCard, duplicateCards } from './cardFactory.ts';
import { refTag } from './refTags.ts';
import type { SpatialCard } from '../types/canvas.ts';

const card = (p: Partial<SpatialCard> & Pick<SpatialCard, 'id' | 'type'>): SpatialCard => ({
  title: p.id,
  tagIndex: 1,
  x: 0,
  y: 0,
  width: 300,
  prompt: '',
  model: '',
  status: 'idle',
  progress: 0,
  ...p,
});

const uploadImage = (patch: Partial<SpatialCard> = {}) =>
  card({ id: 'u1', type: 'upload', mediaKind: 'image', tagIndex: 2, title: '人物', resultUrl: '/assets/uploads/a.png', ...patch });
const uploadVideo = (patch: Partial<SpatialCard> = {}) =>
  card({ id: 'u2', type: 'upload', mediaKind: 'video', tagIndex: 4, title: '动作', resultUrl: '/assets/uploads/m.mp4', ...patch });
const video = (patch: Partial<SpatialCard> = {}) =>
  card({
    id: 'v1',
    type: 'video',
    width: 460,
    provider: 'ark',
    model: 'doubao-seedance-2-5-260628',
    prompt: '按 @视频4 的动作，让 @图2 里的人物跳舞',
    mode: 'all_modal',
    ...patch,
  });

describe('upload cards as video references', () => {
  it('connects an uploaded image like a generated one', () => {
    const res = connectCards(uploadImage(), video({ prompt: '' }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.patch.references?.[0]).toMatchObject({ cardId: 'u1', role: 'reference_image', tagIndex: 2 });
    expect(res.patch.prompt).toBe('@图2');
  });

  it('connects an uploaded video as a reference video with a 视频 tag', () => {
    const res = connectCards(uploadVideo(), video({ prompt: '' }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.patch.references?.[0]).toMatchObject({ cardId: 'u2', role: 'reference_video', tagIndex: 4 });
    expect(res.patch.prompt).toBe('@视频4');
    expect(res.patch.mode).toBe('all_modal');
  });

  it('switches a text-to-video card to multi-reference when a video is connected', () => {
    const res = connectCards(uploadVideo(), video({ mode: 'text_to_video', prompt: '' }));
    expect(res.ok && res.patch.mode).toBe('all_modal');
  });

  it('refuses reference videos in first/last-frame mode and for non-Ark models', () => {
    const frame = connectCards(uploadVideo(), video({ mode: 'first_last_frame' }));
    expect(frame.ok).toBe(false);
    const kling = connectCards(uploadVideo(), video({ provider: 'apimart', model: 'kling-v3' }));
    expect(kling.ok).toBe(false);
  });

  it('takes one reference video on Kling Omni through APIMart, but not a second', () => {
    const omni = video({ provider: 'apimart', model: 'kling-v3-omni', prompt: '' });
    const res = connectCards(uploadVideo(), omni);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const withOne = { ...omni, ...res.patch };
    expect(connectCards(uploadVideo({ id: 'u3', tagIndex: 5 }), withOne).ok).toBe(false);
  });

  it('drops reference videos when the model is switched to one that cannot take them', () => {
    const refs = [{ cardId: 'u2', tagIndex: 4, role: 'reference_video' as const, label: '动作' }];
    const patch = videoModelPatch(video({ references: refs, prompt: '看 @视频4' }), {
      provider: 'apimart',
      protocol: 'apimart',
      id: 'kling-v3',
      label: 'Kling v3',
    } as never);
    expect(patch.references).toEqual([]);
    expect(patch.prompt).toBe('看');
  });

  it('refuses to compile a reference video for a model that cannot take one', () => {
    const refs = [{ cardId: 'u2', tagIndex: 4, role: 'reference_video' as const, label: '动作' }];
    const kling = video({ provider: 'apimart', model: 'kling-v3', references: refs });
    expect(() => compileCardVideoPayload(kling, [uploadVideo({ fileUrl: 'https://t/m.mp4' })])).toThrow(/does not support|不支持参考视频/);
  });

  it('sends only the download URL (never asset://) to non-Ark protocols', () => {
    const refs = [{ cardId: 'u2', tagIndex: 4, role: 'reference_video' as const, label: '动作' }];
    const omni = video({ provider: 'apimart', model: 'kling-v3-omni', references: refs, prompt: '看 @视频4' });
    const onlyAsset = uploadVideo({ assetId: 'a', assetStatus: 'Active' });
    expect(() => compileCardVideoPayload(omni, [onlyAsset])).toThrow(/获取链接/);
    const both = uploadVideo({ assetId: 'a', assetStatus: 'Active', fileUrl: 'https://t/m.mp4' });
    expect(compileCardVideoPayload(omni, [both]).reference_assets?.[0]).toMatchObject({ url: 'https://t/m.mp4' });
  });

  it('only connects uploads to video cards, and refuses duplicates', () => {
    expect(connectCards(uploadImage(), card({ id: 'i', type: 'image' })).ok).toBe(false);
    const target = video({ references: [{ cardId: 'u2', tagIndex: 4, role: 'reference_video', label: '动作' }] });
    expect(connectCards(uploadVideo(), target).ok).toBe(false);
  });

  it('keeps reference videos when the mode is switched to multi-reference, and drops them for frames', () => {
    const refs = [
      { cardId: 'u1', tagIndex: 2, role: 'reference_image' as const, label: '人物' },
      { cardId: 'u2', tagIndex: 4, role: 'reference_video' as const, label: '动作' },
    ];
    const target = video({ references: refs });
    expect(videoModePatch(target, 'all_modal', 30).references?.map((r) => r.role)).toEqual(['reference_image', 'reference_video']);
    expect(videoModePatch(target, 'first_last_frame', 30).references).toEqual([{ ...refs[0], role: 'first_frame' }]);
    expect(refTag(refs[1])).toBe('@视频4');
  });
});

describe('compiling with upload references', () => {
  const refs = [
    { cardId: 'u1', tagIndex: 2, role: 'reference_image' as const, label: '人物' },
    { cardId: 'u2', tagIndex: 4, role: 'reference_video' as const, label: '动作' },
  ];

  it('sends the asset id for Ark and numbers images and videos separately', () => {
    const cards = [
      uploadImage({ assetId: 'asset-img', assetStatus: 'Active' }),
      uploadVideo({ assetId: 'asset-vid', assetStatus: 'Active' }),
    ];
    const payload = compileCardVideoPayload(video({ references: refs }), cards);
    expect(payload.prompt).toBe('按 视频1 的动作，让 图1 里的人物跳舞');
    expect(payload.reference_assets).toEqual([
      expect.objectContaining({ role: 'reference_image', tag_index: 1, url: 'asset://asset-img' }),
      expect.objectContaining({ role: 'reference_video', tag_index: 1, url: 'asset://asset-vid' }),
    ]);
  });

  it('falls back to the download URL, then to the saved image, but never inlines a video', () => {
    const inFuture = Math.floor(Date.now() / 1000) + 3600;
    const withUrl = compileCardVideoPayload(video({ references: refs }), [
      uploadImage(),
      uploadVideo({ fileUrl: 'https://tos.example/m.mp4?sig=1', fileExpiresAt: inFuture }),
    ]);
    expect(withUrl.reference_assets?.[0]).toMatchObject({ local_path: '/assets/uploads/a.png' });
    expect(withUrl.reference_assets?.[1]).toMatchObject({ url: 'https://tos.example/m.mp4?sig=1' });

    expect(() => compileCardVideoPayload(video({ references: refs }), [uploadImage(), uploadVideo()])).toThrow(/上传/);
  });

  it('rejects an expired link, a pending review and a failed review for videos', () => {
    const expired = uploadVideo({ fileUrl: 'https://tos.example/m.mp4', fileExpiresAt: 1 });
    expect(() => compileCardVideoPayload(video({ references: [refs[1]] }), [expired])).toThrow(/上传/);
    const pending = uploadVideo({ assetId: 'a', assetStatus: 'Processing' });
    expect(() => compileCardVideoPayload(video({ references: [refs[1]] }), [pending])).toThrow(/审核中/);
    const failed = uploadVideo({ assetId: 'a', assetStatus: 'Failed', assetError: '内容违规' });
    expect(() => compileCardVideoPayload(video({ references: [refs[1]] }), [failed])).toThrow(/内容违规/);
  });
});

describe('creating and duplicating upload cards', () => {
  it('creates a titled upload card of the requested kind', () => {
    const c = createCard('upload', { x: 0, y: 0 }, [], 'video');
    expect(c).toMatchObject({ type: 'upload', mediaKind: 'video', title: '上传视频 1', tagIndex: 1 });
  });

  it('copies keep the upload and retitle with the new tag', () => {
    const src = uploadVideo({ assetId: 'a', assetStatus: 'Active', title: '上传视频 4' });
    const [copy] = duplicateCards([src], { x: 0, y: 0 }, [src]);
    expect(copy.title).toBe('上传视频 5');
    expect(copy.assetId).toBe('a');
  });
});

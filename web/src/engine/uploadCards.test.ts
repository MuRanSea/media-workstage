import { describe, it, expect } from 'vitest';
import { connectCards } from './connections.ts';
import { compileCardVideoPayload } from './videoCompiler.ts';
import { videoModePatch, videoModelPatch } from './cardParams.ts';
import { createCard, duplicateCards } from './cardFactory.ts';
import { refTag } from './refTags.ts';
import { offersUpload, uploadReference, uploadRefKind } from './uploadRefs.ts';
import { migrateLegacyCards, type SavedCard } from './migration.ts';
import type { SpatialCard } from '../types/canvas.ts';

const card = (p: Partial<SpatialCard> & Pick<SpatialCard, 'id' | 'type'>): SpatialCard => ({
  // Uploads are result cards with no source; the video cards they feed are generation cards.
  role: p.type === 'upload' ? 'result' : 'generation',
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
/** A generated video's result card. */
const videoResult = (patch: Partial<SpatialCard> = {}) =>
  card({
    id: 'r1',
    type: 'video',
    role: 'result',
    sourceId: 'v0',
    tagIndex: 6,
    title: '视频 1 #1',
    status: 'succeeded',
    resultUrl: '/assets/videos/t1/output.mp4',
    ...patch,
  });
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
  it('creates a titled upload card of the requested kind, as a result card with no source', () => {
    const c = createCard('upload', { x: 0, y: 0 }, [], 'video');
    expect(c).toMatchObject({ type: 'upload', role: 'result', mediaKind: 'video', title: '上传视频 1', tagIndex: 1 });
    expect(c.sourceId).toBeUndefined();
  });

  it('copies keep the upload and retitle with the new tag', () => {
    const src = uploadVideo({ assetId: 'a', assetStatus: 'Active', title: '上传视频 4' });
    const [copy] = duplicateCards([src], { x: 0, y: 0 }, [src]);
    expect(copy.title).toBe('上传视频 5');
    expect(copy.assetId).toBe('a');
  });
});

describe('uploadReference choice', () => {
  const clip = (p: Partial<SpatialCard> = {}) =>
    uploadVideo({
      title: '素材',
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

describe('video result cards as reference videos', () => {
  it('connects a generated video to another video card with its @视频 tag', () => {
    const res = connectCards(videoResult(), video({ prompt: '' }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.patch.references?.[0]).toMatchObject({ cardId: 'r1', role: 'reference_video', tagIndex: 6 });
    expect(res.patch.prompt).toBe('@视频6');
  });

  it('refuses a video generation card and non-video targets', () => {
    expect(connectCards(video({ id: 'v0' }), video()).ok).toBe(false);
    expect(connectCards(videoResult(), card({ id: 'i', type: 'image' })).ok).toBe(false);
  });

  it('sends what was uploaded for the video, and asks for an upload otherwise', () => {
    const refs = [{ cardId: 'r1', tagIndex: 6, role: 'reference_video' as const, label: '视频 1 #1' }];
    const target = video({ references: refs, prompt: '参考 @视频6 的运镜' });
    expect(() => compileCardVideoPayload(target, [videoResult()])).toThrow(/上传/);
    const payload = compileCardVideoPayload(target, [videoResult({ assetId: 'asset-r', assetStatus: 'Active' })]);
    expect(payload.prompt).toBe('参考 视频1 的运镜');
    expect(payload.reference_assets?.[0]).toMatchObject({ role: 'reference_video', url: 'asset://asset-r' });
  });
});

describe('opening projects saved by the first upload-card version', () => {
  /** A card as that version saved it: no role, and whatever fields it had then. */
  const saved = (p: Record<string, unknown> & { id: string; type: SpatialCard['type'] }): SavedCard => {
    const { role: _role, ...rest } = card(p as Partial<SpatialCard> & Pick<SpatialCard, 'id' | 'type'>);
    return rest as SavedCard;
  };

  it('makes upload cards result cards with no source and keeps their tags and uploads', () => {
    const upload = saved({ id: 'u2', type: 'upload', mediaKind: 'video', tagIndex: 4, assetId: 'a', assetStatus: 'Active' });
    const [migrated] = migrateLegacyCards([upload]);
    expect(migrated).toMatchObject({ id: 'u2', role: 'result', tagIndex: 4, assetId: 'a' });
    expect(migrated.sourceId).toBeUndefined();
  });

  it('keeps a video card linked to an uploaded video', () => {
    const refs = [{ cardId: 'u2', tagIndex: 4, role: 'reference_video', label: '动作', url: '/assets/uploads/m.mp4' }];
    const cards = migrateLegacyCards([
      saved({ id: 'u2', type: 'upload', mediaKind: 'video', tagIndex: 4 }),
      saved({ id: 'v1', type: 'video', tagIndex: 5, prompt: '按 @视频4 跳舞', references: refs }),
    ]);
    const v1 = cards.find((c) => c.id === 'v1')!;
    expect(v1.role).toBe('generation');
    expect(v1.references).toEqual([{ cardId: 'u2', tagIndex: 4, role: 'reference_video', label: '动作' }]);
    expect(v1.prompt).toBe('按 @视频4 跳舞');
  });

  it('drops the fields that version used to copy finished videos onto upload cards', () => {
    const cards = migrateLegacyCards([
      saved({ id: 'v1', type: 'video', tagIndex: 1, status: 'succeeded', taskId: 't1', resultUrl: '/v.mp4', spawnedTaskId: 't1' }),
      saved({ id: 'u9', type: 'upload', mediaKind: 'video', tagIndex: 2, resultUrl: '/v.mp4', resultOfCardId: 'v1' }),
    ]);
    for (const c of cards) {
      expect(c).not.toHaveProperty('spawnedTaskId');
      expect(c).not.toHaveProperty('resultOfCardId');
    }
    // The video's own output becomes a result card that keeps the old number.
    expect(cards.find((c) => c.id === 'v1-result')).toMatchObject({ role: 'result', type: 'video', tagIndex: 1 });
  });

  it('gives video results saved without a tag the next free @视频N', () => {
    const cards = migrateLegacyCards([videoResult({ tagIndex: undefined }), uploadImage({ tagIndex: 7 })]);
    expect(cards[0].tagIndex).toBe(8);
    expect(migrateLegacyCards(cards)).toBe(cards);
  });
});

describe('generated image results that need an upload', () => {
  const imageResult = (patch: Partial<SpatialCard> = {}) =>
    card({
      id: 'i1',
      type: 'image',
      role: 'result',
      sourceId: 'g1',
      tagIndex: 3,
      title: '图 1 #1',
      status: 'succeeded',
      resultUrl: '/assets/images/t1/base.png',
      outputAssets: [{ id: 'a', kind: 'image_base', local_path: 'images/t1/base.png', remote_url: 'inline://t1/0' } as never],
      ...patch,
    });

  it('offers upload only for images the provider gave no public URL for', () => {
    expect(offersUpload(imageResult())).toBe(true);
    const withUrl = imageResult({ outputAssets: [{ id: 'a', kind: 'image_base', local_path: 'x.png', remote_url: 'https://cdn/x.png' } as never] });
    expect(offersUpload(withUrl)).toBe(false);
    expect(offersUpload(imageResult({ status: 'running', resultUrl: undefined }))).toBe(false);
    expect(offersUpload(imageResult({ role: 'generation' }))).toBe(false);
    expect(offersUpload(uploadImage())).toBe(true);
  });

  it('sends the uploaded link, not base64, once an image result has one', () => {
    const res = imageResult({ fileUrl: 'https://files/x.png', fileExpiresAt: Date.now() / 1000 + 3600 });
    const payload = compileCardVideoPayload(video({ prompt: '让 @图3 动起来', references: [{ cardId: 'i1', tagIndex: 3, role: 'reference_image', label: '' }] }), [res]);
    expect(payload.reference_assets?.[0]).toMatchObject({ url: 'https://files/x.png' });
    expect(payload.reference_assets?.[0].local_path).toBeUndefined();
  });

  it('keeps sending the saved file for an image result that was never uploaded', () => {
    const payload = compileCardVideoPayload(video({ prompt: '让 @图3 动起来', references: [{ cardId: 'i1', tagIndex: 3, role: 'reference_image', label: '' }] }), [imageResult()]);
    expect(payload.reference_assets?.[0].local_path).toContain('images/t1/base.png');
  });
});

import { describe, it, expect } from 'vitest';
import {
  compileCardVideoPayload,
  resolveReferenceAsset,
} from './videoCompiler.ts';
import type { SpatialCard } from '../types/canvas.ts';
import type { BackendTaskResponse } from '../services/api.ts';
import { addPendingResult, applyTaskToCards } from './resultCards.ts';
import { createCard } from './cardFactory.ts';
import { connectCards } from './connections.ts';

describe('Video Task Payload Compiler & Asset Resolution', () => {
  it('reads the image from the card the reference points at', () => {
    const imgCard: SpatialCard = {
      id: 'c-1',
      role: 'result',
      type: 'image',
      title: 'Character',
      tagIndex: 1,
      x: 0,
      y: 0,
      width: 340,
      prompt: '',
      model: 'doubao-seedream-5-0-pro-260628',
      status: 'succeeded',
      progress: 100,
      resultUrl: 'assets/images/task-2/base.png',
    };
    const resolved = resolveReferenceAsset(
      {
        cardId: 'c-1',
        tagIndex: 1,
        role: 'reference_image',
        label: 'Character',
      },
      [imgCard]
    );

    expect(resolved).toEqual({ localPath: 'assets/images/task-2/base.png' });
  });

  it('prioritizes localPath alone when source card has both local_path and remote_url', () => {
    const imgCard: SpatialCard = {
      id: 'c-img-7',
      role: 'result',
      type: 'image',
      title: '机甲少女设定',
      tagIndex: 7,
      x: 0,
      y: 0,
      width: 340,
      prompt: '机甲少女',
      model: 'doubao-seedream-5-0-pro-260628',
      status: 'succeeded',
      progress: 100,
      outputAssets: [
        {
          id: 'a1',
          task_id: 't1',
          asset_index: 0,
          kind: 'image_base',
          name: 'base.png',
          local_path: 'images/t1/base.png',
          remote_url: 'https://tos.example.com/t1/base.png',
          z_index: 0,
        },
      ],
    };

    const resolved = resolveReferenceAsset(
      { cardId: 'c-img-7', tagIndex: 7, role: 'reference_image', label: '机甲少女' },
      [imgCard]
    );

    expect(resolved.localPath).toBe('assets/images/t1/base.png');
    // url must be undefined to avoid backend preferring remote URL over local Base64!
    expect(resolved.url).toBeUndefined();
  });

  it('rejects a reference whose image card is no longer on the canvas', () => {
    expect(() =>
      resolveReferenceAsset(
        {
          cardId: 'c-deleted',
          tagIndex: 2,
          role: 'reference_image',
          label: 'Deleted',
        },
        []
      )
    ).toThrowError(/@图2 was not found/);
  });

  it('rejects ungenerated reference image cards with a clear descriptive error', () => {
    const ungeneratedCard: SpatialCard = {
      id: 'c-img-8',
      role: 'result',
      type: 'image',
      title: '未生成的草图',
      tagIndex: 8,
      x: 0,
      y: 0,
      width: 340,
      prompt: '草图',
      model: 'doubao-seedream-5-0-pro-260628',
      status: 'idle',
      progress: 0,
    };

    expect(() =>
      resolveReferenceAsset(
        { cardId: 'c-img-8', tagIndex: 8, role: 'reference_image', label: '草图' },
        [ungeneratedCard]
      )
    ).toThrowError(/has no output yet/);
  });

  it('renumbers arbitrary global tags (@图7, @图42) into sequential cloud tags (图1, 图2)', () => {
    const card7: SpatialCard = {
      id: 'c-7',
      role: 'result',
      type: 'image',
      title: '机甲少女',
      tagIndex: 7,
      x: 0,
      y: 0,
      width: 340,
      prompt: '机甲少女',
      model: 'doubao-seedream-5-0-pro-260628',
      status: 'succeeded',
      progress: 100,
      resultUrl: 'assets/images/c-7/base.png',
    };

    const card42: SpatialCard = {
      id: 'c-42',
      role: 'result',
      type: 'image',
      title: '雨夜街道',
      tagIndex: 42,
      x: 0,
      y: 0,
      width: 340,
      prompt: '雨夜街道',
      model: 'doubao-seedream-5-0-lite-260128',
      status: 'succeeded',
      progress: 100,
      resultUrl: 'assets/images/c-42/base.png',
    };

    const videoCard: SpatialCard = {
      id: 'v-1',
      role: 'generation',
      type: 'video',
      title: '电影镜头',
      tagIndex: 3,
      x: 0,
      y: 0,
      width: 460,
      model: 'doubao-seedance-2-5-260628',
      prompt: '以 @图7 为主角，置身于 @图42 的街景中，少女抬眼望向镜头',
      status: 'idle',
      progress: 0,
      mode: 'all_modal',
      resolution: '720p',
      duration: 5,
      ratio: '16:9',
      generateAudio: true,
      outputFormat: 'mp4',
      references: [
        { cardId: 'c-7', tagIndex: 7, role: 'reference_image', label: '机甲少女' },
        { cardId: 'c-42', tagIndex: 42, role: 'reference_image', label: '雨夜街道' },
      ],
    };

    const payload = compileCardVideoPayload(videoCard, [card7, card42]);

    expect(payload.provider).toBe('ark');
    // Prompt must be renumbered from @图7 -> 图1 and @图42 -> 图2
    expect(payload.prompt).toBe('以 图1 为主角，置身于 图2 的街景中，少女抬眼望向镜头');

    // References must have 1-based sequential tag_index
    expect(payload.reference_assets?.length).toBe(2);
    expect(payload.reference_assets?.[0].tag_index).toBe(1);
    expect(payload.reference_assets?.[0].local_path).toBe('assets/images/c-7/base.png');
    expect(payload.reference_assets?.[0].url).toBeUndefined();

    expect(payload.reference_assets?.[1].tag_index).toBe(2);
    expect(payload.reference_assets?.[1].local_path).toBe('assets/images/c-42/base.png');
    expect(payload.reference_assets?.[1].url).toBeUndefined();
  });

  it('forces ratio to adaptive in first_last_frame mode and assigns roles', () => {
    const card1: SpatialCard = {
      id: 'c-1',
      role: 'result',
      type: 'image',
      title: 'Day',
      tagIndex: 1,
      x: 0,
      y: 0,
      width: 340,
      prompt: 'Day',
      model: 'doubao-seedream-5-0-pro-260628',
      status: 'succeeded',
      progress: 100,
      resultUrl: 'https://example.com/day.png',
    };

    const card2: SpatialCard = {
      id: 'c-2',
      role: 'result',
      type: 'image',
      title: 'Night',
      tagIndex: 2,
      x: 0,
      y: 0,
      width: 340,
      prompt: 'Night',
      model: 'doubao-seedream-5-0-pro-260628',
      status: 'succeeded',
      progress: 100,
      resultUrl: 'https://example.com/night.png',
    };

    const videoCard: SpatialCard = {
      id: 'v-fl',
      role: 'generation',
      type: 'video',
      title: 'Morph',
      tagIndex: 3,
      x: 0,
      y: 0,
      width: 460,
      model: 'doubao-seedance-2-5-260628',
      prompt: 'Smooth transition from @图1 to @图2',
      status: 'idle',
      progress: 0,
      mode: 'first_last_frame',
      ratio: '16:9', // user set 16:9, but first_last_frame forces adaptive
      references: [
        { cardId: 'c-1', tagIndex: 1, role: 'reference_image', label: 'Day' },
        { cardId: 'c-2', tagIndex: 2, role: 'reference_image', label: 'Night' },
      ],
    };

    const payload = compileCardVideoPayload(videoCard, [card1, card2]);

    expect(payload.task_mode).toBe('first_last_frame');
    expect(payload.params?.ratio).toBe('adaptive');
    expect(payload.reference_assets?.[0].role).toBe('first_frame');
    expect(payload.reference_assets?.[1].role).toBe('last_frame');
  });

  it('detects MiniMax provider and sets prompt_optimizer parameter', () => {
    const card1: SpatialCard = {
      id: 'c-1',
      role: 'result',
      type: 'image',
      title: 'Sunset',
      tagIndex: 1,
      x: 0,
      y: 0,
      width: 340,
      prompt: 'Sunset',
      model: 'doubao-seedream-5-0-pro-260628',
      status: 'succeeded',
      progress: 100,
      resultUrl: 'https://example.com/sunset.png',
    };

    const videoCard: SpatialCard = {
      id: 'v-mm',
      role: 'generation',
      type: 'video',
      title: 'MiniMax Video',
      tagIndex: 2,
      x: 0,
      y: 0,
      width: 460,
      model: 'MiniMax-H3',
      prompt: 'Sunset video @图1',
      status: 'idle',
      progress: 0,
      mode: 'all_modal',
      resolution: '2K',
      duration: 6,
      promptOptimizer: true,
      references: [{ cardId: 'c-1', tagIndex: 1, role: 'reference_image', label: 'Sunset' }],
    };

    const payload = compileCardVideoPayload(videoCard, [card1]);

    expect(payload.provider).toBe('minimax');
    expect(payload.params?.resolution).toBe('2K');
    expect(payload.params?.prompt_optimizer).toBe(true);
    expect(payload.params?.generate_audio).toBeUndefined();
  });

  it('strictly enforces maxRefs: 1 on video-01 model, rejecting 2 references', () => {
    const c1: SpatialCard = {
      id: 'c1',
      role: 'result',
      type: 'image',
      title: 'Img1',
      tagIndex: 1,
      x: 0,
      y: 0,
      width: 340,
      prompt: 'Img1',
      model: 'doubao-seedream-5-0-pro-260628',
      status: 'succeeded',
      progress: 100,
      resultUrl: 'assets/images/1.png',
    };
    const c2: SpatialCard = {
      id: 'c2',
      role: 'result',
      type: 'image',
      title: 'Img2',
      tagIndex: 2,
      x: 0,
      y: 0,
      width: 340,
      prompt: 'Img2',
      model: 'doubao-seedream-5-0-pro-260628',
      status: 'succeeded',
      progress: 100,
      resultUrl: 'assets/images/2.png',
    };

    const video01Card: SpatialCard = {
      id: 'v-01',
      role: 'generation',
      type: 'video',
      title: 'Video01 Test',
      tagIndex: 3,
      x: 0,
      y: 0,
      width: 460,
      model: 'video-01',
      prompt: 'Car in rain @图1 @图2',
      status: 'idle',
      progress: 0,
      mode: 'all_modal',
      references: [
        { cardId: 'c1', tagIndex: 1, role: 'reference_image', label: 'Img1' },
        { cardId: 'c2', tagIndex: 2, role: 'reference_image', label: 'Img2' },
      ],
    };

    expect(() => compileCardVideoPayload(video01Card, [c1, c2])).toThrowError(
      /Model video-01 supports at most 1 reference assets, got 2/
    );
  });

  it('preserves seed: 0 correctly without converting to -1', () => {
    const card: SpatialCard = {
      id: 'v-seed',
      role: 'generation',
      type: 'video',
      title: 'Seed 0 Test',
      tagIndex: 1,
      x: 0,
      y: 0,
      width: 460,
      model: 'doubao-seedance-2-5-260628',
      prompt: 'Prompt with seed 0',
      status: 'idle',
      progress: 0,
      mode: 'text_to_video',
      seed: 0, // Explicit seed 0
    };

    const payload = compileCardVideoPayload(card, []);
    expect(payload.params?.seed).toBe(0);
  });

  it('strips dangling @图N mentions in text_to_video mode', () => {
    const card: SpatialCard = {
      id: 'v-t2v',
      role: 'generation',
      type: 'video',
      title: 'T2V Mentions Test',
      tagIndex: 1,
      x: 0,
      y: 0,
      width: 460,
      model: 'doubao-seedance-2-5-260628',
      prompt: 'A drone shot over mountain @图1 in fog @图2',
      status: 'idle',
      progress: 0,
      mode: 'text_to_video',
      references: [
        { cardId: 'c1', tagIndex: 1, role: 'reference_image', label: 'Ref1' },
      ],
    };

    const payload = compileCardVideoPayload(card, []);
    expect(payload.task_mode).toBe('text_to_video');
    expect(payload.reference_assets?.length).toBe(0);
    // Stray @图1 and @图2 must be stripped
    expect(payload.prompt).toBe('A drone shot over mountain in fog');
  });
});

describe('Video provider selection', () => {
  const base = {
    id: 'v1',
    role: 'generation',
    type: 'video',
    title: 't',
    tagIndex: 1,
    x: 0,
    y: 0,
    width: 460,
    prompt: 'a slow dolly shot',
    status: 'idle',
    progress: 0,
    mode: 'text_to_video',
    resolution: '720p',
    duration: 5,
    ratio: '16:9',
  } as const;

  it('uses the provider chosen on the card', () => {
    const payload = compileCardVideoPayload({ ...base, provider: 'minimax', model: 'MiniMax-H3' } as SpatialCard);
    expect(payload.provider).toBe('minimax');
    expect(payload.params).toHaveProperty('prompt_optimizer');
  });

  it('infers the provider for legacy cards without one', () => {
    expect(compileCardVideoPayload({ ...base, model: 'video-01' } as SpatialCard).provider).toBe('minimax');
    expect(compileCardVideoPayload({ ...base, model: 'doubao-seedance-2-5-260628' } as SpatialCard).provider).toBe('ark');
  });
});

describe('APIMart Kling video compilation', () => {
  const imageCard = {
    id: 'img1',
    role: 'result',
    type: 'image',
    title: 'ref',
    tagIndex: 1,
    x: 0,
    y: 0,
    width: 340,
    prompt: '',
    model: 'doubao-seedream-5-0-pro-260628',
    status: 'succeeded',
    progress: 100,
    outputAssets: [
      {
        id: 'a1',
        task_id: 't1',
        asset_index: 0,
        kind: 'image_base',
        z_index: 0,
        local_path: 'images/t1/base.png',
        remote_url: 'https://ark-cdn.example.com/base.png',
      },
    ],
  } as SpatialCard;

  const klingCard = (patch: Partial<SpatialCard>) =>
    ({
      id: 'v1',
      role: 'generation',
      type: 'video',
      title: 't',
      tagIndex: 2,
      x: 0,
      y: 0,
      width: 460,
      prompt: '@图1 转身',
      status: 'idle',
      progress: 0,
      provider: 'apimart',
      resolution: '1080p',
      duration: 5,
      ratio: '16:9',
      ...patch,
    }) as SpatialCard;

  const ref = { cardId: 'img1', tagIndex: 1, role: 'first_frame', label: '图1' } as const;

  it('carries the source image public URL alongside the local path', () => {
    const payload = compileCardVideoPayload(
      klingCard({ model: 'kling-v3', mode: 'first_last_frame', references: [{ ...ref }] }),
      [imageCard]
    );
    expect(payload.provider).toBe('apimart');
    expect(payload.reference_assets?.[0]).toMatchObject({
      local_path: 'assets/images/t1/base.png',
      remote_url: 'https://ark-cdn.example.com/base.png',
      role: 'first_frame',
    });
  });

  it('rejects modes and reference counts the Kling model cannot take', () => {
    expect(() =>
      compileCardVideoPayload(
        klingCard({ model: 'kling-v3', mode: 'all_modal', references: [{ ...ref, role: 'reference_image' }] }),
        [imageCard]
      )
    ).toThrowError(/does not support all_modal/);

    expect(() =>
      compileCardVideoPayload(
        klingCard({
          model: 'kling-3.0-turbo',
          mode: 'first_last_frame',
          references: [{ ...ref }, { ...ref, cardId: 'img1', role: 'last_frame' }],
        }),
        [imageCard]
      )
    ).toThrowError(/at most 1 reference/);
  });

  const clip = {
    id: 'up1',
    role: 'result',
    type: 'upload',
    mediaKind: 'video',
    title: '原视频',
    tagIndex: 1,
    x: 0,
    y: 0,
    width: 340,
    prompt: '',
    model: '',
    status: 'succeeded',
    progress: 100,
    resultUrl: 'assets/uploads/clip.mp4',
    fileUrl: 'https://tos.example/clip.mp4',
  } as SpatialCard;
  const videoRef = { cardId: 'up1', tagIndex: 1, role: 'reference_video', label: '原视频' } as const;

  it('tells Kling Omni what its reference video is for: an edit unless the card says otherwise', () => {
    const omni = klingCard({ model: 'kling-v3-omni', mode: 'all_modal', prompt: '@视频1 换成冬天', references: [{ ...videoRef }] });
    const edit = compileCardVideoPayload(omni, [clip]);
    expect(edit.prompt).toBe('视频1 换成冬天');
    expect(edit.reference_assets?.[0]).toMatchObject({ role: 'reference_video', url: 'https://tos.example/clip.mp4' });
    expect(edit.params).toMatchObject({ video_refer_type: 'base' });

    const feature = compileCardVideoPayload({ ...omni, videoReferType: 'feature' }, [clip]);
    expect(feature.params).toMatchObject({ video_refer_type: 'feature' });
  });

  it('sends no reference-video use without a reference video, or to models that take none', () => {
    const noVideo = compileCardVideoPayload(klingCard({ model: 'kling-v3-omni', mode: 'text_to_video', prompt: '下雪' }), []);
    expect(noVideo.params).not.toHaveProperty('video_refer_type');

    const h3 = compileCardVideoPayload(
      klingCard({ model: 'MiniMax-H3', resolution: '2K', mode: 'all_modal', prompt: '@视频1 换成冬天', references: [{ ...videoRef }] }),
      [clip]
    );
    expect(h3.params).not.toHaveProperty('video_refer_type');
  });
});

describe('references to image result cards', () => {
  const task = (id: string, patch: Partial<BackendTaskResponse> = {}): BackendTaskResponse => ({
    id,
    provider: 'ark',
    provider_task_id: '',
    model: 'm',
    task_type: 'image_generation',
    task_mode: 'single',
    prompt: '',
    params_json: '',
    status: 'queued',
    progress: 0,
    created_at: '',
    updated_at: '',
    ...patch,
  });
  const succeeded = (id: string) =>
    task(id, {
      status: 'succeeded',
      assets: [{ id: `${id}-a0`, task_id: id, asset_index: 0, kind: 'image_base', z_index: 0, local_path: `images/${id}/base.png` }],
    });

  /** Runs the image generation card once more and lets the task finish. */
  const generateImage = (cards: SpatialCard[], taskId: string) =>
    applyTaskToCards(addPendingResult(cards, cards.find((c) => c.id === 'g1')!, task(taskId)), succeeded(taskId));

  const imageGen: SpatialCard = { ...createCard('image', { x: 0, y: 0 }, []), id: 'g1', prompt: '街景' };
  const videoGen: SpatialCard = { ...createCard('video', { x: 0, y: 800 }, []), id: 'v1', prompt: '镜头推进' };

  it('keeps using the chosen image after the image card generates again', () => {
    let cards = generateImage(generateImage([imageGen, videoGen], 'task-1'), 'task-2');
    const first = cards.find((c) => c.taskId === 'task-1')!;

    const link = connectCards(first, videoGen);
    expect(link.ok).toBe(true);
    if (!link.ok) return;
    cards = cards.map((c) => (c.id === 'v1' ? { ...c, ...link.patch } : c));
    cards = generateImage(cards, 'task-3');

    const payload = compileCardVideoPayload(cards.find((c) => c.id === 'v1')!, cards);
    expect(payload.reference_assets).toEqual([
      expect.objectContaining({ card_id: first.id, local_path: 'assets/images/task-1/base.png' }),
    ]);
    expect(payload.prompt).toBe('镜头推进 图1');
  });

  it('refuses to generate from an image result card that is still running', () => {
    const cards = addPendingResult([imageGen, videoGen], imageGen, task('task-1', { status: 'running' }));
    const running = cards.find((c) => c.taskId === 'task-1')!;
    const link = connectCards(running, videoGen);
    if (!link.ok) throw new Error(link.reason);

    expect(() => compileCardVideoPayload({ ...videoGen, ...link.patch }, cards)).toThrowError(/has no output yet/);
  });
});

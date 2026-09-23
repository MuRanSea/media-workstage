import { describe, it, expect } from 'vitest';
import {
  compileCardVideoPayload,
  resolveReferenceAsset,
} from './videoCompiler.ts';
import type { SpatialCard } from '../types/canvas.ts';

describe('Video Task Payload Compiler & Asset Resolution', () => {
  it('normalizes relative /assets/... URL in ReferenceItem to localPath and omits url', () => {
    // When attachReference sets ref.url to "/assets/images/task-1/base.png"
    const resolved = resolveReferenceAsset(
      {
        cardId: 'c-1',
        tagIndex: 1,
        role: 'reference_image',
        label: 'Character',
        url: '/assets/images/task-1/base.png',
      },
      []
    );

    expect(resolved.localPath).toBe('assets/images/task-1/base.png');
    expect(resolved.url).toBeUndefined();
  });

  it('prioritizes localPath alone when source card has both local_path and remote_url', () => {
    const imgCard: SpatialCard = {
      id: 'c-img-7',
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

  it('returns external HTTP/HTTPS URL when only remote URL is provided', () => {
    const resolved = resolveReferenceAsset(
      {
        cardId: 'c-ext',
        tagIndex: 2,
        role: 'reference_image',
        label: 'External',
        url: 'https://cdn.example.com/character.png',
      },
      []
    );

    expect(resolved.url).toBe('https://cdn.example.com/character.png');
    expect(resolved.localPath).toBeUndefined();
  });

  it('rejects ungenerated reference image cards with a clear descriptive error', () => {
    const ungeneratedCard: SpatialCard = {
      id: 'c-img-8',
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
    ).toThrowError(/has not generated any output image yet/);
  });

  it('renumbers arbitrary global tags (@图7, @图42) into sequential cloud tags (图1, 图2)', () => {
    const card7: SpatialCard = {
      id: 'c-7',
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
});

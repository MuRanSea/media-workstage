import { describe, it, expect } from 'vitest';
import {
  compileImageTaskPayload,
  compileCardImagePayload,
} from './compiler.ts';
import type { SpatialCard } from '../types/canvas.ts';

describe('Seedream Image Payload Compiler', () => {
  it('compiles tier preset + aspect ratio to exact mapped pixel dimension', () => {
    const payload = compileImageTaskPayload({
      model: 'doubao-seedream-5-0-pro-260628',
      prompt: 'A cyberpunk warrior',
      sizeMode: 'tier',
      imageTier: '2K',
      imageRatioPreset: '16:9',
      imageFormat: 'jpeg',
      watermark: false,
    });
    expect(payload.provider).toBe('ark');
    expect(payload.task_type).toBe('image_generation');
    expect(payload.task_mode).toBe('single');
    // 2K 16:9 maps to 2816x1584
    expect(payload.params?.size).toBe('2816x1584');
    expect(payload.params?.output_format).toBe('jpeg');
    expect(payload.params?.watermark).toBe(false);
  });

  it('rejects unsupported tier or ratio combinations rather than silently falling back', () => {
    expect(() =>
      compileImageTaskPayload({
        model: 'doubao-seedream-5-0-pro-260628',
        prompt: 'test',
        sizeMode: 'tier',
        imageTier: '10K', // invalid tier
        imageRatioPreset: '16:9',
      })
    ).toThrowError(/Unsupported Seedream size tier/);

    expect(() =>
      compileImageTaskPayload({
        model: 'doubao-seedream-5-0-pro-260628',
        prompt: 'test',
        sizeMode: 'tier',
        imageTier: '3K',
        imageRatioPreset: '3:2', // 3K only maps 1:1, 16:9, 9:16, 4:3, 3:4
      })
    ).toThrowError(/Unsupported tier\/ratio combination/);
  });

  it('compiles and validates explicit custom pixel dimensions', () => {
    const valid = compileImageTaskPayload({
      model: 'doubao-seedream-5-0-pro-260628',
      prompt: 'test',
      sizeMode: 'custom_pixels',
      customPixels: '2048x1024',
    });
    expect(valid.params?.size).toBe('2048x1024');

    expect(() =>
      compileImageTaskPayload({
        model: 'doubao-seedream-5-0-pro-260628',
        prompt: 'test',
        sizeMode: 'custom_pixels',
        customPixels: 'invalid-dimension',
      })
    ).toThrowError(/Invalid custom pixel dimensions/);
  });

  it('compiles layer decomposition mode with size: auto and layer_decomposition: true', () => {
    const layerPayload = compileImageTaskPayload({
      model: 'doubao-seedream-5-0-pro-260628',
      prompt: 'Layered character',
      imageMode: 'layer_decomp',
    });

    expect(layerPayload.task_mode).toBe('layer_decomp');
    expect(layerPayload.params?.size).toBe('auto');
    expect(layerPayload.params?.layer_decomposition).toBe(true);
    expect(layerPayload.params?.sequential_image_generation).toBe('disabled');
  });

  it('compiles sequential storyboard mode with sequential_image_generation: auto', () => {
    const seqPayload = compileImageTaskPayload({
      model: 'doubao-seedream-5-0-lite-260128',
      prompt: 'Story comics',
      imageMode: 'sequential',
      imageTier: '2K',
      imageRatioPreset: '1:1',
    });

    expect(seqPayload.task_mode).toBe('sequential');
    expect(seqPayload.params?.size).toBe('2048x2048');
    expect(seqPayload.params?.sequential_image_generation).toBe('auto');
    expect(seqPayload.params?.layer_decomposition).toBe(false);
  });

  it('compiles directly from a SpatialCard object identically', () => {
    const card: SpatialCard = {
      id: 'c-test',
      type: 'image',
      title: 'Card Test',
      tagIndex: 1,
      x: 0,
      y: 0,
      width: 340,
      model: 'doubao-seedream-5-0-pro-260628',
      prompt: 'Prompt test',
      status: 'idle',
      progress: 0,
      imageTier: '1K',
      imageRatioPreset: '1:1',
    };

    const compiled = compileCardImagePayload(card);
    expect(compiled.params?.size).toBe('1024x1024');
  });
});

describe('Channel Image Payload Compiler', () => {
  it('sends non-Ark channels a provider-neutral ratio + resolution payload', () => {
    const payload = compileImageTaskPayload({
      provider: 'openai',
      model: 'gpt-image-2',
      prompt: 'A red fox',
      imageRatioPreset: '9:16',
      imageResolution: '4K',
      // Seedream-only settings must not leak into other channels
      imageMode: 'layer_decomp',
      sizeMode: 'custom_pixels',
      customPixels: 'not-a-size',
    });
    expect(payload).toEqual({
      provider: 'openai',
      model: 'gpt-image-2',
      task_type: 'image_generation',
      task_mode: 'single',
      prompt: 'A red fox',
      params: { aspect_ratio: '9:16', resolution: '4K' },
    });
  });

  it('keeps cards without a provider on the Seedream path', () => {
    const payload = compileCardImagePayload({
      id: 'c1',
      type: 'image',
      title: 't',
      tagIndex: 1,
      x: 0,
      y: 0,
      width: 340,
      prompt: 'p',
      model: 'doubao-seedream-5-0-pro-260628',
      status: 'idle',
      progress: 0,
      imageTier: '1K',
      imageRatioPreset: '1:1',
    } as SpatialCard);
    expect(payload.provider).toBe('ark');
    expect(payload.params?.size).toBe('1024x1024');
  });
});

describe('Midjourney payload', () => {
  it('sends the ratio and the chosen speed, never a resolution', () => {
    const input = { provider: 'midjourney', model: 'mj_imagine', prompt: 'a fox', imageRatioPreset: '3:2', imageResolution: '4K' as const };
    expect(compileImageTaskPayload(input).params).toEqual({ aspect_ratio: '3:2' });
    expect(compileImageTaskPayload({ ...input, mjSpeed: 'RELAX' }).params).toEqual({ aspect_ratio: '3:2', speed: 'RELAX' });
  });
});

describe('Follow-up action payload', () => {
  it('runs a derived card as an action on its source task', () => {
    const payload = compileCardImagePayload({
      id: 'c2',
      type: 'image',
      title: '图片 7 · U2',
      tagIndex: 8,
      x: 0,
      y: 0,
      width: 340,
      prompt: 'a red fox',
      provider: 'midjourney',
      model: 'mj_imagine',
      status: 'idle',
      progress: 0,
      imageRatioPreset: '16:9',
      derivedFrom: { cardId: 'c1', taskId: 'task-grid', actionId: 'MJ::JOB::upsample::2::h', label: 'U2', operation: 'action' },
    });
    expect(payload).toEqual({
      provider: 'midjourney',
      model: 'mj_imagine',
      task_type: 'image_generation',
      task_mode: 'action',
      prompt: 'a red fox',
      params: { source_task_id: 'task-grid', action_id: 'MJ::JOB::upsample::2::h' },
    });
  });
});

describe('Midjourney reference images', () => {
  it('sends connected images as reference assets', () => {
    const payload = compileCardImagePayload({
      id: 'm1',
      type: 'image',
      title: '图片 9',
      tagIndex: 9,
      x: 0,
      y: 0,
      width: 340,
      prompt: 'a fox',
      provider: 'midjourney',
      model: 'mj_imagine',
      status: 'idle',
      progress: 0,
      imageRatioPreset: '1:1',
      references: [{ cardId: 'i1', tagIndex: 3, role: 'reference_image', label: '街景', url: '/assets/images/t/base.png' }],
    });
    expect(payload.prompt).toBe('a fox');
    expect(payload.params).toEqual({ aspect_ratio: '1:1' });
    expect(payload.reference_assets).toEqual([
      { card_id: 'i1', tag_index: 1, role: 'reference_image', label: '街景', url: undefined, local_path: 'assets/images/t/base.png', remote_url: undefined },
    ]);
  });
});

describe('Midjourney blend', () => {
  const ref = (n: number) => ({ cardId: `i${n}`, tagIndex: n, role: 'reference_image' as const, label: `图${n}`, url: `/assets/images/t${n}/base.png` });
  const blendCard = (refs: number): SpatialCard => ({
    id: 'm1',
    type: 'image',
    title: '图片 9',
    tagIndex: 9,
    x: 0,
    y: 0,
    width: 340,
    prompt: '',
    provider: 'midjourney',
    model: 'mj_imagine',
    status: 'idle',
    progress: 0,
    imageRatioPreset: '2:3',
    mjSpeed: 'FAST',
    mjOperation: 'blend',
    references: Array.from({ length: refs }, (_, i) => ref(i + 1)),
  });

  it('mixes the connected images, with no prompt needed', () => {
    const payload = compileCardImagePayload(blendCard(3));
    expect(payload.task_mode).toBe('blend');
    expect(payload.prompt).toBe('Blend');
    expect(payload.params).toEqual({ aspect_ratio: '2:3', speed: 'FAST' });
    expect(payload.reference_assets).toHaveLength(3);
  });

  it('needs two to five images', () => {
    expect(() => compileCardImagePayload(blendCard(1))).toThrow('2–5 张');
  });
});

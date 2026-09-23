import { describe, it, expect } from 'vitest';
import { connectCards, effectivePrompt, withEffectivePrompt } from './connections.ts';
import { buildProviderGroups } from './channelModels.ts';
import type { SpatialCard } from '../types/canvas.ts';
import type { ProviderConfigItem } from '../services/api.ts';

const card = (p: Partial<SpatialCard> & Pick<SpatialCard, 'id' | 'type'>): SpatialCard => ({
  title: p.id,
  tagIndex: 1,
  x: 0,
  y: 0,
  width: 340,
  prompt: '',
  model: '',
  status: 'idle',
  progress: 0,
  ...p,
});

const text = card({ id: 't1', type: 'text', title: '提示词助手', textOutput: '雨夜霓虹街道，电影感' });
const img = card({ id: 'i1', type: 'image', tagIndex: 3, title: '街景', provider: 'ark', model: 'doubao-seedream-5-0-pro-260628' });
const video = (patch: Partial<SpatialCard> = {}) =>
  card({ id: 'v1', type: 'video', provider: 'ark', model: 'doubao-seedance-2-5-260628', prompt: '镜头推进', mode: 'all_modal', ...patch });

describe('connectCards', () => {
  it('links a text card as the prompt source of image and video cards', () => {
    expect(connectCards(text, img)).toEqual({ ok: true, patch: { promptSourceId: 't1' } });
    expect(connectCards(text, video())).toEqual({ ok: true, patch: { promptSourceId: 't1' } });
  });

  it('adds an image as a video reference and tags the prompt', () => {
    const res = connectCards(img, video());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.patch.references).toEqual([
      { cardId: 'i1', tagIndex: 3, role: 'reference_image', label: '街景', url: undefined },
    ]);
    expect(res.patch.prompt).toBe('镜头推进 @图3');
  });

  it('switches a text-to-video card to a mode that takes images', () => {
    const seedance = connectCards(img, video({ mode: 'text_to_video' }));
    expect(seedance.ok && seedance.patch.mode).toBe('all_modal');

    // Kling v3 on APIMart has no multi-reference mode: the image becomes the first frame.
    const kling = connectCards(img, video({ provider: 'apimart', model: 'kling-v3', mode: 'text_to_video' }));
    expect(kling.ok && kling.patch.mode).toBe('first_last_frame');
    expect(kling.ok && kling.patch.references?.[0].role).toBe('first_frame');
    expect(kling.ok && kling.patch.ratio).toBe('adaptive');
  });

  it('refuses connections that have no meaning, with a reason', () => {
    const full = video({
      provider: 'apimart',
      model: 'kling-3.0-turbo',
      mode: 'first_last_frame',
      references: [{ cardId: 'x', tagIndex: 9, role: 'first_frame', label: 'x' }],
    });
    for (const [src, tgt, reason] of [
      [img, { ...img, id: 'i2' }, '图片卡片之间'],
      [text, { ...text, id: 't2' }, '文本卡片之间'],
      [img, img, '不能连接到自己'],
      [img, text, '没有输入端口'],
      [video(), img, '没有输出端口'],
      [img, full, '最多 1 张'],
      [text, { ...img, promptSourceId: 't1' }, '已经连接'],
    ] as const) {
      const res = connectCards(src, tgt);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toContain(reason);
    }
  });
});

describe('linked prompts', () => {
  it('uses the text card output once it exists', () => {
    const linked = { ...img, prompt: '旧提示词', promptSourceId: 't1' };
    expect(effectivePrompt(linked, [text, linked])).toBe('雨夜霓虹街道，电影感');
    expect(withEffectivePrompt(linked, [text, linked]).prompt).toBe('雨夜霓虹街道，电影感');
  });

  it('refuses to generate from a text card that has no output yet', () => {
    const empty = { ...text, textOutput: '' };
    const linked = { ...img, promptSourceId: 't1' };
    expect(() => withEffectivePrompt(linked, [empty, linked])).toThrowError(/还没有生成内容/);
  });

  it('drops a link whose text card was deleted', () => {
    const linked = { ...img, prompt: '保留', promptSourceId: 'gone' };
    expect(withEffectivePrompt(linked, [linked])).toMatchObject({ prompt: '保留', promptSourceId: undefined });
  });
});

describe('text model options', () => {
  const ch = (p: Partial<ProviderConfigItem> & Pick<ProviderConfigItem, 'id'>): ProviderConfigItem => ({
    name: p.id,
    base_url: '',
    is_configured: false,
    models: [],
    can_list_models: false,
    ...p,
  });

  it('lists bound chat models of configured channels only', () => {
    const groups = buildProviderGroups(
      [
        ch({ id: 'ark', models: [{ id: 'doubao-seed-1-6', type: 'chat' }] }),
        ch({ id: 'apimart', is_configured: true, models: [{ id: 'gpt-5', type: 'chat' }, { id: 'seedream-5-0-pro', type: 'image' }] }),
        ch({ id: 'kling', is_configured: true, models: [{ id: 'kling-v3', type: 'image' }] }),
      ],
      'text'
    );
    expect(groups.map((g) => [g.provider, g.options.map((o) => o.id), g.ready])).toEqual([
      ['apimart', ['gpt-5'], true],
    ]);
  });
});

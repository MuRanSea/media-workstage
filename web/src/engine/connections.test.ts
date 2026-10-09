import { describe, it, expect } from 'vitest';
import { connectCards, effectivePrompt, hasInputPort, hasOutputPort, removeCards, withEffectivePrompt } from './connections.ts';
import { buildProviderGroups } from './channelModels.ts';
import type { SpatialCard } from '../types/canvas.ts';
import type { ProviderConfigItem } from '../services/api.ts';
import { protocolOf } from './providers.ts';

const card = (p: Partial<SpatialCard> & Pick<SpatialCard, 'id' | 'type' | 'role'>): SpatialCard => ({
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

const text = card({ id: 't1', type: 'text', role: 'result', title: '提示词助手', textOutput: '雨夜霓虹街道，电影感' });
const img = card({ id: 'i1', type: 'image', role: 'result', tagIndex: 3, title: '街景', provider: 'ark', model: 'doubao-seedream-5-0-pro-260628' });
const video = (patch: Partial<SpatialCard> = {}) =>
  card({ id: 'v1', type: 'video', role: 'generation', provider: 'ark', model: 'doubao-seedance-2-5-260628', prompt: '镜头推进', mode: 'all_modal', ...patch });

describe('connectCards', () => {
  it('links a text card as the prompt source of image and video cards', () => {
    expect(connectCards(text, { ...img, role: 'generation' })).toEqual({ ok: true, patch: { promptSourceId: 't1' } });
    expect(connectCards(text, video())).toEqual({ ok: true, patch: { promptSourceId: 't1' } });
  });

  it('adds an image as a video reference and tags the prompt', () => {
    const res = connectCards(img, video());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.patch.references).toEqual([
      { cardId: 'i1', tagIndex: 3, role: 'reference_image', label: '街景' },
    ]);
    expect(res.patch.prompt).toBe('镜头推进 @图3');
  });

  it('tags the prompt even when it already mentions a longer number with the same start', () => {
    const res = connectCards(img, video({ prompt: '参考 @图31 的光线' }));
    expect(res.ok && res.patch.prompt).toBe('参考 @图31 的光线 @图3');
    const kept = connectCards(img, video({ prompt: '以 @图3 为主体' }));
    expect(kept.ok && kept.patch.prompt).toBe('以 @图3 为主体');
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
      [img, { ...img, id: 'i2', role: 'generation' }, '只有 Midjourney 图片卡片'],
      [text, { ...text, id: 't2', role: 'generation' }, '文本卡片之间'],
      [img, img, '不能连接到自己'],
      [img, text, '没有输入端口'],
      [video(), img, '没有输出端口'],
      [img, full, '最多 1 张'],
      [text, { ...img, role: 'generation', promptSourceId: 't1' }, '已经连接'],
    ] as const) {
      const res = connectCards(src, tgt);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toContain(reason);
    }
  });
});

describe('generation and result card ports', () => {
  const genImg = card({ id: 'g1', type: 'image', role: 'generation', tagIndex: undefined });
  const resultImg = card({ id: 'r1', type: 'image', role: 'result', sourceId: 'g1', tagIndex: 4, resultUrl: '/assets/r.png' });

  it('gives image result cards an output port and no input port', () => {
    expect(hasOutputPort(resultImg)).toBe(true);
    expect(hasInputPort(resultImg)).toBe(false);
  });

  it('gives image generation cards an input port and no output port', () => {
    expect(hasOutputPort(genImg)).toBe(false);
    expect(hasInputPort(genImg)).toBe(true);
  });

  it('references an image result card from a video card by its tag', () => {
    const res = connectCards(resultImg, video());
    expect(res.ok && res.patch.references?.[0]).toMatchObject({ cardId: 'r1', tagIndex: 4 });
  });

  it('refuses to connect from a generation card or into a result card', () => {
    for (const [src, tgt, reason] of [
      [genImg, video(), '没有输出端口'],
      [text, resultImg, '没有输入端口'],
    ] as const) {
      const res = connectCards(src, tgt);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toContain(reason);
    }
  });
});

describe('connecting result cards', () => {
  const genImg = card({ id: 'gi', type: 'image', role: 'generation', tagIndex: undefined });
  const genVideo = video({ id: 'gv', role: 'generation', tagIndex: undefined });
  const genText = card({ id: 'gt', type: 'text', role: 'generation', tagIndex: undefined });
  const imgResult = card({ id: 'ri', type: 'image', role: 'result', sourceId: 'gi', tagIndex: 5, title: '第一张', resultUrl: 'assets/images/t1/base.png' });
  const textResult = card({ id: 'rt', type: 'text', role: 'result', sourceId: 'gt', tagIndex: undefined, textOutput: '雨夜' });
  const videoResult = video({ id: 'rv', role: 'result', sourceId: 'gv', tagIndex: undefined });

  it('makes a text result card the prompt source of image and video generation cards', () => {
    expect(connectCards(textResult, genImg)).toEqual({ ok: true, patch: { promptSourceId: 'rt' } });
    expect(connectCards(textResult, genVideo)).toEqual({ ok: true, patch: { promptSourceId: 'rt' } });
  });

  it('makes an image result card a reference of a video generation card, without saving its address', () => {
    const res = connectCards(imgResult, genVideo);
    expect(res.ok && res.patch.references).toEqual([
      { cardId: 'ri', tagIndex: 5, role: 'reference_image', label: '第一张' },
    ]);
    expect(res.ok && res.patch.prompt).toBe('镜头推进 @图5');
  });

  it('refuses every other pairing, and repeats, with a reason', () => {
    const cases: [SpatialCard, SpatialCard, string][] = [
      [imgResult, genImg, '只有 Midjourney 图片卡片'],
      [imgResult, genText, '没有输入端口'],
      [textResult, genText, '文本卡片之间'],
      [videoResult, genImg, '视频只能连接到视频卡片'],
      [videoResult, genVideo, '没有 @视频 编号'],
      [genImg, genVideo, '没有输出端口'],
      [genText, genImg, '没有输出端口'],
      [textResult, imgResult, '没有输入端口'],
      [imgResult, videoResult, '没有输入端口'],
      [textResult, { ...genImg, promptSourceId: 'rt' }, '已经连接'],
      [imgResult, { ...genVideo, references: [{ cardId: 'ri', tagIndex: 5, role: 'reference_image', label: '' }] }, '已经连接'],
    ];
    for (const [src, tgt, reason] of cases) {
      const res = connectCards(src, tgt);
      expect(res.ok, `${src.id} → ${tgt.id}`).toBe(false);
      if (!res.ok) expect(res.reason).toContain(reason);
    }
  });

  it('gives every result card an output port, and only image and video generation cards an input port', () => {
    const ports = [genImg, genVideo, genText, imgResult, textResult, videoResult].map((c) => [c.id, hasOutputPort(c), hasInputPort(c)]);
    expect(ports).toEqual([
      ['gi', false, true],
      ['gv', false, true],
      ['gt', false, false],
      ['ri', true, false],
      ['rt', true, false],
      ['rv', true, false],
    ]);
  });

  it('generates with the text of the linked text result card', () => {
    const linked = { ...genImg, prompt: '旧提示词', promptSourceId: 'rt' };
    expect(withEffectivePrompt(linked, [textResult, linked]).prompt).toBe('雨夜');
  });

  it('refuses to generate while the linked text result card is empty or still running', () => {
    const linked = { ...genVideo, prompt: '旧提示词', promptSourceId: 'rt' };
    const empty = { ...textResult, textOutput: '  ' };
    const running = { ...textResult, status: 'running' as const };
    expect(() => withEffectivePrompt(linked, [empty, linked])).toThrowError(/还没有生成内容/);
    expect(() => withEffectivePrompt(linked, [running, linked])).toThrowError(/还在生成中/);
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
    protocol: protocolOf(p.id)!,
    preset: true,
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

describe('removeCards', () => {
  it('clears the prompt sources and references that pointed at deleted result cards', () => {
    const imgResult = card({ id: 'ri', type: 'image', role: 'result', tagIndex: 5 });
    const textResult = card({ id: 'rt', type: 'text', role: 'result', textOutput: '雨夜' });
    const other = card({ id: 'ri2', type: 'image', role: 'result', tagIndex: 6 });
    const linked = video({
      role: 'generation',
      promptSourceId: 'rt',
      references: [
        { cardId: 'ri', tagIndex: 5, role: 'reference_image', label: 'a' },
        { cardId: 'ri2', tagIndex: 6, role: 'reference_image', label: 'b' },
      ],
    });
    const untouched = card({ id: 'x', type: 'image', role: 'generation' });

    const next = removeCards([imgResult, textResult, other, linked, untouched], ['ri', 'rt']);

    expect(next.map((c) => c.id)).toEqual(['ri2', 'v1', 'x']);
    expect(next[1].promptSourceId).toBeUndefined();
    expect(next[1].references?.map((r) => r.cardId)).toEqual(['ri2']);
    expect(next[2]).toEqual(untouched);
  });

  it("takes a deleted reference card's tag out of the prompt, as disconnecting it does", () => {
    const r3 = card({ id: 'r3', type: 'image', role: 'result', tagIndex: 3 });
    const r31 = card({ id: 'r31', type: 'image', role: 'result', tagIndex: 31 });
    const linked = video({
      role: 'generation',
      prompt: '@图3 走进 @图31 的雨夜',
      references: [
        { cardId: 'r3', tagIndex: 3, role: 'reference_image', label: 'a' },
        { cardId: 'r31', tagIndex: 31, role: 'reference_image', label: 'b' },
      ],
    });

    const next = removeCards([r3, r31, linked], ['r3']);

    expect(next[1].prompt).toBe('走进 @图31 的雨夜');
    expect(next[1].references?.map((r) => r.cardId)).toEqual(['r31']);
  });

  it('deleting a linked result card leaves its generation card and sibling results untouched', () => {
    const g = card({ id: 'g', type: 'image', role: 'generation', tagIndex: undefined });
    const r1 = card({ id: 'r1', type: 'image', role: 'result', sourceId: 'g', tagIndex: 1 });
    const r2 = card({ id: 'r2', type: 'image', role: 'result', sourceId: 'g', tagIndex: 2 });
    const linked = video({ role: 'generation', references: [{ cardId: 'r1', tagIndex: 1, role: 'reference_image', label: 'a' }] });

    const next = removeCards([g, r1, r2, linked], ['r1']);

    expect(next.slice(0, 2)).toEqual([g, r2]);
    expect(next[2].references).toEqual([]);
  });

  it('keeps the results of a deleted generation card as standalone result cards', () => {
    const g = card({ id: 'g', type: 'image', role: 'generation', tagIndex: undefined });
    const r1 = card({ id: 'r1', type: 'image', role: 'result', sourceId: 'g', taskId: 't1', status: 'succeeded' });
    const r2 = card({ id: 'r2', type: 'image', role: 'result', sourceId: 'g', taskId: 't2', status: 'running' });
    const other = card({ id: 'r3', type: 'image', role: 'result', sourceId: 'g2' });

    const next = removeCards([g, r1, r2, other], ['g']);

    expect(next.map((c) => c.id)).toEqual(['r1', 'r2', 'r3']);
    expect(next[0]).toEqual({ ...r1, sourceId: undefined });
    // A running placeholder keeps its task, so its result still arrives.
    expect(next[1]).toEqual({ ...r2, sourceId: undefined });
    expect(next[2]).toBe(other);
  });
});

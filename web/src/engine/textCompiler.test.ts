import { describe, expect, it } from 'vitest';
import type { SpatialCard } from '../types/canvas.ts';
import { compileTextPayload } from './textCompiler.ts';

const card = (p: Partial<SpatialCard> & Pick<SpatialCard, 'id' | 'type' | 'role'>): SpatialCard => ({
  title: p.id,
  x: 0,
  y: 0,
  width: 340,
  prompt: '',
  model: '',
  status: 'idle',
  progress: 0,
  ...p,
});

const street = card({ id: 'i5', type: 'image', role: 'result', tagIndex: 5, title: '街景', resultUrl: '/assets/images/a/base.png' });
const portrait = card({ id: 'i2', type: 'image', role: 'result', tagIndex: 2, title: '人像', resultUrl: 'https://cdn.example.com/p.jpg' });
const gen = card({
  id: 'gt',
  type: 'text',
  role: 'generation',
  provider: 'openai',
  model: 'gpt-5',
  prompt: '把 @图5 的场景和 @图2 的人物写成一个视频提示词',
  references: [
    { cardId: 'i5', tagIndex: 5, role: 'reference_image', label: '街景' },
    { cardId: 'i2', tagIndex: 2, role: 'reference_image', label: '人像' },
  ],
});

describe('compileTextPayload', () => {
  it('sends connected images in order and names them by position in the prompt', () => {
    const payload = compileTextPayload(gen, [gen, street, portrait]);
    expect(payload.prompt).toBe('把 图1 的场景和 图2 的人物写成一个视频提示词');
    expect(payload.images).toEqual([
      { card_id: 'i5', tag_index: 1, role: 'reference_image', label: '街景', url: undefined, local_path: 'assets/images/a/base.png' },
      { card_id: 'i2', tag_index: 2, role: 'reference_image', label: '人像', url: 'https://cdn.example.com/p.jpg', local_path: undefined },
    ]);
    expect(payload.system).toBeTruthy();
  });

  it('sends no images field for a text-only card', () => {
    const payload = compileTextPayload({ ...gen, references: [], prompt: '雨夜街道' }, [gen]);
    expect(payload).not.toHaveProperty('images');
    expect(payload.prompt).toBe('雨夜街道');
  });

  it('takes the prompt from a linked text card', () => {
    const idea = card({ id: 'rt', type: 'text', role: 'result', textOutput: '赛博朋克雨夜' });
    const linked = { ...gen, references: [], prompt: '', promptSourceId: 'rt' };
    expect(compileTextPayload(linked, [linked, idea]).prompt).toBe('赛博朋克雨夜');
  });

  it('says what is missing instead of sending', () => {
    expect(() => compileTextPayload({ ...gen, model: '' }, [gen])).toThrow('请先选择服务商和模型');
    expect(() => compileTextPayload({ ...gen, references: [], prompt: '  ' }, [gen])).toThrow('请先填写想法');
  });
});

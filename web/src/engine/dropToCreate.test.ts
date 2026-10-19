import { describe, expect, it } from 'vitest';
import type { SpatialCard } from '../types/canvas.ts';
import { dropOptions } from './dropToCreate.ts';

const card = (p: Partial<SpatialCard> & Pick<SpatialCard, 'id' | 'type' | 'role'>): SpatialCard => ({
  title: p.id,
  tagIndex: 1,
  x: 0,
  y: 0,
  width: 340,
  prompt: '',
  model: '',
  status: 'succeeded',
  progress: 100,
  ...p,
});

const at = { x: 1000, y: 500 };

describe('dropOptions', () => {
  it('offers every generation card a text result can prompt', () => {
    const text = card({ id: 't1', type: 'text', role: 'result', textOutput: '雨夜' });
    const out = dropOptions(text, at, [text]);
    expect(out.map((o) => [o.type, o.role])).toEqual([
      ['text', 'prompt'],
      ['image', 'prompt'],
      ['video', 'prompt'],
      ['3d', 'prompt'],
    ]);
    for (const o of out) {
      expect(o.card.role).toBe('generation');
      expect(o.card.promptSourceId).toBe('t1');
    }
  });

  it('offers a text card (reads the image), a Seedream image card, a video card and a 3D card (reference) for an image result', () => {
    const img = card({ id: 'i1', type: 'image', role: 'result', tagIndex: 3, provider: 'ark', model: 'doubao-seedream-5-0-pro-260628' });
    const out = dropOptions(img, at, [img]);
    expect(out.map((o) => [o.type, o.role])).toEqual([
      ['text', 'read_image'],
      ['image', 'reference_image'],
      ['video', 'reference_image'],
      ['3d', 'reference_image'],
    ]);
    const video = out.find((o) => o.type === 'video')!.card;
    expect(video.references?.[0]).toMatchObject({ cardId: 'i1', tagIndex: 3 });
    expect(video.prompt).toContain('@图3');
    // A 3D card takes it as the main image and does not tag its prompt.
    const model = out.find((o) => o.type === '3d')!.card;
    expect(model.references?.[0]).toMatchObject({ cardId: 'i1', view: 'reference' });
    expect(model.prompt).toBe('');
  });

  it('offers only a video card for a video result', () => {
    const vid = card({ id: 'v1', type: 'video', role: 'result', tagIndex: 4, provider: 'ark', model: 'doubao-seedance-2-5-260628' });
    expect(dropOptions(vid, at, [vid]).map((o) => [o.type, o.role])).toEqual([['video', 'reference_video']]);
  });

  it('offers nothing for a generation card, which has no output', () => {
    const gen = card({ id: 'g1', type: 'image', role: 'generation' });
    expect(dropOptions(gen, at, [gen])).toEqual([]);
  });

  it('places the new card at the drop point, clear of cards already there', () => {
    const text = card({ id: 't1', type: 'text', role: 'result' });
    const [first] = dropOptions(text, at, [text]);
    expect(first.card.x).toBe(1000);
    expect(first.card.y).toBe(460);
    const blocker = { ...first.card, id: 'blocker' };
    const [moved] = dropOptions(text, at, [text, blocker]);
    expect(moved.card.x !== 1000 || moved.card.y !== 460).toBe(true);
  });
});

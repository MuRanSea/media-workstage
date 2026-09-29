import { describe, it, expect } from 'vitest';
import { createCard, duplicateCards, nextTagIndex, placeCard } from './cardFactory.ts';
import { mergeTaskState } from './useHistory.ts';
import { addPendingResult } from './resultCards.ts';
import type { SpatialCard } from '../types/canvas.ts';

describe('createCard', () => {
  it('centres the card on the point with an empty prompt and the next tag', () => {
    const existing = [createCard('text', { x: 0, y: 0 }, [])];
    const card = createCard('text', { x: 1000, y: 500 }, existing);
    expect(card.x).toBe(1000 - 170);
    expect(card.y).toBe(500 - 120);
    expect(card.prompt).toBe('');
    expect(card.tagIndex).toBe(2);
    expect(card.title).toBe('提示词助手 2');
  });

  it('numbers video generation cards by their own count, without a tag', () => {
    const existing = [createCard('image', { x: 0, y: 0 }, []), createCard('video', { x: 0, y: 0 }, [])];
    const card = createCard('video', { x: 0, y: 0 }, existing);
    expect(card.role).toBe('generation');
    expect(card.tagIndex).toBeUndefined();
    expect(card.title).toBe('视频 2');
  });

  it('numbers image generation cards by their own count, without a tag', () => {
    const existing = [createCard('video', { x: 0, y: 0 }, []), createCard('image', { x: 0, y: 0 }, [])];
    const card = createCard('image', { x: 0, y: 0 }, existing);
    expect(card.tagIndex).toBeUndefined();
    expect(card.title).toBe('图片 2');
  });

  it('cascades when a card already sits at the spot', () => {
    const first = createCard('image', { x: 500, y: 500 }, []);
    const second = placeCard({ x: 500, y: 500 }, 340, [first]);
    expect(second).toEqual({ x: first.x + 32, y: first.y + 32 });
  });
});

describe('duplicateCards', () => {
  const img = { ...createCard('image', { x: 170, y: 120 }, []), id: 'img', tagIndex: 1, x: 0, y: 0, resultUrl: '/assets/x.png', status: 'succeeded' as const };
  const vid: SpatialCard = {
    ...createCard('video', { x: 0, y: 0 }, [img]),
    id: 'vid',
    tagIndex: 2,
    x: 400,
    y: 0,
    prompt: '以 @图1 为首帧',
    references: [{ cardId: 'img', tagIndex: 1, role: 'reference_image', label: 'a' }],
  };

  it('remaps ids, tags and internal links', () => {
    const copies = duplicateCards([img, vid], { x: 1000, y: 1000 }, [img, vid]);
    const [ci, cv] = copies;
    expect(ci.id).not.toBe('img');
    expect(ci.tagIndex).toBe(3);
    expect(ci.title).toBe('图片 3');
    expect(cv.tagIndex).toBe(4);
    expect(cv.x - ci.x).toBe(400);
    expect(ci.x).toBe(1000);
    expect(cv.references).toEqual([{ cardId: ci.id, tagIndex: 3, role: 'reference_image', label: 'a' }]);
    expect(cv.prompt).toBe('以 @图3 为首帧');
    expect(nextTagIndex([img, vid, ...copies])).toBe(5);
  });

  it('marks copies of custom-titled cards', () => {
    const [c] = duplicateCards([{ ...img, title: '主角' }], { x: 0, y: 0 }, [img]);
    expect(c.title).toBe('主角 副本');
  });

  it('drops links to cards that were not copied', () => {
    const [cv] = duplicateCards([vid], { x: 0, y: 0 }, [img, vid]);
    expect(cv.references).toEqual([]);
    expect(cv.prompt).toBe('以 @图1 为首帧');
  });

  it('copies finished result cards without their task, and skips running ones', () => {
    const done: SpatialCard = { ...img, id: 'r1', role: 'result', sourceId: 'gone', taskId: 't1', status: 'succeeded' };
    const running: SpatialCard = { ...done, id: 'r2', taskId: 't2', status: 'running' };
    const copies = duplicateCards([done, running], { x: 0, y: 0 }, [done, running]);
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({ role: 'result', resultUrl: '/assets/x.png' });
    expect(copies[0].taskId).toBeUndefined();
    expect(copies[0].sourceId).toBeUndefined();
  });

  it('can drop task results', () => {
    const [ci] = duplicateCards([img], { x: 0, y: 0 }, [img], false);
    expect(ci.status).toBe('idle');
    expect(ci.resultUrl).toBeUndefined();
  });
});

describe('mergeTaskState', () => {
  it('keeps task results that arrived after the snapshot', () => {
    const before = [{ ...createCard('image', { x: 0, y: 0 }, []), id: 'a', prompt: 'old' }];
    const now = [{ ...before[0], prompt: 'new', status: 'succeeded' as const, resultUrl: '/assets/r.png', progress: 100 }];
    const [restored] = mergeTaskState(before, now);
    expect(restored.prompt).toBe('old');
    expect(restored.status).toBe('succeeded');
    expect(restored.resultUrl).toBe('/assets/r.png');
  });

  it('keeps result cards that tasks added after the snapshot', () => {
    const g = { ...createCard('image', { x: 0, y: 0 }, []), id: 'g' };
    const now = addPendingResult([{ ...g, prompt: 'new' }], g, {
      id: 'task-1', provider: 'ark', provider_task_id: '', model: 'm', task_type: 'image_generation', task_mode: 'single',
      prompt: '', params_json: '', status: 'queued', progress: 0, created_at: '', updated_at: '',
    });
    const restored = mergeTaskState([{ ...g, prompt: 'old' }], now, true);
    expect(restored.map((c) => c.id)).toEqual(['g', 'result-task-1']);
    expect(restored[0].prompt).toBe('old');
    // A pasted copy of a result is a user edit, so undo removes it.
    const pasted = { ...now[1], id: 'copy' };
    expect(mergeTaskState([g], [g, pasted], true).map((c) => c.id)).toEqual(['g']);
    // Redoing a delete of a result card removes it again.
    expect(mergeTaskState([g], now).map((c) => c.id)).toEqual(['g']);
  });

  it('restores deleted cards as they were', () => {
    const before = [{ ...createCard('text', { x: 0, y: 0 }, []), id: 'gone' }];
    expect(mergeTaskState(before, [])).toEqual(before);
  });
});

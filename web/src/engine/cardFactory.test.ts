import { describe, it, expect } from 'vitest';
import { createCard, duplicateCards, nextTagIndex, placeCard, removeCards } from './cardFactory.ts';
import { mergeTaskState } from './useHistory.ts';
import type { SpatialCard } from '../types/canvas.ts';

describe('createCard', () => {
  it('centres the card on the point with an empty prompt and the next tag', () => {
    const existing = [createCard('image', { x: 0, y: 0 }, [])];
    const card = createCard('video', { x: 1000, y: 500 }, existing);
    expect(card.x).toBe(1000 - 230);
    expect(card.y).toBe(500 - 120);
    expect(card.prompt).toBe('');
    expect(card.tagIndex).toBe(2);
    expect(card.title).toBe('视频 2');
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

  it('can drop task results', () => {
    const [ci] = duplicateCards([img], { x: 0, y: 0 }, [img], false);
    expect(ci.status).toBe('idle');
    expect(ci.resultUrl).toBeUndefined();
  });

  it('keeps where a derived card came from, but not its result actions when dropping results', () => {
    const derived: SpatialCard = {
      ...img,
      resultActions: [{ id: 'MJ::JOB::upsample::1::h', label: 'U1' }],
      derivedFrom: { cardId: 'grid', taskId: 'task-grid', actionId: 'MJ::JOB::upsample::1::h', label: 'U1', operation: 'action' },
    };
    const [kept] = duplicateCards([derived], { x: 0, y: 0 }, [derived]);
    expect(kept.resultActions).toEqual(derived.resultActions);
    const [fresh] = duplicateCards([derived], { x: 0, y: 0 }, [derived], false);
    expect(fresh.resultActions).toBeUndefined();
    expect(fresh.derivedFrom).toEqual(derived.derivedFrom);
  });

  it('points a copied derived card at the copy of its source when both are copied', () => {
    const derived: SpatialCard = {
      ...img,
      id: 'up',
      tagIndex: 5,
      derivedFrom: { cardId: 'img', taskId: 'task-grid', actionId: 'a', label: 'U1', operation: 'action' },
    };
    const [ci, cd] = duplicateCards([img, derived], { x: 0, y: 0 }, [img, derived]);
    expect(cd.derivedFrom?.cardId).toBe(ci.id);
    expect(cd.derivedFrom?.taskId).toBe('task-grid');
  });

  it("keeps a describe card's image when copied without its source", () => {
    const [copy] = duplicateCards([describe_], { x: 0, y: 0 }, [img, describe_]);
    expect(copy.references).toEqual(describe_.references);
  });
});

const describe_: SpatialCard = {
  ...createCard('text', { x: 0, y: 0 }, []),
  id: 'desc',
  tagIndex: 9,
  provider: 'midjourney',
  model: 'mj_imagine',
  textOutput: '1️⃣ a fox',
  derivedFrom: { cardId: 'img', taskId: 'task-grid', label: '反推', operation: 'describe' },
  references: [{ cardId: 'img', tagIndex: 1, role: 'reference_image', label: 'a', url: '/assets/x.png' }],
};

describe('removeCards', () => {
  it('drops links to removed cards, but a describe card keeps the image it describes', () => {
    const video: SpatialCard = {
      ...createCard('video', { x: 0, y: 0 }, []),
      id: 'vid',
      promptSourceId: 'img',
      references: [{ cardId: 'img', tagIndex: 1, role: 'reference_image', label: 'a' }],
    };
    const img: SpatialCard = { ...createCard('image', { x: 0, y: 0 }, []), id: 'img' };
    const left = removeCards([img, video, describe_], new Set(['img']));
    expect(left.map((c) => c.id)).toEqual(['vid', 'desc']);
    expect(left[0].references).toEqual([]);
    expect(left[0].promptSourceId).toBeUndefined();
    expect(left[1].references).toEqual(describe_.references);
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

  it('keeps result actions, and the text of describe cards, that arrived after the snapshot', () => {
    const actions = [{ id: 'MJ::JOB::upsample::1::h', label: 'U1' }];
    const [grid] = mergeTaskState(
      [{ ...createCard('image', { x: 0, y: 0 }, []), id: 'g', status: 'running' as const }],
      [{ ...createCard('image', { x: 0, y: 0 }, []), id: 'g', status: 'succeeded' as const, resultActions: actions }]
    );
    expect(grid.resultActions).toEqual(actions);

    const [desc] = mergeTaskState([{ ...describe_, textOutput: '' }], [describe_]);
    expect(desc.textOutput).toBe('1️⃣ a fox');
    // A chat card's output is the user's to edit, so undo still restores it.
    const chat = { ...createCard('text', { x: 0, y: 0 }, []), id: 't', textOutput: 'old' };
    expect(mergeTaskState([chat], [{ ...chat, textOutput: 'edited' }])[0].textOutput).toBe('old');
  });

  it('restores deleted cards as they were', () => {
    const before = [{ ...createCard('text', { x: 0, y: 0 }, []), id: 'gone' }];
    expect(mergeTaskState(before, [])).toEqual(before);
  });
});

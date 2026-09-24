import { describe, it, expect } from 'vitest';
import { normalizeViewport, normalizeCards, cardsAwaitingTask, DEFAULT_VIEWPORT } from './projectDoc.ts';
import { applyTaskToCard } from './taskSync.ts';
import { assetStoredPath, assetUrl } from './assetPaths.ts';
import type { SpatialCard } from '../types/canvas.ts';
import type { BackendTaskResponse } from '../services/api.ts';

const card = (patch: Partial<SpatialCard>): SpatialCard => ({
  id: 'c1',
  type: 'image',
  title: 't',
  tagIndex: 1,
  x: 0,
  y: 0,
  width: 300,
  prompt: '',
  model: 'm',
  status: 'idle',
  progress: 0,
  ...patch,
});

const task = (patch: Partial<BackendTaskResponse>): BackendTaskResponse => ({
  id: 'task-1',
  provider: 'ark',
  provider_task_id: '',
  model: 'm',
  task_type: 'image_generation',
  task_mode: 'single',
  prompt: '',
  params_json: '',
  status: 'running',
  progress: 40,
  created_at: '',
  updated_at: '',
  ...patch,
});

describe('project document normalization', () => {
  it('falls back to the default viewport and clamps zoom', () => {
    expect(normalizeViewport(undefined)).toEqual(DEFAULT_VIEWPORT);
    expect(normalizeViewport({ zoom: 100, panX: 5, panY: 'x' })).toEqual({ zoom: 8, panX: 5, panY: DEFAULT_VIEWPORT.panY });
  });

  it('drops non-cards and resets submits that never got a task id', () => {
    const cards = normalizeCards([
      card({ id: 'a', status: 'queued' }),
      card({ id: 'b', status: 'running', taskId: 't' }),
      { nope: true },
      null,
    ]);
    expect(cards.map((c) => [c.id, c.status])).toEqual([
      ['a', 'idle'],
      ['b', 'running'],
    ]);
    expect(normalizeCards({})).toEqual([]);
    expect(normalizeCards([card({ prompt: '输入画面主体与氛围描述...' })])[0].prompt).toBe('');
  });

  it('lists only cards with an unfinished task', () => {
    const cards = [
      card({ id: 'a', taskId: 't1', status: 'running' }),
      card({ id: 'b', taskId: 't2', status: 'succeeded' }),
      card({ id: 'c', status: 'idle' }),
    ];
    expect(cardsAwaitingTask(cards).map((c) => c.id)).toEqual(['a']);
  });
});

describe('applyTaskToCard', () => {
  it('shows the video (or base image) of a succeeded task', () => {
    const next = applyTaskToCard(
      card({ status: 'running' }),
      task({
        status: 'succeeded',
        assets: [
          { id: '1', task_id: 'task-1', asset_index: 0, kind: 'image_frame', z_index: 0, local_path: 'videos/task-1/last.png' },
          { id: '2', task_id: 'task-1', asset_index: 1, kind: 'video', z_index: 0, local_path: 'videos/task-1/output.mp4' },
        ],
      })
    );
    expect(next.status).toBe('succeeded');
    expect(next.progress).toBe(100);
    expect(next.taskId).toBe('task-1');
    expect(next.resultUrl).toBe('/assets/videos/task-1/output.mp4');
  });

  it('records the failure reason', () => {
    const next = applyTaskToCard(card({}), task({ status: 'failed', error_code: 'X' }));
    expect(next).toMatchObject({ status: 'failed', errorMessage: 'X' });
  });

  it('keeps the follow-up actions a succeeded task offers', () => {
    const actions = [{ id: 'MJ::JOB::upsample::1::h', label: 'U1' }];
    const next = applyTaskToCard(card({ status: 'running' }), task({ status: 'succeeded', result_actions: actions }));
    expect(next.resultActions).toEqual(actions);
    // A new result replaces the old buttons, including with none.
    expect(applyTaskToCard(next, task({ status: 'succeeded' })).resultActions).toBeUndefined();
  });

  it("fills a text card with a task's text result", () => {
    const next = applyTaskToCard(
      card({ type: 'text', status: 'running', textOutput: '' }),
      task({ status: 'succeeded', result_text: '1️⃣ a cat --ar 1:1' })
    );
    expect(next.textOutput).toBe('1️⃣ a cat --ar 1:1');
    // Image cards ignore text results.
    expect(applyTaskToCard(card({}), task({ status: 'succeeded', result_text: 'x' })).textOutput).toBeUndefined();
  });

  it('tracks progress while running', () => {
    expect(applyTaskToCard(card({ progress: 5 }), task({}))).toMatchObject({ status: 'running', progress: 40 });
  });
});

describe('asset paths', () => {
  it('stores project-relative paths and resolves them per project', () => {
    const asset = { id: '1', task_id: 't', asset_index: 0, kind: 'image_base' as const, z_index: 0, local_path: 'images/t/base.png' };
    expect(assetStoredPath(asset)).toBe('/assets/images/t/base.png');
    expect(assetStoredPath({ ...asset, local_path: 'assets/images/t/base.png' })).toBe('/assets/images/t/base.png');
    expect(assetStoredPath({ ...asset, local_path: '', remote_url: 'https://x/y.png' })).toBe('https://x/y.png');

    expect(assetUrl('/assets/images/t/base.png', 'p 1')).toBe('/api/projects/p%201/assets/images/t/base.png');
    expect(assetUrl('https://x/y.png', 'p1')).toBe('https://x/y.png');
    expect(assetUrl('/assets/images/t/base.png', null)).toBe('/assets/images/t/base.png');
  });
});

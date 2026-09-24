import { describe, expect, it } from 'vitest';
import type { SpatialCard, ResultActionDto } from '../types/canvas.ts';
import type { ProviderConfigItem } from '../services/api.ts';
import { actionLabel, findDescribeProvider, groupActions, spawnActionCard, spawnDescribeCard } from './derivedCards.ts';

const U1: ResultActionDto = { id: 'MJ::JOB::upsample::1::h', label: 'U1' };
const U2: ResultActionDto = { id: 'MJ::JOB::upsample::2::h', label: 'U2' };
const V1: ResultActionDto = { id: 'MJ::JOB::variation::1::h', label: 'V1' };
const REROLL: ResultActionDto = { id: 'MJ::JOB::reroll::0::h::SOLO', emoji: '🔄' };
const STRONG: ResultActionDto = { id: 'MJ::JOB::high_variation::1::h::SOLO', label: 'Vary (Strong)', emoji: '🪄' };

const grid = (patch: Partial<SpatialCard> = {}): SpatialCard => ({
  id: 'card-grid',
  taskId: 'task-grid',
  type: 'image',
  title: '图片 7',
  tagIndex: 7,
  x: 100,
  y: 200,
  width: 340,
  prompt: 'a red fox',
  provider: 'midjourney',
  model: 'mj_imagine',
  status: 'succeeded',
  progress: 100,
  imageRatioPreset: '16:9',
  resultUrl: '/assets/images/task-grid/base.webp',
  resultActions: [U1, U2, REROLL, V1],
  promptSourceId: 'card-text',
  ...patch,
});

describe('actionLabel', () => {
  it('uses the label, and names the reroll button that only has an emoji', () => {
    expect(actionLabel(U1)).toBe('U1');
    expect(actionLabel(REROLL)).toBe('重绘');
    expect(actionLabel({ id: 'MJ::x', emoji: '⬅️' })).toBe('⬅️');
    expect(actionLabel({ id: 'MJ::x' })).toBe('MJ::x');
  });
});

describe('groupActions', () => {
  it('puts U buttons, V buttons and the rest on separate rows', () => {
    expect(groupActions([U1, REROLL, V1, U2, STRONG])).toEqual({
      upscale: [U1, U2],
      variation: [V1],
      other: [REROLL, STRONG],
    });
  });
});

describe('spawnActionCard', () => {
  it('creates an idle card right of the source that runs the action on the source task', () => {
    const source = grid();
    const card = spawnActionCard(source, U2, [source], 'a red fox, rainy street');
    expect(card).toMatchObject({
      type: 'image',
      title: '图片 7 · U2',
      tagIndex: 8,
      x: source.x + source.width + 80,
      y: source.y,
      width: source.width,
      provider: 'midjourney',
      model: 'mj_imagine',
      prompt: 'a red fox, rainy street',
      imageRatioPreset: '16:9',
      status: 'idle',
      progress: 0,
      derivedFrom: { cardId: 'card-grid', taskId: 'task-grid', actionId: U2.id, label: 'U2', operation: 'action' },
    });
    expect(card.id).not.toBe(source.id);
    // Nothing of the source's result or links is carried over.
    expect(card.taskId).toBeUndefined();
    expect(card.resultUrl).toBeUndefined();
    expect(card.resultActions).toBeUndefined();
    expect(card.promptSourceId).toBeUndefined();
  });

  it('stacks further cards derived from the same source', () => {
    const source = grid();
    const first = spawnActionCard(source, U1, [source], 'p');
    const second = spawnActionCard(source, V1, [source, first], 'p');
    expect(second.tagIndex).toBe(9);
    expect(second.x).toBeGreaterThan(first.x);
    expect(second.y).toBeGreaterThan(first.y);
  });

  it('refuses a source without a finished task', () => {
    expect(() => spawnActionCard(grid({ taskId: undefined }), U1, [], 'p')).toThrow();
  });
});

const provider = (p: Partial<ProviderConfigItem> & Pick<ProviderConfigItem, 'id' | 'protocol'>): ProviderConfigItem => ({
  name: p.id,
  preset: false,
  base_url: 'http://gw',
  is_configured: true,
  models: [{ id: 'mj_imagine', type: 'image' }],
  can_list_models: false,
  ...p,
});

describe('findDescribeProvider', () => {
  it('picks a configured Midjourney provider with an image model', () => {
    expect(
      findDescribeProvider([
        provider({ id: 'openai', protocol: 'openai_compatible' }),
        provider({ id: 'mj-off', protocol: 'midjourney', is_configured: false }),
        provider({ id: 'mj-empty', protocol: 'midjourney', models: [] }),
        provider({ id: 'mj', protocol: 'midjourney', models: [{ id: 'x', type: 'chat' }, { id: 'NIJI_JOURNEY', type: 'image' }] }),
      ])
    ).toEqual({ provider: 'mj', model: 'NIJI_JOURNEY' });
    expect(findDescribeProvider([provider({ id: 'openai', protocol: 'openai_compatible' })])).toBeUndefined();
  });
});

describe('spawnDescribeCard', () => {
  it('creates a text card beside the image that describes it with Midjourney', () => {
    const source = grid({ provider: 'openai', model: 'gpt-image-2', resultActions: undefined });
    const card = spawnDescribeCard(source, { provider: 'mj', model: 'mj_imagine' }, [source]);
    expect(card).toMatchObject({
      type: 'text',
      title: '图片 7 · 反推',
      tagIndex: 8,
      x: source.x + source.width + 80,
      provider: 'mj',
      model: 'mj_imagine',
      prompt: '',
      textOutput: '',
      status: 'idle',
      derivedFrom: { cardId: 'card-grid', taskId: 'task-grid', label: '反推', operation: 'describe' },
      references: [{ cardId: 'card-grid', tagIndex: 7, role: 'reference_image', label: '图片 7', url: '/assets/images/task-grid/base.webp' }],
    });
  });

  it('needs an image result to describe', () => {
    expect(() => spawnDescribeCard(grid({ resultUrl: undefined }), { provider: 'mj', model: 'm' }, [])).toThrow();
  });
});

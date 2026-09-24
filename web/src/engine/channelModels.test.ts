import { describe, it, expect } from 'vitest';
import { buildProviderGroups, findModelOption } from './channelModels.ts';
import type { ProviderConfigItem } from '../services/api.ts';
import { resolveVideoModelDef } from '../types/canvas.ts';
import { protocolOf, providerName } from './providers.ts';

// Preset providers, as GET /api/config lists them.
const channel = (p: Partial<ProviderConfigItem> & Pick<ProviderConfigItem, 'id'>): ProviderConfigItem => ({
  name: providerName(p.id),
  protocol: protocolOf(p.id)!,
  preset: true,
  base_url: '',
  is_configured: false,
  models: [],
  can_list_models: false,
  ...p,
});

const channels: ProviderConfigItem[] = [
  channel({
    id: 'ark',
    models: [
      { id: 'doubao-seedream-5-0-pro-260628', type: 'image' },
      { id: 'doubao-seedance-2-5-260628', type: 'video' },
    ],
  }),
  channel({ id: 'minimax', models: [{ id: 'MiniMax-H3', type: 'video' }] }),
  channel({ id: 'openai', is_configured: true, models: [{ id: 'gpt-image-2', type: 'image' }] }),
  channel({ id: 'google', is_configured: false, models: [{ id: 'gemini-3-pro-image', type: 'image' }] }),
  channel({
    id: 'apimart',
    is_configured: true,
    models: [
      { id: 'seedream-5-0-pro', type: 'image' },
      { id: 'seedance-2.0', type: 'video' },
    ],
  }),
];

describe('buildProviderGroups', () => {
  it('falls back to built-in models before config loads', () => {
    expect(buildProviderGroups([], 'image').map((g) => g.provider)).toEqual(['ark']);
    const video = buildProviderGroups([], 'video');
    expect(video.map((g) => g.provider)).toEqual(['ark', 'minimax']);
    expect(video[1].options.map((o) => o.label)).toEqual(['MiniMax H3', 'MiniMax Video-01']);
  });

  it('offers image providers with bound image models, skipping unconfigured ones', () => {
    const groups = buildProviderGroups(channels, 'image');
    expect(groups.map((g) => [g.provider, g.ready])).toEqual([
      ['ark', true],
      ['openai', true],
      ['apimart', true],
    ]);
    expect(groups[0].options[0].label).toBe('Seedream 5.0 Pro');
    expect(groups[0].name).toBe('火山方舟');
  });

  it('marks video providers without a video adapter as not ready', () => {
    const groups = buildProviderGroups(channels, 'video');
    expect(groups.map((g) => [g.provider, g.ready])).toEqual([
      ['ark', true],
      ['minimax', true],
      ['apimart', false],
    ]);
    expect(findModelOption(groups, 'minimax', 'MiniMax-H3')?.label).toBe('MiniMax H3');
    expect(findModelOption(groups, 'apimart', 'seedance-2.0')?.label).toBe('seedance-2.0');
    expect(findModelOption(groups, 'google', 'gemini-3-pro-image')).toBeUndefined();
  });
});

describe('Midjourney readiness', () => {
  it('runs the bot types as image models, and nothing for text or video', () => {
    const mj = channel({
      id: 'midjourney',
      is_configured: true,
      models: [
        { id: 'MID_JOURNEY', type: 'image' },
        { id: 'NIJI_JOURNEY', type: 'image' },
        { id: 'mj-video', type: 'video' },
        { id: 'mj-chat', type: 'chat' },
      ],
    });
    const image = buildProviderGroups([mj], 'image');
    expect(image.map((g) => [g.provider, g.name, g.ready])).toEqual([['midjourney', 'Midjourney', true]]);
    expect(image[0].options.map((o) => [o.id, o.ready])).toEqual([
      ['MID_JOURNEY', true],
      ['NIJI_JOURNEY', true],
    ]);
    expect(buildProviderGroups([mj], 'video').map((g) => g.ready)).toEqual([false]);
    expect(buildProviderGroups([mj], 'text').map((g) => g.ready)).toEqual([false]);
  });
});

describe('APIMart video readiness', () => {
  it('enables only Kling models on APIMart video', () => {
    const groups = buildProviderGroups(
      [
        channel({
          id: 'apimart',
          is_configured: true,
          models: [
            { id: 'kling-v3', type: 'video' },
            { id: 'kling-v2-5-pro', type: 'video' },
            { id: 'seedance-2.0', type: 'video' },
          ],
        }),
      ],
      'video'
    );
    expect(groups[0].ready).toBe(true);
    expect(groups[0].options.map((o) => [o.id, o.label, o.ready])).toEqual([
      ['kling-v3', 'Kling v3', true],
      ['kling-v2-5-pro', 'kling-v2-5-pro', true],
      ['seedance-2.0', 'seedance-2.0', false],
    ]);
  });

  it('runs MiniMax-H3 through APIMart with its own limits, separate from the MiniMax channel', () => {
    const groups = buildProviderGroups(
      [channel({ id: 'apimart', is_configured: true, models: [{ id: 'MiniMax-H3', type: 'video' }] })],
      'video'
    );
    expect(groups[0].options[0]).toMatchObject({ id: 'MiniMax-H3', label: 'MiniMax H3', ready: true });
    expect(resolveVideoModelDef('apimart', 'MiniMax-H3')).toMatchObject({ resolutions: ['768P', '2K'], maxRefs: 9 });
    expect(resolveVideoModelDef('minimax', 'MiniMax-H3')).toMatchObject({ resolutions: ['720P', '1080P', '2K'], maxRefs: 2 });
  });
});

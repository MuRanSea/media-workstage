import { describe, it, expect } from 'vitest';
import { buildProviderGroups, findModelOption, isModelReady } from './channelModels.ts';
import type { ProviderConfigItem } from '../services/api.ts';
import { maxReferenceVideos, resolveVideoModelDef, takesVideoReferType } from '../types/canvas.ts';
import { protocolOf, providerName, rememberProviders } from './providers.ts';

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
    expect(resolveVideoModelDef('minimax', 'MiniMax-H3')).toMatchObject({ resolutions: ['768P', '2K'], maxRefs: 2 });
  });
});

describe('Anthropic readiness', () => {
  it('runs Claude models on text cards only', () => {
    const anthropic = channel({
      id: 'anthropic',
      is_configured: true,
      models: [{ id: 'claude-sonnet-x', type: 'chat' }],
    });
    const text = buildProviderGroups([anthropic], 'text');
    expect(text.map((g) => [g.provider, g.name, g.ready])).toEqual([['anthropic', 'Anthropic', true]]);
    expect(buildProviderGroups([anthropic], 'image').every((g) => !g.ready)).toBe(true);
  });
});

describe('Heighliner readiness', () => {
  it('runs its chat models on text cards', () => {
    const hl: ProviderConfigItem = {
      id: 'custom-hl',
      name: 'Heighliner',
      protocol: 'heighliner',
      preset: false,
      base_url: 'https://platform.sgt.site',
      is_configured: true,
      models: [
        { id: 'deepseek-flash', type: 'chat' },
        { id: 'hy-3d-express', type: '3d' },
      ],
      can_list_models: true,
    };
    rememberProviders([hl]);
    const text = buildProviderGroups([hl], 'text');
    expect(text.map((g) => [g.provider, g.name, g.ready])).toEqual([['custom-hl', 'Heighliner', true]]);
    expect(text[0].options.map((o) => o.id)).toEqual(['deepseek-flash']);
    expect(isModelReady('text', 'custom-hl', 'deepseek-flash')).toBe(true);
  });
});

describe('Kling native readiness', () => {
  it('runs every Kling model on the kling channel, with limits that follow the family', () => {
    const groups = buildProviderGroups(
      [
        channel({
          id: 'kling',
          is_configured: true,
          models: [
            { id: 'kling-3.0-omni', type: 'video' },
            { id: 'kling-3.0-turbo', type: 'video' },
            { id: 'kling-v3', type: 'image' },
          ],
        }),
      ],
      'video'
    );
    expect(groups[0].ready).toBe(true);
    expect(groups[0].options.map((o) => [o.id, o.ready])).toEqual([
      ['kling-3.0-omni', true],
      ['kling-3.0-turbo', true],
    ]);
    expect(resolveVideoModelDef('kling', 'kling-3.0-omni')).toMatchObject({ protocol: 'kling', maxRefs: 7 });
    expect(resolveVideoModelDef('kling', 'kling-3.0-turbo')).toMatchObject({ protocol: 'kling', supportsAudio: false });
    // The APIMart entry of the same model keeps its own definition.
    expect(resolveVideoModelDef('apimart', 'kling-3.0-turbo').protocol).toBe('apimart');
    // Unlisted models take after their family.
    expect(resolveVideoModelDef('kling', 'kling-3.1-omni')).toMatchObject({ id: 'kling-3.1-omni', maxRefs: 7 });
    expect(resolveVideoModelDef('kling', 'kling-2.5-turbo')).toMatchObject({ id: 'kling-2.5-turbo', supportsAudio: false });
  });

  it('asks what the reference video is for on Omni, on both the kling and APIMart channels', () => {
    expect(takesVideoReferType('kling', 'kling-3.0-omni')).toBe(true);
    expect(takesVideoReferType('kling', 'kling-3.0')).toBe(false);
    expect(maxReferenceVideos('kling', 'kling-3.0-omni')).toBe(1);
    expect(maxReferenceVideos('kling', 'kling-2.6')).toBe(0);
  });
});

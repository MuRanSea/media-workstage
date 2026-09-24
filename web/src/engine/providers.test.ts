import { afterEach, describe, expect, it } from 'vitest';
import type { ProviderConfigItem } from '../services/api.ts';
import { buildProviderGroups, isModelReady } from './channelModels.ts';
import { imageModelPatch, imageSizeSummary } from './cardParams.ts';
import { compileImageTaskPayload } from './compiler.ts';
import { defaultProviderName, isNameTaken, protocolOf, providerName, rememberProviders } from './providers.ts';

const relay: ProviderConfigItem = {
  id: 'custom-7f3a2c',
  name: '中转 A',
  protocol: 'openai_compatible',
  preset: false,
  base_url: 'http://relay/v1',
  is_configured: true,
  models: [
    { id: 'gpt-image-2', type: 'image' },
    { id: 'gpt-5', type: 'chat' },
    { id: 'sora-2', type: 'video' },
  ],
  can_list_models: true,
};

afterEach(() => rememberProviders([]));

describe('protocolOf', () => {
  it('resolves preset providers before config has loaded', () => {
    expect(protocolOf('ark')).toBe('ark');
    expect(protocolOf('openai')).toBe('openai_compatible');
    expect(protocolOf('google')).toBe('gemini');
    expect(protocolOf('custom-7f3a2c')).toBeUndefined();
    expect(providerName('custom-7f3a2c')).toBe('custom-7f3a2c');
  });

  it('resolves other providers once config has loaded', () => {
    rememberProviders([relay]);
    expect(protocolOf('custom-7f3a2c')).toBe('openai_compatible');
    expect(providerName('custom-7f3a2c')).toBe('中转 A');
    expect(protocolOf('ark')).toBe('ark');
  });
});

describe('branching on protocol, not provider ID', () => {
  it('runs a provider by what its protocol supports', () => {
    rememberProviders([relay]);
    expect(isModelReady('image', relay.id, 'gpt-image-2')).toBe(true);
    expect(isModelReady('text', relay.id, 'gpt-5')).toBe(true);
    expect(isModelReady('video', relay.id, 'sora-2')).toBe(false);
    expect(isModelReady('image', 'unknown-provider', 'gpt-image-2')).toBe(false);
  });

  it('groups a provider under its display name', () => {
    rememberProviders([relay]);
    const groups = buildProviderGroups([relay], 'image');
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ provider: relay.id, protocol: 'openai_compatible', name: '中转 A', ready: true });
  });

  it('applies Seedream rules to any Ark-protocol provider and keeps its ID', () => {
    rememberProviders([{ ...relay, id: 'ark-2', name: '方舟 B', protocol: 'ark' }]);
    const payload = compileImageTaskPayload({ provider: 'ark-2', model: 'doubao-seedream-5-0-pro-260628', prompt: 'p' });
    expect(payload.provider).toBe('ark-2');
    expect(payload.params).toHaveProperty('size');

    const patch = imageModelPatch(
      { id: 'c', type: 'image', title: '', tagIndex: 1, x: 0, y: 0, width: 300, prompt: '', model: 'm', status: 'idle', progress: 0 },
      { provider: 'ark-2', protocol: 'ark', id: 'doubao-seedream-5-0-pro-260628', label: '', ready: true }
    );
    expect(patch).toMatchObject({ provider: 'ark-2', imageTier: '2K' });
  });

  it('sends the generic image payload for OpenAI-compatible providers', () => {
    rememberProviders([relay]);
    const payload = compileImageTaskPayload({ provider: relay.id, model: 'gpt-image-2', prompt: 'p', imageRatioPreset: '1:1' });
    expect(payload).toMatchObject({ provider: relay.id, params: { aspect_ratio: '1:1', resolution: '2K' } });
    expect(
      imageSizeSummary({
        id: 'c', type: 'image', title: '', tagIndex: 1, x: 0, y: 0, width: 300, prompt: '',
        provider: relay.id, model: 'gpt-image-2', status: 'idle', progress: 0, imageRatioPreset: '1:1',
      })
    ).toBe('2K · 1:1');
  });
});

describe('provider names', () => {
  const providers = [
    { id: 'openai', name: 'OpenAI' },
    { id: 'custom-1', name: 'OpenAI 兼容' },
    { id: 'custom-2', name: 'OpenAI 兼容 2' },
  ];

  it('compares names trimmed and case-insensitively, ignoring the provider itself', () => {
    expect(isNameTaken(' openai ', providers)).toBe(true);
    expect(isNameTaken('OpenAI', providers, 'openai')).toBe(false);
    expect(isNameTaken('中转 A', providers)).toBe(false);
  });

  it('suggests the first free default name', () => {
    expect(defaultProviderName('OpenAI 兼容', [])).toBe('OpenAI 兼容');
    expect(defaultProviderName('OpenAI 兼容', providers)).toBe('OpenAI 兼容 3');
  });
});

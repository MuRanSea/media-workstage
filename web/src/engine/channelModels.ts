import type { Protocol, ProviderConfigItem, ProviderId } from '../services/api.ts';
import { IMAGE_MODELS, VIDEO_MODELS, isAPIMartVideoModel } from '../types/canvas.ts';
import { protocolOf, providerName } from './providers.ts';

export type MediaKind = 'image' | 'video' | 'text';

/** Protocols whose backend adapter can run every model of each kind (text = LLM chat). */
export const READY_PROTOCOLS: Record<MediaKind, ReadonlySet<Protocol>> = {
  image: new Set<Protocol>(['ark', 'openai_compatible', 'gemini', 'apimart']),
  video: new Set<Protocol>(['ark', 'minimax']),
  text: new Set<Protocol>(['ark', 'minimax', 'openai_compatible', 'gemini', 'apimart']),
};

/** Bound model type each card kind draws from; text cards use chat (LLM) models. */
const MODEL_TYPE: Record<MediaKind, string> = { image: 'image', video: 'video', text: 'chat' };

function readyFor(kind: MediaKind, protocol: Protocol | undefined, modelId: string): boolean {
  if (!protocol) return false;
  if (READY_PROTOCOLS[kind].has(protocol)) return true;
  // APIMart video is limited to Kling and MiniMax-H3 for now.
  return kind === 'video' && protocol === 'apimart' && isAPIMartVideoModel(modelId);
}

/** Whether the backend can run this model on this provider. */
export function isModelReady(kind: MediaKind, provider: ProviderId, modelId: string): boolean {
  return readyFor(kind, protocolOf(provider), modelId);
}

// Preset Ark and MiniMax run against a mock adapter without a key, so they are always offered.
const MOCK_PROTOCOLS: ReadonlySet<Protocol> = new Set<Protocol>(['ark', 'minimax']);

/** Whether a provider generates (mock) media before it has a key. */
export function runsMockedWithoutKey(p: Pick<ProviderConfigItem, 'preset' | 'protocol'>): boolean {
  return p.preset && MOCK_PROTOCOLS.has(p.protocol);
}

export interface ModelOption {
  provider: ProviderId;
  protocol: Protocol;
  id: string;
  /** Friendly name for known built-in models (Seedream / Seedance / MiniMax), else the model ID. */
  label: string;
  tag?: string;
  /** False when the backend cannot run this model yet: listed, but not selectable. */
  ready: boolean;
}

export interface ProviderGroup {
  provider: ProviderId;
  protocol: Protocol;
  name: string;
  options: ModelOption[];
  /** True when at least one of the provider's models can run. */
  ready: boolean;
}

function optionFor(kind: MediaKind, provider: ProviderId, protocol: Protocol, id: string): ModelOption {
  const known =
    kind === 'image'
      ? protocol === 'ark'
        ? IMAGE_MODELS.find((m) => m.id === id)
        : undefined
      : VIDEO_MODELS.find((m) => m.id === id && m.protocol === protocol);
  return { provider, protocol, id, label: known?.name ?? id, tag: known?.tag, ready: readyFor(kind, protocol, id) };
}

function group(kind: MediaKind, provider: ProviderId, protocol: Protocol, name: string, ids: string[]): ProviderGroup {
  const options = ids.map((id) => optionFor(kind, provider, protocol, id));
  return { provider, protocol, name, options, ready: options.some((o) => o.ready) };
}

/**
 * Builds a card's provider → model choices from provider config: every configured
 * provider (plus preset Ark / MiniMax, which run mocked) with bound models of this kind.
 * Before config has loaded, falls back to the built-in models.
 */
export function buildProviderGroups(providers: ProviderConfigItem[], kind: MediaKind): ProviderGroup[] {
  if (providers.length === 0) {
    if (kind === 'text') return [];
    if (kind === 'image') {
      return [group('image', 'ark', 'ark', providerName('ark'), IMAGE_MODELS.map((m) => m.id))];
    }
    return (['ark', 'minimax'] as const).map((p) =>
      group('video', p, p, providerName(p), VIDEO_MODELS.filter((m) => m.protocol === p).map((m) => m.id))
    );
  }

  const groups: ProviderGroup[] = [];
  for (const p of providers) {
    // Mock adapters only generate media; a text card needs a real key.
    if (!p.is_configured && (kind === 'text' || !runsMockedWithoutKey(p))) continue;
    const ids = p.models.filter((m) => m.type === MODEL_TYPE[kind]).map((m) => m.id);
    if (ids.length > 0) groups.push(group(kind, p.id, p.protocol, p.name, ids));
  }
  return groups;
}

/** Finds the option for a card's provider + model, if that provider still offers it. */
export function findModelOption(
  groups: ProviderGroup[],
  provider: ProviderId,
  modelId: string
): ModelOption | undefined {
  return groups.find((g) => g.provider === provider)?.options.find((o) => o.id === modelId);
}

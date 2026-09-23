import type { ChannelId, ProviderConfigItem } from '../services/api.ts';
import { IMAGE_MODELS, VIDEO_MODELS, isAPIMartVideoModel } from '../types/canvas.ts';

export type MediaKind = 'image' | 'video' | 'text';

/** Channels whose backend can run every model of each kind (text = LLM chat). */
export const READY_CHANNELS: Record<MediaKind, ReadonlySet<ChannelId>> = {
  image: new Set<ChannelId>(['ark', 'openai', 'google', 'apimart']),
  video: new Set<ChannelId>(['ark', 'minimax']),
  text: new Set<ChannelId>(['ark', 'minimax', 'openai', 'google', 'apimart']),
};

/** Bound model type each card kind draws from; text cards use chat (LLM) models. */
const MODEL_TYPE: Record<MediaKind, string> = { image: 'image', video: 'video', text: 'chat' };

/** Whether the backend can run this model; APIMart video is limited to Kling for now. */
export function isModelReady(kind: MediaKind, provider: ChannelId, modelId: string): boolean {
  if (READY_CHANNELS[kind].has(provider)) return true;
  return kind === 'video' && provider === 'apimart' && isAPIMartVideoModel(modelId);
}

// Ark and MiniMax run against a mock adapter without a key, so they are always offered.
const MOCK_CHANNELS: ReadonlySet<ChannelId> = new Set<ChannelId>(['ark', 'minimax']);

/** Short provider names for card pickers. */
export const CHANNEL_SHORT_NAMES: Record<ChannelId, string> = {
  ark: '火山方舟',
  // "官方" tells it apart from MiniMax models offered through APIMart.
  minimax: 'MiniMax 官方',
  kling: '可灵',
  midjourney: 'Midjourney',
  google: 'Google',
  openai: 'OpenAI',
  apimart: 'APIMart',
};

export interface ModelOption {
  provider: ChannelId;
  id: string;
  /** Friendly name for known built-in models (Seedream / Seedance / MiniMax), else the model ID. */
  label: string;
  tag?: string;
  /** False when the backend cannot run this model yet: listed, but not selectable. */
  ready: boolean;
}

export interface ProviderGroup {
  provider: ChannelId;
  name: string;
  options: ModelOption[];
  /** True when at least one of the provider's models can run. */
  ready: boolean;
}

function optionFor(kind: MediaKind, provider: ChannelId, id: string): ModelOption {
  const known =
    kind === 'image'
      ? provider === 'ark'
        ? IMAGE_MODELS.find((m) => m.id === id)
        : undefined
      : VIDEO_MODELS.find((m) => m.id === id && m.provider === provider);
  return { provider, id, label: known?.name ?? id, tag: known?.tag, ready: isModelReady(kind, provider, id) };
}

function group(kind: MediaKind, provider: ChannelId, ids: string[]): ProviderGroup {
  const options = ids.map((id) => optionFor(kind, provider, id));
  return {
    provider,
    name: CHANNEL_SHORT_NAMES[provider],
    options,
    ready: options.some((o) => o.ready),
  };
}

/**
 * Builds a card's provider → model choices from channel config: every configured
 * channel (plus mock-capable Ark / MiniMax) with bound models of this kind.
 * Before config has loaded, falls back to the built-in models.
 */
export function buildProviderGroups(channels: ProviderConfigItem[], kind: MediaKind): ProviderGroup[] {
  if (channels.length === 0) {
    if (kind === 'text') return [];
    if (kind === 'image') {
      return [group('image', 'ark', IMAGE_MODELS.map((m) => m.id))];
    }
    const providers: ChannelId[] = ['ark', 'minimax'];
    return providers.map((p) =>
      group('video', p, VIDEO_MODELS.filter((m) => m.provider === p).map((m) => m.id))
    );
  }

  const groups: ProviderGroup[] = [];
  for (const ch of channels) {
    // Mock adapters only generate media; a text card needs a real key.
    if (!ch.is_configured && (kind === 'text' || !MOCK_CHANNELS.has(ch.id))) continue;
    const ids = ch.models.filter((m) => m.type === MODEL_TYPE[kind]).map((m) => m.id);
    if (ids.length > 0) groups.push(group(kind, ch.id, ids));
  }
  return groups;
}

/** Finds the option for a card's provider + model, if that channel still offers it. */
export function findModelOption(
  groups: ProviderGroup[],
  provider: ChannelId,
  modelId: string
): ModelOption | undefined {
  return groups.find((g) => g.provider === provider)?.options.find((o) => o.id === modelId);
}

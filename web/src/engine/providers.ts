import type { Protocol, ProviderConfigItem, ProviderId } from '../services/api.ts';

/**
 * Provider → Protocol lookup. Cards store only a provider ID; everything that depends on
 * the API dialect (Seedream rules, MiniMax limits, which card kinds can run) asks for the
 * provider's protocol here. Preset providers keep fixed IDs, so they resolve even before
 * the channel config has loaded; other providers resolve once it has.
 */

const PRESETS: Record<string, { protocol: Protocol; name: string }> = {
  ark: { protocol: 'ark', name: '火山方舟' },
  minimax: { protocol: 'minimax', name: 'MiniMax 官方' },
  kling: { protocol: 'kling', name: '可灵' },
  midjourney: { protocol: 'midjourney', name: 'Midjourney' },
  google: { protocol: 'gemini', name: 'Google' },
  openai: { protocol: 'openai_compatible', name: 'OpenAI' },
  apimart: { protocol: 'apimart', name: 'APIMart' },
};

let known = new Map<ProviderId, { protocol: Protocol; name: string }>(Object.entries(PRESETS));

/** Records the configured providers; the channel store calls this on every load. */
export function rememberProviders(providers: ProviderConfigItem[]): void {
  known = new Map(Object.entries(PRESETS));
  for (const p of providers) known.set(p.id, { protocol: p.protocol, name: p.name });
}

/** The protocol a provider speaks; undefined for providers that are not configured here. */
export function protocolOf(provider: ProviderId | undefined): Protocol | undefined {
  return provider === undefined ? undefined : known.get(provider)?.protocol;
}

/** Display name of a provider, falling back to its ID. */
export function providerName(provider: ProviderId): string {
  return known.get(provider)?.name ?? provider;
}

/** Whether a display name is already used by another provider (trimmed, case-insensitive, like the backend). */
export function isNameTaken(name: string, providers: Pick<ProviderConfigItem, 'id' | 'name'>[], exceptId?: ProviderId): boolean {
  const n = name.trim().toLowerCase();
  return providers.some((p) => p.id !== exceptId && p.name.trim().toLowerCase() === n);
}

/** First free default name for a new provider: "<label>", then "<label> 2", "<label> 3", … */
export function defaultProviderName(label: string, providers: Pick<ProviderConfigItem, 'id' | 'name'>[]): string {
  if (!isNameTaken(label, providers)) return label;
  for (let n = 2; ; n++) {
    const name = `${label} ${n}`;
    if (!isNameTaken(name, providers)) return name;
  }
}

import { useEffect, useSyncExternalStore } from 'react';
import { apiGetConfig, type ProviderConfigItem } from './api.ts';

// Shared snapshot of GET /api/config so cards and the settings modal see the same
// channels and bound models. The settings modal refreshes it after every save.
let snapshot: ProviderConfigItem[] = [];
let loaded = false;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reloads channel configuration from the backend and notifies subscribers. */
export function refreshChannels(): Promise<void> {
  if (inflight) return inflight;
  inflight = apiGetConfig()
    .then((data) => {
      snapshot = data.providers;
      loaded = true;
      listeners.forEach((l) => l());
    })
    .catch(() => {
      // Keep the previous snapshot; cards fall back to built-in models.
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Current channel list; triggers the first load on mount. Empty until loaded. */
export function useChannels(): ProviderConfigItem[] {
  useEffect(() => {
    if (!loaded) void refreshChannels();
  }, []);
  return useSyncExternalStore(subscribe, () => snapshot);
}

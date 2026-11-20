import { useEffect, useSyncExternalStore } from 'react';
import { apiGetUploadConfig, apiSaveUploadConfig, type UploadPlatformConfig, type UploadTarget } from './uploads.ts';

function createUploadConfigStore(target: UploadTarget) {
  let snapshot: UploadPlatformConfig | null = null;
  let inflight: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: UploadPlatformConfig) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    load() {
      if (snapshot || inflight) return;
      inflight = apiGetUploadConfig(target)
        .then(publish)
        .catch(() => { /* Keep this destination disabled if its configuration could not load. */ })
        .finally(() => { inflight = null; });
    },
    async save(payload: Parameters<typeof apiSaveUploadConfig>[1]) {
      publish(await apiSaveUploadConfig(target, payload));
    },
  };
}

const stores = { asset: createUploadConfigStore('asset'), file: createUploadConfigStore('file') };

export function saveUploadPlatform(target: UploadTarget, payload: Parameters<typeof apiSaveUploadConfig>[1]): Promise<void> {
  return stores[target].save(payload);
}

/** Current settings for one upload operation; null until it loads. */
export function useUploadPlatform(target: UploadTarget): UploadPlatformConfig | null {
  const store = stores[target];
  useEffect(() => { store.load(); }, [store]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

import { useEffect, useSyncExternalStore } from 'react';
import { apiGetUploadConfig, type UploadPlatformConfig } from './uploads.ts';

// Shared snapshot of GET /api/uploads/config so upload panels and the settings pane agree
// on whether uploads can run. The settings pane refreshes it after every save.
let snapshot: UploadPlatformConfig | null = null;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reloads the Upload Platform settings and notifies subscribers. */
export function refreshUploadPlatform(): Promise<void> {
  if (inflight) return inflight;
  inflight = apiGetUploadConfig()
    .then((data) => {
      snapshot = data;
      listeners.forEach((l) => l());
    })
    .catch(() => {
      // Keep the previous snapshot; the upload buttons stay as they were.
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Current Upload Platform settings; null until the first load finishes. */
export function useUploadPlatform(): UploadPlatformConfig | null {
  useEffect(() => {
    if (!snapshot) void refreshUploadPlatform();
  }, []);
  return useSyncExternalStore(subscribe, () => snapshot);
}

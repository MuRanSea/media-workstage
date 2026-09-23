import type { SpatialCard } from '../types/canvas.ts';
import type { BackendTaskResponse } from '../services/api.ts';
import { assetStoredPath } from './assetPaths.ts';

const TERMINAL: ReadonlySet<SpatialCard['status']> = new Set(['succeeded', 'failed', 'cancelled', 'expired']);

export function isTerminalStatus(status: SpatialCard['status']): boolean {
  return TERMINAL.has(status);
}

/** Folds a backend task snapshot (SSE event, fetch, or submit response) into its card. */
export function applyTaskToCard(card: SpatialCard, task: BackendTaskResponse): SpatialCard {
  switch (task.status) {
    case 'succeeded': {
      const assets = task.assets ?? [];
      const display =
        assets.find((a) => a.kind === 'video') ?? assets.find((a) => a.kind === 'image_base') ?? assets[0];
      return {
        ...card,
        taskId: task.id,
        status: 'succeeded',
        progress: 100,
        errorMessage: undefined,
        outputAssets: task.assets ?? card.outputAssets,
        resultUrl: assetStoredPath(display) ?? card.resultUrl,
      };
    }
    case 'failed':
    case 'cancelled':
    case 'expired':
      return {
        ...card,
        taskId: task.id,
        status: task.status,
        errorMessage: task.error_message || task.error_code || '生成失败',
      };
    default:
      return {
        ...card,
        taskId: task.id,
        status: task.status,
        progress: task.progress || card.progress,
        errorMessage: undefined,
      };
  }
}

import type { SpatialCard } from '../types/canvas.ts';
import type { BackendTaskResponse } from '../services/api.ts';
import { mergeBilling } from './mediaBilling.ts';
import { assetStoredPath } from './assetPaths.ts';

const TERMINAL: ReadonlySet<SpatialCard['status']> = new Set(['succeeded', 'failed', 'cancelled', 'expired']);

export function isTerminalStatus(status: SpatialCard['status']): boolean {
  return TERMINAL.has(status);
}

/** Folds a backend task snapshot (SSE event, fetch, or submit response) into its card. */
export function applyTaskToCard(card: SpatialCard, task: BackendTaskResponse): SpatialCard {
  card = {
    ...card,
    ...(task.provider_task_id ? { providerTaskId: task.provider_task_id } : {}),
    billingDetailsJson: mergeBilling(card.billingDetailsJson, task.billing_details_json),
    deliveryStatus: task.delivery_status,
  };
  switch (task.status) {
    case 'succeeded': {
      const assets = task.assets ?? [];
      const video = assets.find((a) => a.kind === 'video' && a.variant === 'original') ?? assets.find((a) => a.kind === 'video' && a.variant !== 'watermarked') ?? assets.find((a) => a.kind === 'video');
      // A 3D result shows its cover (or nothing): its model files and preview video are not images.
      const display =
        card.type === '3d'
          ? assets.find((a) => a.kind === 'cover')
          : card.type === 'video' && task.delivery_status
            ? video
            : assets.find((a) => a.kind === 'video') ?? assets.find((a) => a.kind === 'image_base') ?? assets[0];
      return {
        ...card,
        taskId: task.id,
        status: 'succeeded',
        progress: 100,
        errorMessage: task.delivery_message,
        outputAssets: task.delivery_status ? assets : task.assets ?? card.outputAssets,
        resultUrl: assetStoredPath(display) ?? (task.delivery_status ? undefined : card.resultUrl),
        resultActions: task.result_actions?.length ? task.result_actions : undefined,
        ...(card.type === 'text' && task.result_text ? { textOutput: task.result_text } : {}),
      };
    }
    case 'failed':
    case 'cancelled':
    case 'expired':
      return {
        ...card,
        taskId: task.id,
        status: task.status,
        errorMessage: task.error_message || task.error_code || { failed: '生成失败', cancelled: '任务已取消', expired: '任务已过期' }[task.status],
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

import type { BackendTaskResponse } from './api.ts';
import type { UploadKind } from '../types/canvas.ts';

async function mediaRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { error?: string; code?: string } | null;
    throw new Error(`${error?.error || `网关请求失败 (HTTP ${response.status})`}${error?.code ? ` · ${error.code}` : ''}`);
  }
  return response.status === 204 ? undefined as T : response.json();
}

const media = (provider: string) => `/api/media/${encodeURIComponent(provider)}`;
export type MediaFilePurpose = 'reference' | 'provider_asset';
export interface ManagedMediaFile {
  id: string;
  name?: string;
  purpose: MediaFilePurpose;
  status: string;
  asset_id?: string;
  asset_type?: UploadKind;
  group_id?: string;
  url?: string;
  expires_at?: string | number;
  metadata?: { content_type?: string; mime_type?: string; type?: string };
}
interface FilePage { items: ManagedMediaFile[]; next_page?: number | null; total?: number }
export interface RemoteMediaTask {
  id: string;
  model: string;
  status: string;
  external_task_id?: string;
  billing?: { status?: string; currency?: string; amount?: string | null };
}
interface TaskPage { items: RemoteMediaTask[]; next_cursor?: string | null; has_more?: boolean }

export const apiListMediaFiles = (provider: string, purpose: MediaFilePurpose, group: string, page: number) => {
  const query = new URLSearchParams({ purpose, page: String(page), page_size: '20' });
  if (group && purpose === 'provider_asset') query.set('group_id', group);
  return mediaRequest<FilePage>(`${media(provider)}/files?${query}`);
};
export const apiUploadMediaFile = (provider: string, body: FormData) => mediaRequest<ManagedMediaFile>(`${media(provider)}/files`, { method: 'POST', body });
export const apiGetMediaFile = (provider: string, id: string) => mediaRequest<ManagedMediaFile>(`${media(provider)}/files/${encodeURIComponent(id)}`);
export const apiDeleteMediaFile = (provider: string, id: string) => mediaRequest<unknown>(`${media(provider)}/files/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const apiBatchMediaTasks = (provider: string, ids: string, external: boolean) =>
  mediaRequest<TaskPage>(`${media(provider)}/tasks?${new URLSearchParams({ [external ? 'external_task_ids' : 'task_ids']: ids })}`);
export const apiQueryMediaTasks = (provider: string, query: { cursor?: string; statuses?: string[]; models?: string[]; limit: number }) =>
  mediaRequest<TaskPage>(`${media(provider)}/tasks/query`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(query) });
const taskAction = (id: string, action: string, projectId: string) => `/api/tasks/${encodeURIComponent(id)}/${action}?${new URLSearchParams({ project_id: projectId })}`;
export const apiCancelMediaTask = (id: string, projectId: string) => mediaRequest<unknown>(taskAction(id, 'cancel', projectId), { method: 'POST' });
export const apiRetryMediaDelivery = (id: string, projectId: string) => mediaRequest<unknown>(taskAction(id, 'delivery/retry', projectId), { method: 'POST' });
export const apiRefreshMediaBilling = (id: string, projectId: string) => mediaRequest<BackendTaskResponse>(taskAction(id, 'billing/refresh', projectId), { method: 'POST' });

export const mediaFileType = (file: ManagedMediaFile): UploadKind | undefined => {
  const value = file.asset_type ?? (file.metadata?.mime_type ?? file.metadata?.content_type ?? file.metadata?.type)?.split('/')[0];
  return value === 'image' || value === 'video' || value === 'audio' ? value : undefined;
};

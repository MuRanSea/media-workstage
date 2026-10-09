import type { AssetStatus, UploadKind } from '../types/canvas.ts';

async function readError(resp: Response, fallback: string): Promise<Error> {
  const body = await resp.json().catch(() => ({}));
  return new Error((body as { error?: string }).error || `${fallback} (HTTP ${resp.status})`);
}

export interface LocalUpload {
  kind: UploadKind;
  name: string;
  mime: string;
  size: number;
  /** Project-relative path, e.g. /assets/uploads/<id>.mp4. */
  local_path: string;
}

/** Saves a picked file into the project's assets/uploads folder. */
export async function apiUploadLocal(projectId: string, kind: UploadKind, file: File): Promise<LocalUpload> {
  const form = new FormData();
  form.append('kind', kind);
  form.append('file', file);
  const resp = await fetch(`/api/projects/${encodeURIComponent(projectId)}/uploads`, { method: 'POST', body: form });
  if (!resp.ok) throw await readError(resp, '保存文件失败');
  return resp.json();
}

export interface AssetUpload {
  asset_id: string;
  /** asset://<id>; usable as a reference once status is Active. */
  uri: string;
  status: AssetStatus;
  error_code?: string;
  error_message?: string;
}

function remoteForm(projectId: string, localPath: string, extra?: Record<string, string>): FormData {
  const form = new FormData();
  form.append('project_id', projectId);
  form.append('local_path', localPath);
  for (const [k, v] of Object.entries(extra ?? {})) form.append(k, v);
  return form;
}

/** Puts a saved file into the Upload Platform's asset library and returns its asset id. */
export async function apiUploadAsset(projectId: string, localPath: string, name?: string): Promise<AssetUpload> {
  const resp = await fetch('/api/uploads/asset', {
    method: 'POST',
    body: remoteForm(projectId, localPath, name ? { name } : undefined),
  });
  if (!resp.ok) throw await readError(resp, '上传素材失败');
  return resp.json();
}

/** Current review status of an uploaded asset. */
export async function apiAssetStatus(assetId: string): Promise<AssetUpload> {
  const resp = await fetch('/api/uploads/asset/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ asset_id: assetId }),
  });
  if (!resp.ok) throw await readError(resp, '查询素材状态失败');
  return resp.json();
}

export interface FileUpload {
  file_url: string;
  /** Unix seconds. */
  expires_at: number;
}

/** Uploads a saved file to the Upload Platform's file store and returns a 7-day download URL. */
export async function apiUploadFile(projectId: string, localPath: string): Promise<FileUpload> {
  const resp = await fetch('/api/uploads/file', { method: 'POST', body: remoteForm(projectId, localPath) });
  if (!resp.ok) throw await readError(resp, '上传文件失败');
  return resp.json();
}

/** The Upload Platform (Heighliner business API) that upload cards send files to. */
export interface UploadPlatformConfig {
  base_url: string;
  is_configured: boolean;
  masked_key?: string;
  docs_url: string;
}

export async function apiGetUploadConfig(): Promise<UploadPlatformConfig> {
  const resp = await fetch('/api/uploads/config');
  if (!resp.ok) throw await readError(resp, '读取上传平台设置失败');
  return resp.json();
}

/** Saves the address and/or key; blank fields keep what is saved. `clear` removes both. */
export async function apiSaveUploadConfig(payload: { base_url?: string; api_key?: string; clear?: boolean }): Promise<UploadPlatformConfig> {
  const resp = await fetch('/api/uploads/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw await readError(resp, '保存上传平台设置失败');
  return resp.json();
}

/** Checks an address and key with a read-only call; blank fields test the saved ones. */
export async function apiTestUploadConfig(payload: { base_url?: string; api_key?: string }): Promise<{ ok: boolean; message: string }> {
  const resp = await fetch('/api/uploads/config/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw await readError(resp, '测试上传平台失败');
  return resp.json();
}

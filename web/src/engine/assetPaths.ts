import type { TaskAssetDto } from '../types/canvas.ts';

/**
 * Cards store local media as `/assets/...` paths relative to the project
 * folder, so a project keeps working after its folder is moved or copied.
 * Only rendering turns them into URLs, via the open project's asset route.
 */

let activeProjectId: string | null = null;

/** Sets the project whose asset route `assetUrl` resolves against. */
export function setActiveProjectId(id: string | null): void {
  activeProjectId = id;
}

/** The stored path for a task asset: `/assets/<local_path>`, or its remote URL. */
export function assetStoredPath(asset: TaskAssetDto | undefined): string | undefined {
  if (!asset) return undefined;
  if (!asset.local_path) return asset.remote_url;
  const clean = asset.local_path.replace(/^\/+/, '');
  return clean.startsWith('assets/') ? `/${clean}` : `/assets/${clean}`;
}

/** Browser URL for a stored path. Remote and data: URLs pass through unchanged. */
export function assetUrl(path: string | undefined, projectId: string | null = activeProjectId): string | undefined {
  if (!path || !projectId) return path;
  const clean = path.replace(/^\/+/, '');
  if (!clean.startsWith('assets/')) return path;
  return `/api/projects/${encodeURIComponent(projectId)}/${clean}`;
}

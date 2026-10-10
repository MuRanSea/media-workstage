import type { SpatialCard } from '../types/canvas.ts';

export interface ProjectViewport {
  zoom: number;
  panX: number;
  panY: number;
}

export interface ProjectDocument {
  version: number;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  viewport: ProjectViewport;
  cards: SpatialCard[];
  /** Absent in projects saved before sections existed. */
  sections?: unknown[];
}

export interface ProjectSummary {
  id: string;
  name: string;
  dir: string;
  createdAt: string;
  updatedAt: string;
  cardCounts: Partial<Record<SpatialCard['type'], number>>;
  /** First image card's local result ("/assets/..."), shown as the project's cover. */
  cover?: string;
}

export interface ProjectList {
  root: string;
  projects: ProjectSummary[];
}

/** Thrown when a save was based on a stale revision (the project changed in another tab). */
export class ProjectConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectConflictError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    const message = (data as { error?: string }).error || `请求失败 (${resp.status})`;
    if (resp.status === 409) throw new ProjectConflictError(message);
    throw new Error(message);
  }
  if (resp.status === 204) return undefined as T;
  return resp.json() as Promise<T>;
}

const projectPath = (id: string) => `/api/projects/${encodeURIComponent(id)}`;

export function apiListProjects(): Promise<ProjectList> {
  return request('/api/projects');
}

export function apiCreateProject(name: string): Promise<ProjectDocument> {
  return request('/api/projects', { method: 'POST', body: JSON.stringify({ name }) });
}

export function apiGetProject(id: string): Promise<ProjectDocument> {
  return request(projectPath(id));
}

export interface SaveProjectBody {
  revision: number;
  viewport: ProjectViewport;
  cards: unknown[];
  sections: unknown[];
}

/** Saves the canvas; `keepalive` lets a save started during page unload finish. */
export function apiSaveProject(
  id: string,
  body: SaveProjectBody,
  opts: { keepalive?: boolean } = {}
): Promise<{ revision: number; updatedAt: string }> {
  return request(projectPath(id), { method: 'PUT', body: JSON.stringify(body), keepalive: opts.keepalive });
}

/** Saves where the canvas is looking; needs no revision and does not change it. */
export function apiSaveViewport(id: string, viewport: ProjectViewport, opts: { keepalive?: boolean } = {}): Promise<void> {
  return request(`${projectPath(id)}/viewport`, { method: 'PUT', body: JSON.stringify(viewport), keepalive: opts.keepalive });
}

export function apiRenameProject(id: string, name: string): Promise<{ id: string; name: string }> {
  return request(projectPath(id), { method: 'PATCH', body: JSON.stringify({ name }) });
}

export function apiDeleteProject(id: string): Promise<void> {
  return request(projectPath(id), { method: 'DELETE' });
}

export function apiRevealProject(id: string): Promise<void> {
  return request(`${projectPath(id)}/reveal`, { method: 'POST' });
}

/** Where the browser downloads a project as a zip (project.json and assets/). */
export const projectExportUrl = (id: string) => `${projectPath(id)}/export`;

/** Writes the project zip next to the projects and shows it in the file manager (desktop mode). */
export function apiExportProjectToFolder(id: string): Promise<{ path: string }> {
  return request(`${projectPath(id)}/export`, { method: 'POST' });
}

/** Copies a project into a new one named "<name> 副本". */
export function apiDuplicateProject(id: string): Promise<ProjectDocument> {
  return request(`${projectPath(id)}/duplicate`, { method: 'POST' });
}

/** Makes a new project from an exported zip. */
export async function apiImportProject(file: File): Promise<ProjectDocument> {
  const body = new FormData();
  body.append('file', file);
  // No JSON content type here: the browser sets the multipart boundary.
  const resp = await fetch('/api/projects/import', { method: 'POST', body });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || `导入失败 (${resp.status})`);
  }
  return resp.json() as Promise<ProjectDocument>;
}

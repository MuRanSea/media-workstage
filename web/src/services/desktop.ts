/** Desktop mode (ADR 0007): directory settings the desktop app applies on its next start. */

export interface DesktopDirSettings {
  /** Empty means the default location. */
  data_dir: string;
  projects_dir: string;
}

export type DesktopInfo =
  | { enabled: false }
  | {
      enabled: true;
      /** Directories this run is using. */
      data_dir: string;
      projects_dir: string;
      logs_dir: string;
      /** What settings.json holds; takes effect on the next start. */
      settings: DesktopDirSettings;
    };

async function failure(resp: Response, fallback: string): Promise<Error> {
  const data = await resp.json().catch(() => ({}));
  return new Error(data.error || `${fallback} (${resp.status})`);
}

export async function apiGetDesktop(): Promise<DesktopInfo> {
  const resp = await fetch('/api/desktop');
  if (!resp.ok) throw await failure(resp, 'Get desktop info failed');
  return resp.json();
}

export async function apiSaveDesktopSettings(settings: DesktopDirSettings): Promise<void> {
  const resp = await fetch('/api/desktop/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!resp.ok) throw await failure(resp, 'Save settings failed');
}

/** Asks the desktop app to restart; the window returns to the splash page meanwhile. */
export async function apiRestartDesktop(): Promise<void> {
  const resp = await fetch('/api/desktop/restart', { method: 'POST' });
  if (!resp.ok) throw await failure(resp, 'Restart failed');
}

export async function apiOpenLogs(): Promise<void> {
  const resp = await fetch('/api/desktop/open-logs', { method: 'POST' });
  if (!resp.ok) throw await failure(resp, 'Open logs failed');
}

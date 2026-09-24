import type { TaskAssetDto } from '../types/canvas.ts';

export interface CreateTaskPayload {
  /** Owning project; its folder receives the outputs and resolves reference paths. */
  project_id?: string;
  provider: string;
  model: string;
  task_type: string;
  task_mode?: string;
  prompt: string;
  params?: Record<string, unknown>;
  reference_assets?: Array<{
    card_id: string;
    tag_index: number;
    role: string;
    label: string;
    url?: string;
    local_path?: string;
    remote_url?: string;
  }>;
}

export interface BackendTaskResponse {
  id: string;
  provider: string;
  provider_task_id: string;
  model: string;
  task_type: string;
  task_mode: string;
  prompt: string;
  params_json: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'expired';
  progress: number;
  error_code?: string;
  error_message?: string;
  usage_tokens?: number;
  output_duration_sec?: number;
  billing_details_json?: string;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  assets?: TaskAssetDto[];
}

/** Stable ID of a configured provider: a preset ID ('ark', 'openai', …) or a generated one. */
export type ProviderId = string;

/** API dialect a provider speaks; decides the adapter and which card kinds it can run. */
export type Protocol = 'ark' | 'minimax' | 'kling' | 'midjourney' | 'gemini' | 'openai_compatible' | 'apimart';

export type ModelType = 'image' | 'video' | 'chat' | 'audio' | 'other';

export interface BoundModel {
  id: string;
  type: ModelType;
}

export interface ProviderConfigItem {
  id: ProviderId;
  /** Display name, unique across providers. */
  name: string;
  protocol: Protocol;
  /** Preset providers ship with the app and cannot be deleted. */
  preset: boolean;
  base_url: string;
  is_configured: boolean;
  masked_key?: string;
  extra?: Record<string, string>;
  /** Models bound to this provider (presets until the user saves a binding). */
  models: BoundModel[];
  /** Whether the provider exposes a live model catalog (otherwise presets only). */
  can_list_models: boolean;
  /** Built-in models the binding panel can restore with 「恢复默认」. */
  presets?: BoundModel[];
}

export interface GetConfigResponse {
  providers: ProviderConfigItem[];
}

export interface UpdateConfigPayload {
  provider: ProviderId;
  base_url?: string;
  api_key?: string;
  extra?: Record<string, string>;
  /** Replaces the provider's bound models; omit to leave them unchanged. */
  models?: BoundModel[];
  /** Wipes the provider's saved key, base URL, extras and bindings. */
  clear?: boolean;
}

export interface ListModelsPayload {
  provider: ProviderId;
  base_url?: string;
  api_key?: string;
}

export interface ListModelsResponse {
  models: BoundModel[];
  source: 'remote' | 'preset';
}

export interface TestConfigPayload {
  provider: ProviderId;
  base_url: string;
  api_key: string;
  extra?: Record<string, string>;
}

export interface TestConfigResponse {
  ok: boolean;
  message?: string;
  error?: string;
}

/**
 * Creates a media generation task via POST /api/tasks.
 */
export async function apiCreateTask(payload: CreateTaskPayload): Promise<BackendTaskResponse> {
  const resp = await fetch('/api/tasks', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    throw new Error(`Create task failed (${resp.status}): ${errorText}`);
  }

  return resp.json();
}

/**
 * Fetches a single task by ID via GET /api/tasks/:id.
 */
export async function apiGetTask(taskId: string): Promise<BackendTaskResponse> {
  const resp = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`);
  if (!resp.ok) {
    throw new Error(`Get task failed (${resp.status})`);
  }
  return resp.json();
}

/**
 * Lists recent tasks via GET /api/tasks.
 */
export async function apiListTasks(): Promise<BackendTaskResponse[]> {
  const resp = await fetch('/api/tasks');
  if (!resp.ok) {
    throw new Error(`List tasks failed (${resp.status})`);
  }
  return resp.json();
}

/**
 * Queries current provider configuration and masked keys via GET /api/config.
 */
export async function apiGetConfig(): Promise<GetConfigResponse> {
  const resp = await fetch('/api/config');
  if (!resp.ok) {
    throw new Error(`Get config failed (${resp.status})`);
  }
  return resp.json();
}

/**
 * Updates provider credentials and base URL via POST /api/config.
 */
export async function apiUpdateConfig(payload: UpdateConfigPayload): Promise<{ status: string; config?: unknown }> {
  const resp = await fetch('/api/config', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const errData = await resp.json().catch(() => ({ error: 'Update failed' }));
    throw new Error(errData.error || `Update config failed (${resp.status})`);
  }

  return resp.json();
}

/**
 * Tests connection and authentication for a provider via POST /api/config/test.
 */
export async function apiTestConfig(payload: TestConfigPayload): Promise<TestConfigResponse> {
  const resp = await fetch('/api/config/test', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const errData = await resp.json().catch(() => ({ error: 'Test failed' }));
    return { ok: false, error: errData.error || `HTTP ${resp.status}` };
  }

  return resp.json();
}

/**
 * Fetches a provider's model catalog via POST /api/config/models: live from the
 * provider where supported (using the typed or saved key), otherwise its presets.
 */
export async function apiListProviderModels(payload: ListModelsPayload): Promise<ListModelsResponse> {
  const resp = await fetch('/api/config/models', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const errData = await resp.json().catch(() => ({ error: 'List models failed' }));
    throw new Error(errData.error || `List models failed (${resp.status})`);
  }

  return resp.json();
}

export interface GenerateTextPayload {
  provider: ProviderId;
  model: string;
  system?: string;
  prompt: string;
}

/**
 * Runs a text card via POST /api/llm/generate (single system + user turn).
 */
export async function apiGenerateText(payload: GenerateTextPayload): Promise<{ text: string }> {
  const resp = await fetch('/api/llm/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const errData = await resp.json().catch(() => ({ error: 'Generate text failed' }));
    throw new Error(errData.error || `Generate text failed (${resp.status})`);
  }

  return resp.json();
}

const recentTaskEvents = new Map<string, { eventType: string; task: BackendTaskResponse }>();

/**
 * Retrieves the latest buffered SSE event for a specific task ID.
 * Helps reconcile race conditions when backend poller completes before frontend fetch returns.
 */
export function getBufferedTaskEvent(taskId: string): { eventType: string; task: BackendTaskResponse } | undefined {
  return recentTaskEvents.get(taskId);
}

/**
 * Subscribes to real-time Server-Sent Events from GET /api/tasks/events.
 * Returns an unsubscribe cleanup function.
 */
export function subscribeTaskEvents(
  onEvent: (eventType: string, task: BackendTaskResponse) => void
): () => void {
  const eventSource = new EventSource('/api/tasks/events');

  const handleCustomEvent = (type: string) => (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data) as BackendTaskResponse;
      if (data && data.id) {
        recentTaskEvents.set(data.id, { eventType: type, task: data });
      }
      onEvent(type, data);
    } catch {
      // ignore non-json events like ready
    }
  };

  eventSource.addEventListener('task.created', handleCustomEvent('task.created'));
  eventSource.addEventListener('task.progress', handleCustomEvent('task.progress'));
  eventSource.addEventListener('task.succeeded', handleCustomEvent('task.succeeded'));
  eventSource.addEventListener('task.failed', handleCustomEvent('task.failed'));

  return () => {
    eventSource.close();
  };
}

import type { ResultActionDto, ResultOrigin, ResultSnapshot, SpatialCard, TaskAssetDto } from '../types/canvas.ts';
import type { BackendTaskResponse } from '../services/api.ts';
import { applyTaskToCard, isTerminalStatus } from './taskSync.ts';
import { newCardId, nextTagIndex } from './cardFactory.ts';
import { firstFreeSlotBelow, firstFreeSlotRight } from './layout.ts';
import { previewAspect } from './cardParams.ts';
import { assetStoredPath } from './assetPaths.ts';
import { sentVideoSettings } from './videoCompiler.ts';

/** Image settings a result card records and reuses to shape its preview. */
const IMAGE_PARAMS = [
  'imageMode',
  'sizeMode',
  'imageTier',
  'imageRatioPreset',
  'customPixels',
  'imageResolution',
  'imageFormat',
  'watermark',
  'background',
  'mjSpeed',
  'mjOperation',
] as const;

/** Video settings a result card records; the ratio also shapes its preview. */
const VIDEO_PARAMS = ['mode', 'resolution', 'duration', 'ratio', 'generateAudio'] as const;

/** Space between a result card and its neighbours. */
const GAP = 40;

/** Rendered height of a card; the page supplies measured heights when it has them. */

export type HeightOf = (card: SpatialCard) => number | undefined;

const HEADER = 40;
const PADDING = 24;
const PREVIEW_MAX_HEIGHT = 480;
/** Model / spec summary row under a result card's preview. */
const SUMMARY_ROW = 30;
/** Generation card body: prompt, summary row and the Generate button; video adds reference chips. */
const GENERATION_BODY = { image: 150, video: 180, text: 150, upload: 0 } as const;
/** Upload panel under an uploaded or generated image or video: provider, upload buttons and what was uploaded. */
const UPLOAD_PANEL = 110;
/** One row of result action buttons (Midjourney's U row, V row, …). */
const ACTION_ROW = 30;
/** Text result card body: summary row and a few rows of editable text. */
const TEXT_RESULT_BODY = 160;

/**
 * Height to leave room for when placing new cards: what the card measures, but
 * never less than its finished estimate while it still waits on a task, since
 * it grows (preview, upload panel) when the output arrives.
 */
function plannedHeight(heightOf: HeightOf): (card: SpatialCard) => number {
  return (card) => {
    const measured = heightOf(card);
    if (measured === undefined) return estimateCardHeight(card);
    const waiting = card.status === 'queued' || card.status === 'running';
    return waiting ? Math.max(measured, estimateCardHeight(card)) : measured;
  };
}

/** Height a card will roughly render at, from its preview's shape. */
export function estimateCardHeight(card: SpatialCard): number {
  const aspect = previewAspect(card) ?? 16 / 9;
  const preview = Math.min((card.width - PADDING) / aspect, PREVIEW_MAX_HEIGHT);
  // No preview on generation cards.
  if (card.role === 'generation') return HEADER + PADDING + GENERATION_BODY[card.type];
  if (card.type === 'text') return HEADER + PADDING + TEXT_RESULT_BODY;
  const { upscale, variation, other } = groupActions(card.resultActions ?? []);
  const actionRows = [upscale, variation, other].filter((row) => row.length).length;
  return HEADER + PADDING + preview + SUMMARY_ROW + UPLOAD_PANEL + actionRows * ACTION_ROW;
}

/** Result cards take their id from the task that produced them. */
export const resultIdFor = (taskId: string) => `result-${taskId}`;

/** A multi-output task's result card for each asset after the first, derived so resent states add nothing. */
const extraResultIdFor = (taskId: string, assetIndex: number) => `${resultIdFor(taskId)}-${assetIndex}`;
const isExtraResultIdFor = (taskId: string, id: string) => id.startsWith(`${resultIdFor(taskId)}-`);

/** Text runs have no backend task; their result cards get a fresh id under this prefix. */
const TEXT_RESULT_PREFIX = 'result-text-';

/** A result card a run produced (as opposed to a user's pasted copy of one). */
export function isTaskResult(card: SpatialCard): boolean {
  if (card.role !== 'result') return false;
  if (card.taskId) return card.id === resultIdFor(card.taskId) || isExtraResultIdFor(card.taskId, card.id);
  return card.type === 'text' && card.id.startsWith(TEXT_RESULT_PREFIX);
}

export function resultCardsOf(cards: SpatialCard[], generationId: string): SpatialCard[] {
  return cards.filter((c) => c.role === 'result' && c.sourceId === generationId);
}

/** Runs of a generation card still in progress: its queued or running result cards. */
export function runsInProgress(cards: SpatialCard[], generationId: string): number {
  return resultCardsOf(cards, generationId).filter((c) => c.status === 'queued' || c.status === 'running').length;
}

/** What `submitted` (the card as sent, prompt already resolved) was generated with. */
export function snapshotOf(submitted: SpatialCard): ResultSnapshot {
  if (submitted.type === 'text') {
    return {
      prompt: submitted.prompt,
      provider: submitted.provider,
      model: submitted.model,
      params: submitted.textPreset ? { textPreset: submitted.textPreset } : {},
    };
  }
  const isVideo = submitted.type === 'video';
  const params: ResultSnapshot['params'] = {};
  for (const key of isVideo ? VIDEO_PARAMS : IMAGE_PARAMS) {
    const value = submitted[key];
    if (value !== undefined) params[key] = value;
  }
  const snapshot: ResultSnapshot = {
    prompt: submitted.prompt,
    provider: submitted.provider,
    model: submitted.model,
    params,
    seed: isVideo ? submitted.seed : submitted.seedImage,
  };
  if (!isVideo && submitted.references?.length) {
    // Midjourney reference images.
    snapshot.references = submitted.references.map(({ cardId, tagIndex, role, label }) => ({ cardId, tagIndex, role, label }));
  }
  if (isVideo) {
    // Record what the compiler sends, which the mode can rewrite.
    const sent = sentVideoSettings(submitted);
    params.mode = sent.mode;
    params.ratio = sent.ratio;
    if (sent.references.length) {
      snapshot.references = sent.references.map(({ cardId, tagIndex, role, label }) => ({ cardId, tagIndex, role, label }));
    }
  }
  return snapshot;
}

/**
 * Adds the result card for a task the backend just accepted from `submitted`,
 * in the first free slot right of its generation card, and folds in the latest
 * known task state (the task may already have finished). Idempotent per task.
 */
export function addPendingResult(
  cards: SpatialCard[],
  submitted: SpatialCard,
  task: BackendTaskResponse,
  heightOf: HeightOf = () => undefined
): SpatialCard[] {
  if (cards.some((c) => c.role === 'result' && c.taskId === task.id)) return cards;

  const draft: SpatialCard = {
    ...resultDraft(submitted, resultIdFor(task.id), `${submitted.title} #${resultCardsOf(cards, submitted.id).length + 1}`),
    taskId: task.id,
    tagIndex: submitted.type === 'text' ? undefined : nextTagIndex(cards),
  };

  return settleResult([...cards, placeResult(cards, submitted, draft, heightOf)], draft.id, task, heightOf);
}

/**
 * A queued result card of a run of `submitted` (the card as sent), recording what
 * it was sent with; not yet placed. Callers add the task, tag and output.
 */
export function resultDraft(submitted: SpatialCard, id: string, title: string): SpatialCard {
  const snapshot = snapshotOf(submitted);
  return {
    id,
    role: 'result',
    sourceId: submitted.id,
    snapshot,
    type: submitted.type,
    title,
    x: 0,
    y: 0,
    width: submitted.width,
    prompt: snapshot.prompt,
    provider: submitted.provider,
    model: submitted.model,
    ...snapshot.params,
    status: 'queued',
    progress: 0,
  };
}

/** `draft` moved to the first free slot right of the generation card `submitted` came from. */
export function placeResult(
  cards: SpatialCard[],
  submitted: SpatialCard,
  draft: SpatialCard,
  heightOf: HeightOf = () => undefined
): SpatialCard {
  const height = plannedHeight(heightOf);
  // The generation card may have been dragged while the request was in flight.
  const anchor = cards.find((c) => c.id === submitted.id) ?? submitted;
  const slot = firstFreeSlotRight(
    { ...anchor, height: height(anchor) },
    { width: draft.width, height: height(draft) },
    cards.map((c) => ({ ...c, height: height(c) })),
    GAP
  );
  return { ...draft, ...slot };
}

// --- Operations on a result card (Midjourney result actions and Describe) -----------

/** Display name of a result action; Midjourney's reroll button carries only 🔄. */
export function actionLabel(action: ResultActionDto): string {
  if (action.label) return action.label;
  if (action.emoji === '🔄') return '重绘';
  return action.emoji || action.id;
}

export interface ActionGroups {
  upscale: ResultActionDto[];
  variation: ResultActionDto[];
  other: ResultActionDto[];
}

/** Splits a grid's buttons into the U row, the V row and everything else, keeping order. */
export function groupActions(actions: ResultActionDto[]): ActionGroups {
  const groups: ActionGroups = { upscale: [], variation: [], other: [] };
  for (const a of actions) {
    if (/^U\d$/.test(a.label ?? '')) groups.upscale.push(a);
    else if (/^V\d$/.test(a.label ?? '')) groups.variation.push(a);
    else groups.other.push(a);
  }
  return groups;
}

/** How a result action being submitted is keyed among the cards with a request in flight. */
export const actionKey = (sourceId: string, actionId: string) => `${sourceId}::${actionId}`;

/** Actions on the result card `sourceId` with a run still queued or running. */
export function runningActionIds(cards: SpatialCard[], sourceId: string): Set<string> {
  const ids = new Set<string>();
  for (const c of cards) {
    if (c.sourceId === sourceId && c.origin?.actionId && (c.status === 'queued' || c.status === 'running')) ids.add(c.origin.actionId);
  }
  return ids;
}

/** What runs an operation: result actions run on the source's own provider; Describe on a Midjourney one. */
export interface OriginRunner {
  type: 'image' | 'text';
  provider?: SpatialCard['provider'];
  model: string;
}

/**
 * Adds the result card for a task the backend just accepted from an operation on
 * the result card `source`: a result action yields an image result, Describe a
 * text one. It is linked to `source`, sits in the first free slot right of it and
 * folds in the latest known task state. Idempotent per task.
 */
export function addOriginResult(
  cards: SpatialCard[],
  source: SpatialCard,
  origin: ResultOrigin,
  runner: OriginRunner,
  task: BackendTaskResponse,
  heightOf: HeightOf = () => undefined
): SpatialCard[] {
  if (cards.some((c) => c.role === 'result' && c.taskId === task.id)) return cards;

  const submitted: SpatialCard = {
    ...source,
    type: runner.type,
    provider: runner.provider,
    model: runner.model,
    prompt: runner.type === 'text' ? '' : source.prompt,
    references: undefined,
  };
  const draft: SpatialCard = {
    ...resultDraft(submitted, resultIdFor(task.id), `${source.title} · ${origin.label}`),
    origin,
    taskId: task.id,
    tagIndex: runner.type === 'text' ? undefined : nextTagIndex(cards),
  };
  return settleResult([...cards, placeResult(cards, source, draft, heightOf)], draft.id, task, heightOf);
}

export type TextRunOutcome = { text: string } | { error: string };

/**
 * Settles a prompt-assistant run of `submitted` (the card as sent). Text runs
 * are synchronous, so there is no placeholder: a returned text becomes a new,
 * editable text result card and clears the generation card's error; a failure
 * only shows on the generation card.
 */
export function settleTextRun(
  cards: SpatialCard[],
  submitted: SpatialCard,
  outcome: TextRunOutcome,
  heightOf: HeightOf = () => undefined
): SpatialCard[] {
  const setError = (errorMessage: string | undefined) =>
    cards.map((c) => (c.id === submitted.id && c.errorMessage !== errorMessage ? { ...c, errorMessage } : c));
  if ('error' in outcome) return setError(outcome.error);

  const draft: SpatialCard = {
    ...resultDraft(submitted, `${TEXT_RESULT_PREFIX}${newCardId()}`, `${submitted.title} #${resultCardsOf(cards, submitted.id).length + 1}`),
    textOutput: outcome.text,
    status: 'succeeded',
    progress: 100,
  };
  const current = setError(undefined);
  return [...current, placeResult(current, submitted, draft, heightOf)];
}

/**
 * Folds a task snapshot (SSE event or fetch) into the result card running it.
 * Generation cards never take task state; a finished result card takes no
 * further snapshots, so a resent or stale one changes nothing; unmatched tasks
 * change nothing.
 */
export function applyTaskToCards(
  cards: SpatialCard[],
  task: BackendTaskResponse,
  heightOf: HeightOf = () => undefined
): SpatialCard[] {
  const placeholder = cards.find((c) => c.role === 'result' && c.taskId === task.id && !isExtraResultIdFor(task.id, c.id));
  if (!placeholder || isTerminalStatus(placeholder.status)) return cards;
  return settleResult(cards, placeholder.id, task, heightOf);
}

/** Where each asset kind sorts among a task's outputs, and what its extra cards are called. */
const ASSET_KINDS: Record<TaskAssetDto['kind'], { rank: number; label?: string }> = {
  video: { rank: 0 },
  image_base: { rank: 0 },
  image_layer: { rank: 1, label: '图层' },
  image_frame: { rank: 2, label: '分镜' },
};

/** Base image first, then layers by `z_index`, then frames by `asset_index`. */
export function orderedAssets(assets: TaskAssetDto[]): TaskAssetDto[] {
  const rank = (a: TaskAssetDto) => ASSET_KINDS[a.kind].rank;
  return [...assets].sort(
    (a, b) => rank(a) - rank(b) || (a.kind === 'image_layer' ? a.z_index - b.z_index : 0) || a.asset_index - b.asset_index
  );
}

/**
 * Folds `task` into the unfinished placeholder `placeholderId`. On success the
 * placeholder keeps the first asset and every further asset gets its own result
 * card, laid out in a grid from the placeholder.
 */
function settleResult(cards: SpatialCard[], placeholderId: string, task: BackendTaskResponse, heightOf: HeightOf): SpatialCard[] {
  const assets = task.status === 'succeeded' ? orderedAssets(task.assets ?? []) : [];
  let first = applyTaskToCard(cards.find((c) => c.id === placeholderId)!, task);
  if (assets.length) first = { ...first, outputAssets: [assets[0]], resultUrl: assetStoredPath(assets[0]) };
  let next = cards.map((c) => (c.id === placeholderId ? first : c));
  // A video task's extra assets (a returned last frame) belong to the video.
  if (first.type !== 'image' || assets.length < 2) return next;

  assets.slice(1).forEach((asset, i) => {
    const card: SpatialCard = {
      ...first,
      id: extraResultIdFor(task.id, asset.asset_index),
      title: `${first.title} · ${extraAssetLabel(assets, i + 1)}`,
      tagIndex: first.type === 'image' ? nextTagIndex(next) : undefined,
      outputAssets: [asset],
      resultUrl: assetStoredPath(asset),
    };
    next = [...next, placeInAssetGrid(card, first, i + 1, assets.length, next, heightOf)];
  });
  return next;
}

/** What the card for `ordered[index]` (not the first) is called after the first card's title: "图层 2", "分镜 3". */
export function extraAssetLabel(ordered: TaskAssetDto[], index: number): string {
  const asset = ordered[index];
  const kindLabel = ASSET_KINDS[asset.kind].label;
  return kindLabel ? `${kindLabel} ${ordered.filter((a) => a.kind === asset.kind).indexOf(asset) + 1}` : `${index + 1}`;
}

/**
 * `card`, the one for output `index` of `count`, in the first free slot of its
 * grid column: the grid starts at `first` (output 0) and nothing is moved.
 */
export function placeInAssetGrid(
  card: SpatialCard,
  first: SpatialCard,
  index: number,
  count: number,
  cards: SpatialCard[],
  heightOf: HeightOf = () => undefined
): SpatialCard {
  const height = plannedHeight(heightOf);
  // Columns grow with the output count: 2 for up to 4 cards, 4 for a 15-frame storyboard, 5 for 17 layers.
  const column = index % Math.ceil(Math.sqrt(count));
  const slot = firstFreeSlotBelow(
    { x: first.x + column * (first.width + GAP), y: first.y },
    { width: card.width, height: height(card) },
    cards.map((c) => ({ ...c, height: height(c) })),
    GAP
  );
  return { ...card, ...slot };
}

import type { ResultSnapshot, SpatialCard, TaskAssetDto } from '../types/canvas.ts';
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
const GENERATION_BODY = { image: 150, video: 180, text: 150 } as const;
/** Text result card body: summary row and a few rows of editable text. */
const TEXT_RESULT_BODY = 160;

/** Height a card will roughly render at, from its preview's shape. */
export function estimateCardHeight(card: SpatialCard): number {
  const aspect = previewAspect(card) ?? 16 / 9;
  const preview = Math.min((card.width - PADDING) / aspect, PREVIEW_MAX_HEIGHT);
  if (card.role === 'result') {
    return card.type === 'text' ? HEADER + PADDING + TEXT_RESULT_BODY : HEADER + PADDING + preview + SUMMARY_ROW;
  }
  // No preview on generation cards.
  if (card.role === 'generation') return HEADER + PADDING + GENERATION_BODY[card.type];
  if (card.type === 'text') return 300;
  return HEADER + PADDING + preview + 200;
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

  const snapshot = snapshotOf(submitted);
  const draft: SpatialCard = {
    id: resultIdFor(task.id),
    role: 'result',
    sourceId: submitted.id,
    snapshot,
    taskId: task.id,
    type: submitted.type,
    title: `${submitted.title} #${resultCardsOf(cards, submitted.id).length + 1}`,
    tagIndex: submitted.type === 'image' ? nextTagIndex(cards) : undefined,
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

  return settleResult([...cards, placeResult(cards, submitted, draft, heightOf)], draft.id, task, heightOf);
}

/** `draft` moved to the first free slot right of the generation card `submitted` came from. */
function placeResult(cards: SpatialCard[], submitted: SpatialCard, draft: SpatialCard, heightOf: HeightOf): SpatialCard {
  const height = (c: SpatialCard) => heightOf(c) ?? estimateCardHeight(c);
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

  const snapshot = snapshotOf(submitted);
  const draft: SpatialCard = {
    id: `${TEXT_RESULT_PREFIX}${newCardId()}`,
    role: 'result',
    sourceId: submitted.id,
    snapshot,
    type: 'text',
    title: `${submitted.title} #${resultCardsOf(cards, submitted.id).length + 1}`,
    x: 0,
    y: 0,
    width: submitted.width,
    prompt: snapshot.prompt,
    provider: submitted.provider,
    model: submitted.model,
    textPreset: submitted.textPreset,
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
 * change nothing. Cards without a role are legacy cards and are matched the old way.
 */
export function applyTaskToCards(
  cards: SpatialCard[],
  task: BackendTaskResponse,
  heightOf: HeightOf = () => undefined
): SpatialCard[] {
  const placeholder = cards.find((c) => c.role === 'result' && c.taskId === task.id && !isExtraResultIdFor(task.id, c.id));
  if (placeholder) {
    return isTerminalStatus(placeholder.status) ? cards : settleResult(cards, placeholder.id, task, heightOf);
  }
  let changed = false;
  const next = cards.map((c) => {
    if (c.role) return c;
    if (c.taskId !== task.id && c.id !== task.id) return c;
    changed = true;
    return applyTaskToCard(c, task);
  });
  return changed ? next : cards;
}

/** Base image first, then layers by `z_index`, then frames by `asset_index`. */
/** Where each asset kind sorts among a task's outputs, and what its extra cards are called. */
const ASSET_KINDS: Record<TaskAssetDto['kind'], { rank: number; label?: string }> = {
  video: { rank: 0 },
  image_base: { rank: 0 },
  image_layer: { rank: 1, label: '图层' },
  image_frame: { rank: 2, label: '分镜' },
};

function orderedAssets(assets: TaskAssetDto[]): TaskAssetDto[] {
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

  const height = (c: SpatialCard) => heightOf(c) ?? estimateCardHeight(c);
  // Columns grow with the output count: 2 for up to 4 cards, 4 for a 15-frame storyboard, 5 for 17 layers.
  const columns = Math.ceil(Math.sqrt(assets.length));
  assets.slice(1).forEach((asset, i) => {
    const kindLabel = ASSET_KINDS[asset.kind].label;
    const label = kindLabel ? `${kindLabel} ${assets.filter((a) => a.kind === asset.kind).indexOf(asset) + 1}` : `${i + 2}`;
    const card: SpatialCard = {
      ...first,
      id: extraResultIdFor(task.id, asset.asset_index),
      title: `${first.title} · ${label}`,
      tagIndex: first.type === 'image' ? nextTagIndex(next) : undefined,
      outputAssets: [asset],
      resultUrl: assetStoredPath(asset),
    };
    const column = (i + 1) % columns;
    const slot = firstFreeSlotBelow(
      { x: first.x + column * (first.width + GAP), y: first.y },
      { width: card.width, height: height(card) },
      next.map((c) => ({ ...c, height: height(c) })),
      GAP
    );
    next = [...next, { ...card, ...slot }];
  });
  return next;
}

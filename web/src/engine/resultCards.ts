import type { ResultSnapshot, SpatialCard } from '../types/canvas.ts';
import type { BackendTaskResponse } from '../services/api.ts';
import { applyTaskToCard, isTerminalStatus } from './taskSync.ts';
import { nextTagIndex } from './cardFactory.ts';
import { firstFreeSlotRight } from './layout.ts';
import { requestedAspect } from './cardParams.ts';
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

/** Rendered height of a card; the page supplies measured heights when it has them. */
export type HeightOf = (card: SpatialCard) => number | undefined;

const HEADER = 40;
const PADDING = 24;
const PREVIEW_MAX_HEIGHT = 480;
/** Model / spec summary row under a result card's preview. */
const SUMMARY_ROW = 30;
/** Generation card body: prompt, summary row and the Generate button; video adds reference chips. */
const GENERATION_BODY = { image: 150, video: 180, text: 150 } as const;

/** Height a card will roughly render at, from its preview's shape. */
export function estimateCardHeight(card: SpatialCard): number {
  const aspect = requestedAspect(card) ?? 16 / 9;
  const preview = Math.min((card.width - PADDING) / aspect, PREVIEW_MAX_HEIGHT);
  if (card.role === 'result') return HEADER + PADDING + preview + SUMMARY_ROW;
  // No preview on generation cards.
  if (card.role === 'generation') return HEADER + PADDING + GENERATION_BODY[card.type];
  if (card.type === 'text') return 300;
  return HEADER + PADDING + preview + 200;
}

/** Result cards take their id from the task that produced them. */
export const resultIdFor = (taskId: string) => `result-${taskId}`;

/** A result card a task produced (as opposed to a user's pasted copy of one). */
export function isTaskResult(card: SpatialCard): boolean {
  return card.role === 'result' && !!card.taskId && card.id === resultIdFor(card.taskId);
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

  const height = (c: SpatialCard) => heightOf(c) ?? estimateCardHeight(c);
  // The generation card may have been dragged while the request was in flight.
  const anchor = cards.find((c) => c.id === submitted.id) ?? submitted;
  const slot = firstFreeSlotRight(
    { ...anchor, height: height(anchor) },
    { width: draft.width, height: height(draft) },
    cards.map((c) => ({ ...c, height: height(c) }))
  );
  return [...cards, applyTaskToCard({ ...draft, ...slot }, task)];
}

/**
 * Folds a task snapshot (SSE event or fetch) into the result card running it.
 * Generation cards never take task state; a finished result is never rolled
 * back by a stale snapshot; unmatched tasks change nothing. Cards without a
 * role are legacy cards and are matched the old way.
 */
export function applyTaskToCards(cards: SpatialCard[], task: BackendTaskResponse): SpatialCard[] {
  let changed = false;
  const next = cards.map((c) => {
    if (c.role === 'generation') return c;
    if (c.role === 'result') {
      if (c.taskId !== task.id) return c;
      if (isTerminalStatus(c.status) && !isTerminalStatus(task.status)) return c;
    } else if (c.taskId !== task.id && c.id !== task.id) {
      return c;
    }
    changed = true;
    return applyTaskToCard(c, task);
  });
  return changed ? next : cards;
}

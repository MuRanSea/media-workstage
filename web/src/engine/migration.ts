import type { ReferenceItem, SpatialCard } from '../types/canvas.ts';
import { estimateCardHeight, orderedAssets, snapshotOf } from './resultCards.ts';
import { firstFreeSlotRight } from './layout.ts';
import { assetStoredPath } from './assetPaths.ts';

/**
 * One-time migration of cards saved before generation and result cards (ADR 0005).
 *
 * A card without a role wrote its runs back onto itself. It stays where it is,
 * with its id, title and settings, as a generation card, and what it held moves
 * into result cards linked to it: its output, and the task still running on it.
 * An image card's @图N goes to its output's result card, and old links point at
 * that result card, so an old video prompt's @图3 still means the same image.
 *
 * Pure and deterministic: result ids derive from the old card's id, so opening a
 * project twice gives the same cards, and migrated cards (which have a role) pass
 * through untouched.
 */

/** Space between a migrated result card and its neighbours, as for new results. */
const GAP = 40;

/** Card types this migration knows; anything else passes through as saved. */
const MIGRATABLE = new Set<string>(['image', 'video', 'text']);

/** Run and output fields a generation card no longer holds. */
const RUN_FIELDS = ['taskId', 'resultUrl', 'outputAssets', 'errorMessage', 'textOutput', 'tagIndex'] as const;

const isLegacy = (card: SpatialCard) => !card.role && MIGRATABLE.has(card.type);
const isInProgress = (card: SpatialCard) => !!card.taskId && (card.status === 'queued' || card.status === 'running');

export const migratedOutputId = (legacyId: string) => `${legacyId}-result`;
export const migratedRunId = (legacyId: string) => `${legacyId}-run`;

export function migrateLegacyCards(cards: SpatialCard[]): SpatialCard[] {
  if (!cards.some(isLegacy)) return cards;

  let lastTag = cards.reduce((max, c) => Math.max(max, c.tagIndex ?? 0), 0);
  const claimedTasks = new Set(cards.filter((c) => c.role === 'result' && c.taskId).map((c) => c.taskId!));

  // What each legacy card splits into, before anything is placed.
  const splits = new Map<string, SpatialCard[]>();
  for (const card of cards.filter(isLegacy)) {
    const drafts: SpatialCard[] = [];
    // The old @图N stays with the first image the card yields; later ones get fresh numbers.
    let tag = card.tagIndex;
    const nextTag = () => {
      if (card.type !== 'image') return undefined;
      const t = tag ?? ++lastTag;
      tag = undefined;
      return t;
    };
    const output = outputDraft(card);
    if (output) drafts.push({ ...output, tagIndex: nextTag() });
    // Two legacy copies of one card may share a running task; only one card can follow it.
    if (isInProgress(card) && !claimedTasks.has(card.taskId!)) {
      claimedTasks.add(card.taskId!);
      drafts.push({ ...resultDraft(card, migratedRunId(card.id)), taskId: card.taskId, status: card.status, progress: card.progress, tagIndex: nextTag() });
    }
    drafts.forEach((d, i) => (d.title = `${card.title} #${i + 1}`));
    splits.set(card.id, drafts);
  }

  // Where links to a legacy card now point: the result card holding its output (or run).
  const redirect = new Map<string, string | undefined>();
  for (const [id, drafts] of splits) redirect.set(id, drafts[0]?.id);
  const present = new Set(cards.map((c) => c.id));
  const retarget = (id: string | undefined) => (id === undefined ? undefined : redirect.has(id) ? redirect.get(id) : present.has(id) ? id : undefined);
  const retargetRefs = <T extends Pick<ReferenceItem, 'cardId'>>(refs: T[] | undefined) =>
    refs?.flatMap((r) => {
      const cardId = retarget(r.cardId);
      return cardId ? [{ ...r, cardId }] : [];
    });

  // Legacy cards become generation cards in place; nothing already on the canvas moves.
  const inPlace = cards.map((card) => {
    if (!isLegacy(card)) return card;
    const g: SpatialCard = { ...card, role: 'generation', status: 'idle', progress: 0 };
    for (const f of RUN_FIELDS) delete g[f];
    if (card.references) g.references = retargetRefs(card.references)!.map(({ url: _u, localPath: _l, ...ref }) => ref);
    if (card.promptSourceId !== undefined) g.promptSourceId = retarget(card.promptSourceId);
    return g;
  });

  // Each result card takes the first free slot right of its generation card.
  const height = (c: SpatialCard) => estimateCardHeight(c);
  let next = inPlace;
  for (const card of cards.filter(isLegacy)) {
    const anchor = next.find((c) => c.id === card.id)!;
    for (const draft of splits.get(card.id)!) {
      const result: SpatialCard = draft.snapshot?.references
        ? { ...draft, snapshot: { ...draft.snapshot, references: retargetRefs(draft.snapshot.references) } }
        : draft;
      const slot = firstFreeSlotRight(
        { ...anchor, height: height(anchor) },
        { width: result.width, height: height(result) },
        next.map((c) => ({ ...c, height: height(c) })),
        GAP
      );
      next = [...next, { ...result, ...slot }];
    }
  }
  return next;
}

/** A result card of `card` without its run state, output or place. */
function resultDraft(card: SpatialCard, id: string): SpatialCard {
  const snapshot = snapshotOf(card);
  const draft: SpatialCard = {
    id,
    role: 'result',
    sourceId: card.id,
    snapshot,
    type: card.type,
    title: card.title,
    x: 0,
    y: 0,
    width: card.width,
    prompt: snapshot.prompt,
    provider: card.provider,
    model: card.model,
    ...snapshot.params,
    status: 'succeeded',
    progress: 100,
  };
  if (card.type === 'text') draft.textPreset = card.textPreset;
  return draft;
}

/** The result card holding `card`'s saved output, if it has one. */
function outputDraft(card: SpatialCard): SpatialCard | undefined {
  if (card.type === 'text') {
    if (!card.textOutput?.trim()) return undefined;
    return { ...resultDraft(card, migratedOutputId(card.id)), textOutput: card.textOutput };
  }
  const assets = orderedAssets(card.outputAssets ?? []);
  if (!assets.length && !card.resultUrl) return undefined;
  const first = assets[0];
  // An output shown while a newer run was going (or failed) came from an earlier task, named by its assets.
  const taskId = card.status === 'succeeded' ? card.taskId ?? first?.task_id : first?.task_id;
  const draft: SpatialCard = {
    ...resultDraft(card, migratedOutputId(card.id)),
    resultUrl: card.resultUrl ?? assetStoredPath(first),
  };
  if (first) draft.outputAssets = [first];
  if (taskId) draft.taskId = taskId;
  return draft;
}

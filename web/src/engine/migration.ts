import type { CardRole, ReferenceItem, SpatialCard, TaskAssetDto } from '../types/canvas.ts';
import { estimateCardHeight, extraAssetLabel, orderedAssets, placeInAssetGrid, snapshotOf } from './resultCards.ts';
import { firstFreeSlotRight } from './layout.ts';
import { assetStoredPath } from './assetPaths.ts';

/**
 * One-time migration of cards saved before generation and result cards (ADR 0005).
 *
 * A card without a role wrote its runs back onto itself. It stays where it is,
 * with its id, title and settings, as a generation card, and what it held moves
 * into result cards linked to it: each asset of its output, the task still
 * running on it, and the task that failed on it. An image card's @图N goes to
 * the result card of the image it showed, and old links point at that card, so
 * an old video prompt's @图3 still means the same image.
 *
 * Cards the old "unpack" buttons made from a card's layers or frames become
 * result cards where they are, linked to that card when they still match one of
 * its assets, which then gets no second card.
 *
 * Pure and deterministic: result ids derive from the old card's id, so opening a
 * project twice gives the same cards, and migrated cards (which have a role) pass
 * through untouched.
 */

/** A reference as older versions saved it, with the image address it had when linked. */
type SavedReference = ReferenceItem & { url?: string; localPath?: string };

/** A card as project.json holds it: without a role when saved before roles existed. */
export type SavedCard = Omit<SpatialCard, 'role' | 'references'> & { role?: CardRole; references?: SavedReference[] };

/** Space between a migrated result card and its neighbours, as for new results. */
const GAP = 40;

/** Card types this migration knows; anything else passes through as saved. */
const MIGRATABLE = new Set<string>(['image', 'video', 'text']);

/** Run and output fields a generation card no longer holds. */
const RUN_FIELDS = ['taskId', 'resultUrl', 'outputAssets', 'errorMessage', 'textOutput', 'tagIndex'] as const;

const FAILED = new Set<SpatialCard['status']>(['failed', 'cancelled', 'expired']);

const isLegacy = (card: SavedCard) => !card.role && MIGRATABLE.has(card.type);
const isInProgress = (card: SavedCard) => !!card.taskId && (card.status === 'queued' || card.status === 'running');
const hasOutput = (card: SavedCard) => !!card.resultUrl || !!card.outputAssets?.length;

/** Made by an old unpack button: a result of its own, no task, and a `layer-` / `frame-` id. */
const isUnpacked = (card: SavedCard) =>
  isLegacy(card) && card.type === 'image' && !card.taskId && hasOutput(card) && /^(layer|frame)-/.test(card.id);

/** The id the old unpack buttons gave the card for `asset`, the `index`-th of its kind on `parent`. */
const unpackedIdFor = (parent: SavedCard, asset: TaskAssetDto, index: number) =>
  `${asset.kind === 'image_layer' ? 'layer' : 'frame'}-${asset.id || index}-${parent.id}`;

export const migratedOutputId = (legacyId: string, asset?: TaskAssetDto, first = true) =>
  first || !asset ? `${legacyId}-result` : `${legacyId}-result-${asset.asset_index}`;
export const migratedRunId = (legacyId: string) => `${legacyId}-run`;
export const migratedFailureId = (legacyId: string) => `${legacyId}-failed`;

/** What a legacy generation card splits into. */
interface Split {
  /** Result cards to create for its output, in output order (base / first frame first). */
  outputs: SpatialCard[];
  /** Its running task's placeholder, and the result card of the task that failed on it. */
  runs: SpatialCard[];
  /** The card now holding the image it showed, which old links point at. */
  shown?: string;
}

/**
 * `saved` with every legacy card migrated. Cards of a type this version does not
 * know pass through as saved, so saving the project never loses them.
 */
export function migrateLegacyCards(saved: SavedCard[]): SpatialCard[] {
  // Legacy cards read as cards with a role still missing; only fields they share with new cards are used.
  const cards = saved as SpatialCard[];
  if (!saved.some(isLegacy)) return cards;

  let lastTag = cards.reduce((max, c) => Math.max(max, c.tagIndex ?? 0), 0);
  const claimedTasks = new Set(cards.filter((c) => c.role === 'result' && c.taskId).map((c) => c.taskId!));
  const unpacked = new Map(cards.filter(isUnpacked).map((c) => [c.id, c]));
  /** Unpacked card id → the generation card and asset it was made from. */
  const unpackedFrom = new Map<string, { parentId: string; asset: TaskAssetDto }>();

  const splits = new Map<string, Split>();
  for (const card of cards.filter((c) => isLegacy(c) && !unpacked.has(c.id))) {
    // The old @图N goes to the first image result made for the card; later ones get fresh numbers.
    let tag = card.tagIndex;
    const nextTag = () => {
      if (card.type !== 'image') return undefined;
      const t = tag ?? ++lastTag;
      tag = undefined;
      return t;
    };

    const split: Split = { outputs: [], runs: [] };
    const assets = outputAssetsOf(card);
    const perKind = new Map<string, number>();
    const unpackedIds = new Map<TaskAssetDto, string>();
    // The old buttons numbered layers and frames in saved order.
    for (const asset of card.outputAssets ?? []) {
      if (asset.kind !== 'image_layer' && asset.kind !== 'image_frame') continue;
      const index = perKind.get(asset.kind) ?? 0;
      perKind.set(asset.kind, index + 1);
      const id = unpackedIdFor(card, asset, index);
      if (card.type === 'image' && unpacked.has(id) && !unpackedFrom.has(id)) unpackedIds.set(asset, id);
    }

    if (assets.length || hasOutput(card)) {
      const first = resultDraft(card, migratedOutputId(card.id), `${card.title} #1`);
      assets.forEach((asset, i) => {
        const id = unpackedIds.get(asset);
        if (id) {
          unpackedFrom.set(id, { parentId: card.id, asset });
          if (i === 0) {
            split.shown = id;
            // The old @图N meant this image, which already has its own number.
            tag = undefined;
          }
          return;
        }
        const draft: SpatialCard = {
          ...first,
          id: migratedOutputId(card.id, asset, i === 0),
          title: i === 0 ? first.title : `${first.title} · ${extraAssetLabel(assets, i)}`,
          tagIndex: nextTag(),
          outputAssets: [asset],
          resultUrl: i === 0 && card.resultUrl ? card.resultUrl : assetStoredPath(asset),
        };
        // An output shown while a newer run was going (or failed) came from an earlier task, named by its assets.
        const taskId = card.status === 'succeeded' && i === 0 ? card.taskId ?? asset.task_id : asset.task_id;
        if (taskId) draft.taskId = taskId;
        split.outputs.push(draft);
      });
      if (!assets.length) split.outputs.push({ ...first, tagIndex: nextTag(), resultUrl: card.resultUrl });
      split.shown ??= split.outputs[0]?.id;
    } else if (card.type === 'text' && card.textOutput?.trim()) {
      split.outputs.push({ ...resultDraft(card, migratedOutputId(card.id), `${card.title} #1`), textOutput: card.textOutput });
      split.shown = split.outputs[0].id;
    }

    const runTitle = () => `${card.title} #${(split.outputs.length ? 1 : 0) + split.runs.length + 1}`;
    // Two legacy copies of one card may share a running task; only one card can follow it.
    if (isInProgress(card) && !claimedTasks.has(card.taskId!)) {
      claimedTasks.add(card.taskId!);
      split.runs.push({
        ...resultDraft(card, migratedRunId(card.id), runTitle()),
        taskId: card.taskId,
        status: card.status,
        progress: card.progress,
        tagIndex: nextTag(),
      });
      split.shown ??= split.runs[0].id;
    }
    // A failure without a task happened while submitting and leaves nothing behind.
    if (card.taskId && FAILED.has(card.status)) {
      split.runs.push({
        ...resultDraft(card, migratedFailureId(card.id), runTitle()),
        taskId: card.taskId,
        status: card.status,
        progress: card.progress,
        errorMessage: card.errorMessage,
        tagIndex: nextTag(),
      });
    }
    splits.set(card.id, split);
  }

  // Where links to a legacy card now point, and the @图N that card carries.
  const redirect = new Map<string, string | undefined>();
  for (const [id, split] of splits) redirect.set(id, split.shown);
  const tagOf = new Map<string, number | undefined>(cards.map((c) => [c.id, c.tagIndex]));
  for (const split of splits.values()) for (const c of [...split.outputs, ...split.runs]) tagOf.set(c.id, c.tagIndex);
  const present = new Set(cards.map((c) => c.id));
  const retarget = (id: string | undefined) =>
    id === undefined ? undefined : redirect.has(id) ? redirect.get(id) : present.has(id) ? id : undefined;
  const retargetRefs = <T extends Pick<ReferenceItem, 'cardId' | 'tagIndex'>>(refs: T[]) =>
    refs.flatMap((r) => {
      const cardId = retarget(r.cardId);
      return cardId ? [{ ...r, cardId, tagIndex: tagOf.get(cardId) ?? r.tagIndex }] : [];
    });

  // Legacy cards become generation or result cards in place; nothing already on the canvas moves.
  const inPlace = saved.map((savedCard): SpatialCard => {
    const card = savedCard as SpatialCard;
    if (!isLegacy(savedCard)) return card;
    if (unpacked.has(card.id)) {
      const from = unpackedFrom.get(card.id);
      const r: SpatialCard = { ...card, role: 'result', snapshot: snapshotOf(card), status: 'succeeded', progress: 100 };
      delete r.errorMessage;
      if (from) {
        r.sourceId = from.parentId;
        r.outputAssets = [from.asset];
      }
      return r;
    }
    const g: SpatialCard = { ...card, role: 'generation', status: 'idle', progress: 0 };
    for (const f of RUN_FIELDS) delete g[f];
    if (savedCard.references) {
      const refs = retargetRefs(savedCard.references).map(({ url: _u, localPath: _l, ...ref }) => ref);
      // A link now pointing at a card with another @图N follows it in the prompt.
      savedCard.references.forEach((old) => {
        const now = refs.find((r) => r.cardId === retarget(old.cardId));
        if (now && now.tagIndex !== old.tagIndex) g.prompt = g.prompt.replace(new RegExp(`@图${old.tagIndex}\\b`, 'g'), `@图${now.tagIndex}`);
      });
      g.references = refs;
    }
    if (card.promptSourceId !== undefined) g.promptSourceId = retarget(card.promptSourceId);
    return g;
  });

  // Result cards take the first free slot right of their generation card; several outputs form a grid.
  const height = (c: SpatialCard) => estimateCardHeight(c);
  const firstFreeRight = (anchor: SpatialCard, card: SpatialCard, all: SpatialCard[]) => ({
    ...card,
    ...firstFreeSlotRight(
      { ...anchor, height: height(anchor) },
      { width: card.width, height: height(card) },
      all.map((c) => ({ ...c, height: height(c) })),
      GAP
    ),
  });
  const withLinks = (card: SpatialCard): SpatialCard =>
    card.snapshot?.references ? { ...card, snapshot: { ...card.snapshot, references: retargetRefs(card.snapshot.references) } } : card;

  let next = inPlace;
  for (const [id, split] of splits) {
    const anchor = next.find((c) => c.id === id)!;
    let first: SpatialCard | undefined;
    split.outputs.map(withLinks).forEach((card, i) => {
      const placed = first ? placeInAssetGrid(card, first, i, split.outputs.length, next) : firstFreeRight(anchor, card, next);
      first ??= placed;
      next = [...next, placed];
    });
    for (const run of split.runs) next = [...next, firstFreeRight(anchor, withLinks(run), next)];
  }
  return next;
}

/** The assets a card's output splits into: every image in output order, or a video alone. */
function outputAssetsOf(card: SpatialCard): TaskAssetDto[] {
  if (card.type === 'text') return [];
  const assets = orderedAssets(card.outputAssets ?? []);
  // A video task's extra assets (a returned last frame) belong to the video.
  return card.type === 'video' ? assets.slice(0, 1) : assets;
}

/** A result card of `card` with its settings snapshot, not yet placed; succeeded unless overridden. */
function resultDraft(card: SpatialCard, id: string, title: string): SpatialCard {
  const snapshot = snapshotOf(card);
  const draft: SpatialCard = {
    id,
    role: 'result',
    sourceId: card.id,
    snapshot,
    type: card.type,
    title,
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

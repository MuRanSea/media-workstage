import type { CardRole, ReferenceItem, SpatialCard, TaskAssetDto } from '../types/canvas.ts';
import { extraAssetLabel, orderedAssets, placeInAssetGrid, placeResult, resultDraft, snapshotOf } from './resultCards.ts';
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
 * through untouched apart from dropping saved reference addresses.
 */

/** A reference as older versions saved it, with the image address it had when linked. */
type SavedReference = ReferenceItem & { url?: string; localPath?: string };

/** A card as project.json holds it: without a role when saved before roles existed. */
export type SavedCard = Omit<SpatialCard, 'role' | 'references'> & { role?: CardRole; references?: SavedReference[] };

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

/** Result ids derive from the legacy card's id, so migrating twice gives the same cards. */
const outputId = (legacyId: string) => `${legacyId}-result`;
const extraOutputId = (legacyId: string, asset: TaskAssetDto) => `${legacyId}-result-${asset.asset_index}`;
const runId = (legacyId: string) => `${legacyId}-run`;
const failureId = (legacyId: string) => `${legacyId}-failed`;

const hasSavedAddress = (card: SavedCard) => !!card.references?.some((r) => r.url !== undefined || r.localPath !== undefined);

/** References without the address older versions saved when linking: the image is read from the card. */
const withoutSavedAddress = (refs: SavedReference[]): ReferenceItem[] => refs.map(({ url: _u, localPath: _l, ...ref }) => ref);

/** What a legacy generation card splits into. */
interface Split {
  /** Result cards to create for its output, in output order (base / first frame first). */
  outputs: SpatialCard[];
  /** Its running task's placeholder, and the result card of the task that failed on it. */
  runs: SpatialCard[];
  /** Where old links to it now point: the card holding the output it showed, else its running task's placeholder. */
  linkTarget?: string;
}

/**
 * `saved` with every legacy card migrated. Cards of a type this version does not
 * know pass through as saved, so saving the project never loses them.
 */
export function migrateLegacyCards(saved: SavedCard[]): SpatialCard[] {
  // Legacy cards read as cards with a role still missing; only fields they share with new cards are used.
  const cards = saved as SpatialCard[];
  if (!saved.some((c) => isLegacy(c) || hasSavedAddress(c))) return cards;

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
      const first = doneDraft(card, outputId(card.id), `${card.title} #1`);
      assets.forEach((asset, i) => {
        const id = unpackedIds.get(asset);
        if (id) {
          unpackedFrom.set(id, { parentId: card.id, asset });
          if (i === 0) {
            split.linkTarget = id;
            // The old @图N meant this image, which already has its own number.
            tag = undefined;
          }
          return;
        }
        const draft: SpatialCard = {
          ...first,
          id: i === 0 ? first.id : extraOutputId(card.id, asset),
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
      split.linkTarget ??= split.outputs[0]?.id;
    } else if (card.type === 'text' && card.textOutput?.trim()) {
      split.outputs.push({ ...doneDraft(card, outputId(card.id), `${card.title} #1`), textOutput: card.textOutput });
      split.linkTarget = split.outputs[0].id;
    }

    const runTitle = () => `${card.title} #${(split.outputs.length ? 1 : 0) + split.runs.length + 1}`;
    // Two legacy copies of one card may share a running task; only one card can follow it.
    if (isInProgress(card) && !claimedTasks.has(card.taskId!)) {
      claimedTasks.add(card.taskId!);
      split.runs.push({
        ...resultDraft(card, runId(card.id), runTitle()),
        taskId: card.taskId,
        status: card.status,
        progress: card.progress,
        tagIndex: nextTag(),
      });
      // Its output will arrive on the placeholder, as it would have arrived on the old card.
      split.linkTarget ??= split.runs[0].id;
    }
    // A failure without a task happened while submitting and leaves nothing behind.
    if (card.taskId && FAILED.has(card.status)) {
      split.runs.push({
        ...resultDraft(card, failureId(card.id), runTitle()),
        taskId: card.taskId,
        status: card.status,
        progress: card.progress,
        errorMessage: card.errorMessage,
        tagIndex: nextTag(),
      });
    }
    splits.set(card.id, split);
  }

  // Where links to a legacy card now point, and the @图N each card carries.
  const redirect = new Map<string, string | undefined>();
  for (const [id, split] of splits) redirect.set(id, split.linkTarget);
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
  /** `prompt` with the @图N of each of `refs` renumbered when it now points at a card with another number. */
  const retag = (prompt: string, refs: Pick<ReferenceItem, 'cardId' | 'tagIndex'>[]) =>
    refs.reduce((text, old) => {
      const target = retarget(old.cardId);
      const now = target === undefined ? undefined : tagOf.get(target);
      return now !== undefined && now !== old.tagIndex ? text.replace(new RegExp(`@图${old.tagIndex}\\b`, 'g'), `@图${now}`) : text;
    }, prompt);

  // Legacy cards become generation or result cards in place; nothing already on the canvas moves.
  const inPlace = saved.map((savedCard): SpatialCard => {
    const card = savedCard as SpatialCard;
    if (!isLegacy(savedCard)) {
      return hasSavedAddress(savedCard) ? { ...card, references: withoutSavedAddress(savedCard.references!) } : card;
    }
    if (unpacked.has(card.id)) {
      const from = unpackedFrom.get(card.id);
      const result: SpatialCard = { ...card, role: 'result', snapshot: snapshotOf(card), status: 'succeeded', progress: 100 };
      delete result.errorMessage;
      if (from) {
        result.sourceId = from.parentId;
        result.outputAssets = [from.asset];
      }
      return result;
    }
    const generation: SpatialCard = { ...card, role: 'generation', status: 'idle', progress: 0 };
    for (const f of RUN_FIELDS) delete generation[f];
    if (savedCard.references) {
      generation.references = withoutSavedAddress(retargetRefs(savedCard.references));
      // A link now pointing at a card with another @图N follows it in the prompt.
      generation.prompt = retag(card.prompt, savedCard.references);
    }
    if (card.promptSourceId !== undefined) generation.promptSourceId = retarget(card.promptSourceId);
    return generation;
  });

  // A result's snapshot records the links its run was sent with; they follow the migrated cards too.
  const withLinks = (card: SpatialCard): SpatialCard => {
    const snapshot = card.snapshot;
    if (!snapshot?.references) return card;
    const prompt = retag(snapshot.prompt, snapshot.references);
    return { ...card, prompt, snapshot: { ...snapshot, prompt, references: retargetRefs(snapshot.references) } };
  };

  // Result cards take the first free slot right of their generation card; several outputs form a grid.
  let next = inPlace;
  for (const [id, split] of splits) {
    const generation = next.find((c) => c.id === id)!;
    let first: SpatialCard | undefined;
    split.outputs.map(withLinks).forEach((card, i) => {
      const placed = first ? placeInAssetGrid(card, first, i, split.outputs.length, next) : placeResult(next, generation, card);
      first ??= placed;
      next = [...next, placed];
    });
    for (const run of split.runs) next = [...next, placeResult(next, generation, withLinks(run))];
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

/** A finished result card of `card`'s saved output, not yet placed. */
function doneDraft(card: SpatialCard, id: string, title: string): SpatialCard {
  return { ...resultDraft(card, id, title), status: 'succeeded', progress: 100 };
}

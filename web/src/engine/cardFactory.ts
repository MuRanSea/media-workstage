import type { CardType, SpatialCard } from '../types/canvas.ts';
import type { Point } from './matrix.ts';

const CARD_WIDTH: Record<CardType, number> = { image: 340, video: 460, text: 340 };
const CASCADE = 32;

const TITLES: Record<CardType, string> = { image: '图片', video: '视频', text: '提示词助手' };

/** Next free @图N: one past the highest tag, so deleted cards never cause duplicates. */
export function nextTagIndex(cards: SpatialCard[]): number {
  return cards.reduce((max, c) => Math.max(max, c.tagIndex), 0) + 1;
}

let idCounter = 0;
export function newCardId(): string {
  idCounter = (idCounter + 1) % 1000;
  return `card-${Date.now().toString(36)}-${idCounter}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Top-left for a card centred on `at`, stepped down-right while another card already sits there. */
export function placeCard(at: Point, width: number, cards: SpatialCard[]): Point {
  let x = Math.round(at.x - width / 2);
  let y = Math.round(at.y - 120);
  for (let i = 0; i < 50 && cards.some((c) => Math.abs(c.x - x) < 8 && Math.abs(c.y - y) < 8); i++) {
    x += CASCADE;
    y += CASCADE;
  }
  return { x, y };
}

/** A new card of `type` centred on world point `at`. */
export function createCard(type: CardType, at: Point, cards: SpatialCard[]): SpatialCard {
  const tagIndex = nextTagIndex(cards);
  const width = CARD_WIDTH[type];
  const common = {
    id: newCardId(),
    type,
    title: `${TITLES[type]} ${tagIndex}`,
    tagIndex,
    ...placeCard(at, width, cards),
    width,
    prompt: '',
    status: 'idle' as const,
    progress: 0,
  };
  if (type === 'image') {
    return {
      ...common,
      provider: 'ark',
      model: 'doubao-seedream-5-0-pro-260628',
      imageMode: 'single',
      sizeMode: 'tier',
      imageTier: '2K',
      imageRatioPreset: '16:9',
      imageFormat: 'jpeg',
      watermark: false,
      background: 'opaque',
    };
  }
  if (type === 'video') {
    return {
      ...common,
      provider: 'ark',
      model: 'doubao-seedance-2-5-260628',
      mode: 'all_modal',
      resolution: '720p',
      duration: 5,
      ratio: '16:9',
      generateAudio: true,
      outputFormat: 'mp4',
      promptOptimizer: true,
      references: [],
    };
  }
  return { ...common, model: '', textPreset: 'image_prompt', textOutput: '' };
}

/** Default titles carry the tag number ("图片 3"); copies renumber those and mark custom ones. */
function copyTitle(card: SpatialCard, newTag: number): string {
  const auto = new RegExp(`^${TITLES[card.type]} \\d+$`);
  return auto.test(card.title) ? `${TITLES[card.type]} ${newTag}` : `${card.title} 副本`;
}

/** Task results are not copied: a duplicate starts idle with the same settings. */
const RESULT_FIELDS = ['taskId', 'status', 'progress', 'errorMessage', 'resultUrl', 'outputAssets'] as const;

/**
 * Copies of `source` cards placed with their top-left group corner at `at`.
 * Ids and @图N tags are new; links (references, prompt source) are kept only
 * when both ends are copied, and remapped to the copies.
 */
export function duplicateCards(source: SpatialCard[], at: Point, existing: SpatialCard[], keepResults = true): SpatialCard[] {
  if (source.length === 0) return [];
  const minX = Math.min(...source.map((c) => c.x));
  const minY = Math.min(...source.map((c) => c.y));
  let tag = nextTagIndex(existing);
  const idMap = new Map<string, string>();
  const tagMap = new Map<number, number>();
  for (const c of source) {
    idMap.set(c.id, newCardId());
    tagMap.set(c.tagIndex, tag++);
  }

  return source.map((c) => {
    const copy: SpatialCard = {
      ...c,
      id: idMap.get(c.id)!,
      tagIndex: tagMap.get(c.tagIndex)!,
      title: copyTitle(c, tagMap.get(c.tagIndex)!),
      x: Math.round(at.x + (c.x - minX)),
      y: Math.round(at.y + (c.y - minY)),
    };
    if (!keepResults) {
      for (const f of RESULT_FIELDS) delete copy[f];
      copy.status = 'idle';
      copy.progress = 0;
    }
    copy.references = c.references
      ?.filter((r) => idMap.has(r.cardId))
      .map((r) => ({ ...r, cardId: idMap.get(r.cardId)!, tagIndex: tagMap.get(r.tagIndex) ?? r.tagIndex }));
    copy.promptSourceId = c.promptSourceId && idMap.has(c.promptSourceId) ? idMap.get(c.promptSourceId) : undefined;
    // Rewrite @图N in the prompt for references that were remapped.
    if (c.references?.length) {
      copy.prompt = c.prompt.replace(/@图(\d+)/g, (m, n) => {
        const ref = c.references!.find((r) => r.tagIndex === Number(n));
        return ref && idMap.has(ref.cardId) ? `@图${tagMap.get(ref.tagIndex)}` : m;
      });
    }
    return copy;
  });
}

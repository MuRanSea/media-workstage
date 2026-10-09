import type { CardType, SpatialCard, UploadKind } from '../types/canvas.ts';
import type { Point } from './matrix.ts';
import { refNoun } from './refTags.ts';

const CARD_WIDTH: Record<CardType, number> = { image: 340, video: 460, text: 340, upload: 300 };
const CASCADE = 32;

const TITLES: Record<CardType, string> = { image: '图片', video: '视频', text: '提示词助手', upload: '上传' };

/** Next free @图N / @视频N: one past the highest tag, so deleted cards never cause duplicates. */
export function nextTagIndex(cards: SpatialCard[]): number {
  return cards.reduce((max, c) => Math.max(max, c.tagIndex ?? 0), 0) + 1;
}

let idCounter = 0;
export function newCardId(): string {
  idCounter = (idCounter + 1) % 1000;
  return `card-${Date.now().toString(36)}-${idCounter}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Top-left for a card centred on `at`, stepped down-right while another card already sits there. */
export function placeCard(at: Point, width: number, cards: SpatialCard[]): Point {
  return cascadeFrom({ x: at.x - width / 2, y: at.y - 120 }, cards);
}

/** `topLeft`, stepped down and right while a card already sits (almost) exactly there. */
export function cascadeFrom(topLeft: Point, cards: SpatialCard[]): Point {
  let x = Math.round(topLeft.x);
  let y = Math.round(topLeft.y);
  for (let i = 0; i < 50 && cards.some((c) => Math.abs(c.x - x) < 8 && Math.abs(c.y - y) < 8); i++) {
    x += CASCADE;
    y += CASCADE;
  }
  return { x, y };
}

/**
 * A new card of `type` centred on world point `at`: a generation card, or for
 * `upload` a result card with no source. Generation cards carry no @图N tag;
 * image and video result cards (uploads included) get one.
 */
export function createCard(type: CardType, at: Point, cards: SpatialCard[], mediaKind: UploadKind = 'image'): SpatialCard {
  const width = CARD_WIDTH[type];
  const common = {
    id: newCardId(),
    type,
    role: 'generation' as const,
    title: `${TITLES[type]} ${cards.filter((c) => c.type === type && c.role === 'generation').length + 1}`,
    ...placeCard(at, width, cards),
    width,
    prompt: '',
    status: 'idle' as const,
    progress: 0,
  };
  if (type === 'upload') {
    const tagIndex = nextTagIndex(cards);
    const title = `${mediaKind === 'video' ? '上传视频' : '上传图片'} ${tagIndex}`;
    return { ...common, role: 'result', tagIndex, title, model: '', mediaKind };
  }
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
  const auto = /^(图片|视频|提示词助手|上传图片|上传视频) \d+$/;
  return auto.test(card.title) ? `${card.title.replace(/ \d+$/, '')} ${newTag}` : `${card.title} 副本`;
}

/**
 * Copies of `source` cards placed with their top-left group corner at `at`.
 * Ids and @图N tags are new; links (references, prompt source) are kept only
 * when both ends are copied, and remapped to the copies.
 */
export function duplicateCards(source: SpatialCard[], at: Point, existing: SpatialCard[]): SpatialCard[] {
  // A running result card cannot be copied: the copy would never get the task's updates.
  source = source.filter((c) => !(c.role === 'result' && (c.status === 'queued' || c.status === 'running')));
  if (source.length === 0) return [];
  const minX = Math.min(...source.map((c) => c.x));
  const minY = Math.min(...source.map((c) => c.y));
  let tag = nextTagIndex(existing);
  const idMap = new Map<string, string>();
  const tagMap = new Map<number, number>();
  for (const c of source) {
    idMap.set(c.id, newCardId());
    if (c.tagIndex !== undefined) tagMap.set(c.tagIndex, tag++);
  }

  return source.map((c) => {
    const newTag = c.tagIndex !== undefined ? tagMap.get(c.tagIndex) : undefined;
    const copy: SpatialCard = {
      ...c,
      id: idMap.get(c.id)!,
      tagIndex: newTag,
      title: newTag !== undefined ? copyTitle(c, newTag) : `${c.title} 副本`,
      x: Math.round(at.x + (c.x - minX)),
      y: Math.round(at.y + (c.y - minY)),
    };
    copy.references = c.references
      ?.filter((r) => idMap.has(r.cardId))
      .map((r) => ({ ...r, cardId: idMap.get(r.cardId)!, tagIndex: tagMap.get(r.tagIndex) ?? r.tagIndex }));
    copy.promptSourceId = c.promptSourceId && idMap.has(c.promptSourceId) ? idMap.get(c.promptSourceId) : undefined;
    copy.sourceId = c.sourceId && idMap.has(c.sourceId) ? idMap.get(c.sourceId) : undefined;
    // Task updates go to the original result card only; without the task its follow-ups cannot run.
    if (c.role === 'result') {
      delete copy.taskId;
      delete copy.resultActions;
    }
    // Rewrite @图N in the prompt for references that were remapped.
    if (c.references?.length) {
      copy.prompt = c.prompt.replace(/@(图|视频)(\d+)/g, (m, noun, n) => {
        const ref = c.references!.find((r) => r.tagIndex === Number(n) && refNoun(r.role) === noun);
        return ref && idMap.has(ref.cardId) ? `@${noun}${tagMap.get(ref.tagIndex)}` : m;
      });
    }
    return copy;
  });
}

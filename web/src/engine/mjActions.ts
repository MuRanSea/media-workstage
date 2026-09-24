import type { SpatialCard, TaskActionDto } from '../types/canvas.ts';
import { newCardId, nextTagIndex } from './cardFactory.ts';

/** Horizontal gap between a card and the cards derived from it. */
const DERIVED_GAP = 80;
/** Offset between successive cards derived from the same source. */
const DERIVED_CASCADE = 40;

/** Display name of a follow-up; Midjourney's reroll button carries only 🔄. */
export function actionLabel(action: TaskActionDto): string {
  if (action.label) return action.label;
  if (action.emoji === '🔄') return '重绘';
  return action.emoji || action.id;
}

export interface ActionGroups {
  upscale: TaskActionDto[];
  variation: TaskActionDto[];
  other: TaskActionDto[];
}

/** Splits a grid's buttons into the U row, the V row and everything else, keeping order. */
export function groupActions(actions: TaskActionDto[]): ActionGroups {
  const groups: ActionGroups = { upscale: [], variation: [], other: [] };
  for (const a of actions) {
    if (/^U\d$/.test(a.label ?? '')) groups.upscale.push(a);
    else if (/^V\d$/.test(a.label ?? '')) groups.variation.push(a);
    else groups.other.push(a);
  }
  return groups;
}

/**
 * A new idle image card, right of `source`, that runs `action` on the source's task.
 * It keeps the source's provider, model and ratio; `prompt` is the source's effective
 * prompt (a linked text card's output, if any). Results and links are not copied.
 */
export function spawnActionCard(source: SpatialCard, action: TaskActionDto, cards: SpatialCard[], prompt: string): SpatialCard {
  if (!source.taskId) throw new Error(`「${source.title}」还没有可以操作的生成结果`);
  const siblings = cards.filter((c) => c.derivedFrom?.cardId === source.id).length;
  const tagIndex = nextTagIndex(cards);
  const label = actionLabel(action);
  return {
    id: newCardId(),
    type: 'image',
    title: `${source.title} · ${label}`,
    tagIndex,
    x: source.x + source.width + DERIVED_GAP + siblings * DERIVED_CASCADE,
    y: source.y + siblings * DERIVED_CASCADE,
    width: source.width,
    prompt,
    provider: source.provider,
    model: source.model,
    imageRatioPreset: source.imageRatioPreset,
    status: 'idle',
    progress: 0,
    derivedFrom: { cardId: source.id, taskId: source.taskId, actionId: action.id, label, operation: 'action' },
  };
}

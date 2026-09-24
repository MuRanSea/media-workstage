import type { SpatialCard, ResultActionDto } from '../types/canvas.ts';
import type { ProviderConfigItem, ProviderId } from '../services/api.ts';
import { newCardId, nextTagIndex } from './cardFactory.ts';
import { referenceTo } from './connections.ts';

/** Horizontal gap between a card and the cards derived from it. */
const DERIVED_GAP = 80;
/** Offset between successive cards derived from the same source. */
const DERIVED_CASCADE = 40;

/** Display name of a follow-up; Midjourney's reroll button carries only 🔄. */
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

/**
 * A new idle image card, right of `source`, that runs `action` on the source's task.
 * It keeps the source's provider, model and ratio; `prompt` is the source's effective
 * prompt (a linked text card's output, if any). Results and links are not copied.
 */
export function spawnActionCard(source: SpatialCard, action: ResultActionDto, cards: SpatialCard[], prompt: string): SpatialCard {
  if (!source.taskId) throw new Error(`「${source.title}」还没有可以操作的生成结果`);
  const tagIndex = nextTagIndex(cards);
  const label = actionLabel(action);
  return {
    id: newCardId(),
    type: 'image',
    title: `${source.title} · ${label}`,
    tagIndex,
    ...derivedPosition(source, cards),
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

/** Right of `source`, stepped for each card already derived from it. */
function derivedPosition(source: SpatialCard, cards: SpatialCard[]): { x: number; y: number } {
  const siblings = cards.filter((c) => c.derivedFrom?.cardId === source.id).length;
  return {
    x: source.x + source.width + DERIVED_GAP + siblings * DERIVED_CASCADE,
    y: source.y + siblings * DERIVED_CASCADE,
  };
}

/** The Midjourney provider and image model that runs Describe, if one is configured. */
export function findDescribeProvider(providers: ProviderConfigItem[]): { provider: ProviderId; model: string } | undefined {
  for (const p of providers) {
    if (p.protocol !== 'midjourney' || !p.is_configured) continue;
    const model = p.models.find((m) => m.type === 'image');
    if (model) return { provider: p.id, model: model.id };
  }
  return undefined;
}

/**
 * A new text card, right of `source`, that asks Midjourney for prompts matching the
 * source's image. The image is kept as its reference so the card can run again later.
 */
export function spawnDescribeCard(
  source: SpatialCard,
  target: { provider: ProviderId; model: string },
  cards: SpatialCard[]
): SpatialCard {
  if (!source.resultUrl || !source.taskId) throw new Error(`「${source.title}」还没有生成图片，无法反推提示词`);
  return {
    id: newCardId(),
    type: 'text',
    title: `${source.title} · 反推`,
    tagIndex: nextTagIndex(cards),
    ...derivedPosition(source, cards),
    width: 340,
    prompt: '',
    textOutput: '',
    provider: target.provider,
    model: target.model,
    status: 'idle',
    progress: 0,
    derivedFrom: { cardId: source.id, taskId: source.taskId, label: '反推', operation: 'describe' },
    references: [referenceTo(source)],
  };
}

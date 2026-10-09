import { describe, expect, it } from 'vitest';
import type { SpatialCard } from '../types/canvas.ts';
import { cardHeight, createCardMetrics } from './cardMetrics.ts';
import { estimateCardHeight } from './resultCards.ts';
import { alignCards, autoArrangeGrid, getCardsBoundingBox } from './layout.ts';

const card = (over: Partial<SpatialCard> = {}): SpatialCard =>
  ({ id: 'a', type: 'image', role: 'generation', title: 'a', x: 0, y: 0, width: 320, ...over }) as SpatialCard;

describe('cardHeight', () => {
  it('prefers the measured height', () => {
    const metrics = createCardMetrics();
    const c = card();
    metrics.set(c.id, 777);
    expect(cardHeight(metrics, c)).toBe(777);
  });

  it('falls back to the estimate while a card has no measurement', () => {
    const c = card();
    expect(cardHeight(createCardMetrics(), c)).toBe(estimateCardHeight(c));
  });

  it('forgets a card once it is removed', () => {
    const metrics = createCardMetrics();
    const c = card();
    metrics.set(c.id, 777);
    metrics.remove(c.id);
    expect(cardHeight(metrics, c)).toBe(estimateCardHeight(c));
  });

  it('picks up a new height after the card resizes', () => {
    const metrics = createCardMetrics();
    const c = card();
    metrics.set(c.id, 300);
    metrics.set(c.id, 520);
    expect(cardHeight(metrics, c)).toBe(520);
  });

  it('ignores a zero height, which means the card is hidden', () => {
    const metrics = createCardMetrics();
    const c = card();
    metrics.set(c.id, 300);
    metrics.set(c.id, 0);
    expect(cardHeight(metrics, c)).toBe(300);
  });
});

describe('layout with measured heights', () => {
  const tall = card({ id: 'tall', x: 0, y: 0 });
  const short = card({ id: 'short', x: 400, y: 100 });
  const metrics = createCardMetrics();
  metrics.set('tall', 700);
  metrics.set('short', 200);
  const heightOf = (c: SpatialCard) => cardHeight(metrics, c);
  const ids = new Set(['tall', 'short']);

  it('bounds the cards by their real heights', () => {
    expect(getCardsBoundingBox([tall, short], heightOf)).toEqual({ x: 0, y: 0, width: 720, height: 700 });
  });

  it('aligns bottom edges so they end up flush', () => {
    const [t, s] = alignCards([tall, short], ids, 'bottom', heightOf);
    expect(t.y + 700).toBe(s.y + 200);
  });

  it('centres cards vertically on their real heights', () => {
    const [t, s] = alignCards([tall, short], ids, 'center-v', heightOf);
    expect(t.y + 350).toBe(s.y + 100);
  });

  it('sizes grid rows by the tallest card', () => {
    const third = card({ id: 'third' });
    metrics.set('third', 100);
    const out = autoArrangeGrid([tall, short, third], new Set(['tall', 'short', 'third']), 40, 2, heightOf);
    expect(out[2].y - out[0].y).toBe(700 + 40);
  });
});

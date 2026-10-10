import { createContext, useContext, useEffect, type RefObject } from 'react';
import type { CardMetrics } from '../../engine/cardMetrics.ts';

/** Where cards report their rendered height. */
export const CardMetricsContext = createContext<CardMetrics | null>(null);

/**
 * Reports the element's rendered height (unaffected by canvas zoom) while the
 * card is mounted. Unmounting keeps the last height: a card scrolled out of view
 * is still that tall. Deleted cards are dropped by the page.
 */
export function useReportCardHeight(id: string, ref: RefObject<HTMLElement | null>) {
  const metrics = useContext(CardMetricsContext);
  useEffect(() => {
    const el = ref.current;
    if (!metrics || !el) return;
    const report = () => metrics.set(id, el.offsetHeight);
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    return () => observer.disconnect();
  }, [id, metrics, ref]);
}

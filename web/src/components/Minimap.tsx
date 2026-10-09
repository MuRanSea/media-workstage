import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SpatialCard } from '../types/canvas.ts';
import type { CanvasTransform, Point, ViewportSize } from '../engine/matrix.ts';
import { centerOn, minimapFrame, minimapToWorld, viewportWorldRect, worldToMinimap } from '../engine/minimap.ts';

const WIDTH = 200;
const HEIGHT = 140;

/** Card colours, by type: the same hues as the cards' accents. */
const FILL: Record<SpatialCard['type'], string> = {
  image: 'rgba(244, 114, 182, 0.75)',
  video: 'rgba(129, 140, 248, 0.75)',
  text: 'rgba(52, 211, 153, 0.75)',
  upload: 'rgba(251, 191, 36, 0.75)',
};

const STORAGE_KEY = 'mw-minimap';

/** Whether the minimap is shown; a per-browser preference, on by default. */
export function useMinimapVisible(): [boolean, (visible: boolean) => void] {
  const [visible, setVisible] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) !== '0';
    } catch {
      return true;
    }
  });
  const set = useCallback((next: boolean) => {
    setVisible(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    } catch {
      // Storage blocked: the choice holds for this session.
    }
  }, []);
  return [visible, set];
}

interface MinimapProps {
  cards: SpatialCard[];
  heightOf: (card: SpatialCard) => number;
  transform: CanvasTransform;
  viewport: ViewportSize;
  /** Distance from the right edge, to clear the inspector panel. */
  right: number;
  onPan: (next: CanvasTransform) => void;
}

/** Overview of the whole canvas; click or drag in it to move the view there. */
export const Minimap: React.FC<MinimapProps> = ({ cards, heightOf, transform, viewport, right, onPan }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useMemo(() => viewportWorldRect(transform, viewport), [transform, viewport]);
  const rects = useMemo(
    () => cards.map((c) => ({ type: c.type, x: c.x, y: c.y, width: c.width, height: heightOf(c) })),
    [cards, heightOf]
  );
  const frame = useMemo(() => minimapFrame(rects, view, { width: WIDTH, height: HEIGHT }), [rects, view]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = WIDTH * dpr;
    canvas.height = HEIGHT * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    for (const r of rects) {
      const p = worldToMinimap(r, frame);
      ctx.fillStyle = FILL[r.type];
      ctx.fillRect(p.x, p.y, Math.max(1.5, r.width * frame.scale), Math.max(1.5, r.height * frame.scale));
    }
    const v = worldToMinimap(view, frame);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.fillStyle = 'rgba(148, 163, 184, 0.08)';
    ctx.fillRect(v.x, v.y, view.width * frame.scale, view.height * frame.scale);
    ctx.strokeRect(v.x, v.y, view.width * frame.scale, view.height * frame.scale);
  }, [rects, view, frame]);

  // The frame changes while dragging (the view moves); keep using the one the drag started with.
  const dragFrame = useRef(frame);
  const latest = useRef({ transform, viewport, onPan });
  latest.current = { transform, viewport, onPan };

  const panTo = (clientX: number, clientY: number) => {
    const box = canvasRef.current?.getBoundingClientRect();
    if (!box) return;
    const point: Point = { x: clientX - box.left, y: clientY - box.top };
    const { transform: t, viewport: vp, onPan: pan } = latest.current;
    pan(centerOn(minimapToWorld(point, dragFrame.current), t, vp));
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragFrame.current = frame;
    panTo(e.clientX, e.clientY);
    const onMove = (ev: MouseEvent) => panTo(ev.clientX, ev.clientY);
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div
      style={{ right, width: WIDTH, height: HEIGHT }}
      className="fixed bottom-[68px] z-40 rounded-xl overflow-hidden bg-canvas-surface/90 backdrop-blur-md border border-slate-800 shadow-lg shadow-black/40 transition-[right] duration-200"
    >
      <canvas
        ref={canvasRef}
        data-minimap
        title="小地图：点击或拖动跳转"
        onMouseDown={onMouseDown}
        style={{ width: WIDTH, height: HEIGHT }}
        className="block cursor-pointer"
      />
    </div>
  );
};

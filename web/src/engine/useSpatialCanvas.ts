import { useState, useRef, useEffect, useCallback } from 'react';
import {
  type CanvasTransform,
  type Point,
  type Rect,
  calculateZoomAtPoint,
  calculateFitView,
  calculateFocusRects,
  screenToWorld,
  wheelZoomFactor,
} from './matrix.ts';
import {
  isRectIntersecting,
  getMarqueeRect,
  getCardsBoundingBox,
  alignCards,
  autoArrangeGrid,
  type AlignmentType,
} from './layout.ts';
import type { CanvasTool, SpatialCard } from '../types/canvas.ts';
import type { CardHeightOf } from './layout.ts';
import { sameIds } from './culling.ts';
import { snapBox, SNAP_THRESHOLD_PX, type SnapGuide } from './snapping.ts';

interface UseSpatialCanvasProps {
  cards: SpatialCard[];
  setCards: React.Dispatch<React.SetStateAction<SpatialCard[]>>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** A card's rendered height: measured when on screen, estimated otherwise. */
  heightOf: CardHeightOf<SpatialCard>;
  initialZoom?: number;
  initialPanX?: number;
  initialPanY?: number;
  /** Called once before a user edit changes card positions (drag, align), for undo. */
  onBeforeEdit?: () => void;
  /** False while a dialog covers the canvas, so its keys do not move the canvas. */
  keyboardEnabled?: boolean;
  /** Cards inside collapsed sections: not selectable, not snapped to, not framed by fit view. */
  hiddenIds?: ReadonlySet<string>;
  /** Section rectangles, so fit view frames sections too (a collapsed one may hold every card). */
  sectionRects?: Rect[];
}

const NO_IDS: ReadonlySet<string> = new Set();
const NO_RECTS: Rect[] = [];

export function useSpatialCanvas({
  cards,
  setCards,
  containerRef,
  heightOf,
  initialZoom = 0.85,
  initialPanX = 60,
  initialPanY = 40,
  onBeforeEdit,
  keyboardEnabled = true,
  hiddenIds = NO_IDS,
  sectionRects = NO_RECTS,
}: UseSpatialCanvasProps) {
  const [transform, setTransform] = useState<CanvasTransform>({
    zoom: initialZoom,
    panX: initialPanX,
    panY: initialPanY,
  });

  const [activeTool, setActiveTool] = useState<CanvasTool>('select');
  const [isPanning, setIsPanning] = useState(false);

  // Multi-selection state
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());

  // Marquee selection state
  const [isMarqueeSelecting, setIsMarqueeSelecting] = useState(false);
  const [marqueeStartScreen, setMarqueeStartScreen] = useState<Point | null>(null);
  const [marqueeCurrentScreen, setMarqueeCurrentScreen] = useState<Point | null>(null);

  // Multi-card dragging state
  const [isDraggingCards, setIsDraggingCards] = useState(false);
  const dragStartWorldRef = useRef<Point>({ x: 0, y: 0 });
  const initialCardPositionsRef = useRef<Map<string, Point>>(new Map());
  // A drag records its undo step on the first actual move, so plain clicks add none.
  const dragRecordedRef = useRef(false);
  // Snapping: the dragged cards' box when the drag began, and the cards it can snap to.
  const dragBoxRef = useRef<Rect | null>(null);
  const snapTargetsRef = useRef<Rect[]>([]);
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);

  const startPanRef = useRef<Point>({ x: 0, y: 0 });
  const mousePosRef = useRef<Point>({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const isSpacePressedRef = useRef(false);
  // Holding space borrows the hand tool; letting go gives back the tool picked before.
  const toolBeforeSpaceRef = useRef<CanvasTool>('select');

  // Zoom anchored at screen point
  const zoomAtPoint = useCallback(
    (
      zoomUpdater: number | ((currentZoom: number) => number),
      clientX?: number,
      clientY?: number
    ) => {
      setTransform((prev) => {
        const container = containerRef.current;
        const rect = container?.getBoundingClientRect();
        const origin: Point = { x: rect?.left ?? 0, y: rect?.top ?? 0 };

        const sX = clientX !== undefined ? clientX : mousePosRef.current.x;
        const sY = clientY !== undefined ? clientY : mousePosRef.current.y;

        const targetZoom = typeof zoomUpdater === 'function' ? zoomUpdater(prev.zoom) : zoomUpdater;
        return calculateZoomAtPoint(prev, targetZoom, { x: sX, y: sY }, origin);
      });
    },
    [containerRef]
  );

  const zoomIn = useCallback(() => {
    zoomAtPoint((z) => z * 1.15);
  }, [zoomAtPoint]);

  const zoomOut = useCallback(() => {
    zoomAtPoint((z) => z / 1.15);
  }, [zoomAtPoint]);

  const resetZoom100 = useCallback(() => {
    zoomAtPoint(1.0);
  }, [zoomAtPoint]);

  const fitView = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const viewport = {
      width: container.clientWidth,
      height: container.clientHeight,
    };

    const rects: Rect[] = cards
      .filter((c) => !hiddenIds.has(c.id))
      .map((c) => ({
        x: c.x,
        y: c.y,
        width: c.width,
        height: heightOf(c),
      }))
      .concat(sectionRects);
    if (rects.length === 0) return;

    const nextTransform = calculateFitView(rects, viewport, 140);
    setTransform(nextTransform);
  }, [cards, containerRef, heightOf, hiddenIds, sectionRects]);

  const focusSelection = useCallback(
    (cardId?: string) => {
      const container = containerRef.current;
      if (!container) return;

      const ids = cardId ? new Set([cardId]) : selectedCardIds;
      const rects: Rect[] = cards
        .filter((c) => ids.has(c.id))
        .map((c) => ({ x: c.x, y: c.y, width: c.width, height: heightOf(c) }));

      const viewport = {
        width: container.clientWidth,
        height: container.clientHeight,
      };
      const nextTransform = calculateFocusRects(rects, viewport);
      if (nextTransform) setTransform(nextTransform);
    },
    [cards, selectedCardIds, containerRef, heightOf]
  );

  // Wheel listener
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleNativeWheel = (e: WheelEvent) => {
      e.preventDefault();
      mousePosRef.current = { x: e.clientX, y: e.clientY };

      if (e.ctrlKey || e.metaKey) {
        const factor = wheelZoomFactor(e.deltaY, e.deltaMode);
        zoomAtPoint((z) => z * factor, e.clientX, e.clientY);
      } else {
        const deltaX = e.shiftKey ? e.deltaY : e.deltaX;
        const deltaY = e.shiftKey ? 0 : e.deltaY;
        setTransform((prev) => ({
          ...prev,
          panX: prev.panX - deltaX,
          panY: prev.panY - deltaY,
        }));
      }
    };

    container.addEventListener('wheel', handleNativeWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleNativeWheel);
  }, [zoomAtPoint, containerRef]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const tag = activeEl?.tagName?.toLowerCase();
      if (
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        (activeEl as HTMLElement)?.isContentEditable
      ) {
        return;
      }
      if (!keyboardEnabled) return;
      // Modifier combinations belong to the browser (Ctrl+F finds, Ctrl+0 resets the page zoom).
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === '0') {
        e.preventDefault();
        fitView();
      } else if (e.key === '1') {
        e.preventDefault();
        resetZoom100();
      } else if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        zoomIn();
      } else if (e.key === '-') {
        e.preventDefault();
        zoomOut();
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        focusSelection();
      } else if (e.key === ' ' && !isSpacePressedRef.current) {
        isSpacePressedRef.current = true;
        setActiveTool((prev) => {
          toolBeforeSpaceRef.current = prev;
          return 'hand';
        });
      } else if (e.key === 'Escape') {
        setSelectedCardIds(new Set());
      }
    };

    // Only a space that took the hand tool gives it back: one typed into a prompt did not.
    const releaseSpace = () => {
      if (!isSpacePressedRef.current) return;
      isSpacePressedRef.current = false;
      setActiveTool(toolBeforeSpaceRef.current);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') releaseSpace();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    // Switching windows while holding space never delivers its keyup.
    window.addEventListener('blur', releaseSpace);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', releaseSpace);
    };
  }, [fitView, resetZoom100, zoomIn, zoomOut, focusSelection, keyboardEnabled]);

  // Canvas background mouse down
  const handleMouseDownCanvas = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const isHand = activeTool === 'hand' || isSpacePressedRef.current;
      const isMiddle = e.button === 1;

      if (isHand || isMiddle) {
        setIsPanning(true);
        startPanRef.current = {
          x: e.clientX - transform.panX,
          y: e.clientY - transform.panY,
        };
        return;
      }

      // If clicking directly on empty canvas background with select tool:
      if (e.target === e.currentTarget && e.button === 0) {
        if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
          setSelectedCardIds(new Set());
        }

        setIsMarqueeSelecting(true);
        setMarqueeStartScreen({ x: e.clientX, y: e.clientY });
        setMarqueeCurrentScreen({ x: e.clientX, y: e.clientY });
      }
    },
    [activeTool, transform]
  );

  // Mouse move handler
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      mousePosRef.current = { x: e.clientX, y: e.clientY };

      const container = containerRef.current;
      const rect = container?.getBoundingClientRect();
      const origin: Point = { x: rect?.left ?? 0, y: rect?.top ?? 0 };

      if (isPanning) {
        setTransform((prev) => ({
          ...prev,
          panX: e.clientX - startPanRef.current.x,
          panY: e.clientY - startPanRef.current.y,
        }));
      } else if (isMarqueeSelecting && marqueeStartScreen) {
        setMarqueeCurrentScreen({ x: e.clientX, y: e.clientY });

        // Compute world coordinates for marquee box
        const wStart = screenToWorld(marqueeStartScreen, transform, origin);
        const wCurrent = screenToWorld({ x: e.clientX, y: e.clientY }, transform, origin);
        const marqueeWorldBox = getMarqueeRect(wStart, wCurrent);

        const newSelected = new Set<string>(
          e.shiftKey || e.ctrlKey || e.metaKey ? selectedCardIds : []
        );

        for (const card of cards) {
          if (hiddenIds.has(card.id)) continue;
          const cardBox: Rect = {
            x: card.x,
            y: card.y,
            width: card.width,
            height: heightOf(card),
          };
          if (isRectIntersecting(cardBox, marqueeWorldBox)) {
            newSelected.add(card.id);
          }
        }

        // Most moves change nothing: keep the same set so nothing re-renders.
        setSelectedCardIds((prev) => (sameIds(prev, newSelected) ? prev : newSelected));
      } else if (isDraggingCards) {
        const currentWorld = screenToWorld(
          { x: e.clientX, y: e.clientY },
          transform,
          origin
        );
        let dx = currentWorld.x - dragStartWorldRef.current.x;
        let dy = currentWorld.y - dragStartWorldRef.current.y;
        // Snap the dragged box to other cards' edges and centres; Alt drags freely.
        let guides: SnapGuide[] = [];
        const box = dragBoxRef.current;
        if (box && !e.altKey && (dx !== 0 || dy !== 0)) {
          const snap = snapBox({ ...box, x: box.x + dx, y: box.y + dy }, snapTargetsRef.current, SNAP_THRESHOLD_PX / transform.zoom);
          dx += snap.dx;
          dy += snap.dy;
          guides = snap.guides;
        }
        setSnapGuides((prev) => (prev.length === 0 && guides.length === 0 ? prev : guides));
        if (!dragRecordedRef.current && (dx !== 0 || dy !== 0)) {
          dragRecordedRef.current = true;
          onBeforeEdit?.();
        }

        setCards((prev) =>
          prev.map((c) => {
            const initialPos = initialCardPositionsRef.current.get(c.id);
            if (initialPos) {
              return { ...c, x: initialPos.x + dx, y: initialPos.y + dy };
            }
            return c;
          })
        );
      }
    },
    [
      isPanning,
      isMarqueeSelecting,
      marqueeStartScreen,
      isDraggingCards,
      transform,
      containerRef,
      cards,
      heightOf,
      selectedCardIds,
      setCards,
      onBeforeEdit,
    ]
  );

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
    setIsMarqueeSelecting(false);
    setMarqueeStartScreen(null);
    setMarqueeCurrentScreen(null);
    setIsDraggingCards(false);
    setSnapGuides([]);
  }, []);

  // Shift/Ctrl toggles a card in the selection; a plain click selects it alone
  // unless it is already part of the selection (so a group can be dragged).
  const nextSelection = useCallback(
    (e: React.MouseEvent, cardId: string): Set<string> => {
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        const next = new Set(selectedCardIds);
        if (next.has(cardId)) next.delete(cardId);
        else next.add(cardId);
        return next;
      }
      return selectedCardIds.has(cardId) ? new Set(selectedCardIds) : new Set([cardId]);
    },
    [selectedCardIds]
  );

  // Mouse down on a card's body: select without dragging.
  const handleSelectCard = useCallback(
    (e: React.MouseEvent<HTMLDivElement>, card: SpatialCard) => {
      if (e.button !== 0 || activeTool === 'hand' || isSpacePressedRef.current) return;
      setSelectedCardIds(nextSelection(e, card.id));
    },
    [activeTool, nextSelection]
  );

  // Card dragging & selection handler
  const handleStartDragCard = useCallback(
    (e: React.MouseEvent<HTMLDivElement>, card: SpatialCard) => {
      if (activeTool === 'hand' || isSpacePressedRef.current) return;
      if (e.button !== 0) return;
      e.stopPropagation();

      const container = containerRef.current;
      const rect = container?.getBoundingClientRect();
      const origin: Point = { x: rect?.left ?? 0, y: rect?.top ?? 0 };

      const nextSelectedIds = nextSelection(e, card.id);
      setSelectedCardIds(nextSelectedIds);
      dragRecordedRef.current = false;

      // Initialize multi-card drag
      setIsDraggingCards(true);
      const worldMouse = screenToWorld({ x: e.clientX, y: e.clientY }, transform, origin);
      dragStartWorldRef.current = worldMouse;

      const initialPositions = new Map<string, Point>();
      const moving: Rect[] = [];
      const others: Rect[] = [];
      for (const c of cards) {
        const r = { x: c.x, y: c.y, width: c.width, height: heightOf(c) };
        if (nextSelectedIds.has(c.id)) {
          initialPositions.set(c.id, { x: c.x, y: c.y });
          moving.push(r);
        } else if (!hiddenIds.has(c.id)) {
          others.push(r);
        }
      }
      initialCardPositionsRef.current = initialPositions;
      // A group snaps as one box: its bounding box.
      dragBoxRef.current = getCardsBoundingBox(moving.map((r, i) => ({ id: String(i), ...r })));
      snapTargetsRef.current = others;
    },
    [activeTool, nextSelection, transform, containerRef, cards, heightOf, hiddenIds]
  );

  // Multi-card layout commands
  const alignSelected = useCallback(
    (alignment: AlignmentType) => {
      onBeforeEdit?.();
      setCards((prev) => alignCards(prev, selectedCardIds, alignment, heightOf));
    },
    [selectedCardIds, setCards, onBeforeEdit, heightOf]
  );

  const arrangeSelectedGrid = useCallback(
    (gap = 40, columns = 3) => {
      onBeforeEdit?.();
      setCards((prev) => autoArrangeGrid(prev, selectedCardIds, gap, columns, heightOf));
    },
    [selectedCardIds, setCards, onBeforeEdit, heightOf]
  );

  // Calculate screen-space marquee box for rendering
  const marqueeScreenBox =
    isMarqueeSelecting && marqueeStartScreen && marqueeCurrentScreen
      ? getMarqueeRect(marqueeStartScreen, marqueeCurrentScreen)
      : null;

  return {
    transform,
    setTransform,
    activeTool,
    setActiveTool,
    isPanning,
    selectedCardIds,
    setSelectedCardIds,
    marqueeScreenBox,
    /** Alignment lines to draw while a drag is snapped (world coordinates). */
    snapGuides,
    isDraggingCards,
    zoomIn,
    zoomOut,
    zoomAtPoint,
    resetZoom100,
    fitView,
    focusSelection,
    alignSelected,
    arrangeSelectedGrid,
    handleMouseDownCanvas,
    handleMouseMove,
    handleMouseUp,
    handleStartDragCard,
    handleSelectCard,
    /** Last known pointer position (client coords). */
    pointerRef: mousePosRef,
  };
}

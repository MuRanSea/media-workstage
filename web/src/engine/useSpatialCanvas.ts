import { useState, useRef, useEffect, useCallback } from 'react';
import {
  type CanvasTransform,
  type Point,
  type Rect,
  calculateZoomAtPoint,
  calculateFitView,
  calculateFocusSelection,
  screenToWorld,
} from './matrix.ts';
import {
  isRectIntersecting,
  getMarqueeRect,
  alignCards,
  autoArrangeGrid,
  type AlignmentType,
} from './layout.ts';
import type { CanvasTool, SpatialCard } from '../types/canvas.ts';

interface UseSpatialCanvasProps {
  cards: SpatialCard[];
  setCards: React.Dispatch<React.SetStateAction<SpatialCard[]>>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  initialZoom?: number;
  initialPanX?: number;
  initialPanY?: number;
}

export function useSpatialCanvas({
  cards,
  setCards,
  containerRef,
  initialZoom = 0.85,
  initialPanX = 60,
  initialPanY = 40,
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

  const startPanRef = useRef<Point>({ x: 0, y: 0 });
  const mousePosRef = useRef<Point>({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const isSpacePressedRef = useRef(false);

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
    if (!container || cards.length === 0) return;

    const viewport = {
      width: container.clientWidth,
      height: container.clientHeight,
    };

    const cardRects: Rect[] = cards.map((c) => ({
      x: c.x,
      y: c.y,
      width: c.width,
      height: 380,
    }));

    const nextTransform = calculateFitView(cardRects, viewport, 140);
    setTransform(nextTransform);
  }, [cards, containerRef]);

  const focusSelection = useCallback(
    (cardId?: string) => {
      const container = containerRef.current;
      if (!container) return;

      const targetId = cardId ?? (selectedCardIds.size > 0 ? Array.from(selectedCardIds)[0] : null);
      if (!targetId) return;

      const target = cards.find((c) => c.id === targetId);
      if (!target) return;

      const viewport = {
        width: container.clientWidth,
        height: container.clientHeight,
      };

      const rect: Rect = {
        x: target.x,
        y: target.y,
        width: target.width,
        height: 380,
      };

      const nextTransform = calculateFocusSelection(rect, viewport, 1.0);
      setTransform(nextTransform);
    },
    [cards, selectedCardIds, containerRef]
  );

  // Wheel listener
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleNativeWheel = (e: WheelEvent) => {
      e.preventDefault();
      mousePosRef.current = { x: e.clientX, y: e.clientY };

      if (e.ctrlKey || e.metaKey) {
        const factor = e.deltaY < 0 ? 1.06 : 0.94;
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
        (activeEl as HTMLElement)?.isContentEditable
      ) {
        return;
      }

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
        setActiveTool('hand');
      } else if (e.key === 'Escape') {
        setSelectedCardIds(new Set());
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        isSpacePressedRef.current = false;
        setActiveTool('select');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [fitView, resetZoom100, zoomIn, zoomOut, focusSelection]);

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
          const cardBox: Rect = {
            x: card.x,
            y: card.y,
            width: card.width,
            height: 380,
          };
          if (isRectIntersecting(cardBox, marqueeWorldBox)) {
            newSelected.add(card.id);
          }
        }

        setSelectedCardIds(newSelected);
      } else if (isDraggingCards) {
        const currentWorld = screenToWorld(
          { x: e.clientX, y: e.clientY },
          transform,
          origin
        );
        const dx = currentWorld.x - dragStartWorldRef.current.x;
        const dy = currentWorld.y - dragStartWorldRef.current.y;

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
      selectedCardIds,
      setCards,
    ]
  );

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
    setIsMarqueeSelecting(false);
    setMarqueeStartScreen(null);
    setMarqueeCurrentScreen(null);
    setIsDraggingCards(false);
  }, []);

  // Card dragging & selection handler
  const handleStartDragCard = useCallback(
    (e: React.MouseEvent<HTMLDivElement>, card: SpatialCard) => {
      if (activeTool === 'hand' || isSpacePressedRef.current) return;
      e.stopPropagation();

      const container = containerRef.current;
      const rect = container?.getBoundingClientRect();
      const origin: Point = { x: rect?.left ?? 0, y: rect?.top ?? 0 };

      const isModifierKey = e.shiftKey || e.ctrlKey || e.metaKey;

      let nextSelectedIds: Set<string>;
      if (isModifierKey) {
        nextSelectedIds = new Set(selectedCardIds);
        if (nextSelectedIds.has(card.id)) {
          nextSelectedIds.delete(card.id);
        } else {
          nextSelectedIds.add(card.id);
        }
      } else {
        if (!selectedCardIds.has(card.id)) {
          nextSelectedIds = new Set([card.id]);
        } else {
          nextSelectedIds = new Set(selectedCardIds);
        }
      }

      setSelectedCardIds(nextSelectedIds);

      // Initialize multi-card drag
      setIsDraggingCards(true);
      const worldMouse = screenToWorld({ x: e.clientX, y: e.clientY }, transform, origin);
      dragStartWorldRef.current = worldMouse;

      const initialPositions = new Map<string, Point>();
      for (const c of cards) {
        if (nextSelectedIds.has(c.id)) {
          initialPositions.set(c.id, { x: c.x, y: c.y });
        }
      }
      initialCardPositionsRef.current = initialPositions;
    },
    [activeTool, selectedCardIds, transform, containerRef, cards]
  );

  // Multi-card layout commands
  const alignSelected = useCallback(
    (alignment: AlignmentType) => {
      setCards((prev) => alignCards(prev, selectedCardIds, alignment));
    },
    [selectedCardIds, setCards]
  );

  const arrangeSelectedGrid = useCallback(
    (gap = 40, columns = 3) => {
      setCards((prev) => autoArrangeGrid(prev, selectedCardIds, gap, columns));
    },
    [selectedCardIds, setCards]
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
  };
}

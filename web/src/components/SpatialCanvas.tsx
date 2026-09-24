import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, FileText, Film, Image as ImageIcon, ScanText, Sparkles, Trash2 } from 'lucide-react';
import type { CardType, SpatialCard, TaskActionDto } from '../types/canvas.ts';
import { useSpatialCanvas } from '../engine/useSpatialCanvas.ts';
import { screenToWorld, type CanvasTransform, type Point } from '../engine/matrix.ts';
import { connectCards, hasOutputPort, withEffectivePrompt } from '../engine/connections.ts';
import { findDescribeProvider, spawnActionCard, spawnDescribeCard } from '../engine/mjActions.ts';
import { useChannels } from '../services/channels.ts';
import { createCard, duplicateCards } from '../engine/cardFactory.ts';
import { useHistory } from '../engine/useHistory.ts';
import { removeReferencePatch } from '../engine/cardParams.ts';
import { unpackLayerDecomposition, unpackSequentialStoryboards } from '../engine/expansion.ts';
import { ImageCardView } from './cards/ImageCardView.tsx';
import { VideoCardView } from './cards/VideoCardView.tsx';
import { TextCardView } from './cards/TextCardView.tsx';
import { PORT_Y, type ConnectHint } from './cards/CardPorts.tsx';
import type { CardViewProps } from './cards/cardProps.ts';
import { InspectorPanel, INSPECTOR_WIDTH } from './inspector/InspectorPanel.tsx';
import { NavigationDock } from './NavigationDock.tsx';
import { ADD_CARD_ITEMS, CanvasHeader } from './CanvasHeader.tsx';
import { SettingsModal } from './SettingsModal.tsx';
import { MediaViewer, type ViewerMedia } from './MediaViewer.tsx';
import { ShortcutsDialog } from './ShortcutsDialog.tsx';
import { Menu, useToast, type MenuEntry } from './ui/index.ts';

interface SpatialCanvasProps {
  cards: SpatialCard[];
  setCards: React.Dispatch<React.SetStateAction<SpatialCard[]>>;
  /** `card` is passed when the card was just added and is not in `cards` yet. */
  onTriggerGenerate: (cardId: string, card?: SpatialCard) => void;
  /** Viewport to open with (a saved project's). */
  initialViewport?: CanvasTransform;
  /** Called whenever the viewport pans or zooms. */
  onViewportChange?: (viewport: CanvasTransform) => void;
  /** Project controls rendered inside the header's brand area. */
  headerSlot?: React.ReactNode;
}

interface Ray {
  id: string;
  kind: 'reference' | 'prompt' | 'derived';
  pathData: string;
  midX: number;
  midY: number;
  label: string;
  /** Absent for links that cannot be disconnected (a derived card's origin). */
  onRemove?: () => void;
}

/** In-progress connection drag: from a card's output port to the cursor (world coords). */
interface LinkDrag {
  sourceId: string;
  x: number;
  y: number;
  hoverId?: string;
}

interface ContextMenuState {
  at: Point;
  items: MenuEntry[];
  title?: string;
}

const RAY_STYLE: Record<Ray['kind'], { stroke: string; dash?: string; pill: string }> = {
  reference: { stroke: '#f472b6', pill: 'border-pink-500/60 text-pink-300' },
  prompt: { stroke: '#34d399', pill: 'border-emerald-500/60 text-emerald-300' },
  derived: { stroke: '#a78bfa', dash: '5 4', pill: 'border-violet-500/60 text-violet-300' },
};

const bezier = (srcX: number, srcY: number, tgtX: number, tgtY: number) => {
  const dx = Math.max(80, Math.abs(tgtX - srcX) * 0.5);
  return `M ${srcX} ${srcY} C ${srcX + dx} ${srcY}, ${tgtX - dx} ${tgtY}, ${tgtX} ${tgtY}`;
};

const isTyping = () => {
  const el = document.activeElement as HTMLElement | null;
  const tag = el?.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || !!el?.isContentEditable;
};

/** Edits of these fields while typing merge into one undo step. */
const COALESCE_MS = 1000;

export const SpatialCanvas: React.FC<SpatialCanvasProps> = ({
  cards,
  setCards,
  onTriggerGenerate,
  initialViewport,
  onViewportChange,
  headerSlot,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [linkDrag, setLinkDrag] = useState<LinkDrag | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [viewer, setViewer] = useState<ViewerMedia | null>(null);
  const toast = useToast();

  // --- Undo history ------------------------------------------------------------
  const { record, undo: undoHistory, redo: redoHistory, canUndo, canRedo } = useHistory();
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const lastCoalesce = useRef<{ key: string; at: number } | null>(null);

  const recordEdit = useCallback(() => {
    lastCoalesce.current = null;
    record(cardsRef.current);
  }, [record]);

  /** A user edit: records an undo step, then applies the change. */
  const editCards = useCallback(
    (updater: (prev: SpatialCard[]) => SpatialCard[]) => {
      recordEdit();
      setCards(updater);
    },
    [recordEdit, setCards]
  );

  const {
    transform,
    activeTool,
    setActiveTool,
    isPanning,
    selectedCardIds,
    setSelectedCardIds,
    marqueeScreenBox,
    zoomIn,
    zoomOut,
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
    pointerRef,
  } = useSpatialCanvas({
    cards,
    setCards,
    containerRef,
    initialZoom: initialViewport?.zoom,
    initialPanX: initialViewport?.panX,
    initialPanY: initialViewport?.panY,
    onBeforeEdit: recordEdit,
  });

  useEffect(() => {
    onViewportChange?.(transform);
  }, [transform, onViewportChange]);

  const selectedCards = useMemo(() => cards.filter((c) => selectedCardIds.has(c.id)), [cards, selectedCardIds]);
  const availableImageCards = useMemo(() => cards.filter((c) => c.type === 'image'), [cards]);

  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      return screenToWorld({ x: clientX, y: clientY }, transform, { x: rect?.left ?? 0, y: rect?.top ?? 0 });
    },
    [transform]
  );

  /**
   * World point at the centre of the canvas area left of the inspector: new and
   * pasted cards get selected, which opens the inspector over the right side.
   */
  const viewportCenter = useCallback((): Point => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 400, y: 300 };
    const visibleWidth = Math.max(rect.width - (INSPECTOR_WIDTH + 16), rect.width / 2);
    return toWorld(rect.left + visibleWidth / 2, rect.top + rect.height / 2);
  }, [toWorld]);

  // --- Card operations -------------------------------------------------------

  /**
   * Updates a card. Typing and other rapid edits of the same fields merge into
   * one undo step; `history: false` skips recording (automatic updates).
   */
  const handleUpdateCard = useCallback(
    (cardId: string, patch: Partial<SpatialCard>, opts?: { history?: boolean }) => {
      if (opts?.history !== false) {
        const key = `${cardId}:${Object.keys(patch).sort().join(',')}`;
        const now = Date.now();
        const last = lastCoalesce.current;
        if (!last || last.key !== key || now - last.at > COALESCE_MS) record(cardsRef.current);
        lastCoalesce.current = { key, at: now };
      }
      setCards((prev) => prev.map((c) => (c.id === cardId ? { ...c, ...patch } : c)));
    },
    [record, setCards]
  );

  const addCard = useCallback(
    (type: CardType, at?: Point) => {
      const card = createCard(type, at ?? viewportCenter(), cardsRef.current);
      editCards((prev) => [...prev, card]);
      setSelectedCardIds(new Set([card.id]));
    },
    [editCards, viewportCenter, setSelectedCardIds]
  );

  const undo = useCallback(() => {
    const restored = undoHistory(cardsRef.current);
    if (restored) {
      lastCoalesce.current = null;
      setCards(restored);
    }
  }, [undoHistory, setCards]);

  const redo = useCallback(() => {
    const restored = redoHistory(cardsRef.current);
    if (restored) {
      lastCoalesce.current = null;
      setCards(restored);
    }
  }, [redoHistory, setCards]);

  const deleteCards = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const gone = new Set(ids);
      // Drop connections that point at the deleted cards along with them.
      editCards((prev) =>
        prev
          .filter((c) => !gone.has(c.id))
          .map((c) => {
            const refs = c.references?.filter((r) => !gone.has(r.cardId));
            const promptSourceId = c.promptSourceId && gone.has(c.promptSourceId) ? undefined : c.promptSourceId;
            return refs?.length !== c.references?.length || promptSourceId !== c.promptSourceId
              ? { ...c, references: refs, promptSourceId }
              : c;
          })
      );
      setSelectedCardIds((prev) => new Set([...prev].filter((id) => !gone.has(id))));
      toast(`已删除 ${ids.length} 张卡片`, { action: { label: '撤销', onClick: undo } });
    },
    [editCards, setSelectedCardIds, toast, undo]
  );

  const duplicate = useCallback(
    (source: SpatialCard[], at?: Point) => {
      if (source.length === 0) return;
      const minX = Math.min(...source.map((c) => c.x));
      const minY = Math.min(...source.map((c) => c.y));
      const copies = duplicateCards(source, at ?? { x: minX + 40, y: minY + 40 }, cardsRef.current);
      editCards((prev) => [...prev, ...copies]);
      setSelectedCardIds(new Set(copies.map((c) => c.id)));
    },
    [editCards, setSelectedCardIds]
  );

  // In-app clipboard for Ctrl+C / Ctrl+V.
  const clipboardRef = useRef<SpatialCard[]>([]);

  const pasteAtPointer = useCallback(() => {
    if (clipboardRef.current.length === 0) return;
    const rect = containerRef.current?.getBoundingClientRect();
    const p = pointerRef.current;
    const inside = rect && p.x >= rect.left && p.x <= rect.right && p.y >= rect.top && p.y <= rect.bottom;
    duplicate(clipboardRef.current, inside ? toWorld(p.x, p.y) : viewportCenter());
  }, [duplicate, pointerRef, toWorld, viewportCenter]);

  /** Runs a follow-up of `source`'s result on a new card beside it (one undo step). */
  const runAction = useCallback(
    (source: SpatialCard, action: TaskActionDto) => {
      let prompt = source.prompt;
      try {
        prompt = withEffectivePrompt(source, cardsRef.current).prompt;
      } catch {
        // The linked text card is empty; the source's own prompt is only a record here.
      }
      let card: SpatialCard;
      try {
        card = spawnActionCard(source, action, cardsRef.current, prompt);
      } catch (err) {
        toast((err as Error).message, { tone: 'error' });
        return;
      }
      editCards((prev) => [...prev, card]);
      onTriggerGenerate(card.id, card);
    },
    [editCards, onTriggerGenerate, toast]
  );

  const channels = useChannels();
  const describeWith = useMemo(() => findDescribeProvider(channels), [channels]);

  /** Asks Midjourney for prompts matching `source`'s image, on a new text card beside it. */
  const runDescribe = useCallback(
    (source: SpatialCard) => {
      if (!describeWith) return;
      let card: SpatialCard;
      try {
        card = spawnDescribeCard(source, describeWith, cardsRef.current);
      } catch (err) {
        toast((err as Error).message, { tone: 'error' });
        return;
      }
      editCards((prev) => [...prev, card]);
      onTriggerGenerate(card.id, card);
    },
    [describeWith, editCards, onTriggerGenerate, toast]
  );

  /** Actions of `card` whose derived card is still generating, so they are not run twice. */
  const busyActionsFor = useCallback(
    (card: SpatialCard) =>
      new Set(
        cards
          .filter((c) => c.derivedFrom?.cardId === card.id && (c.status === 'queued' || c.status === 'running'))
          .map((c) => c.derivedFrom!.actionId!)
      ),
    [cards]
  );

  const cardMenuItems = useCallback(
    (card: SpatialCard): MenuEntry[] => [
      { label: '生成', icon: <Sparkles className="w-3.5 h-3.5" />, onSelect: () => onTriggerGenerate(card.id) },
      { label: '复制一份', icon: <Copy className="w-3.5 h-3.5" />, hint: 'Ctrl+D', onSelect: () => duplicate([card]) },
      ...(card.type === 'image' && card.status === 'succeeded' && card.resultUrl && describeWith
        ? [{ label: 'Midjourney 反推提示词', icon: <ScanText className="w-3.5 h-3.5" />, onSelect: () => runDescribe(card) }]
        : []),
      'separator',
      { label: '删除', icon: <Trash2 className="w-3.5 h-3.5" />, hint: 'Delete', danger: true, onSelect: () => deleteCards([card.id]) },
    ],
    [onTriggerGenerate, duplicate, deleteCards, describeWith, runDescribe]
  );

  const addMenuAt = useCallback(
    (clientX: number, clientY: number) => {
      const world = toWorld(clientX, clientY);
      setContextMenu({
        at: { x: clientX, y: clientY },
        title: '在这里添加',
        items: ADD_CARD_ITEMS((type) => addCard(type, world)).concat(
          clipboardRef.current.length
            ? ['separator', { label: `粘贴 ${clipboardRef.current.length} 张卡片`, hint: 'Ctrl+V', onSelect: () => duplicate(clipboardRef.current, world) }]
            : []
        ),
      });
    },
    [toWorld, addCard, duplicate]
  );

  // --- Keyboard shortcuts ----------------------------------------------------
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping() || isSettingsOpen || viewer || showShortcuts) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const selected = cardsRef.current.filter((c) => selectedCardIds.has(c.id));

      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && key === 'y') {
        e.preventDefault();
        redo();
      } else if (mod && key === 'a') {
        e.preventDefault();
        setSelectedCardIds(new Set(cardsRef.current.map((c) => c.id)));
      } else if (mod && key === 'd') {
        e.preventDefault();
        duplicate(selected);
      } else if (mod && key === 'c') {
        if (selected.length) {
          clipboardRef.current = selected;
          toast(`已复制 ${selected.length} 张卡片`);
        }
      } else if (mod && key === 'v') {
        e.preventDefault();
        pasteAtPointer();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected.length) {
        e.preventDefault();
        deleteCards(selected.map((c) => c.id));
      } else if (!mod && key === 'v') {
        setActiveTool('select');
      } else if (!mod && key === 'h') {
        setActiveTool('hand');
      } else if (e.key === '?') {
        setShowShortcuts(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedCardIds, undo, redo, duplicate, pasteAtPointer, deleteCards, setSelectedCardIds, setActiveTool, toast, isSettingsOpen, viewer, showShortcuts]);

  // --- Drag-to-connect ------------------------------------------------------

  const cardIdAt = (clientX: number, clientY: number, excludeId: string): string | undefined => {
    const el = document.elementFromPoint(clientX, clientY)?.closest('[data-card-id]');
    const id = el?.getAttribute('data-card-id') ?? undefined;
    return id && id !== excludeId ? id : undefined;
  };

  const startConnect = (source: SpatialCard, e: React.MouseEvent) => {
    const p = toWorld(e.clientX, e.clientY);
    setLinkDrag({ sourceId: source.id, x: p.x, y: p.y });
  };

  const showNotice = useCallback((msg: string) => toast(msg, { tone: 'warning' }), [toast]);

  useEffect(() => {
    if (!linkDrag) return;
    const sourceId = linkDrag.sourceId;

    const onMove = (e: MouseEvent) => {
      const p = toWorld(e.clientX, e.clientY);
      setLinkDrag({ sourceId, x: p.x, y: p.y, hoverId: cardIdAt(e.clientX, e.clientY, sourceId) });
    };
    const onUp = (e: MouseEvent) => {
      setLinkDrag(null);
      const targetId = cardIdAt(e.clientX, e.clientY, sourceId);
      if (!targetId) return;
      const source = cards.find((c) => c.id === sourceId);
      const target = cards.find((c) => c.id === targetId);
      if (!source || !target) return;
      const res = connectCards(source, target);
      if (res.ok) {
        recordEdit();
        handleUpdateCard(target.id, res.patch, { history: false });
      } else showNotice(res.reason);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    // linkDrag itself changes on every move; only (re)bind when a drag starts or ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkDrag?.sourceId, toWorld, cards, handleUpdateCard, showNotice, recordEdit]);

  const connectHintFor = (card: SpatialCard): ConnectHint => {
    if (!linkDrag || linkDrag.hoverId !== card.id) return undefined;
    const source = cards.find((c) => c.id === linkDrag.sourceId);
    return source && connectCards(source, card).ok ? 'ok' : 'bad';
  };

  // --- Connection lines -----------------------------------------------------

  const connectionRays = useMemo(() => {
    const rays: Ray[] = [];
    const byId = new Map(cards.map((c) => [c.id, c]));

    for (const card of cards) {
      const tgtX = card.x;
      const tgtY = card.y + PORT_Y;

      // A describe card's image is its origin, drawn as the derived link below.
      const refs = card.derivedFrom?.operation === 'describe' ? [] : card.references;
      refs?.forEach((ref) => {
        const src = byId.get(ref.cardId);
        if (!src) return;
        const srcX = src.x + src.width;
        const srcY = src.y + PORT_Y;
        rays.push({
          id: `ref:${src.id}->${card.id}`,
          kind: 'reference',
          pathData: bezier(srcX, srcY, tgtX, tgtY),
          midX: (srcX + tgtX) / 2,
          midY: (srcY + tgtY) / 2,
          label: `@图${ref.tagIndex}`,
          onRemove: () => handleUpdateCard(card.id, removeReferencePatch(card, src.id)),
        });
      });

      const origin = card.derivedFrom ? byId.get(card.derivedFrom.cardId) : undefined;
      if (origin) {
        const srcX = origin.x + origin.width;
        const srcY = origin.y + PORT_Y;
        rays.push({
          id: `derived:${origin.id}->${card.id}`,
          kind: 'derived',
          pathData: bezier(srcX, srcY, tgtX, tgtY),
          midX: (srcX + tgtX) / 2,
          midY: (srcY + tgtY) / 2,
          label: card.derivedFrom!.label,
        });
      }

      const textSrc = card.promptSourceId ? byId.get(card.promptSourceId) : undefined;
      if (textSrc) {
        const srcX = textSrc.x + textSrc.width;
        const srcY = textSrc.y + PORT_Y;
        rays.push({
          id: `prompt:${textSrc.id}->${card.id}`,
          kind: 'prompt',
          pathData: bezier(srcX, srcY, tgtX, tgtY),
          midX: (srcX + tgtX) / 2,
          midY: (srcY + tgtY) / 2,
          label: '提示词',
          onRemove: () => handleUpdateCard(card.id, { promptSourceId: undefined }),
        });
      }
    }
    return rays;
  }, [cards, handleUpdateCard]);

  const dragSource = linkDrag ? cards.find((c) => c.id === linkDrag.sourceId) : undefined;
  const dragPath =
    linkDrag && dragSource
      ? bezier(dragSource.x + dragSource.width, dragSource.y + PORT_Y, linkDrag.x, linkDrag.y)
      : null;

  const linkedPromptFor = useCallback(
    (card: SpatialCard) => {
      const src = card.promptSourceId ? cards.find((c) => c.id === card.promptSourceId) : undefined;
      return src ? { title: src.title, text: src.textOutput ?? '' } : undefined;
    },
    [cards]
  );

  // --- Canvas mouse --------------------------------------------------------

  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) addMenuAt(e.clientX, e.clientY);
  };

  const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    // Keep the native menu (copy/paste) inside text fields.
    if (target.closest('input, textarea')) return;
    e.preventDefault();
    const cardId = target.closest('[data-card-id]')?.getAttribute('data-card-id');
    const card = cardId ? cards.find((c) => c.id === cardId) : undefined;
    if (card) {
      if (!selectedCardIds.has(card.id)) setSelectedCardIds(new Set([card.id]));
      setContextMenu({ at: { x: e.clientX, y: e.clientY }, items: cardMenuItems(card) });
    } else {
      addMenuAt(e.clientX, e.clientY);
    }
  };

  // Grid background pattern scaling
  const gridPatternSize = 24 * transform.zoom;
  const gridOffsetX = transform.panX % gridPatternSize;
  const gridOffsetY = transform.panY % gridPatternSize;
  const inspectorOpen = selectedCards.length > 0;

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-canvas-bg text-slate-100 select-none">
      <CanvasHeader onAdd={(type) => addCard(type)} onOpenSettings={() => setIsSettingsOpen(true)} projectSlot={headerSlot} />

      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
      <ShortcutsDialog open={showShortcuts} onClose={() => setShowShortcuts(false)} />
      {viewer && <MediaViewer media={viewer} onClose={() => setViewer(null)} />}
      {contextMenu && (
        <Menu at={contextMenu.at} items={contextMenu.items} title={contextMenu.title} onClose={() => setContextMenu(null)} />
      )}

      <NavigationDock
        zoom={transform.zoom}
        activeTool={activeTool}
        right={inspectorOpen ? INSPECTOR_WIDTH + 32 : 16}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onResetZoom={resetZoom100}
        onFitView={fitView}
        onFocusSelection={() => focusSelection()}
        onToggleTool={setActiveTool}
        onShowShortcuts={() => setShowShortcuts(true)}
      />

      <InspectorPanel
        selected={selectedCards}
        cards={cards}
        onUpdateCard={handleUpdateCard}
        onAlign={alignSelected}
        onArrangeGrid={() => arrangeSelectedGrid(40, 2)}
        onClose={() => setSelectedCardIds(new Set())}
        linkedPromptFor={linkedPromptFor}
      />

      {/* Empty canvas: offer the three card types right away */}
      {cards.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="pointer-events-auto w-[min(92vw,440px)] p-6 rounded-2xl bg-canvas-surface/90 border border-slate-800 text-center shadow-2xl shadow-black/40">
            <h2 className="text-sm font-semibold text-slate-100">从一张卡片开始</h2>
            <p className="mt-1 text-xs text-slate-500">每张卡片完成一步生成，卡片之间可以连线传递提示词和参考图。</p>
            <div className="mt-5 grid grid-cols-3 gap-2">
              {(
                [
                  ['text', '文本', '写提示词', <FileText key="t" className="w-5 h-5 text-emerald-400" />],
                  ['image', '图片', '生成图片', <ImageIcon key="i" className="w-5 h-5 text-pink-400" />],
                  ['video', '视频', '生成视频', <Film key="v" className="w-5 h-5 text-indigo-400" />],
                ] as const
              ).map(([type, label, hint, icon]) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => addCard(type)}
                  className="flex flex-col items-center gap-1.5 py-4 rounded-xl border border-slate-800 bg-canvas-bg hover:border-slate-600 hover:bg-slate-900 transition"
                >
                  {icon}
                  <span className="text-xs font-semibold text-slate-200">{label}</span>
                  <span className="text-[11px] text-slate-500">{hint}</span>
                </button>
              ))}
            </div>
            <p className="mt-4 text-[11px] text-slate-500">也可以双击画布空白处添加 · 拖动卡片右侧的圆点连线</p>
          </div>
        </div>
      )}

      {/* Main Canvas Viewport Container */}
      <div
        ref={containerRef}
        onMouseDown={handleMouseDownCanvas}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        className={`w-full h-full relative overflow-hidden ${
          linkDrag ? 'cursor-crosshair' : activeTool === 'hand' || isPanning ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'
        }`}
        style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, rgba(148, 163, 184, 0.12) 1px, transparent 0)`,
          backgroundSize: `${gridPatternSize}px ${gridPatternSize}px`,
          backgroundPosition: `${gridOffsetX}px ${gridOffsetY}px`,
        }}
      >
        {/* World Layer Container */}
        <div
          style={{
            transform: `translate3d(${transform.panX}px, ${transform.panY}px, 0) scale(${transform.zoom})`,
            transformOrigin: '0 0',
          }}
          className="absolute top-0 left-0 w-full h-full pointer-events-none"
        >
          {/* SVG Connection Rays Layer */}
          <svg className="absolute top-0 left-0 w-[50000px] h-[50000px] pointer-events-none overflow-visible -translate-x-[25000px] -translate-y-[25000px]">
            <g transform="translate(25000, 25000)">
              {connectionRays.map((ray) => {
                const style = RAY_STYLE[ray.kind];
                return (
                  <g key={ray.id}>
                    <path d={ray.pathData} fill="none" stroke={style.stroke} strokeOpacity={0.7} strokeWidth="2" strokeDasharray={style.dash} />
                    {/* Label pill at curve center; its × disconnects */}
                    <foreignObject x={ray.midX - 48} y={ray.midY - 12} width={96} height={24}>
                      <div
                        title={ray.label}
                        className={`pointer-events-auto flex items-center justify-center gap-1 w-fit max-w-full h-full mx-auto px-2 overflow-hidden bg-canvas-surface border rounded-full text-[11px] font-mono ${style.pill}`}
                      >
                        <span className="min-w-0 truncate">{ray.label}</span>
                        {ray.onRemove && (
                          <button
                            type="button"
                            title="断开连线"
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={ray.onRemove}
                            className="text-slate-500 hover:text-rose-300 leading-none"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    </foreignObject>
                  </g>
                );
              })}

              {/* Line following the cursor while connecting */}
              {dragPath && (
                <path d={dragPath} fill="none" stroke={dragSource?.type === 'text' ? '#34d399' : '#f472b6'} strokeWidth="2" strokeDasharray="6 4" />
              )}
            </g>
          </svg>

          {/* Cards Render Layer */}
          <div className="pointer-events-auto">
            {cards.map((card) => {
              const common: CardViewProps = {
                card,
                isSelected: selectedCardIds.has(card.id),
                connectHint: connectHintFor(card),
                onSelect: (e) => handleSelectCard(e, card),
                onStartDrag: (e) => handleStartDragCard(e, card),
                onUpdateCard: handleUpdateCard,
                onTriggerGenerate,
                menuItems: cardMenuItems(card),
                onOpenViewer: setViewer,
              };
              if (card.type === 'text') {
                return (
                  <TextCardView
                    key={card.id}
                    {...common}
                    linkedCount={cards.filter((c) => c.promptSourceId === card.id).length}
                    onStartConnect={(e) => startConnect(card, e)}
                  />
                );
              }
              if (card.type === 'image') {
                return (
                  <ImageCardView
                    key={card.id}
                    {...common}
                    onUnpackLayers={(c) => editCards((prev) => unpackLayerDecomposition(c, prev))}
                    onUnpackStoryboards={(c) => editCards((prev) => unpackSequentialStoryboards(c, prev))}
                    linkedPrompt={linkedPromptFor(card)}
                    onUnlinkPrompt={() => handleUpdateCard(card.id, { promptSourceId: undefined })}
                    onStartConnect={hasOutputPort(card) ? (e) => startConnect(card, e) : undefined}
                    onRunAction={(action) => runAction(card, action)}
                    busyActionIds={busyActionsFor(card)}
                  />
                );
              }
              return (
                <VideoCardView
                  key={card.id}
                  {...common}
                  availableImageCards={availableImageCards}
                  linkedPrompt={linkedPromptFor(card)}
                  onUnlinkPrompt={() => handleUpdateCard(card.id, { promptSourceId: undefined })}
                  onNotice={showNotice}
                />
              );
            })}
          </div>
        </div>

        {/* Marquee Selection Screen Overlay */}
        {marqueeScreenBox && (
          <div
            style={{
              left: `${marqueeScreenBox.x}px`,
              top: `${marqueeScreenBox.y}px`,
              width: `${marqueeScreenBox.width}px`,
              height: `${marqueeScreenBox.height}px`,
            }}
            className="absolute pointer-events-none border border-indigo-500/80 bg-indigo-500/15 rounded-md"
          />
        )}
      </div>
    </div>
  );
};

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, FileText, Film, Image as ImageIcon, ScanText, Sparkles, Trash2, Upload } from 'lucide-react';
import type { CardType, ResultActionDto, SpatialCard, UploadKind } from '../types/canvas.ts';
import { useSpatialCanvas } from '../engine/useSpatialCanvas.ts';
import { screenToWorld, type CanvasTransform, type Point } from '../engine/matrix.ts';
import { connectCards, hasOutputPort, removeCards } from '../engine/connections.ts';
import { createCard, duplicateCards } from '../engine/cardFactory.ts';
import { useHistory } from '../engine/useHistory.ts';
import { removeReferencePatch } from '../engine/cardParams.ts';
import { actionKey, runningActionIds, runsInProgress } from '../engine/resultCards.ts';
import { findDescribeProvider, savedImageOf } from '../engine/midjourney.ts';
import { useChannels } from '../services/channels.ts';
import { refTag } from '../engine/refTags.ts';
import { ImageCardView } from './cards/ImageCardView.tsx';
import { VideoCardView } from './cards/VideoCardView.tsx';
import { TextCardView } from './cards/TextCardView.tsx';
import { UploadCardView } from './cards/UploadCardView.tsx';
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
  onTriggerGenerate: (cardId: string) => void;
  /** Runs a result action (Midjourney U/V/reroll) on a result card. */
  onRunAction?: (sourceId: string, action: ResultActionDto) => void;
  /** Asks Midjourney for prompts matching an image card's picture. */
  onDescribe?: (sourceId: string) => void;
  /** Generation cards whose submit request is in flight, and `actionKey`s of result actions being submitted. */
  submittingIds?: ReadonlySet<string>;
  /** Prompt-assistant requests in flight, per generation card (not saved). */
  textRuns?: ReadonlyMap<string, number>;
  /** Viewport to open with (a saved project's). */
  initialViewport?: CanvasTransform;
  /** Called whenever the viewport pans or zooms. */
  onViewportChange?: (viewport: CanvasTransform) => void;
  /** Project controls rendered inside the header's brand area. */
  headerSlot?: React.ReactNode;
  /** Undo/redo replaced the cards: `restored` are shown, `before` were. */
  onRestore?: (restored: SpatialCard[], before: SpatialCard[]) => void;
}

interface Ray {
  id: string;
  kind: 'reference' | 'prompt' | 'source';
  /** Source lines of results made by an operation on another result: the operation ("U2", "反推"). */
  sourceLabel?: string;
  /** Colour of the source card: pink image, indigo video, amber upload, emerald text; source lines are grey. */
  tone?: 'pink' | 'amber' | 'emerald' | 'indigo';
  pathData: string;
  midX: number;
  midY: number;
  /** Label pill with a disconnect button; source lines (generation → result) have none. */
  label?: string;
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

const RAY_COLORS = {
  pink: { stroke: 'rgb(var(--c-pink-400))', pill: 'border-pink-500/60 text-pink-300' },
  amber: { stroke: 'rgb(var(--c-amber-400))', pill: 'border-amber-500/60 text-amber-300' },
  indigo: { stroke: 'rgb(var(--c-indigo-400))', pill: 'border-indigo-500/60 text-indigo-300' },
  emerald: { stroke: 'rgb(var(--c-emerald-400))', pill: 'border-emerald-500/60 text-emerald-300' },
} as const;

const RAY_TONE = { image: 'pink', video: 'indigo', upload: 'amber', text: 'emerald' } as const;

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
  onRunAction,
  onDescribe,
  submittingIds,
  textRuns,
  initialViewport,
  onViewportChange,
  headerSlot,
  onRestore,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [linkDrag, setLinkDrag] = useState<LinkDrag | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [viewer, setViewer] = useState<ViewerMedia | null>(null);
  const toast = useToast();
  const channels = useChannels();
  const describer = useMemo(() => findDescribeProvider(channels), [channels]);

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

  // A video takes minutes and its result card may be off screen by the time it is done: say so, and offer to jump to it.
  const finishedVideoIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    const isFinishedVideo = (c: SpatialCard) => c.type === 'video' && c.role === 'result' && c.status === 'succeeded';
    const seen = finishedVideoIds.current;
    finishedVideoIds.current = new Set(cards.filter(isFinishedVideo).map((c) => c.id));
    if (!seen) return;
    for (const card of cards) {
      if (!isFinishedVideo(card) || seen.has(card.id) || !card.sourceId) continue;
      const source = cards.find((c) => c.id === card.sourceId);
      toast(`「${source?.title ?? '视频'}」生成完成，结果在卡片「${card.title}」`, {
        tone: 'success',
        durationMs: 8000,
        action: {
          label: '查看',
          onClick: () => {
            setSelectedCardIds(new Set([card.id]));
            focusSelection(card.id);
          },
        },
      });
    }
  }, [cards, toast, focusSelection, setSelectedCardIds]);

  const selectedCards = useMemo(() => cards.filter((c) => selectedCardIds.has(c.id)), [cards, selectedCardIds]);
  // Cards a video card can take as references: image and video results, uploads included. Generation cards hold none.
  const availableImageCards = useMemo(
    () => cards.filter((c) => c.role === 'result' && c.type !== 'text' && c.tagIndex !== undefined),
    [cards]
  );

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
    (type: CardType, at?: Point, mediaKind?: UploadKind) => {
      const card = createCard(type, at ?? viewportCenter(), cardsRef.current, mediaKind);
      editCards((prev) => [...prev, card]);
      setSelectedCardIds(new Set([card.id]));
    },
    [editCards, viewportCenter, setSelectedCardIds]
  );

  const undo = useCallback(() => {
    const before = cardsRef.current;
    const restored = undoHistory(before);
    if (restored) {
      lastCoalesce.current = null;
      setCards(restored);
      onRestore?.(restored, before);
    }
  }, [undoHistory, setCards, onRestore]);

  const redo = useCallback(() => {
    const before = cardsRef.current;
    const restored = redoHistory(before);
    if (restored) {
      lastCoalesce.current = null;
      setCards(restored);
      onRestore?.(restored, before);
    }
  }, [redoHistory, setCards, onRestore]);

  const deleteCards = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const gone = new Set(ids);
      editCards((prev) => removeCards(prev, gone));
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
      if (copies.length < source.length) toast('生成中的结果卡不能复制', { tone: 'warning' });
      if (copies.length === 0) return;
      editCards((prev) => [...prev, ...copies]);
      setSelectedCardIds(new Set(copies.map((c) => c.id)));
    },
    [editCards, setSelectedCardIds, toast]
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

  const cardMenuItems = useCallback(
    (card: SpatialCard): MenuEntry[] => [
      // Result cards (uploads included) are finished outputs: only their generation card runs again.
      ...(card.role === 'generation'
        ? [{ label: '生成', icon: <Sparkles className="w-3.5 h-3.5" />, onSelect: () => onTriggerGenerate(card.id) }]
        : []),
      // Any finished image can be described, when a Midjourney provider is configured.
      ...(describer && onDescribe && card.role === 'result' && card.status === 'succeeded' && savedImageOf(card)
        ? [{ label: 'Midjourney 反推提示词', icon: <ScanText className="w-3.5 h-3.5" />, onSelect: () => onDescribe(card.id) }]
        : []),
      { label: '复制一份', icon: <Copy className="w-3.5 h-3.5" />, hint: 'Ctrl+D', onSelect: () => duplicate([card]) },
      'separator',
      { label: '删除', icon: <Trash2 className="w-3.5 h-3.5" />, hint: 'Delete', danger: true, onSelect: () => deleteCards([card.id]) },
    ],
    [onTriggerGenerate, onDescribe, describer, duplicate, deleteCards]
  );

  const addMenuAt = useCallback(
    (clientX: number, clientY: number) => {
      const world = toWorld(clientX, clientY);
      setContextMenu({
        at: { x: clientX, y: clientY },
        title: '在这里添加',
        items: ADD_CARD_ITEMS((type, kind) => addCard(type, world, kind)).concat(
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

      card.references?.forEach((ref) => {
        const src = byId.get(ref.cardId);
        if (!src) return;
        const srcX = src.x + src.width;
        const srcY = src.y + PORT_Y;
        rays.push({
          id: `ref:${src.id}->${card.id}`,
          kind: 'reference',
          tone: RAY_TONE[src.type],
          pathData: bezier(srcX, srcY, tgtX, tgtY),
          midX: (srcX + tgtX) / 2,
          midY: (srcY + tgtY) / 2,
          label: refTag(ref),
          onRemove: () => handleUpdateCard(card.id, removeReferencePatch(card, src.id)),
        });
      });

      // Derived from the result card's source field; it cannot be dragged out or cut.
      const generation = card.role === 'result' && card.sourceId ? byId.get(card.sourceId) : undefined;
      if (generation) {
        const srcX = generation.x + generation.width;
        const srcY = generation.y + PORT_Y;
        rays.push({
          id: `source:${generation.id}->${card.id}`,
          kind: 'source',
          sourceLabel: card.origin?.label,
          pathData: bezier(srcX, srcY, tgtX, tgtY),
          midX: (srcX + tgtX) / 2,
          midY: (srcY + tgtY) / 2,
        });
      }

      const textSrc = card.promptSourceId ? byId.get(card.promptSourceId) : undefined;
      if (textSrc) {
        const srcX = textSrc.x + textSrc.width;
        const srcY = textSrc.y + PORT_Y;
        rays.push({
          id: `prompt:${textSrc.id}->${card.id}`,
          kind: 'prompt',
          tone: 'emerald',
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

  /** Result actions of `card` that are being submitted or have a run in progress. */
  const busyActionsOf = (card: SpatialCard): ReadonlySet<string> => {
    const busy = runningActionIds(cards, card.id);
    for (const action of card.resultActions ?? []) if (submittingIds?.has(actionKey(card.id, action.id))) busy.add(action.id);
    return busy;
  };

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
      <CanvasHeader onAdd={(type, kind) => addCard(type, undefined, kind)} onOpenSettings={() => setIsSettingsOpen(true)} projectSlot={headerSlot} />

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

      {/* Empty canvas: offer the card types right away */}
      {cards.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="pointer-events-auto w-[min(92vw,440px)] p-6 rounded-2xl bg-canvas-surface/90 border border-slate-800 text-center shadow-2xl shadow-black/40">
            <h2 className="text-sm font-semibold text-slate-100">从一张卡片开始</h2>
            <p className="mt-1 text-xs text-slate-500">每张卡片完成一步生成，卡片之间可以连线传递提示词和参考图。</p>
            <div className="mt-5 grid grid-cols-6 gap-2">
              {(
                [
                  ['text', undefined, '文本', '写提示词', <FileText key="t" className="w-5 h-5 text-emerald-400" />],
                  ['image', undefined, '图片', '生成图片', <ImageIcon key="i" className="w-5 h-5 text-pink-400" />],
                  ['video', undefined, '视频', '生成视频', <Film key="v" className="w-5 h-5 text-indigo-400" />],
                  ['upload', 'image', '上传图片', '本地图片', <Upload key="ui" className="w-5 h-5 text-amber-400" />],
                  ['upload', 'video', '上传视频', '本地视频', <Upload key="uv" className="w-5 h-5 text-amber-400" />],
                ] as const
              ).map(([type, kind, label, hint, icon], i) => (
                <button
                  key={`${type}-${kind ?? ''}`}
                  type="button"
                  onClick={() => addCard(type, undefined, kind)}
                  className={`${i < 3 ? 'col-span-2' : 'col-span-3'} flex flex-col items-center gap-1.5 py-4 rounded-xl border border-slate-800 bg-canvas-bg hover:border-slate-600 hover:bg-slate-900 transition`}
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
          backgroundImage: `radial-gradient(circle at 1px 1px, rgb(var(--c-slate-400) / 0.18) 1px, transparent 0)`,
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
                if (ray.kind === 'source') {
                  return (
                    <g key={ray.id}>
                      <path d={ray.pathData} fill="none" style={{ stroke: 'rgb(var(--c-slate-400))' }} strokeOpacity={0.5} strokeWidth="2" />
                      {ray.sourceLabel && (
                        <foreignObject x={ray.midX - 36} y={ray.midY - 11} width={72} height={22}>
                          <div
                            title={ray.sourceLabel}
                            className="flex items-center justify-center w-full h-full px-1.5 bg-canvas-surface border border-slate-600 rounded-full text-[11px] font-mono text-slate-300"
                          >
                            <span className="truncate">{ray.sourceLabel}</span>
                          </div>
                        </foreignObject>
                      )}
                    </g>
                  );
                }
                const color = RAY_COLORS[ray.tone ?? 'pink'];
                return (
                  <g key={ray.id}>
                    <path d={ray.pathData} fill="none" style={{ stroke: color.stroke }} strokeOpacity={0.7} strokeWidth="2" />
                    {/* Label pill at curve center; its × disconnects */}
                    <foreignObject x={ray.midX - 36} y={ray.midY - 12} width={72} height={24}>
                      <div
                        className={`pointer-events-auto flex items-center justify-center gap-1 w-full h-full bg-canvas-surface border rounded-full text-[11px] font-mono ${color.pill}`}
                      >
                        <span>{ray.label}</span>
                        <button
                          type="button"
                          title="断开连线"
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={ray.onRemove}
                          className="text-slate-500 hover:text-rose-300 leading-none"
                        >
                          ×
                        </button>
                      </div>
                    </foreignObject>
                  </g>
                );
              })}

              {/* Line following the cursor while connecting */}
              {dragPath && (
                <path d={dragPath} fill="none" style={{ stroke: RAY_COLORS[RAY_TONE[dragSource?.type ?? 'image']].stroke }} strokeWidth="2" strokeDasharray="6 4" />
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
                    onStartConnect={hasOutputPort(card) ? (e) => startConnect(card, e) : undefined}
                    runsInProgress={card.role === 'generation' ? textRuns?.get(card.id) ?? 0 : 0}
                  />
                );
              }
              if (card.type === 'upload') {
                return <UploadCardView key={card.id} {...common} onStartConnect={(e) => startConnect(card, e)} />;
              }
              if (card.type === 'image') {
                return (
                  <ImageCardView
                    key={card.id}
                    {...common}
                    linkedPrompt={linkedPromptFor(card)}
                    onUnlinkPrompt={() => handleUpdateCard(card.id, { promptSourceId: undefined })}
                    onStartConnect={hasOutputPort(card) ? (e) => startConnect(card, e) : undefined}
                    isSubmitting={!!submittingIds?.has(card.id)}
                    runsInProgress={card.role === 'generation' ? runsInProgress(cards, card.id) : 0}
                    onRunAction={onRunAction && card.role === 'result' ? (action) => onRunAction(card.id, action) : undefined}
                    busyActionIds={card.resultActions?.length ? busyActionsOf(card) : undefined}
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
                  isSubmitting={!!submittingIds?.has(card.id)}
                  runsInProgress={card.role === 'generation' ? runsInProgress(cards, card.id) : 0}
                  onStartConnect={hasOutputPort(card) ? (e) => startConnect(card, e) : undefined}
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

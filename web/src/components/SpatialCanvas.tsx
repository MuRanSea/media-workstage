import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { SpatialCard } from '../types/canvas.ts';
import { useSpatialCanvas } from '../engine/useSpatialCanvas.ts';
import { screenToWorld, type CanvasTransform } from '../engine/matrix.ts';
import { connectCards, hasOutputPort } from '../engine/connections.ts';
import { ImageCardView } from './cards/ImageCardView.tsx';
import { VideoCardView } from './cards/VideoCardView.tsx';
import { TextCardView } from './cards/TextCardView.tsx';
import { PORT_Y, type ConnectHint } from './cards/CardPorts.tsx';
import {
  unpackLayerDecomposition,
  unpackSequentialStoryboards,
} from '../engine/expansion.ts';
import { NavigationDock } from './NavigationDock.tsx';
import { CanvasHeader } from './CanvasHeader.tsx';
import { SelectionToolbar } from './SelectionToolbar.tsx';
import { SettingsModal } from './SettingsModal.tsx';
interface SpatialCanvasProps {
  cards: SpatialCard[];
  setCards: React.Dispatch<React.SetStateAction<SpatialCard[]>>;
  onAddImageCard: () => void;
  onAddVideoCard: () => void;
  onAddTextCard: () => void;
  onTriggerGenerate: (cardId: string) => void;
  /** Viewport to open with (a saved project's). */
  initialViewport?: CanvasTransform;
  /** Called whenever the viewport pans or zooms. */
  onViewportChange?: (viewport: CanvasTransform) => void;
  /** Project controls rendered inside the header's brand area. */
  headerSlot?: React.ReactNode;
}

interface Ray {
  id: string;
  kind: 'reference' | 'prompt';
  pathData: string;
  midX: number;
  midY: number;
  label: string;
  onRemove: () => void;
}

/** In-progress connection drag: from a card's output port to the cursor (world coords). */
interface LinkDrag {
  sourceId: string;
  x: number;
  y: number;
  hoverId?: string;
}

const bezier = (srcX: number, srcY: number, tgtX: number, tgtY: number) => {
  const dx = Math.max(80, Math.abs(tgtX - srcX) * 0.5);
  return `M ${srcX} ${srcY} C ${srcX + dx} ${srcY}, ${tgtX - dx} ${tgtY}, ${tgtX} ${tgtY}`;
};

export const SpatialCanvas: React.FC<SpatialCanvasProps> = ({
  cards,
  setCards,
  onAddImageCard,
  onAddVideoCard,
  onAddTextCard,
  onTriggerGenerate,
  initialViewport,
  onViewportChange,
  headerSlot,
}) => {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
  const [linkDrag, setLinkDrag] = useState<LinkDrag | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
  } = useSpatialCanvas({
    cards,
    setCards,
    containerRef,
    initialZoom: initialViewport?.zoom,
    initialPanX: initialViewport?.panX,
    initialPanY: initialViewport?.panY,
  });

  useEffect(() => {
    onViewportChange?.(transform);
  }, [transform, onViewportChange]);

  const availableImageCards = useMemo(
    () => cards.filter((c) => c.type === 'image'),
    [cards]
  );

  const imageCount = availableImageCards.length;
  const videoCount = cards.filter((c) => c.type === 'video').length;
  const textCount = cards.filter((c) => c.type === 'text').length;

  const handleUpdateCard = useCallback(
    (cardId: string, updater: Partial<SpatialCard>) => {
      setCards((prev) => prev.map((c) => (c.id === cardId ? { ...c, ...updater } : c)));
    },
    [setCards]
  );

  const handleUnpackLayers = (parentCard: SpatialCard) => {
    setCards((prev) => unpackLayerDecomposition(parentCard, prev));
  };

  const handleUnpackStoryboards = (parentCard: SpatialCard) => {
    setCards((prev) => unpackSequentialStoryboards(parentCard, prev));
  };

  const removeReference = useCallback(
    (videoId: string, imageId: string) => {
      setCards((prev) =>
        prev.map((c) => {
          if (c.id !== videoId) return c;
          const ref = c.references?.find((r) => r.cardId === imageId);
          const prompt = ref ? c.prompt.replace(new RegExp(`@图${ref.tagIndex}\\b`, 'g'), '').trim() : c.prompt;
          return { ...c, prompt, references: (c.references ?? []).filter((r) => r.cardId !== imageId) };
        })
      );
    },
    [setCards]
  );

  const handleDeleteCard = (cardId: string) => {
    // Drop connections that point at the deleted card along with it.
    setCards((prev) =>
      prev
        .filter((c) => c.id !== cardId)
        .map((c) => {
          const refs = c.references?.filter((r) => r.cardId !== cardId);
          const promptSourceId = c.promptSourceId === cardId ? undefined : c.promptSourceId;
          return refs?.length !== c.references?.length || promptSourceId !== c.promptSourceId
            ? { ...c, references: refs, promptSourceId }
            : c;
        })
    );
    setSelectedCardIds((prev) => {
      const next = new Set(prev);
      next.delete(cardId);
      return next;
    });
  };

  const showNotice = useCallback((msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice((cur) => (cur === msg ? null : cur)), 2500);
  }, []);

  // --- Drag-to-connect ------------------------------------------------------

  const toWorld = useCallback(
    (clientX: number, clientY: number) => {
      const rect = containerRef.current?.getBoundingClientRect();
      return screenToWorld({ x: clientX, y: clientY }, transform, { x: rect?.left ?? 0, y: rect?.top ?? 0 });
    },
    [transform]
  );

  const cardIdAt = (clientX: number, clientY: number, excludeId: string): string | undefined => {
    const el = document.elementFromPoint(clientX, clientY)?.closest('[data-card-id]');
    const id = el?.getAttribute('data-card-id') ?? undefined;
    return id && id !== excludeId ? id : undefined;
  };

  const startConnect = (source: SpatialCard, e: React.MouseEvent) => {
    const p = toWorld(e.clientX, e.clientY);
    setLinkDrag({ sourceId: source.id, x: p.x, y: p.y });
  };

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
      if (res.ok) handleUpdateCard(target.id, res.patch);
      else showNotice(res.reason);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    // linkDrag itself changes on every move; only (re)bind when a drag starts or ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkDrag?.sourceId, toWorld, cards, handleUpdateCard, showNotice]);

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
          pathData: bezier(srcX, srcY, tgtX, tgtY),
          midX: (srcX + tgtX) / 2,
          midY: (srcY + tgtY) / 2,
          label: `@图${ref.tagIndex}`,
          onRemove: () => removeReference(card.id, src.id),
        });
      });

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
  }, [cards, removeReference, handleUpdateCard]);

  const dragSource = linkDrag ? cards.find((c) => c.id === linkDrag.sourceId) : undefined;
  const dragPath =
    linkDrag && dragSource
      ? bezier(dragSource.x + dragSource.width, dragSource.y + PORT_Y, linkDrag.x, linkDrag.y)
      : null;

  const linkedPromptFor = (card: SpatialCard) => {
    const src = card.promptSourceId ? cards.find((c) => c.id === card.promptSourceId) : undefined;
    return src ? { title: src.title, text: src.textOutput ?? '' } : undefined;
  };

  // Grid background pattern scaling
  const gridPatternSize = 24 * transform.zoom;
  const gridOffsetX = transform.panX % gridPatternSize;
  const gridOffsetY = transform.panY % gridPatternSize;

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#08090f] text-slate-100 select-none">
      {/* Header Bar */}
      <CanvasHeader
        imageCount={imageCount}
        videoCount={videoCount}
        textCount={textCount}
        onAddImageCard={onAddImageCard}
        onAddVideoCard={onAddVideoCard}
        onAddTextCard={onAddTextCard}
        onOpenSettings={() => setIsSettingsOpen(true)}
        projectSlot={headerSlot}
      />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />

      {/* Floating Navigation Dock */}
      <NavigationDock
        zoom={transform.zoom}
        activeTool={activeTool}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onResetZoom={resetZoom100}
        onFitView={fitView}
        onFocusSelection={() => focusSelection()}
        onToggleTool={setActiveTool}
      />

      {/* Multi-Selection Alignment Toolbar */}
      <SelectionToolbar
        selectedCount={selectedCardIds.size}
        onAlign={alignSelected}
        onArrangeGrid={arrangeSelectedGrid}
        onClearSelection={() => setSelectedCardIds(new Set())}
      />

      {/* Empty canvas hint */}
      {cards.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="text-center space-y-2 text-slate-500">
            <div className="text-sm font-semibold text-slate-400">画布是空的</div>
            <div className="text-xs leading-relaxed">
              点右上角「新增文本 / 生图 / 视频卡片」开始
              <br />
              拖动卡片右侧的圆点到另一张卡片即可连线
            </div>
          </div>
        </div>
      )}

      {/* Connection feedback */}
      {notice && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-50 px-3 py-1.5 rounded-xl bg-[#161925]/95 border border-amber-500/40 text-xs text-amber-200 shadow-2xl pointer-events-none">
          {notice}
        </div>
      )}

      {/* Main Canvas Viewport Container */}
      <div
        ref={containerRef}
        onMouseDown={handleMouseDownCanvas}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        className={`w-full h-full relative overflow-hidden ${
          linkDrag
            ? 'cursor-crosshair'
            : activeTool === 'hand' || isPanning
            ? 'cursor-grab active:cursor-grabbing'
            : 'cursor-default'
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
                const isPrompt = ray.kind === 'prompt';
                return (
                  <g key={ray.id}>
                    {/* Glowing background ray */}
                    <path
                      d={ray.pathData}
                      fill="none"
                      stroke={isPrompt ? 'rgba(16, 185, 129, 0.2)' : 'rgba(236, 72, 153, 0.2)'}
                      strokeWidth="8"
                      strokeLinecap="round"
                    />
                    {/* Animated foreground dash ray */}
                    <path
                      d={ray.pathData}
                      fill="none"
                      stroke={isPrompt ? 'url(#ray-gradient-prompt)' : 'url(#ray-gradient)'}
                      strokeWidth="2.5"
                      strokeDasharray="6 6"
                      className="animate-pulse"
                    />
                    {/* Label pill at curve center; its × disconnects */}
                    <foreignObject x={ray.midX - 34} y={ray.midY - 12} width={68} height={24}>
                      <div
                        className={`pointer-events-auto flex items-center justify-center gap-1 w-full h-full bg-[#12141e] border rounded-full text-[9px] font-mono font-bold shadow-lg ${
                          isPrompt
                            ? 'border-emerald-500/60 text-emerald-300 shadow-emerald-500/30'
                            : 'border-pink-500/60 text-pink-300 shadow-pink-500/30'
                        }`}
                      >
                        <span>{ray.label}</span>
                        <button
                          type="button"
                          title="断开连线"
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={ray.onRemove}
                          className="text-slate-500 hover:text-red-300 leading-none"
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
                <path
                  d={dragPath}
                  fill="none"
                  stroke={dragSource?.type === 'text' ? '#34d399' : '#f472b6'}
                  strokeWidth="2.5"
                  strokeDasharray="6 4"
                />
              )}

              <defs>
                <linearGradient
                  id="ray-gradient"
                  x1="0%"
                  y1="0%"
                  x2="100%"
                  y2="0%"
                >
                  <stop offset="0%" stopColor="#ec4899" />
                  <stop offset="50%" stopColor="#8b5cf6" />
                  <stop offset="100%" stopColor="#6366f1" />
                </linearGradient>
                <linearGradient id="ray-gradient-prompt" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#10b981" />
                  <stop offset="100%" stopColor="#22d3ee" />
                </linearGradient>
              </defs>
            </g>
          </svg>

          {/* Cards Render Layer */}
          <div className="pointer-events-auto">
            {cards.map((card) => {
              const common = {
                card,
                isSelected: selectedCardIds.has(card.id),
                onUpdateCard: handleUpdateCard,
                onDeleteCard: handleDeleteCard,
                onStartDrag: (e: React.MouseEvent<HTMLDivElement>) => handleStartDragCard(e, card),
                onTriggerGenerate,
                connectHint: connectHintFor(card),
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
                    onUnpackLayers={handleUnpackLayers}
                    onUnpackStoryboards={handleUnpackStoryboards}
                    linkedPrompt={linkedPromptFor(card)}
                    onUnlinkPrompt={() => handleUpdateCard(card.id, { promptSourceId: undefined })}
                    onStartConnect={hasOutputPort(card) ? (e) => startConnect(card, e) : undefined}
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
            className="absolute pointer-events-none border border-indigo-500/80 bg-indigo-500/15 rounded-md shadow-sm"
          />
        )}
      </div>
    </div>
  );
};

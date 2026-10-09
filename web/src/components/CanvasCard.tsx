import React, { useMemo } from 'react';
import type { ResultActionDto, SpatialCard } from '../types/canvas.ts';
import { hasOutputPort } from '../engine/connections.ts';
import { ImageCardView } from './cards/ImageCardView.tsx';
import { VideoCardView } from './cards/VideoCardView.tsx';
import { TextCardView } from './cards/TextCardView.tsx';
import { UploadCardView } from './cards/UploadCardView.tsx';
import type { ConnectHint } from './cards/CardPorts.tsx';
import type { CardViewProps } from './cards/cardProps.ts';
import type { ViewerMedia } from './MediaViewer.tsx';
import type { MenuEntry } from './ui/index.ts';

/**
 * What a card asks of the canvas. The canvas hands over one object that never
 * changes identity and always calls its latest handlers, so cards need not
 * re-render when the canvas does (panning, zooming, another card moving).
 */
export interface CardActions {
  select: (e: React.MouseEvent<HTMLDivElement>, card: SpatialCard) => void;
  startDrag: (e: React.MouseEvent<HTMLDivElement>, card: SpatialCard) => void;
  startConnect: (card: SpatialCard, e: React.MouseEvent) => void;
  updateCard: CardViewProps['onUpdateCard'];
  triggerGenerate: (cardId: string) => void;
  menuItems: (card: SpatialCard) => MenuEntry[];
  openViewer: (media: ViewerMedia) => void;
  notice: (message: string) => void;
  /** Absent when the page cannot run result actions. */
  runAction?: (cardId: string, action: ResultActionDto) => void;
}

interface CanvasCardProps {
  card: SpatialCard;
  actions: CardActions;
  isSelected: boolean;
  connectHint: ConnectHint;
  /** Changes whenever the card's ⋯ menu would (e.g. a describer was configured). */
  menuKey: string;
  /** Text cards: how many cards take their prompt from it. */
  linkedCount: number;
  /** The text card feeding this card's prompt. */
  linkedPromptTitle?: string;
  linkedPromptText?: string;
  runsInProgress: number;
  isSubmitting: boolean;
  /** Ids of result actions in flight, comma-joined so equal sets compare equal. */
  busyActionKey: string;
  /** Video cards: results it can take as references. */
  availableImageCards: SpatialCard[];
}

/** One card on the canvas; re-renders only when its own props change. */
export const CanvasCard = React.memo(function CanvasCard({
  card,
  actions,
  isSelected,
  connectHint,
  menuKey,
  linkedCount,
  linkedPromptTitle,
  linkedPromptText,
  runsInProgress,
  isSubmitting,
  busyActionKey,
  availableImageCards,
}: CanvasCardProps) {
  // menuKey stands in for what the menu depends on besides the card.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const menuItems = useMemo(() => actions.menuItems(card), [actions, card, menuKey]);
  const linkedPrompt = useMemo(
    () => (linkedPromptTitle === undefined ? undefined : { title: linkedPromptTitle, text: linkedPromptText ?? '' }),
    [linkedPromptTitle, linkedPromptText]
  );
  const busyActionIds = useMemo(() => (busyActionKey ? new Set(busyActionKey.split(',')) : undefined), [busyActionKey]);

  const common: CardViewProps = {
    card,
    isSelected,
    connectHint,
    onSelect: (e) => actions.select(e, card),
    onStartDrag: (e) => actions.startDrag(e, card),
    onUpdateCard: actions.updateCard,
    onTriggerGenerate: actions.triggerGenerate,
    menuItems,
    onOpenViewer: actions.openViewer,
  };
  const onStartConnect = hasOutputPort(card) ? (e: React.MouseEvent) => actions.startConnect(card, e) : undefined;
  const onUnlinkPrompt = () => actions.updateCard(card.id, { promptSourceId: undefined });

  if (card.type === 'text') {
    return (
      <TextCardView
        {...common}
        linkedCount={linkedCount}
        onStartConnect={onStartConnect}
        runsInProgress={runsInProgress}
        linkedPrompt={linkedPrompt}
        onUnlinkPrompt={onUnlinkPrompt}
      />
    );
  }
  if (card.type === 'upload') {
    return <UploadCardView {...common} onStartConnect={(e) => actions.startConnect(card, e)} />;
  }
  if (card.type === 'image') {
    return (
      <ImageCardView
        {...common}
        linkedPrompt={linkedPrompt}
        onUnlinkPrompt={onUnlinkPrompt}
        onStartConnect={onStartConnect}
        isSubmitting={isSubmitting}
        runsInProgress={runsInProgress}
        onRunAction={actions.runAction && card.role === 'result' ? (action) => actions.runAction?.(card.id, action) : undefined}
        busyActionIds={busyActionIds}
      />
    );
  }
  return (
    <VideoCardView
      {...common}
      availableImageCards={availableImageCards}
      linkedPrompt={linkedPrompt}
      onUnlinkPrompt={onUnlinkPrompt}
      onNotice={actions.notice}
      isSubmitting={isSubmitting}
      runsInProgress={runsInProgress}
      onStartConnect={onStartConnect}
    />
  );
});

import type React from 'react';
import type { SpatialCard } from '../../types/canvas.ts';
import type { MenuEntry } from '../ui/Menu.tsx';
import type { ConnectHint } from './CardPorts.tsx';

/** What the canvas hands every card view. */
export interface CardViewProps {
  card: SpatialCard;
  isSelected: boolean;
  connectHint?: ConnectHint;
  onSelect: (e: React.MouseEvent<HTMLDivElement>) => void;
  onStartDrag: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** `history: false` for automatic updates that should not be an undo step. */
  onUpdateCard: (cardId: string, patch: Partial<SpatialCard>, opts?: { history?: boolean }) => void;
  onTriggerGenerate: (cardId: string) => void;
  /** Standard ⋯ menu entries (duplicate, delete) built by the canvas. */
  menuItems: MenuEntry[];
  /** Opens the full-size media viewer. */
  onOpenViewer: (media: { url: string; kind: 'image' | 'video'; title: string }) => void;
}

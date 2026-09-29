import React from 'react';
import { X } from 'lucide-react';
import type { ReferenceItem, SpatialCard } from '../../types/canvas.ts';

const ROLE_LABELS: Record<string, string> = {
  first_frame: '首帧',
  last_frame: '尾帧',
  reference_image: '参考',
  reference_video: '参考',
};

interface Props {
  refs: ReferenceItem[];
  cards: SpatialCard[];
  onRemove: (cardId: string) => void;
  /** Shown while nothing is connected. */
  emptyHint: string;
  /** Tag the prompt uses: 图 for images (@图N), 视频 for videos (@视频N). */
  tagPrefix?: '图' | '视频';
}

/** A card's connected references (images or videos), each removable. */
export const ReferenceList: React.FC<Props> = ({ refs, cards, onRemove, emptyHint, tagPrefix = '图' }) =>
  refs.length === 0 ? (
    <p className="text-[11px] leading-relaxed text-slate-500">{emptyHint}</p>
  ) : (
    <ul className="space-y-1">
      {refs.map((ref) => {
        const src = cards.find((c) => c.id === ref.cardId);
        return (
          <li key={ref.cardId} className="flex items-center gap-2 rounded-lg bg-canvas-bg border border-canvas-border px-2 py-1.5 text-xs">
            <span className={`font-mono ${tagPrefix === '视频' ? 'text-indigo-300' : 'text-pink-300'}`}>
              @{tagPrefix}
              {ref.tagIndex}
            </span>
            <span className="flex-1 min-w-0 truncate text-slate-300">{src?.title ?? ref.label}</span>
            <span className="text-[11px] text-slate-500">{ROLE_LABELS[ref.role] ?? ref.role}</span>
            <button type="button" title="移除" onClick={() => onRemove(ref.cardId)} className="p-0.5 text-slate-500 hover:text-rose-400">
              <X className="w-3.5 h-3.5" />
            </button>
          </li>
        );
      })}
    </ul>
  );

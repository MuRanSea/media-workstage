import React from 'react';
import { Link2, Unlink } from 'lucide-react';

/** Vertical offset (world px) of a card's ports; connection lines anchor here. */
export const PORT_Y = 120;

/** Hover state while a connection is being dragged over this card. */
export type ConnectHint = 'ok' | 'bad' | undefined;

export const connectHintRing = (hint: ConnectHint): string =>
  hint === 'ok'
    ? 'ring-4 ring-emerald-400/60 border-emerald-400'
    : hint === 'bad'
    ? 'ring-4 ring-red-500/40 border-red-500/70'
    : '';

/** What an input slot takes: text into the prompt, or images / videos as references. */
export type SlotKind = 'prompt' | 'reference';

const SLOT_TITLE: Record<SlotKind, string> = {
  prompt: '提示词输入：从文本卡片右侧的圆点拖线到这张卡片，它的输出就是这里的提示词',
  reference: '参考输入：从图片、视频或上传卡片右侧的圆点拖线到这张卡片',
};

/**
 * Left-edge dot beside the field it feeds. Place it inside a `relative` element in the
 * card body; it sits on the card's edge (body padding 12px + border 1px + half the dot).
 * The canvas reads `data-slot` to end connection lines here.
 */
export const InputSlot: React.FC<{ kind: SlotKind; title?: string }> = ({ kind, title }) => (
  <div
    data-slot={kind}
    title={title ?? SLOT_TITLE[kind]}
    style={{ left: -20 }}
    className={`absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full border-2 bg-canvas-surface shadow ${
      kind === 'prompt' ? 'border-emerald-400' : 'border-pink-400'
    }`}
  />
);

/** Right-edge dot: drag from here onto another card to connect. */
export const OutputPort: React.FC<{
  color: 'pink' | 'emerald' | 'amber' | 'indigo';
  onStart: (e: React.MouseEvent<HTMLDivElement>) => void;
}> = ({ color, onStart }) => (
  <div
    title="拖动到其他卡片以连线"
    onMouseDown={(e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      onStart(e);
    }}
    style={{ top: PORT_Y - 8 }}
    className={`absolute -right-[9px] w-4 h-4 rounded-full border-2 bg-canvas-surface cursor-crosshair shadow-lg transition hover:scale-125 ${
      color === 'pink'
        ? 'border-pink-400 shadow-pink-500/40'
        : color === 'amber'
        ? 'border-amber-400 shadow-amber-500/40'
        : color === 'indigo'
        ? 'border-indigo-400 shadow-indigo-500/40'
        : 'border-emerald-400 shadow-emerald-500/40'
    }`}
  />
);

/** Replaces a card's prompt box while a text card feeds its prompt. */
export const LinkedPromptBox: React.FC<{
  sourceTitle: string;
  text: string;
  onUnlink: () => void;
}> = ({ sourceTitle, text, onUnlink }) => (
  <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/20 px-2.5 py-2 space-y-1">
    <div className="flex items-center justify-between text-[11px]">
      <span className="flex items-center gap-1 text-emerald-300 font-semibold min-w-0">
        <Link2 className="w-3 h-3 flex-shrink-0" />
        <span className="truncate">提示词来自「{sourceTitle}」</span>
      </span>
      <button
        type="button"
        onClick={onUnlink}
        className="flex items-center gap-0.5 text-slate-400 hover:text-red-300 flex-shrink-0"
        title="断开连线，恢复手动输入提示词"
      >
        <Unlink className="w-3 h-3" /> 断开
      </button>
    </div>
    <div className="text-xs text-slate-200 leading-relaxed max-h-20 overflow-y-auto whitespace-pre-wrap">
      {text.trim() ? text : <span className="text-slate-500">文本卡片还没有生成内容</span>}
    </div>
  </div>
);

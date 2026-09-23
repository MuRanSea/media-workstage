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

/** Left-edge dot: drop another card's output onto this card. */
export const InputPort: React.FC = () => (
  <div
    title="输入：从其他卡片右侧的圆点拖线到这张卡片"
    style={{ top: PORT_Y - 7 }}
    className="absolute -left-[8px] w-3.5 h-3.5 rounded-full border-2 border-slate-500 bg-[#12141e] shadow"
  />
);

/** Right-edge dot: drag from here onto another card to connect. */
export const OutputPort: React.FC<{
  color: 'pink' | 'emerald';
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
    className={`absolute -right-[9px] w-4 h-4 rounded-full border-2 bg-[#12141e] cursor-crosshair shadow-lg transition hover:scale-125 ${
      color === 'pink' ? 'border-pink-400 shadow-pink-500/40' : 'border-emerald-400 shadow-emerald-500/40'
    }`}
  />
);

/** Replaces a card's prompt box while a text card feeds its prompt. */
export const LinkedPromptBox: React.FC<{
  sourceTitle: string;
  text: string;
  onUnlink: () => void;
}> = ({ sourceTitle, text, onUnlink }) => (
  <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/20 p-2 space-y-1">
    <div className="flex items-center justify-between text-[10px]">
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

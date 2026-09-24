import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, ChevronDown, ChevronUp, Copy, Loader2, MoreHorizontal } from 'lucide-react';
import type { SpatialCard } from '../../types/canvas.ts';
import { ACCENT, type Accent } from '../ui/accent.ts';
import { MenuButton, type MenuEntry } from '../ui/Menu.tsx';
import { connectHintRing, type ConnectHint } from './CardPorts.tsx';

interface CardShellProps {
  card: SpatialCard;
  accent: Accent;
  icon: React.ReactNode;
  isSelected: boolean;
  connectHint?: ConnectHint;
  /** Mouse down anywhere on the card selects it. */
  onSelect: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** Mouse down on the header starts a drag. */
  onStartDrag: (e: React.MouseEvent<HTMLDivElement>) => void;
  onRename: (title: string) => void;
  /** Right side of the header, before the ⋯ menu. */
  badges?: React.ReactNode;
  menuItems: MenuEntry[];
  /** Port dots positioned against the card edge. */
  ports?: React.ReactNode;
  children: React.ReactNode;
}

/** Frame shared by all cards: positioning, selection outline, draggable header, ⋯ menu. */
export const CardShell: React.FC<CardShellProps> = ({
  card,
  accent,
  icon,
  isSelected,
  connectHint,
  onSelect,
  onStartDrag,
  onRename,
  badges,
  menuItems,
  ports,
  children,
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(card.title);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== card.title) onRename(next);
    else setDraft(card.title);
  };

  return (
    <div
      data-card-id={card.id}
      onMouseDown={onSelect}
      style={{ transform: `translate3d(${card.x}px, ${card.y}px, 0)`, width: `${card.width}px` }}
      className={`absolute top-0 left-0 rounded-2xl bg-canvas-surface border shadow-xl shadow-black/40 select-none ${
        connectHint ? connectHintRing(connectHint) : isSelected ? ACCENT[accent].selected : 'border-slate-800 hover:border-slate-700'
      }`}
    >
      {ports}
      <div
        onMouseDown={onStartDrag}
        onDoubleClick={() => {
          setDraft(card.title);
          setEditing(true);
        }}
        className="flex items-center gap-2 h-10 pl-3 pr-1.5 border-b border-slate-800/80 cursor-grab active:cursor-grabbing"
      >
        <span className={`flex-shrink-0 ${ACCENT[accent].text}`}>{icon}</span>
        {editing ? (
          <input
            autoFocus
            value={draft}
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') {
                setDraft(card.title);
                setEditing(false);
              }
            }}
            className="flex-1 min-w-0 bg-canvas-bg border border-slate-700 rounded-md px-1.5 py-0.5 text-xs font-semibold text-slate-100 outline-none"
          />
        ) : (
          <span className="flex-1 min-w-0 truncate text-xs font-semibold text-slate-100" title="双击重命名">
            {card.title}
          </span>
        )}
        {badges}
        <MenuButton items={menuItems} align="right">
          {({ open, toggle }) => (
            <button
              type="button"
              title="更多操作"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={toggle}
              className={`w-7 h-7 flex items-center justify-center rounded-lg transition ${
                open ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-white hover:bg-slate-800'
              }`}
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
          )}
        </MenuButton>
      </div>
      <div className="p-3 space-y-2.5">{children}</div>
    </div>
  );
};

/** The @图N tag other cards use to reference this one. */
export const TagBadge: React.FC<{ tagIndex: number; accent: Accent }> = ({ tagIndex, accent }) => (
  <span
    title={`在视频提示词里用 @图${tagIndex} 引用这张卡片`}
    className={`flex-shrink-0 font-mono text-[11px] px-1.5 py-px rounded-md border ${ACCENT[accent].soft}`}
  >
    @图{tagIndex}
  </span>
);

/** Textarea that grows with its content up to `maxRows`. */
export const AutoTextarea: React.FC<
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
    accent: Accent;
    minRows?: number;
    maxRows?: number;
    textareaRef?: React.MutableRefObject<HTMLTextAreaElement | null>;
  }
> = ({ accent, minRows = 2, maxRows = 6, textareaRef, className = '', ...rest }) => {
  const localRef = useRef<HTMLTextAreaElement | null>(null);
  const ref = textareaRef ?? localRef;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const line = 18; // text-xs leading-relaxed ≈ 18px
    el.style.height = 'auto';
    el.style.height = `${Math.min(Math.max(el.scrollHeight, minRows * line + 14), maxRows * line + 14)}px`;
  }, [rest.value, minRows, maxRows, ref]);

  return (
    <textarea
      ref={ref}
      rows={minRows}
      className={`w-full block bg-canvas-bg border border-canvas-border rounded-xl px-2.5 py-1.5 text-xs leading-relaxed text-slate-200 placeholder:text-slate-500 resize-none focus:outline-none ${ACCENT[accent].focus} ${className}`}
      {...rest}
    />
  );
};

/** Full error text, clamped to three lines until expanded, with a copy button. */
export const ErrorBox: React.FC<{ message: string }> = ({ message }) => {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const long = message.length > 90;
  return (
    <div className="rounded-lg border border-rose-500/40 bg-rose-950/40 px-2.5 py-2 text-[11px] leading-relaxed text-rose-200">
      <div className="flex items-start gap-1.5">
        <AlertCircle className="w-3.5 h-3.5 mt-px flex-shrink-0 text-rose-400" />
        <p className={`flex-1 min-w-0 break-words select-text ${expanded ? '' : 'line-clamp-3'}`}>{message}</p>
      </div>
      <div className="flex justify-end gap-3 mt-1 text-rose-300/80">
        {long && (
          <button type="button" onClick={() => setExpanded(!expanded)} className="flex items-center gap-0.5 hover:text-rose-100">
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {expanded ? '收起' : '展开'}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(message).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          className="flex items-center gap-0.5 hover:text-rose-100"
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
    </div>
  );
};

/** Progress overlay for a preview while its task runs. */
export const GeneratingOverlay: React.FC<{ progress: number; label?: string }> = ({ progress, label = '生成中' }) => (
  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 backdrop-blur-[2px]">
    <Loader2 className="w-5 h-5 text-white/80 animate-spin" />
    <span className="text-xs text-white/90">
      {label} {progress > 0 ? `${progress}%` : ''}
    </span>
    <div className="w-2/3 h-1 rounded-full bg-white/15 overflow-hidden">
      <div className="h-full bg-white/80 transition-all" style={{ width: `${Math.max(progress, 4)}%` }} />
    </div>
  </div>
);

/** Small status chip in a preview corner. */
export const StatusChip: React.FC<{ status: SpatialCard['status'] }> = ({ status }) => {
  if (status === 'succeeded') {
    return (
      <span className="absolute top-2 right-2 px-1.5 py-px rounded-md bg-black/70 text-[11px] text-emerald-300 flex items-center gap-1 pointer-events-none">
        <Check className="w-3 h-3" /> 已完成
      </span>
    );
  }
  if (status === 'failed' || status === 'expired' || status === 'cancelled') {
    return (
      <span className="absolute top-2 right-2 px-1.5 py-px rounded-md bg-rose-950/90 text-[11px] text-rose-200 flex items-center gap-1 pointer-events-none">
        <AlertCircle className="w-3 h-3" /> {status === 'failed' ? '失败' : status === 'expired' ? '已过期' : '已取消'}
      </span>
    );
  }
  return null;
};

/** Model + spec line under the preview; clicking it selects the card to open the inspector. */
export const SummaryRow: React.FC<{ model: string; spec: string; extra?: React.ReactNode }> = ({ model, spec, extra }) => (
  <div className="flex items-center gap-1.5 min-w-0 text-[11px] text-slate-400" title="在右侧面板调整模型和参数">
    <span className="truncate font-medium text-slate-300">{model}</span>
    {spec && <span className="text-slate-600">·</span>}
    <span className="truncate font-mono">{spec}</span>
    {extra}
  </div>
);

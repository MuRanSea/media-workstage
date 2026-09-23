import React from 'react';
import {
  Sparkles,
  Video,
  Image as ImageIcon,
  Trash2,
  CheckCircle2,
  Loader2,
  Film,
} from 'lucide-react';
import type { SpatialCard } from '../../types/canvas.ts';

interface CanvasCardProps {
  card: SpatialCard;
  isSelected: boolean;
  onUpdateCard: (cardId: string, updater: Partial<SpatialCard>) => void;
  onDeleteCard: (cardId: string) => void;
  onStartDrag: (e: React.MouseEvent<HTMLDivElement>) => void;
  onTriggerGenerate: (cardId: string) => void;
}

export const CanvasCard: React.FC<CanvasCardProps> = ({
  card,
  isSelected,
  onUpdateCard,
  onDeleteCard,
  onStartDrag,
  onTriggerGenerate,
}) => {
  const isImage = card.type === 'image';

  return (
    <div
      style={{
        transform: `translate3d(${card.x}px, ${card.y}px, 0)`,
        width: `${card.width}px`,
      }}
      className={`absolute top-0 left-0 rounded-2xl bg-[#12141e]/95 backdrop-blur-xl border transition-all duration-75 select-none shadow-2xl ${
        isSelected
          ? isImage
            ? 'border-pink-500 ring-2 ring-pink-500/40 shadow-pink-500/20'
            : 'border-indigo-500 ring-2 ring-indigo-500/40 shadow-indigo-500/20'
          : 'border-slate-800/90 hover:border-slate-700'
      }`}
    >
      {/* Card Header & Drag Handle */}
      <div
        onMouseDown={onStartDrag}
        className="flex items-center justify-between px-3 py-2 border-b border-slate-800/80 cursor-grab active:cursor-grabbing bg-slate-900/40 rounded-t-2xl"
      >
        <div className="flex items-center gap-2">
          <div
            className={`w-5 h-5 rounded-lg border flex items-center justify-center ${
              isImage
                ? 'bg-pink-500/20 border-pink-500/30 text-pink-400'
                : 'bg-indigo-500/20 border-indigo-500/30 text-indigo-400'
            }`}
          >
            {isImage ? (
              <ImageIcon className="w-3 h-3" />
            ) : (
              <Video className="w-3 h-3" />
            )}
          </div>
          <input
            type="text"
            value={card.title}
            onChange={(e) => onUpdateCard(card.id, { title: e.target.value })}
            className="text-xs font-bold text-slate-100 bg-transparent border-none focus:outline-none focus:ring-1 focus:ring-indigo-500/50 rounded px-1 max-w-[160px]"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <span
            className={`font-mono text-[10px] px-1.5 py-0.5 rounded-full font-bold border ${
              isImage
                ? 'bg-pink-500/20 text-pink-300 border-pink-500/40'
                : 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
            }`}
          >
            @图{card.tagIndex}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDeleteCard(card.id);
            }}
            title="删除卡片"
            className="p-1 text-slate-500 hover:text-red-400 rounded transition"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Card Body */}
      <div className="p-3 space-y-2.5">
        {/* Preview Area */}
        <div
          className={`relative rounded-xl overflow-hidden border border-slate-700/80 bg-black flex items-center justify-center ${
            isImage ? 'aspect-[16/10]' : 'aspect-video'
          }`}
        >
          <div
            className={`w-full h-full bg-gradient-to-br flex flex-col items-center justify-center p-3 text-center ${
              isImage
                ? 'from-pink-950/40 via-slate-900 to-purple-950/40'
                : 'from-indigo-950/40 via-slate-900 to-cyan-950/40'
            }`}
          >
            {isImage ? (
              <ImageIcon className="w-6 h-6 text-pink-400 mb-1 opacity-70" />
            ) : (
              <Film className="w-6 h-6 text-indigo-400 mb-1 opacity-70" />
            )}
            <span className="text-xs font-semibold text-slate-200 truncate max-w-[200px]">
              {card.model}
            </span>
          </div>

          {card.status === 'succeeded' && (
            <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded-full bg-black/70 backdrop-blur text-[9px] text-emerald-400 flex items-center gap-1 border border-emerald-500/30">
              <CheckCircle2 className="w-2.5 h-2.5" /> 就绪
            </div>
          )}
        </div>

        {/* Prompt Input */}
        <textarea
          value={card.prompt}
          onChange={(e) => onUpdateCard(card.id, { prompt: e.target.value })}
          className={`w-full bg-[#0b0d14] border border-slate-700/70 rounded-xl p-2 text-xs text-slate-200 focus:outline-none resize-none h-14 leading-relaxed ${
            isImage ? 'focus:border-pink-500' : 'focus:border-indigo-500'
          }`}
          placeholder={
            isImage
              ? '输入画面描述...'
              : '运镜描述，可使用 @图1 @图2 引用...'
          }
        />

        {/* Generate Button */}
        <button
          type="button"
          onClick={() => onTriggerGenerate(card.id)}
          disabled={card.status === 'running' || card.status === 'queued'}
          className={`w-full py-2 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-lg transition active:scale-98 disabled:opacity-50 ${
            isImage
              ? 'bg-gradient-to-r from-pink-600 via-purple-600 to-indigo-600 hover:from-pink-500 hover:to-indigo-500 shadow-pink-600/25'
              : 'bg-gradient-to-r from-indigo-600 via-purple-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 shadow-indigo-600/25'
          }`}
        >
          {card.status === 'running' || card.status === 'queued' ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> 生成中 {card.progress}%
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5" /> 生成{isImage ? '图片' : '视频'}
            </>
          )}
        </button>
      </div>
    </div>
  );
};

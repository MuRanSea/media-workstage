import React from 'react';
import {
  AlignLeft,
  AlignCenterHorizontal,
  AlignRight,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  LayoutGrid,
  X,
  Layers,
} from 'lucide-react';
import type { AlignmentType } from '../engine/layout.ts';

interface SelectionToolbarProps {
  selectedCount: number;
  onAlign: (alignment: AlignmentType) => void;
  onArrangeGrid: (gap?: number, columns?: number) => void;
  onClearSelection: () => void;
}

export const SelectionToolbar: React.FC<SelectionToolbarProps> = ({
  selectedCount,
  onAlign,
  onArrangeGrid,
  onClearSelection,
}) => {
  if (selectedCount <= 1) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1.5 bg-[#12141e]/95 backdrop-blur-md border border-indigo-500/40 px-3 py-1.5 rounded-2xl shadow-2xl shadow-black/80 text-slate-200 select-none animate-in fade-in slide-in-from-bottom-3 duration-150">
      {/* Count pill */}
      <div className="flex items-center gap-1.5 text-xs font-semibold text-indigo-300 pr-2 border-r border-slate-800">
        <Layers className="w-3.5 h-3.5" />
        <span>{selectedCount} 张卡片已选中</span>
      </div>

      {/* Alignment actions */}
      <div className="flex items-center gap-0.5 text-slate-400">
        <button
          type="button"
          onClick={() => onAlign('left')}
          title="左对齐"
          className="p-1.5 hover:bg-slate-800 hover:text-white rounded-lg transition"
        >
          <AlignLeft className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onAlign('center-h')}
          title="水平居中对齐"
          className="p-1.5 hover:bg-slate-800 hover:text-white rounded-lg transition"
        >
          <AlignCenterHorizontal className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onAlign('right')}
          title="右对齐"
          className="p-1.5 hover:bg-slate-800 hover:text-white rounded-lg transition"
        >
          <AlignRight className="w-3.5 h-3.5" />
        </button>

        <div className="h-3.5 w-[1px] bg-slate-800 mx-1" />

        <button
          type="button"
          onClick={() => onAlign('top')}
          title="顶部对齐"
          className="p-1.5 hover:bg-slate-800 hover:text-white rounded-lg transition"
        >
          <AlignStartVertical className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onAlign('center-v')}
          title="垂直居中对齐"
          className="p-1.5 hover:bg-slate-800 hover:text-white rounded-lg transition"
        >
          <AlignCenterVertical className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onAlign('bottom')}
          title="底部对齐"
          className="p-1.5 hover:bg-slate-800 hover:text-white rounded-lg transition"
        >
          <AlignEndVertical className="w-3.5 h-3.5" />
        </button>

        <div className="h-3.5 w-[1px] bg-slate-800 mx-1" />

        <button
          type="button"
          onClick={() => onArrangeGrid(40, 2)}
          title="自动网格排版 (2列)"
          className="px-2 py-1 bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 border border-indigo-500/30 rounded-lg text-xs font-semibold flex items-center gap-1 transition"
        >
          <LayoutGrid className="w-3.5 h-3.5" />
          <span>网格排列</span>
        </button>
      </div>

      <button
        type="button"
        onClick={onClearSelection}
        title="取消全选 (Esc)"
        className="p-1 text-slate-500 hover:text-slate-200 ml-1 rounded-md transition"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

import React from 'react';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Focus,
  Hand,
  MousePointer,
} from 'lucide-react';
import type { CanvasTool } from '../types/canvas.ts';

interface NavigationDockProps {
  zoom: number;
  activeTool: CanvasTool;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onFitView: () => void;
  onFocusSelection: () => void;
  onToggleTool: (tool: CanvasTool) => void;
}

export const NavigationDock: React.FC<NavigationDockProps> = ({
  zoom,
  activeTool,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onFitView,
  onFocusSelection,
  onToggleTool,
}) => {
  const zoomPercent = Math.round(zoom * 100);

  return (
    <div className="fixed bottom-6 right-6 z-40 flex items-center gap-1 bg-[#12141e]/90 backdrop-blur-md border border-slate-800/80 p-1.5 rounded-2xl shadow-2xl shadow-black/60 text-slate-300 select-none">
      {/* Tool switcher */}
      <div className="flex bg-slate-900/80 p-0.5 rounded-xl border border-slate-800 mr-1">
        <button
          type="button"
          onClick={() => onToggleTool('select')}
          title="选择/移动卡片 (V)"
          className={`p-1.5 rounded-lg transition ${
            activeTool === 'select'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <MousePointer className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onToggleTool('hand')}
          title="抓手漫游画布 (Space)"
          className={`p-1.5 rounded-lg transition ${
            activeTool === 'hand'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Hand className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="h-4 w-[1px] bg-slate-800" />

      {/* Zoom controls */}
      <button
        type="button"
        onClick={onZoomOut}
        title="缩小 (-)"
        className="p-1.5 hover:bg-slate-800/80 hover:text-white rounded-lg transition"
      >
        <ZoomOut className="w-3.5 h-3.5" />
      </button>

      <button
        type="button"
        onClick={onResetZoom}
        title="重置缩放到 100% (1)"
        className="px-2 py-1 hover:bg-slate-800/80 hover:text-white rounded-lg text-xs font-mono font-bold transition min-w-[50px] text-center"
      >
        {zoomPercent}%
      </button>

      <button
        type="button"
        onClick={onZoomIn}
        title="放大 (+)"
        className="p-1.5 hover:bg-slate-800/80 hover:text-white rounded-lg transition"
      >
        <ZoomIn className="w-3.5 h-3.5" />
      </button>

      <div className="h-4 w-[1px] bg-slate-800" />

      {/* Quick view navigation */}
      <button
        type="button"
        onClick={onFitView}
        title="适应画布全景 (0)"
        className="p-1.5 hover:bg-slate-800/80 hover:text-white rounded-lg transition flex items-center gap-1 text-xs"
      >
        <Maximize2 className="w-3.5 h-3.5" />
      </button>

      <button
        type="button"
        onClick={onFocusSelection}
        title="聚焦所选卡片 (F)"
        className="p-1.5 hover:bg-slate-800/80 hover:text-white rounded-lg transition flex items-center gap-1 text-xs"
      >
        <Focus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

import React from 'react';
import { Focus, Hand, HelpCircle, Maximize2, MousePointer2, Redo2, Undo2, ZoomIn, ZoomOut } from 'lucide-react';
import type { CanvasTool } from '../types/canvas.ts';
import { IconButton } from './ui/index.ts';

interface NavigationDockProps {
  zoom: number;
  activeTool: CanvasTool;
  /** Distance from the right edge, so the dock clears the inspector panel. */
  right: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onFitView: () => void;
  onFocusSelection: () => void;
  onToggleTool: (tool: CanvasTool) => void;
  onShowShortcuts: () => void;
}

const Divider = () => <div className="h-5 w-px bg-slate-800 mx-0.5" />;

export const NavigationDock: React.FC<NavigationDockProps> = ({
  zoom,
  activeTool,
  right,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onFitView,
  onFocusSelection,
  onToggleTool,
  onShowShortcuts,
}) => (
  <div
    style={{ right }}
    className="fixed bottom-4 z-40 flex items-center gap-0.5 p-1 bg-canvas-surface/90 backdrop-blur-md border border-slate-800 rounded-xl shadow-lg shadow-black/40 text-slate-300 select-none transition-[right] duration-200"
  >
    <IconButton title="选择（V）" active={activeTool === 'select'} onClick={() => onToggleTool('select')}>
      <MousePointer2 className="w-4 h-4" />
    </IconButton>
    <IconButton title="拖动画布（按住空格）" active={activeTool === 'hand'} onClick={() => onToggleTool('hand')}>
      <Hand className="w-4 h-4" />
    </IconButton>
    <Divider />
    <IconButton title="撤销（Ctrl+Z）" disabled={!canUndo} onClick={onUndo}>
      <Undo2 className="w-4 h-4" />
    </IconButton>
    <IconButton title="重做（Ctrl+Shift+Z）" disabled={!canRedo} onClick={onRedo}>
      <Redo2 className="w-4 h-4" />
    </IconButton>
    <Divider />
    <IconButton title="缩小（-）" onClick={onZoomOut}>
      <ZoomOut className="w-4 h-4" />
    </IconButton>
    <button
      type="button"
      onClick={onResetZoom}
      title="缩放到 100%（1）"
      className="h-8 min-w-[52px] px-1.5 rounded-lg text-xs font-mono hover:bg-slate-800 hover:text-white"
    >
      {Math.round(zoom * 100)}%
    </button>
    <IconButton title="放大（+）" onClick={onZoomIn}>
      <ZoomIn className="w-4 h-4" />
    </IconButton>
    <IconButton title="显示全部卡片（0）" onClick={onFitView}>
      <Maximize2 className="w-4 h-4" />
    </IconButton>
    <IconButton title="聚焦选中的卡片（F）" onClick={onFocusSelection}>
      <Focus className="w-4 h-4" />
    </IconButton>
    <Divider />
    <IconButton title="快捷键" onClick={onShowShortcuts}>
      <HelpCircle className="w-4 h-4" />
    </IconButton>
  </div>
);

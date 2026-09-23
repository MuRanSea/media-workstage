import React from 'react';
import {
  Sparkles,
  Video,
  Image as ImageIcon,
  Plus,
  Settings,
  FileText,
} from 'lucide-react';

interface CanvasHeaderProps {
  imageCount: number;
  videoCount: number;
  textCount: number;
  onAddImageCard: () => void;
  onAddVideoCard: () => void;
  onAddTextCard: () => void;
  onOpenSettings: () => void;
  /** Project name, save status and switcher. */
  projectSlot?: React.ReactNode;
}

export const CanvasHeader: React.FC<CanvasHeaderProps> = ({
  imageCount,
  videoCount,
  textCount,
  onAddImageCard,
  onAddVideoCard,
  onAddTextCard,
  onOpenSettings,
  projectSlot,
}) => {
  return (
    <header className="fixed top-4 left-4 right-4 z-40 flex items-center justify-between pointer-events-none select-none">
      {/* Brand logo and stats */}
      <div className="pointer-events-auto flex items-center gap-3 bg-[#12141e]/90 backdrop-blur-md border border-slate-800/80 px-3.5 py-2 rounded-2xl shadow-xl shadow-black/40">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-xl bg-gradient-to-tr from-pink-600 via-purple-600 to-indigo-600 flex items-center justify-center shadow-md shadow-pink-600/30">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-xs font-bold text-slate-100 tracking-wide flex items-center gap-1.5">
              Media Workstage
              <span className="text-[9px] px-1.5 py-0.2 rounded-full bg-indigo-500/20 text-indigo-300 font-mono border border-indigo-500/30">
                Spatial v1
              </span>
            </h1>
          </div>
        </div>

        {projectSlot && (
          <>
            <div className="h-4 w-[1px] bg-slate-800" />
            {projectSlot}
          </>
        )}

        <div className="h-4 w-[1px] bg-slate-800" />

        {/* Card stats badges */}
        <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono">
          <span className="flex items-center gap-1">
            <ImageIcon className="w-3 h-3 text-pink-400" /> {imageCount} 生图
          </span>
          <span className="text-slate-700">•</span>
          <span className="flex items-center gap-1">
            <Video className="w-3 h-3 text-indigo-400" /> {videoCount} 视频
          </span>
          <span className="text-slate-700">•</span>
          <span className="flex items-center gap-1">
            <FileText className="w-3 h-3 text-emerald-400" /> {textCount} 文本
          </span>
        </div>
      </div>

      {/* Action buttons */}
      <div className="pointer-events-auto flex items-center gap-2">
        <button
          type="button"
          onClick={onAddTextCard}
          className="flex items-center gap-1.5 bg-[#141724]/90 hover:bg-[#1a1e30] border border-emerald-500/30 hover:border-emerald-500/60 px-3 py-2 rounded-xl text-xs font-semibold text-emerald-300 shadow-lg shadow-emerald-950/40 backdrop-blur-md transition active:scale-95"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>新增文本卡片</span>
        </button>

        <button
          type="button"
          onClick={onAddImageCard}
          className="flex items-center gap-1.5 bg-[#141724]/90 hover:bg-[#1a1e30] border border-pink-500/30 hover:border-pink-500/60 px-3 py-2 rounded-xl text-xs font-semibold text-pink-300 shadow-lg shadow-pink-950/40 backdrop-blur-md transition active:scale-95"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>新增生图卡片</span>
        </button>

        <button
          type="button"
          onClick={onAddVideoCard}
          className="flex items-center gap-1.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 border border-indigo-400/30 px-3.5 py-2 rounded-xl text-xs font-bold text-white shadow-lg shadow-indigo-950/60 backdrop-blur-md transition active:scale-95"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>新增视频卡片</span>
        </button>

        <button
          type="button"
          onClick={onOpenSettings}
          title="配置 API 密钥与服务商参数"
          className="flex items-center justify-center w-8 h-8 bg-[#12141e]/90 hover:bg-[#1a1e30] border border-slate-700/80 hover:border-slate-600 rounded-xl text-slate-300 hover:text-white shadow-md transition active:scale-95"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};

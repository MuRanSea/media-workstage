import React from 'react';
import { FileText, Film, Image as ImageIcon, Plus, Settings, Sparkles } from 'lucide-react';
import type { CardType } from '../types/canvas.ts';
import { navigate } from '../services/router.ts';
import { IconButton, MenuButton, type MenuEntry } from './ui/index.ts';

interface CanvasHeaderProps {
  onAdd: (type: CardType) => void;
  onOpenSettings: () => void;
  /** Project name, save status and switcher. */
  projectSlot?: React.ReactNode;
}

export const ADD_CARD_ITEMS = (onAdd: (type: CardType) => void): MenuEntry[] => [
  { label: '文本卡片', hint: '让模型写提示词', icon: <FileText className="w-4 h-4 text-emerald-400" />, onSelect: () => onAdd('text') },
  { label: '图片卡片', hint: '文字生成图片', icon: <ImageIcon className="w-4 h-4 text-pink-400" />, onSelect: () => onAdd('image') },
  { label: '视频卡片', hint: '文字或图片生成视频', icon: <Film className="w-4 h-4 text-indigo-400" />, onSelect: () => onAdd('video') },
];

export const CanvasHeader: React.FC<CanvasHeaderProps> = ({ onAdd, onOpenSettings, projectSlot }) => (
  <header className="fixed top-4 left-4 right-4 z-40 flex items-center justify-between gap-3 pointer-events-none select-none">
    <div className="pointer-events-auto flex items-center gap-3 min-w-0 h-11 pl-1.5 pr-3 bg-canvas-surface/90 backdrop-blur-md border border-slate-800 rounded-xl shadow-lg shadow-black/30">
      <button
        type="button"
        title="全部工程"
        onClick={() => navigate('/')}
        className="w-8 h-8 flex-shrink-0 rounded-lg bg-gradient-to-tr from-pink-600 to-indigo-600 flex items-center justify-center hover:opacity-90"
      >
        <Sparkles className="w-4 h-4 text-white" />
      </button>
      {projectSlot}
    </div>

    <div className="pointer-events-auto flex items-center gap-1.5 h-11 px-1.5 bg-canvas-surface/90 backdrop-blur-md border border-slate-800 rounded-xl shadow-lg shadow-black/30">
      <MenuButton items={ADD_CARD_ITEMS(onAdd)} align="right" title="添加到画布中央">
        {({ open, toggle }) => (
          <button
            type="button"
            onClick={toggle}
            className={`flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
              open ? 'bg-indigo-500 text-white' : 'bg-indigo-600 hover:bg-indigo-500 text-white'
            }`}
          >
            <Plus className="w-4 h-4" />
            添加
          </button>
        )}
      </MenuButton>
      <IconButton title="服务商设置" onClick={onOpenSettings}>
        <Settings className="w-4 h-4" />
      </IconButton>
    </div>
  </header>
);

import React from 'react';
import { Dialog } from './ui/index.ts';

const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: '添加与编辑',
    items: [
      ['双击空白处 / 右键', '在光标处添加卡片'],
      ['Delete', '删除选中的卡片'],
      ['Ctrl+Z', '撤销'],
      ['Ctrl+Shift+Z / Ctrl+Y', '重做'],
      ['Ctrl+C / Ctrl+V', '复制 / 粘贴到光标处'],
      ['Ctrl+D', '复制一份'],
      ['Ctrl+A', '全选'],
      ['Ctrl+S', '立即保存'],
    ],
  },
  {
    title: '画布',
    items: [
      ['滚轮 / 触控板', '平移画布'],
      ['Ctrl+滚轮', '缩放'],
      ['按住空格拖动', '平移画布'],
      ['V / H', '选择工具 / 拖动工具'],
      ['Shift+点击 / 框选', '多选'],
      ['0', '显示全部卡片'],
      ['1', '缩放到 100%'],
      ['F', '聚焦选中的卡片'],
      ['Esc', '取消选择'],
    ],
  },
];

export const ShortcutsDialog: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => (
  <Dialog open={open} title="快捷键" onClose={onClose} width="max-w-lg">
    <div className="grid sm:grid-cols-2 gap-x-6 gap-y-4">
      {GROUPS.map((g) => (
        <div key={g.title} className="space-y-1.5">
          <h3 className="text-[11px] font-semibold text-slate-500">{g.title}</h3>
          {g.items.map(([keys, what]) => (
            <div key={keys} className="flex items-center justify-between gap-3">
              <span className="text-slate-300">{what}</span>
              <kbd className="px-1.5 py-px rounded border border-slate-700 bg-canvas-bg text-[11px] font-mono text-slate-400 whitespace-nowrap">
                {keys}
              </kbd>
            </div>
          ))}
        </div>
      ))}
    </div>
  </Dialog>
);

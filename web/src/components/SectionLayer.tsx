import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { CanvasSection } from '../types/canvas.ts';
import { SECTION_HEADER, sectionRect } from '../engine/sections.ts';

interface SectionLayerProps {
  sections: CanvasSection[];
  selectedIds: ReadonlySet<string>;
  /** Cards in each section. */
  memberCounts: ReadonlyMap<string, number>;
  /** Mouse down on a title bar: select it and start moving it with its cards. */
  onStartMove: (e: React.MouseEvent, section: CanvasSection) => void;
  /** Mouse down on the corner handle. */
  onStartResize: (e: React.MouseEvent, section: CanvasSection) => void;
  onRename: (id: string, title: string) => void;
  onToggleCollapse: (id: string) => void;
}

/**
 * Sections, drawn under the cards. Only the title bar and the corner handle
 * take the mouse: the body lets clicks through to the canvas, so marquee
 * selection and double-click-to-add still work inside a section.
 */
export const SectionLayer: React.FC<SectionLayerProps> = ({ sections, selectedIds, memberCounts, onStartMove, onStartResize, onRename, onToggleCollapse }) => (
  <div className="absolute top-0 left-0">
    {sections.map((s) => (
      <SectionFrame
        key={s.id}
        section={s}
        selected={selectedIds.has(s.id)}
        count={memberCounts.get(s.id) ?? 0}
        onStartMove={onStartMove}
        onStartResize={onStartResize}
        onRename={onRename}
        onToggleCollapse={onToggleCollapse}
      />
    ))}
  </div>
);

const SectionFrame: React.FC<{
  section: CanvasSection;
  selected: boolean;
  count: number;
  onStartMove: SectionLayerProps['onStartMove'];
  onStartResize: SectionLayerProps['onStartResize'];
  onRename: SectionLayerProps['onRename'];
  onToggleCollapse: SectionLayerProps['onToggleCollapse'];
}> = ({ section, selected, count, onStartMove, onStartResize, onRename, onToggleCollapse }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(section.title);
  const rect = sectionRect(section);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== section.title) onRename(section.id, next);
    else setDraft(section.title);
  };

  return (
    <div
      data-section-id={section.id}
      style={{ transform: `translate3d(${rect.x}px, ${rect.y}px, 0)`, width: rect.width, height: rect.height }}
      className={`absolute top-0 left-0 rounded-2xl border-2 ${
        selected
          ? 'border-indigo-400/80 bg-indigo-500/[0.06]'
          : section.collapsed
            ? 'border-slate-600 bg-canvas-surface shadow-lg shadow-black/30'
            : 'border-slate-600/80 bg-slate-400/[0.07]'
      }`}
    >
      <div
        onMouseDown={(e) => onStartMove(e, section)}
        onDoubleClick={(e) => {
          e.stopPropagation();
          setDraft(section.title);
          setEditing(true);
        }}
        style={{ height: SECTION_HEADER }}
        className={`pointer-events-auto flex items-center gap-2 pl-1.5 pr-3 cursor-grab active:cursor-grabbing select-none ${
          section.collapsed ? 'rounded-2xl' : 'rounded-t-2xl'
        }`}
      >
        <button
          type="button"
          title={section.collapsed ? '展开分区' : '折叠分区'}
          onMouseDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onClick={() => onToggleCollapse(section.id)}
          className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-700/60"
        >
          {section.collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
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
                setDraft(section.title);
                setEditing(false);
              }
            }}
            className="min-w-0 flex-1 bg-canvas-bg border border-slate-700 rounded-md px-1.5 py-0.5 text-sm font-semibold text-slate-100 outline-none"
          />
        ) : (
          <span className="min-w-0 truncate text-sm font-semibold text-slate-300" title="双击重命名">
            {section.title}
          </span>
        )}
        <span className="flex-shrink-0 text-xs text-slate-500">{count} 张</span>
      </div>
      {!section.collapsed && (
        <div
          title="拖动调整大小"
          onMouseDown={(e) => onStartResize(e, section)}
          className="pointer-events-auto absolute right-0 bottom-0 w-5 h-5 cursor-nwse-resize"
        >
          <div className="absolute right-1.5 bottom-1.5 w-2.5 h-2.5 border-r-2 border-b-2 border-slate-500 rounded-br-sm" />
        </div>
      )}
    </div>
  );
};

import React, { useState } from 'react';
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
}

/**
 * Sections, drawn under the cards. Only the title bar and the corner handle
 * take the mouse: the body lets clicks through to the canvas, so marquee
 * selection and double-click-to-add still work inside a section.
 */
export const SectionLayer: React.FC<SectionLayerProps> = ({ sections, selectedIds, memberCounts, onStartMove, onStartResize, onRename }) => (
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
}> = ({ section, selected, count, onStartMove, onStartResize, onRename }) => {
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
        selected ? 'border-indigo-400/80 bg-indigo-500/[0.06]' : 'border-slate-700/70 bg-slate-500/[0.05]'
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
        className="pointer-events-auto flex items-center gap-2 px-3 rounded-t-2xl cursor-grab active:cursor-grabbing select-none"
      >
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

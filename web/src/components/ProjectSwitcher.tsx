import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, FolderOpen, LayoutGrid, Loader2, Plus } from 'lucide-react';
import type { SaveState } from '../engine/useAutosave.ts';
import { apiListProjects, apiRevealProject, type ProjectSummary } from '../services/projects.ts';
import { navigate, projectHref } from '../services/router.ts';

interface ProjectSwitcherProps {
  projectId: string;
  name: string;
  saveState: SaveState;
  saveError: string | null;
  onRename: (name: string) => void;
  onCreateProject: () => void;
}

const SAVE_LABELS: Record<SaveState, { text: string; className: string }> = {
  saved: { text: '已保存', className: 'text-emerald-400' },
  dirty: { text: '未保存', className: 'text-slate-400' },
  saving: { text: '保存中', className: 'text-sky-300' },
  error: { text: '保存失败', className: 'text-rose-400' },
  conflict: { text: '冲突，请刷新', className: 'text-amber-300' },
};

const SaveBadge: React.FC<{ state: SaveState; error: string | null }> = ({ state, error }) => {
  const label = SAVE_LABELS[state];
  const title =
    state === 'conflict'
      ? '这个工程在另一个窗口里被保存过。为避免互相覆盖，已暂停自动保存；请刷新页面加载最新版本。'
      : state === 'error'
        ? `${error ?? ''}（下次改动时会重试，也可按 Ctrl+S）`
        : 'Ctrl+S 立即保存';
  return (
    <span title={title} className={`flex shrink-0 items-center gap-1 whitespace-nowrap text-[10px] font-mono ${label.className}`}>
      {state === 'saving' && <Loader2 className="w-3 h-3 animate-spin" />}
      {state === 'saved' && <Check className="w-3 h-3" />}
      {(state === 'error' || state === 'conflict') && <AlertTriangle className="w-3 h-3" />}
      {label.text}
    </span>
  );
};

export const ProjectSwitcher: React.FC<ProjectSwitcherProps> = ({
  projectId,
  name,
  saveState,
  saveError,
  onRename,
  onCreateProject,
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [menuOpen, setMenuOpen] = useState(false);
  const [recent, setRecent] = useState<ProjectSummary[]>([]);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    apiListProjects()
      .then((list) => setRecent(list.projects.filter((p) => p.id !== projectId).slice(0, 6)))
      .catch(() => setRecent([]));
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [menuOpen, projectId]);

  const commitRename = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== name) onRename(next);
    else setDraft(name);
  };

  return (
    <div className="relative flex items-center gap-2" ref={menuRef}>
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename();
            if (e.key === 'Escape') {
              setDraft(name);
              setEditing(false);
            }
          }}
          className="w-40 bg-[#0b0d15] border border-indigo-500/50 rounded-md px-1.5 py-0.5 text-xs text-slate-100 outline-none"
        />
      ) : (
        <button
          type="button"
          title="点击重命名"
          onClick={() => {
            setDraft(name);
            setEditing(true);
          }}
          className="max-w-[12rem] truncate whitespace-nowrap text-xs font-semibold text-slate-200 hover:text-white"
        >
          {name}
        </button>
      )}

      <SaveBadge state={saveState} error={saveError} />

      <button
        type="button"
        title="切换工程"
        onClick={() => setMenuOpen((v) => !v)}
        className="flex items-center justify-center w-5 h-5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800"
      >
        <ChevronDown className="w-3.5 h-3.5" />
      </button>

      {menuOpen && (
        <div className="absolute left-0 top-full mt-3 w-64 bg-[#12141e] border border-slate-800 rounded-xl shadow-2xl shadow-black/60 py-1.5 text-xs">
          <MenuItem icon={<LayoutGrid className="w-3.5 h-3.5" />} onClick={() => navigate('/')}>
            全部工程
          </MenuItem>
          <MenuItem
            icon={<Plus className="w-3.5 h-3.5" />}
            onClick={() => {
              setMenuOpen(false);
              onCreateProject();
            }}
          >
            新建工程
          </MenuItem>
          <MenuItem
            icon={<FolderOpen className="w-3.5 h-3.5" />}
            onClick={() => {
              setMenuOpen(false);
              void apiRevealProject(projectId).catch(() => {});
            }}
          >
            在资源管理器中打开
          </MenuItem>
          {recent.length > 0 && (
            <>
              <div className="my-1.5 h-px bg-slate-800" />
              <div className="px-3 py-1 text-[10px] text-slate-500">最近的工程</div>
              {recent.map((p) => (
                <MenuItem key={p.id} onClick={() => navigate(projectHref(p.id))}>
                  <span className="truncate">{p.name}</span>
                </MenuItem>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
};

const MenuItem: React.FC<{ icon?: React.ReactNode; onClick: () => void; children: React.ReactNode }> = ({
  icon,
  onClick,
  children,
}) => (
  <button
    type="button"
    onClick={onClick}
    className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-slate-300 hover:bg-slate-800/70 hover:text-white"
  >
    {icon && <span className="text-slate-500">{icon}</span>}
    {children}
  </button>
);

import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, FolderOpen, LayoutGrid, Loader2, Plus } from 'lucide-react';
import type { SaveState } from '../engine/useAutosave.ts';
import { apiListProjects, apiRevealProject, type ProjectSummary } from '../services/projects.ts';
import { navigate, projectHref } from '../services/router.ts';
import { MenuButton, useToast, type MenuEntry } from './ui/index.ts';

interface ProjectSwitcherProps {
  projectId: string;
  name: string;
  saveState: SaveState;
  saveError: string | null;
  onRename: (name: string) => void;
  onCreateProject: () => void;
}

const SAVE_LABELS: Record<SaveState, { text: string; className: string }> = {
  saved: { text: '已保存', className: 'text-slate-500' },
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
        ? `${error ?? ''}（下次改动时会重试，也可以按 Ctrl+S）`
        : 'Ctrl+S 立即保存';
  return (
    <span title={title} className={`flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px] ${label.className}`}>
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
  const [recent, setRecent] = useState<ProjectSummary[]>([]);
  const toast = useToast();

  useEffect(() => {
    apiListProjects()
      .then((list) => setRecent(list.projects.filter((p) => p.id !== projectId).slice(0, 6)))
      .catch(() => setRecent([]));
  }, [projectId]);

  const commitRename = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== name) onRename(next);
    else setDraft(name);
  };

  const items: MenuEntry[] = [
    { label: '全部工程', icon: <LayoutGrid className="w-3.5 h-3.5" />, onSelect: () => navigate('/') },
    { label: '新建工程', icon: <Plus className="w-3.5 h-3.5" />, onSelect: onCreateProject },
    {
      label: '在资源管理器中打开',
      icon: <FolderOpen className="w-3.5 h-3.5" />,
      onSelect: () => void apiRevealProject(projectId).catch((err) => toast(`无法打开文件夹：${(err as Error).message}`, { tone: 'error' })),
    },
    ...(recent.length
      ? (['separator', ...recent.map((p) => ({ label: p.name, onSelect: () => navigate(projectHref(p.id)) }))] as MenuEntry[])
      : []),
  ];

  return (
    <div className="flex items-center gap-2 min-w-0">
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
          className="w-44 bg-canvas-bg border border-indigo-500/50 rounded-md px-1.5 py-0.5 text-xs text-slate-100 outline-none"
        />
      ) : (
        <button
          type="button"
          title="点击重命名"
          onClick={() => {
            setDraft(name);
            setEditing(true);
          }}
          className="min-w-0 max-w-[14rem] truncate text-xs font-semibold text-slate-100 hover:text-white"
        >
          {name}
        </button>
      )}
      <SaveBadge state={saveState} error={saveError} />
      <MenuButton items={items}>
        {({ open, toggle }) => (
          <button
            type="button"
            title="切换工程"
            onClick={toggle}
            className={`flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-md transition ${
              open ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        )}
      </MenuButton>
    </div>
  );
};

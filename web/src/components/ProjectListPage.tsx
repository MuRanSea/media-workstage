import React, { useCallback, useEffect, useState } from 'react';
import { FileText, FolderOpen, Image as ImageIcon, Pencil, Plus, Sparkles, Trash2, Video } from 'lucide-react';
import {
  apiDeleteProject,
  apiListProjects,
  apiRenameProject,
  apiRevealProject,
  type ProjectList,
  type ProjectSummary,
} from '../services/projects.ts';
import { navigate, projectHref } from '../services/router.ts';
import { promptCreateProject } from './CanvasPage.tsx';

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export const ProjectListPage: React.FC = () => {
  const [data, setData] = useState<ProjectList | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    apiListProjects()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((err) => setError((err as Error).message));
  }, []);

  useEffect(() => {
    document.title = 'Media Workstage';
    reload();
  }, [reload]);

  const handleRename = async (p: ProjectSummary) => {
    const name = window.prompt('重命名工程', p.name);
    if (!name || name.trim() === p.name) return;
    try {
      await apiRenameProject(p.id, name.trim());
      reload();
    } catch (err) {
      window.alert(`重命名失败：${(err as Error).message}`);
    }
  };

  const handleDelete = async (p: ProjectSummary) => {
    if (!window.confirm(`删除工程「${p.name}」？\n\n工程文件夹会被移到工程目录下的 .trash 文件夹，需要时可以从那里找回。`)) return;
    try {
      await apiDeleteProject(p.id);
      reload();
    } catch (err) {
      window.alert(`删除失败：${(err as Error).message}`);
    }
  };

  return (
    <div className="min-h-screen bg-[#08090f] text-slate-100">
      <div className="max-w-6xl mx-auto px-4 sm:px-8 py-10">
        <header className="flex items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-pink-600 via-purple-600 to-indigo-600 flex items-center justify-center shadow-md shadow-pink-600/30">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-wide">Media Workstage</h1>
              <p className="text-[11px] text-slate-500">我的工程</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void promptCreateProject()}
            className="flex items-center gap-1.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 border border-indigo-400/30 px-3.5 py-2 rounded-xl text-xs font-bold text-white shadow-lg shadow-indigo-950/60 transition active:scale-95"
          >
            <Plus className="w-3.5 h-3.5" />
            新建工程
          </button>
        </header>

        {error && <p className="text-xs text-rose-400 mb-4">加载工程列表失败：{error}</p>}

        {data && data.projects.length === 0 && (
          <div className="border border-dashed border-slate-800 rounded-2xl py-20 flex flex-col items-center gap-3 text-slate-400">
            <p className="text-sm">还没有工程</p>
            <p className="text-xs text-slate-500">工程会把画布和生成的图片、视频一起保存在一个文件夹里。</p>
            <button
              type="button"
              onClick={() => void promptCreateProject()}
              className="mt-2 px-3 py-1.5 rounded-lg border border-indigo-500/40 text-xs text-indigo-300 hover:bg-indigo-500/10"
            >
              新建第一个工程
            </button>
          </div>
        )}

        {data && data.projects.length > 0 && (
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {data.projects.map((p) => (
              <div
                key={p.id}
                role="button"
                tabIndex={0}
                onClick={() => navigate(projectHref(p.id))}
                onKeyDown={(e) => e.key === 'Enter' && navigate(projectHref(p.id))}
                className="group text-left bg-[#12141e] hover:bg-[#161927] border border-slate-800 hover:border-indigo-500/40 rounded-2xl p-4 cursor-pointer transition"
              >
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-sm font-semibold text-slate-100 truncate">{p.name}</h2>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition">
                    <IconButton title="重命名" onClick={() => void handleRename(p)}>
                      <Pencil className="w-3.5 h-3.5" />
                    </IconButton>
                    <IconButton title="在资源管理器中打开" onClick={() => void apiRevealProject(p.id).catch(() => {})}>
                      <FolderOpen className="w-3.5 h-3.5" />
                    </IconButton>
                    <IconButton title="删除" danger onClick={() => void handleDelete(p)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </IconButton>
                  </div>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">更新于 {formatTime(p.updatedAt)}</p>
                <div className="mt-4 flex items-center gap-3 text-[10px] text-slate-400 font-mono">
                  <span className="flex items-center gap-1">
                    <ImageIcon className="w-3 h-3 text-pink-400" /> {p.cardCounts.image ?? 0}
                  </span>
                  <span className="flex items-center gap-1">
                    <Video className="w-3 h-3 text-indigo-400" /> {p.cardCounts.video ?? 0}
                  </span>
                  <span className="flex items-center gap-1">
                    <FileText className="w-3 h-3 text-emerald-400" /> {p.cardCounts.text ?? 0}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {data && (
          <p className="mt-10 text-[11px] text-slate-600 break-all">
            工程目录：<span className="font-mono">{data.root}</span>
          </p>
        )}
      </div>
    </div>
  );
};

const IconButton: React.FC<{ title: string; danger?: boolean; onClick: () => void; children: React.ReactNode }> = ({
  title,
  danger,
  onClick,
  children,
}) => (
  <button
    type="button"
    title={title}
    onClick={(e) => {
      e.stopPropagation();
      onClick();
    }}
    className={`w-6 h-6 flex items-center justify-center rounded-md text-slate-400 hover:bg-slate-800 ${
      danger ? 'hover:text-rose-400' : 'hover:text-white'
    }`}
  >
    {children}
  </button>
);

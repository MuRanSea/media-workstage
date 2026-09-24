import React, { useCallback, useEffect, useState } from 'react';
import { FileText, Film, FolderOpen, Image as ImageIcon, MoreHorizontal, Pencil, Plus, Settings, Sparkles, Trash2 } from 'lucide-react';
import { apiListProjects, apiRevealProject, type ProjectList, type ProjectSummary } from '../services/projects.ts';
import { navigate, projectHref } from '../services/router.ts';
import { assetUrl } from '../engine/assetPaths.ts';
import { SettingsModal } from './SettingsModal.tsx';
import { useProjectActions } from './useProjectActions.ts';
import { Button, IconButton, MenuButton, useToast } from './ui/index.ts';

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diffMin = (Date.now() - d.getTime()) / 60000;
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${Math.floor(diffMin)} 分钟前`;
  if (diffMin < 60 * 24 && d.getDate() === new Date().getDate()) return `今天 ${d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  return d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export const ProjectListPage: React.FC = () => {
  const [data, setData] = useState<ProjectList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { create, rename, remove } = useProjectActions();
  const toast = useToast();

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

  const reveal = (p: ProjectSummary) =>
    apiRevealProject(p.id).catch((err) => toast(`无法打开文件夹：${(err as Error).message}`, { tone: 'error' }));

  return (
    <div className="h-screen overflow-y-auto bg-canvas-bg text-slate-100">
      <div className="max-w-6xl mx-auto px-4 sm:px-8 py-8">
        <header className="flex items-center justify-between gap-3 mb-8">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-pink-600 to-indigo-600 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-sm font-semibold tracking-wide">Media Workstage</h1>
              <p className="text-[11px] text-slate-500">我的工程</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <IconButton title="服务商设置" onClick={() => setSettingsOpen(true)}>
              <Settings className="w-4 h-4" />
            </IconButton>
            <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => void create()}>
              新建工程
            </Button>
          </div>
        </header>

        {error && <p className="text-xs text-rose-400 mb-4">加载工程列表失败：{error}</p>}

        {data && data.projects.length === 0 && (
          <div className="border border-dashed border-slate-800 rounded-2xl py-20 flex flex-col items-center gap-2 text-center px-4">
            <p className="text-sm text-slate-300">还没有工程</p>
            <p className="text-xs text-slate-500">工程会把画布和生成的图片、视频一起保存在一个文件夹里。</p>
            <Button variant="primary" className="mt-3" icon={<Plus className="w-4 h-4" />} onClick={() => void create()}>
              新建第一个工程
            </Button>
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
                className="group text-left bg-canvas-surface border border-slate-800 hover:border-slate-600 rounded-2xl overflow-hidden cursor-pointer transition"
              >
                <div className="relative aspect-[16/9] bg-gradient-to-br from-slate-900 via-canvas-bg to-indigo-950/40 flex items-center justify-center">
                  {p.cover ? (
                    <img src={assetUrl(p.cover, p.id)} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <Sparkles className="w-6 h-6 text-slate-700" />
                  )}
                </div>
                <div className="p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="text-sm font-semibold text-slate-100 truncate">{p.name}</h2>
                      <p className="mt-0.5 text-[11px] text-slate-500">更新于 {formatTime(p.updatedAt)}</p>
                    </div>
                    <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                      <MenuButton
                        align="right"
                        items={[
                          {
                            label: '重命名',
                            icon: <Pencil className="w-3.5 h-3.5" />,
                            onSelect: () => void rename(p).then((name) => name && reload()),
                          },
                          { label: '在资源管理器中打开', icon: <FolderOpen className="w-3.5 h-3.5" />, onSelect: () => void reveal(p) },
                          'separator',
                          {
                            label: '删除',
                            icon: <Trash2 className="w-3.5 h-3.5" />,
                            danger: true,
                            onSelect: () => void remove(p).then((ok) => ok && reload()),
                          },
                        ]}
                      >
                        {({ open, toggle }) => (
                          <IconButton title="更多操作" size="sm" active={open} onClick={toggle}>
                            <MoreHorizontal className="w-4 h-4" />
                          </IconButton>
                        )}
                      </MenuButton>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-3 text-[11px] text-slate-400">
                    <span className="flex items-center gap-1">
                      <FileText className="w-3.5 h-3.5 text-emerald-400" /> {p.cardCounts.text ?? 0}
                    </span>
                    <span className="flex items-center gap-1">
                      <ImageIcon className="w-3.5 h-3.5 text-pink-400" /> {p.cardCounts.image ?? 0}
                    </span>
                    <span className="flex items-center gap-1">
                      <Film className="w-3.5 h-3.5 text-indigo-400" /> {p.cardCounts.video ?? 0}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {data && (
          <p className="mt-10 text-[11px] text-slate-600 break-all">
            工程目录：<span className="font-mono select-text">{data.root}</span>
          </p>
        )}
      </div>
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
};

import { useCallback } from 'react';
import { apiCreateProject, apiDeleteProject, apiRenameProject } from '../services/projects.ts';
import { navigate, projectHref } from '../services/router.ts';
import { useDialogs, useToast } from './ui/index.ts';

/** Create / rename / delete projects through in-app dialogs, reporting failures as toasts. */
export function useProjectActions() {
  const { prompt, confirm } = useDialogs();
  const toast = useToast();

  const create = useCallback(async () => {
    const name = await prompt({ title: '新建工程', label: '工程名称', defaultValue: '未命名工程', confirmText: '创建' });
    if (!name) return;
    try {
      const doc = await apiCreateProject(name);
      navigate(projectHref(doc.id));
    } catch (err) {
      toast(`新建工程失败：${(err as Error).message}`, { tone: 'error' });
    }
  }, [prompt, toast]);

  /** Resolves to the new name, or null when cancelled or failed. */
  const rename = useCallback(
    async (project: { id: string; name: string }): Promise<string | null> => {
      const name = await prompt({ title: '重命名工程', label: '工程名称', defaultValue: project.name, confirmText: '保存' });
      if (!name || name === project.name) return null;
      try {
        await apiRenameProject(project.id, name);
        return name;
      } catch (err) {
        toast(`重命名失败：${(err as Error).message}`, { tone: 'error' });
        return null;
      }
    },
    [prompt, toast]
  );

  /** Resolves to true once the project was moved to the trash. */
  const remove = useCallback(
    async (project: { id: string; name: string }): Promise<boolean> => {
      const ok = await confirm({
        title: `删除「${project.name}」？`,
        message: '工程文件夹会被移到工程目录下的 .trash 文件夹里，需要时可以从那里找回。',
        confirmText: '删除',
        danger: true,
      });
      if (!ok) return false;
      try {
        await apiDeleteProject(project.id);
        toast(`已删除「${project.name}」`, { tone: 'success' });
        return true;
      } catch (err) {
        toast(`删除失败：${(err as Error).message}`, { tone: 'error' });
        return false;
      }
    },
    [confirm, toast]
  );

  return { create, rename, remove };
}

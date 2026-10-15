import React, { useEffect, useRef, useState } from 'react';
import { Box, Download, FolderOpen, Loader2, X } from 'lucide-react';
import { IconButton } from './ui/index.ts';

export interface Model3DMedia {
  kind: 'model3d';
  title: string;
  /** The GLB/glTF to show; absent when the result has no format the preview opens. */
  url?: string;
  /** Every format the result holds, e.g. ["STL", "FBX"]. */
  formats: string[];
  /** Shows the model's file in the system file manager. */
  onReveal?: () => void;
}

/**
 * Full-screen interactive preview of a 3D result: rotate, zoom and pan a GLB/glTF.
 * three.js loads on first open; closing frees the WebGL context.
 */
export const Model3DViewer: React.FC<{ media: Model3DMedia; onClose: () => void }> = ({ media, onClose }) => {
  const stageRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ phase: 'loading' | 'ready' | 'error'; progress?: number; message?: string }>({ phase: 'loading' });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!media.url || !stage) return;
    let teardown: (() => void) | undefined;
    let closed = false;
    setState({ phase: 'loading' });
    import('./modelScene.ts')
      .then(({ mountModelScene }) => {
        if (closed) return;
        teardown = mountModelScene(stage, media.url!, {
          onProgress: (progress) => setState({ phase: 'loading', progress }),
          onLoad: () => setState({ phase: 'ready' }),
          onError: (message) => setState({ phase: 'error', message }),
        });
      })
      .catch(() => !closed && setState({ phase: 'error', message: '预览组件加载失败，请刷新后重试' }));
    return () => {
      closed = true;
      teardown?.();
    };
  }, [media.url]);

  const fileName = media.url?.split('/').pop()?.split('?')[0] || 'model.glb';

  return (
    <div data-theme="dark" className="fixed inset-0 z-[65] flex flex-col bg-black/90 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex items-center gap-2 px-4 h-14 flex-shrink-0 text-slate-200">
        <span className="flex-1 min-w-0 truncate text-sm font-medium">{media.title}</span>
        {media.url && <span className="text-[11px] text-slate-500">拖动旋转 · 滚轮缩放 · 右键拖动平移</span>}
        {media.url && (
          <a
            href={media.url}
            download={`${media.title}-${fileName}`}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-xs font-semibold"
          >
            <Download className="w-3.5 h-3.5" /> 下载
          </a>
        )}
        {media.url && media.onReveal && (
          <button
            type="button"
            onClick={media.onReveal}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg hover:bg-slate-800 text-xs font-semibold"
          >
            <FolderOpen className="w-3.5 h-3.5" /> 在文件夹中显示
          </button>
        )}
        <IconButton title="关闭（Esc）" onClick={onClose}>
          <X className="w-5 h-5" />
        </IconButton>
      </div>
      <div className="flex-1 min-h-0 p-6 pt-0" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        {media.url ? (
          <div className="relative w-full h-full rounded-lg overflow-hidden border border-slate-800 bg-gradient-to-b from-slate-900 to-slate-950">
            <div ref={stageRef} className="absolute inset-0" />
            {state.phase !== 'ready' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-slate-400 pointer-events-none">
                {state.phase === 'loading' ? (
                  <>
                    <Loader2 className="w-6 h-6 animate-spin text-sky-400" />
                    {state.progress === undefined ? '正在加载模型…' : `正在加载模型 ${Math.round(state.progress * 100)}%`}
                  </>
                ) : (
                  <span className="text-rose-300">{state.message}</span>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
            <Box className="w-10 h-10 text-sky-400/60" />
            <p className="text-base font-medium text-slate-200">该格式不支持预览</p>
            <p className="text-xs text-slate-500">
              {media.formats.length ? `这个结果只有 ${media.formats.join('、')}；` : ''}预览只支持 GLB / glTF，可以用本地软件打开文件。
            </p>
            {media.onReveal && (
              <button
                type="button"
                onClick={media.onReveal}
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold"
              >
                <FolderOpen className="w-4 h-4" /> 在文件夹中显示
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

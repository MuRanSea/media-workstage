import React, { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

/** Only one card keeps a live WebGL view at a time; opening another closes the previous one. */
let closeActive: (() => void) | undefined;

/**
 * The 3D result card's cover swapped for a live, rotatable view of the GLB/glTF. Drag rotates,
 * the wheel zooms the model (not the canvas), right-drag pans. It lives only while the card
 * stays selected; `onExit` is called when it should go back to the cover image.
 */
export const InlineModelView: React.FC<{ url: string; onExit: () => void }> = ({ url, onExit }) => {
  const stageRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ phase: 'loading' | 'ready' | 'error'; progress?: number; message?: string }>({ phase: 'loading' });
  const exitRef = useRef(onExit);
  exitRef.current = onExit;

  useEffect(() => {
    const exit = () => exitRef.current();
    closeActive?.();
    closeActive = exit;
    return () => {
      if (closeActive === exit) closeActive = undefined;
    };
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    // The canvas pans on wheel and opens its menu on right click; both belong to the model here.
    const keep = (e: Event) => e.stopPropagation();
    stage.addEventListener('wheel', keep);
    stage.addEventListener('contextmenu', keep);
    let teardown: (() => void) | undefined;
    let closed = false;
    import('../modelScene.ts')
      .then(({ mountModelScene }) => {
        if (closed) return;
        teardown = mountModelScene(stage, url, {
          onProgress: (progress) => setState({ phase: 'loading', progress }),
          onLoad: () => setState({ phase: 'ready' }),
          onError: (message) => setState({ phase: 'error', message }),
        });
      })
      .catch(() => !closed && setState({ phase: 'error', message: '预览组件加载失败' }));
    return () => {
      closed = true;
      stage.removeEventListener('wheel', keep);
      stage.removeEventListener('contextmenu', keep);
      teardown?.();
    };
  }, [url]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && exitRef.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="absolute inset-0 z-[1] bg-gradient-to-b from-slate-900 to-slate-950 cursor-grab active:cursor-grabbing">
      <div ref={stageRef} className="absolute inset-0" />
      {state.phase !== 'ready' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-[11px] text-slate-400 pointer-events-none">
          {state.phase === 'loading' ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin text-sky-400" />
              {state.progress === undefined ? '正在加载模型…' : `正在加载模型 ${Math.round(state.progress * 100)}%`}
            </>
          ) : (
            <span className="text-rose-300 px-3 text-center">{state.message}</span>
          )}
        </div>
      )}
    </div>
  );
};

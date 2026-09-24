import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

type Tone = 'info' | 'success' | 'error' | 'warning';

interface ToastOptions {
  tone?: Tone;
  /** e.g. { label: '撤销', onClick: undo } */
  action?: { label: string; onClick: () => void };
  durationMs?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
  message: string;
}

type ToastFn = (message: string, opts?: ToastOptions) => void;

const ToastContext = createContext<ToastFn | null>(null);

const TONES: Record<Tone, { icon: React.ReactNode; border: string }> = {
  info: { icon: <Info className="w-4 h-4 text-sky-300" />, border: 'border-slate-700' },
  success: { icon: <CheckCircle2 className="w-4 h-4 text-emerald-400" />, border: 'border-emerald-500/40' },
  warning: { icon: <AlertCircle className="w-4 h-4 text-amber-300" />, border: 'border-amber-500/40' },
  error: { icon: <AlertCircle className="w-4 h-4 text-rose-400" />, border: 'border-rose-500/40' },
};

/** Bottom-center notifications; at most three stay on screen. */
export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((prev) => prev.filter((t) => t.id !== id)), []);

  const toast = useCallback<ToastFn>(
    (message, opts = {}) => {
      const id = nextId.current++;
      setItems((prev) => [...prev.slice(-2), { id, message, ...opts }]);
      const duration = opts.durationMs ?? (opts.action ? 6000 : opts.tone === 'error' ? 6000 : 3000);
      window.setTimeout(() => dismiss(id), duration);
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[80] flex flex-col items-center gap-2 pointer-events-none">
        {items.map((t) => {
          const tone = TONES[t.tone ?? 'info'];
          return (
            <div
              key={t.id}
              role="status"
              className={`pointer-events-auto flex items-center gap-2.5 max-w-[min(90vw,32rem)] pl-3 pr-1.5 py-1.5 rounded-xl bg-canvas-surface/95 backdrop-blur border ${tone.border} shadow-2xl shadow-black/60 text-xs text-slate-200`}
            >
              {tone.icon}
              <span className="leading-relaxed break-words">{t.message}</span>
              {t.action && (
                <button
                  type="button"
                  onClick={() => {
                    t.action!.onClick();
                    dismiss(t.id);
                  }}
                  className="ml-1 px-2 py-1 rounded-md text-indigo-300 hover:bg-slate-800 font-semibold whitespace-nowrap"
                >
                  {t.action.label}
                </button>
              )}
              <button
                type="button"
                aria-label="关闭"
                onClick={() => dismiss(t.id)}
                className="p-1 rounded-md text-slate-500 hover:text-slate-200"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
};

export function useToast(): ToastFn {
  const fn = useContext(ToastContext);
  if (!fn) throw new Error('useToast must be used inside <ToastProvider>');
  return fn;
}

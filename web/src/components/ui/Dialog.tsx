import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Button, IconButton } from './Button.tsx';
import { inputClass } from './accent.ts';

interface DialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: string;
}

/** Centered modal with backdrop; Esc and backdrop clicks close it. */
export const Dialog: React.FC<DialogProps> = ({ open, title, onClose, children, footer, width = 'max-w-sm' }) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`w-full ${width} bg-canvas-surface border border-slate-700/80 rounded-2xl shadow-2xl shadow-black/70`}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
          <IconButton title="关闭" size="sm" onClick={onClose}>
            <X className="w-4 h-4" />
          </IconButton>
        </div>
        <div className="px-5 pb-4 text-xs leading-relaxed text-slate-300">{children}</div>
        {footer && <div className="flex justify-end gap-2 px-5 py-3 border-t border-canvas-border">{footer}</div>}
      </div>
    </div>
  );
};

// --- Promise-based confirm / prompt ------------------------------------------

interface ConfirmOptions {
  title: string;
  message?: React.ReactNode;
  confirmText?: string;
  danger?: boolean;
}

interface PromptOptions {
  title: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmText?: string;
}

interface DialogApi {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  /** Resolves to the trimmed text, or null when cancelled. */
  prompt: (opts: PromptOptions) => Promise<string | null>;
}

const DialogContext = createContext<DialogApi | null>(null);

type Pending =
  | { kind: 'confirm'; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: 'prompt'; opts: PromptOptions; resolve: (v: string | null) => void };

export const DialogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [pending, setPending] = useState<Pending | null>(null);
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const confirm = useCallback(
    (opts: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ kind: 'confirm', opts, resolve })),
    []
  );
  const prompt = useCallback(
    (opts: PromptOptions) =>
      new Promise<string | null>((resolve) => {
        setText(opts.defaultValue ?? '');
        setPending({ kind: 'prompt', opts, resolve });
      }),
    []
  );

  useEffect(() => {
    if (pending?.kind === 'prompt') {
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [pending]);

  const close = (result: boolean) => {
    if (!pending) return;
    if (pending.kind === 'confirm') pending.resolve(result);
    else pending.resolve(result && text.trim() ? text.trim() : null);
    setPending(null);
  };

  return (
    <DialogContext.Provider value={{ confirm, prompt }}>
      {children}
      {pending && (
        <Dialog
          open
          title={pending.opts.title}
          onClose={() => close(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => close(false)}>
                取消
              </Button>
              <Button
                variant={pending.kind === 'confirm' && pending.opts.danger ? 'danger' : 'primary'}
                disabled={pending.kind === 'prompt' && !text.trim()}
                onClick={() => close(true)}
                autoFocus={pending.kind === 'confirm'}
              >
                {pending.opts.confirmText ?? '确定'}
              </Button>
            </>
          }
        >
          {pending.kind === 'confirm' ? (
            pending.opts.message
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                close(true);
              }}
              className="space-y-1.5"
            >
              {pending.opts.label && <label className="block text-[11px] text-slate-400">{pending.opts.label}</label>}
              <input
                ref={inputRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={pending.opts.placeholder}
                className={`${inputClass} focus:border-indigo-500 text-sm py-2`}
              />
            </form>
          )}
        </Dialog>
      )}
    </DialogContext.Provider>
  );
};

export function useDialogs(): DialogApi {
  const api = useContext(DialogContext);
  if (!api) throw new Error('useDialogs must be used inside <DialogProvider>');
  return api;
}

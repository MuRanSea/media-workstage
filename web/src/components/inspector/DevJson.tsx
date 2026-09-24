import React, { useState } from 'react';
import { ChevronRight } from 'lucide-react';

/** Collapsed "request JSON" preview for debugging what a card will send. */
export const DevJson: React.FC<{ compile: () => unknown }> = ({ compile }) => {
  const [open, setOpen] = useState(false);
  let json = '';
  if (open) {
    try {
      json = JSON.stringify(compile(), null, 2);
    } catch (e) {
      json = `无法生成请求：${(e as Error).message}`;
    }
  }
  return (
    <section className="py-4">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-300"
      >
        <ChevronRight className={`w-3.5 h-3.5 transition ${open ? 'rotate-90' : ''}`} />
        开发者：查看请求 JSON
      </button>
      {open && (
        <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-black/60 border border-canvas-border p-2.5 text-[11px] leading-relaxed font-mono text-slate-300 select-text whitespace-pre-wrap break-all">
          {json}
        </pre>
      )}
    </section>
  );
};

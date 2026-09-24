import React from 'react';

interface FieldProps {
  label: string;
  /** Extra text on the right of the label, e.g. the computed pixel size. */
  aside?: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
}

/** Label above a control, with an optional right-aligned note and hint below. */
export const Field: React.FC<FieldProps> = ({ label, aside, hint, children }) => (
  <div className="space-y-1.5">
    <div className="flex items-center justify-between gap-2 text-[11px]">
      <span className="font-medium text-slate-400">{label}</span>
      {aside && <span className="text-slate-500 font-mono truncate">{aside}</span>}
    </div>
    {children}
    {hint && <p className="text-[11px] leading-relaxed text-slate-500">{hint}</p>}
  </div>
);

/** Titled group inside a panel. */
export const Section: React.FC<{ title: string; children: React.ReactNode; action?: React.ReactNode }> = ({
  title,
  children,
  action,
}) => (
  <section className="space-y-3 py-4 border-b border-canvas-border last:border-b-0">
    <div className="flex items-center justify-between">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{title}</h3>
      {action}
    </div>
    {children}
  </section>
);

/** Label + switch on one row. */
export const Toggle: React.FC<{
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
}> = ({ label, checked, onChange, hint }) => (
  <label className="flex items-start justify-between gap-3 cursor-pointer">
    <span className="text-xs text-slate-300">
      {label}
      {hint && <span className="block text-[11px] text-slate-500 mt-0.5">{hint}</span>}
    </span>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative mt-0.5 w-8 h-[18px] rounded-full flex-shrink-0 transition ${
        checked ? 'bg-indigo-600' : 'bg-slate-700'
      }`}
    >
      <span
        className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white transition-all ${checked ? 'left-4' : 'left-0.5'}`}
      />
    </button>
  </label>
);

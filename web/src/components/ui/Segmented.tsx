import { ACCENT, type Accent } from './accent.ts';

export interface SegmentOption<T> {
  value: T;
  label: string;
  disabled?: boolean;
  title?: string;
}

interface SegmentedProps<T> {
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
  accent?: Accent;
  /** Lay options out in a fixed grid instead of one row (for long lists like ratios). */
  columns?: number;
  mono?: boolean;
}

/** Single-choice button group; replaces hand-rolled pill rows. */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  accent = 'indigo',
  columns,
  mono,
}: SegmentedProps<T>) {
  return (
    <div
      className={`gap-1 ${columns ? 'grid' : 'flex flex-wrap'}`}
      style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
    >
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            disabled={opt.disabled}
            title={opt.title}
            onClick={() => onChange(opt.value)}
            className={`h-7 px-2.5 rounded-md text-[11px] font-semibold whitespace-nowrap transition disabled:opacity-35 disabled:cursor-not-allowed ${
              mono ? 'font-mono' : ''
            } ${
              selected
                ? ACCENT[accent].active
                : 'bg-slate-800/70 text-slate-300 hover:bg-slate-700/80 hover:text-white'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

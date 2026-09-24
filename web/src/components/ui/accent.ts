/** Card-type accents: pink = image, indigo = video, emerald = text. */
export type Accent = 'pink' | 'indigo' | 'emerald';

interface AccentClasses {
  /** Solid primary button. */
  solid: string;
  /** Selected segment / chip. */
  active: string;
  /** Accent text. */
  text: string;
  /** Input focus border. */
  focus: string;
  /** Selected card outline. */
  selected: string;
  /** Soft tinted chip (badges). */
  soft: string;
}

// Full class strings so Tailwind's content scan picks them up.
export const ACCENT: Record<Accent, AccentClasses> = {
  pink: {
    solid: 'bg-pink-600 hover:bg-pink-500 text-white',
    active: 'bg-pink-600 text-white',
    text: 'text-pink-300',
    focus: 'focus:border-pink-500',
    selected: 'border-pink-500 ring-2 ring-pink-500/30',
    soft: 'bg-pink-500/15 text-pink-300 border-pink-500/30',
  },
  indigo: {
    solid: 'bg-indigo-600 hover:bg-indigo-500 text-white',
    active: 'bg-indigo-600 text-white',
    text: 'text-indigo-300',
    focus: 'focus:border-indigo-500',
    selected: 'border-indigo-500 ring-2 ring-indigo-500/30',
    soft: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  },
  emerald: {
    solid: 'bg-emerald-600 hover:bg-emerald-500 text-white',
    active: 'bg-emerald-600 text-white',
    text: 'text-emerald-300',
    focus: 'focus:border-emerald-500',
    selected: 'border-emerald-500 ring-2 ring-emerald-500/30',
    soft: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  },
};

export const ACCENT_BY_CARD_TYPE: Record<'image' | 'video' | 'text', Accent> = {
  image: 'pink',
  video: 'indigo',
  text: 'emerald',
};

/** Shared input look for cards, panels and dialogs. */
export const inputClass =
  'w-full bg-canvas-bg border border-canvas-border rounded-lg px-2.5 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none transition';

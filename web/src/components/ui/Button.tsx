import React from 'react';
import { ACCENT, type Accent } from './accent.ts';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  accent?: Accent;
  size?: 'sm' | 'md';
  icon?: React.ReactNode;
  block?: boolean;
}

const VARIANTS: Record<Exclude<Variant, 'primary'>, string> = {
  secondary: 'bg-slate-800/80 hover:bg-slate-700/80 text-slate-200 border border-slate-700',
  ghost: 'text-slate-300 hover:text-white hover:bg-slate-800/70',
  danger: 'bg-rose-600 hover:bg-rose-500 text-white',
};

export const Button: React.FC<ButtonProps> = ({
  variant = 'secondary',
  accent = 'indigo',
  size = 'md',
  icon,
  block,
  className = '',
  children,
  type = 'button',
  ...rest
}) => {
  const tone = variant === 'primary' ? ACCENT[accent].solid : VARIANTS[variant];
  const sizing = size === 'sm' ? 'h-7 px-2.5 text-[11px] gap-1' : 'h-8 px-3 text-xs gap-1.5';
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center rounded-lg font-semibold whitespace-nowrap transition active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none ${sizing} ${tone} ${
        block ? 'w-full' : ''
      } ${className}`}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
};

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  title: string;
  danger?: boolean;
  active?: boolean;
  size?: 'sm' | 'md';
}

export const IconButton: React.FC<IconButtonProps> = ({
  title,
  danger,
  active,
  size = 'md',
  className = '',
  children,
  type = 'button',
  ...rest
}) => (
  <button
    type={type}
    title={title}
    aria-label={title}
    className={`inline-flex items-center justify-center rounded-lg transition disabled:opacity-40 ${
      size === 'sm' ? 'w-6 h-6' : 'w-8 h-8'
    } ${
      active
        ? 'bg-indigo-600 text-white'
        : danger
          ? 'text-slate-400 hover:text-rose-400 hover:bg-slate-800'
          : 'text-slate-400 hover:text-white hover:bg-slate-800'
    } ${className}`}
    {...rest}
  >
    {children}
  </button>
);

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

export type MenuEntry =
  | {
      label: string;
      icon?: React.ReactNode;
      /** Secondary text: a shortcut ("Ctrl+D") or a one-line description. */
      hint?: string;
      danger?: boolean;
      disabled?: boolean;
      onSelect: () => void;
    }
  | 'separator';

interface MenuProps {
  /** Viewport point the menu opens at (top-left corner). */
  at: { x: number; y: number };
  items: MenuEntry[];
  onClose: () => void;
  /** Optional heading shown above the items. */
  title?: string;
}

/** Floating menu for dropdowns and context menus; closes on outside click, Esc, scroll or resize. */
export const Menu: React.FC<MenuProps> = ({ at, items, onClose, title }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState(at);

  // Keep the menu inside the viewport.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(at.x, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(at.y, window.innerHeight - height - 8)),
    });
  }, [at]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onClose);
    window.addEventListener('wheel', onClose, { passive: true });
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('wheel', onClose);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-[75] min-w-[200px] py-1.5 bg-canvas-surface border border-slate-700/80 rounded-xl shadow-2xl shadow-black/70 text-xs"
    >
      {title && <div className="px-3 pt-0.5 pb-1.5 text-[11px] text-slate-500">{title}</div>}
      {items.map((item, i) =>
        item === 'separator' ? (
          <div key={`sep-${i}`} className="my-1.5 h-px bg-canvas-border" />
        ) : (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
            className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition disabled:opacity-40 disabled:pointer-events-none ${
              item.danger ? 'text-rose-300 hover:bg-rose-500/10' : 'text-slate-200 hover:bg-slate-800/80'
            }`}
          >
            {item.icon && <span className="w-4 flex justify-center text-slate-400">{item.icon}</span>}
            <span className="flex-1 whitespace-nowrap">{item.label}</span>
            {item.hint && <span className="text-[11px] text-slate-500 whitespace-nowrap">{item.hint}</span>}
          </button>
        )
      )}
    </div>
  );
};

/** A button that opens a Menu below itself. */
export const MenuButton: React.FC<{
  items: MenuEntry[];
  title?: string;
  align?: 'left' | 'right';
  children: (props: { open: boolean; toggle: (e: React.MouseEvent<HTMLElement>) => void }) => React.ReactNode;
}> = ({ items, title, align = 'left', children }) => {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  // Clicking the button while open first closes the menu via its outside-mousedown
  // handler; remember that so the click does not reopen it.
  const closedAtRef = useRef(0);
  const close = () => {
    closedAtRef.current = Date.now();
    setAt(null);
  };
  const toggle = (e: React.MouseEvent<HTMLElement>) => {
    if (at) return close();
    if (Date.now() - closedAtRef.current < 250) return;
    const r = e.currentTarget.getBoundingClientRect();
    // Right-aligned menus start at an estimate; Menu clamps them into the viewport.
    setAt({ x: align === 'right' ? r.right - 240 : r.left, y: r.bottom + 6 });
  };
  return (
    <>
      {children({ open: !!at, toggle })}
      {at && <Menu at={at} items={items} title={title} onClose={close} />}
    </>
  );
};

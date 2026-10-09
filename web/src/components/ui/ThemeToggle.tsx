import React from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type ThemeChoice } from '../../services/theme.ts';
import { IconButton } from './Button.tsx';
import { MenuButton, type MenuEntry } from './Menu.tsx';

const OPTIONS: Array<{ choice: ThemeChoice; label: string; icon: React.ReactNode }> = [
  { choice: 'system', label: '跟随系统', icon: <Monitor className="w-3.5 h-3.5" /> },
  { choice: 'light', label: '浅色', icon: <Sun className="w-3.5 h-3.5" /> },
  { choice: 'dark', label: '深色', icon: <Moon className="w-3.5 h-3.5" /> },
];

/** Header button showing the theme in effect (sun / moon); opens a menu of the three choices. */
export const ThemeToggle: React.FC = () => {
  const { choice, theme, setChoice } = useTheme();
  const items: MenuEntry[] = OPTIONS.map((o) => ({
    label: o.label,
    icon: o.icon,
    // "跟随系统" also says what the system currently gives.
    hint: o.choice === 'system' ? `现在是${theme === 'light' ? '浅色' : '深色'}` : undefined,
    checked: o.choice === choice,
    onSelect: () => setChoice(o.choice),
  }));
  return (
    <MenuButton items={items} align="right" title="外观">
      {({ open, toggle }) => (
        <IconButton title="外观：浅色 / 深色" active={open} onClick={toggle}>
          {theme === 'light' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </IconButton>
      )}
    </MenuButton>
  );
};

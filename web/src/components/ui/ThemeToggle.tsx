import React from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { NEXT_THEME, useThemeChoice, type ThemeChoice } from '../../services/theme.ts';
import { IconButton } from './Button.tsx';

const LABEL: Record<ThemeChoice, string> = { system: '跟随系统', light: '浅色', dark: '深色' };
const ICON: Record<ThemeChoice, React.ReactNode> = {
  system: <Monitor className="w-4 h-4" />,
  light: <Sun className="w-4 h-4" />,
  dark: <Moon className="w-4 h-4" />,
};

/** Header button stepping through 跟随系统 → 浅色 → 深色. */
export const ThemeToggle: React.FC = () => {
  const [choice, setChoice] = useThemeChoice();
  const next = NEXT_THEME[choice];
  return (
    <IconButton title={`主题：${LABEL[choice]}（点击切换为${LABEL[next]}）`} onClick={() => setChoice(next)}>
      {ICON[choice]}
    </IconButton>
  );
};

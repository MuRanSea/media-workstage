/**
 * Light / dark theme. The choice lives in localStorage; index.html applies it
 * before the first paint, this module keeps it in sync afterwards.
 */
import { useEffect, useState } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

const KEY = 'mw-theme';
const listeners = new Set<(choice: ThemeChoice) => void>();
const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: light)') : null;

export function readThemeChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function resolveTheme(choice: ThemeChoice, systemLight = media?.matches ?? false): Theme {
  if (choice === 'system') return systemLight ? 'light' : 'dark';
  return choice;
}

function apply(choice: ThemeChoice) {
  document.documentElement.dataset.theme = resolveTheme(choice);
}

export function setThemeChoice(choice: ThemeChoice) {
  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // Storage blocked: the choice still applies for this session.
  }
  apply(choice);
  listeners.forEach((fn) => fn(choice));
}

media?.addEventListener('change', () => {
  if (readThemeChoice() === 'system') apply('system');
});

export function useThemeChoice(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const [choice, setChoice] = useState(readThemeChoice);
  useEffect(() => {
    listeners.add(setChoice);
    return () => {
      listeners.delete(setChoice);
    };
  }, []);
  return [choice, setThemeChoice];
}

/** The order the header button steps through. */
export const NEXT_THEME: Record<ThemeChoice, ThemeChoice> = { system: 'light', light: 'dark', dark: 'system' };

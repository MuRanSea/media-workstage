/**
 * Light / dark theme. The choice lives in localStorage; index.html applies it
 * before the first paint, this module keeps it in sync afterwards.
 */
import { useEffect, useState } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

const KEY = 'mw-theme';
const listeners = new Set<() => void>();
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
  listeners.forEach((fn) => fn());
}

media?.addEventListener('change', () => {
  if (readThemeChoice() === 'system') apply('system');
  listeners.forEach((fn) => fn());
});

/** The user's choice and the theme it resolves to right now. */
export function useTheme(): { choice: ThemeChoice; theme: Theme; setChoice: (choice: ThemeChoice) => void } {
  const read = () => {
    const choice = readThemeChoice();
    return { choice, theme: resolveTheme(choice) };
  };
  const [state, setState] = useState(read);
  useEffect(() => {
    const update = () => setState(read());
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);
  return { ...state, setChoice: setThemeChoice };
}

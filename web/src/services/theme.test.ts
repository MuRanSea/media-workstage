import { describe, expect, it } from 'vitest';
import { NEXT_THEME, resolveTheme } from './theme.ts';

describe('resolveTheme', () => {
  it('follows the system only when asked to', () => {
    expect(resolveTheme('system', true)).toBe('light');
    expect(resolveTheme('system', false)).toBe('dark');
    expect(resolveTheme('light', false)).toBe('light');
    expect(resolveTheme('dark', true)).toBe('dark');
  });

  it('cycles through all three choices', () => {
    expect(NEXT_THEME.system).toBe('light');
    expect(NEXT_THEME[NEXT_THEME.system]).toBe('dark');
    expect(NEXT_THEME[NEXT_THEME[NEXT_THEME.system]]).toBe('system');
  });
});

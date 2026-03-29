/**
 * Theme management — dark/light/system with localStorage persistence.
 *
 * Applied before first paint to prevent flash (spec 06-frontend.md 3.3).
 */

export type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'ogmara.theme';

/** Get the current theme preference. */
export function getTheme(): Theme {
  return (localStorage.getItem(STORAGE_KEY) as Theme) || 'system';
}

/** Set the theme preference and apply it. */
export function setTheme(theme: Theme): void {
  localStorage.setItem(STORAGE_KEY, theme);
  applyTheme(theme);
}

/** Apply the theme to the document (called before first paint). */
export function initTheme(): void {
  applyTheme(getTheme());

  // Listen for system theme changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getTheme() === 'system') {
      applyTheme('system');
    }
  });
}

function applyTheme(theme: Theme): void {
  const resolved = theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;
  document.documentElement.setAttribute('data-theme', resolved);
}

/**
 * Theme management — dark/light/system with design style selection.
 *
 * Applied before first paint to prevent flash (spec 06-frontend.md 3.3).
 *
 * Design styles control the visual language (shapes, shadows, effects) independently
 * from the color theme (light/dark). Available styles:
 * - classic: Original flat design
 * - glassmorphism: Frosted glass panels, gradient background, glow accents
 * - elevated: Layered shadows, bold radius, clear depth hierarchy
 * - minimal: Pill shapes, tight palette, content-first
 */

import { createSignal } from 'solid-js';

export type Theme = 'light' | 'dark' | 'system';
export type DesignStyle = 'classic' | 'glassmorphism' | 'elevated' | 'minimal' | 'modern';

export const DESIGN_STYLES: DesignStyle[] = ['glassmorphism', 'elevated', 'minimal', 'modern', 'classic'];

export type ColorScheme = 'default' | 'amber' | 'teal' | 'violet' | 'coral' | 'neutral-gray';
export const COLOR_SCHEMES: ColorScheme[] = ['default', 'amber', 'teal', 'violet', 'coral', 'neutral-gray'];
export const COLOR_SCHEME_LABELS: Record<ColorScheme, string> = {
  default: 'Ogmara-Blau (Standard)',
  amber: 'Amber',
  teal: 'Teal',
  violet: 'Violet',
  coral: 'Coral',
  'neutral-gray': 'Neutral Gray',
};

const STORAGE_KEY = 'ogmara.theme';
const STYLE_KEY = 'ogmara.designStyle';
const SCHEME_KEY = 'ogmara.colorScheme';

/** Get the current design style (validated against known values). */
export function getDesignStyle(): DesignStyle {
  const stored = localStorage.getItem(STYLE_KEY);
  if (stored && DESIGN_STYLES.includes(stored as DesignStyle)) {
    return stored as DesignStyle;
  }
  return 'glassmorphism';
}

/** Reactive signal for the current design style — components can use this
 *  to conditionally render structural variants (e.g. modern sidebar). */
const [designStyleSignal, setDesignStyleSignal] = createSignal<DesignStyle>(getDesignStyle());
export function currentDesignStyle(): DesignStyle { return designStyleSignal(); }
export function isModernStyle(): boolean { return designStyleSignal() === 'modern'; }

/** Set the design style and apply it. */
export function setDesignStyle(style: DesignStyle): void {
  localStorage.setItem(STYLE_KEY, style);
  setDesignStyleSignal(style);
  applyDesignStyle(style);
}

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
  applyDesignStyle(getDesignStyle());
  applyColorScheme(getColorScheme());

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

/** Apply the design style as a data attribute on <html>. */
function applyDesignStyle(style: DesignStyle): void {
  if (style === 'classic') {
    document.documentElement.removeAttribute('data-style');
  } else {
    document.documentElement.setAttribute('data-style', style);
  }
}

export function getColorScheme(): ColorScheme {
  const stored = localStorage.getItem(SCHEME_KEY);
  if (stored && COLOR_SCHEMES.includes(stored as ColorScheme)) return stored as ColorScheme;
  return 'default';
}

export function setColorScheme(scheme: ColorScheme): void {
  localStorage.setItem(SCHEME_KEY, scheme);
  applyColorScheme(scheme);
}

function applyColorScheme(scheme: ColorScheme): void {
  if (scheme === 'default') {
    document.documentElement.removeAttribute('data-scheme');
  } else {
    document.documentElement.setAttribute('data-scheme', scheme);
  }
}

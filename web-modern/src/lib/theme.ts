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

export type Theme = 'light' | 'dark' | 'system';
export type DesignStyle = 'classic' | 'glassmorphism' | 'elevated' | 'minimal';

/**
 * Accent color scheme — changes the highlight color (send button,
 * active chat row, badges, links, bubble tint) without touching the
 * dark/light palette. `default` = the original Ogmara blue.
 *
 * `neutral-gray` is special: it also neutralises the blue-tinted
 * background to a true dark gray, for people who want to get away from
 * the "everything is blue" look entirely.
 */
export type ColorScheme =
  | 'default'
  | 'amber'
  | 'teal'
  | 'violet'
  | 'coral'
  | 'neutral-gray';

export const COLOR_SCHEMES: ColorScheme[] = [
  'default',
  'amber',
  'teal',
  'violet',
  'coral',
  'neutral-gray',
];

/** Human-readable labels (German). */
export const COLOR_SCHEME_LABELS: Record<ColorScheme, string> = {
  'default': 'Ogmara-Blau (Standard)',
  'amber': 'Amber / Gold',
  'teal': 'Teal / Smaragd',
  'violet': 'Violett',
  'coral': 'Koralle / Orange',
  'neutral-gray': 'Neutrales Grau',
};

export const DESIGN_STYLES: DesignStyle[] = ['glassmorphism', 'elevated', 'minimal', 'classic'];

const STORAGE_KEY = 'ogmara.theme';
const STYLE_KEY = 'ogmara.designStyle';
const SCHEME_KEY = 'ogmara.colorScheme';
/**
 * Bumped when we change the *default* theme/style. Existing users who haven't
 * actively customized still get the new look on next load. Once they pick
 * something explicitly, the version is stored and they keep their choice.
 */
const UI_DEFAULTS_VERSION = '3';
const UI_VERSION_KEY = 'ogmara.uiDefaultsVersion';

/** Get the current design style (validated against known values). */
export function getDesignStyle(): DesignStyle {
  const stored = localStorage.getItem(STYLE_KEY);
  if (stored && DESIGN_STYLES.includes(stored as DesignStyle)) {
    return stored as DesignStyle;
  }
  return 'classic';
}

/** Set the design style and apply it. */
export function setDesignStyle(style: DesignStyle): void {
  localStorage.setItem(STYLE_KEY, style);
  applyDesignStyle(style);
}

/** Get the current theme preference. */
export function getTheme(): Theme {
  return (localStorage.getItem(STORAGE_KEY) as Theme) || 'dark';
}

/** Set the theme preference and apply it. */
export function setTheme(theme: Theme): void {
  localStorage.setItem(STORAGE_KEY, theme);
  applyTheme(theme);
}

/** Get the current color scheme (validated). */
export function getColorScheme(): ColorScheme {
  const stored = localStorage.getItem(SCHEME_KEY) as ColorScheme | null;
  if (stored && COLOR_SCHEMES.includes(stored)) return stored;
  return 'default';
}

/** Set and apply the color scheme. */
export function setColorScheme(scheme: ColorScheme): void {
  localStorage.setItem(SCHEME_KEY, scheme);
  applyColorScheme(scheme);
}

/** Apply the color scheme as a data attribute on <html>. */
function applyColorScheme(scheme: ColorScheme): void {
  if (scheme === 'default') {
    document.documentElement.removeAttribute('data-scheme');
  } else {
    document.documentElement.setAttribute('data-scheme', scheme);
  }
}

/** Apply the theme to the document (called before first paint). */
export function initTheme(): void {
  // One-time migration: bump existing users who haven't seen the v2 defaults
  // (Ogmara dark + classic) onto the new defaults. Anyone who
  // actively picks a theme/style afterward keeps their own choice.
  const seenVersion = localStorage.getItem(UI_VERSION_KEY);
  if (seenVersion !== UI_DEFAULTS_VERSION) {
    localStorage.setItem(STORAGE_KEY, 'dark');
    localStorage.setItem(STYLE_KEY, 'classic');
    // Reset node URL to the SDK default (ogmara.org = testnet endpoint).
    // Users who set a custom node afterwards keep their choice on next load.
    localStorage.removeItem('ogmara.nodeUrl');
    // Channels sidebar section open by default — matches the layout users
    // see on the production site and avoids the "where are my channels?"
    // confusion on first load.
    localStorage.setItem('ogmara.channelsExpanded', 'true');
    localStorage.setItem(UI_VERSION_KEY, UI_DEFAULTS_VERSION);
  }

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

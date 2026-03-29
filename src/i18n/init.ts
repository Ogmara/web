/**
 * i18n initialization with i18next.
 *
 * 6 languages at launch (spec 06-frontend.md 2.1).
 * Auto-detects browser language, falls back to English.
 */

import i18next from 'i18next';

import en from './locales/en.json';
import de from './locales/de.json';
import es from './locales/es.json';
import pt from './locales/pt.json';
import ja from './locales/ja.json';
import zh from './locales/zh.json';

export const SUPPORTED_LANGUAGES = ['en', 'de', 'es', 'pt', 'ja', 'zh'] as const;
export type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number];

export function initI18n(): void {
  const saved = localStorage.getItem('ogmara.lang');
  const detected = saved && saved !== 'auto'
    ? saved
    : navigator.language.split('-')[0];

  i18next.init({
    lng: SUPPORTED_LANGUAGES.includes(detected as SupportedLanguage) ? detected : 'en',
    fallbackLng: 'en',
    resources: {
      en: { translation: en },
      de: { translation: de },
      es: { translation: es },
      pt: { translation: pt },
      ja: { translation: ja },
      zh: { translation: zh },
    },
    interpolation: {
      escapeValue: false,
    },
  });
}

/** Get a translated string. */
export function t(key: string, options?: Record<string, unknown>): string {
  return i18next.t(key, options) as string;
}

/** Change the current language. */
export function setLanguage(lang: SupportedLanguage): void {
  i18next.changeLanguage(lang);
  localStorage.setItem('ogmara.lang', lang);
}

/** Get the current language. */
export function currentLanguage(): string {
  return i18next.language;
}

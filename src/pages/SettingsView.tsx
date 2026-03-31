import { Component, createSignal } from 'solid-js';
import { t, setLanguage, currentLanguage, SUPPORTED_LANGUAGES } from '../i18n/init';
import { getTheme, setTheme, type Theme } from '../lib/theme';
import { getSetting, setSetting } from '../lib/settings';

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  de: 'Deutsch',
  es: 'Español',
  pt: 'Português',
  ja: '日本語',
  zh: '中文',
  ru: 'Русский',
};

export const SettingsView: Component = () => {
  const [theme, setThemeState] = createSignal(getTheme());
  const [lang, setLang] = createSignal(currentLanguage());
  const [nodeUrl, setNodeUrl] = createSignal(getSetting('nodeUrl'));
  const [compact, setCompact] = createSignal(getSetting('compactLayout'));
  const [sounds, setSounds] = createSignal(getSetting('notificationSound'));

  const handleThemeChange = (value: Theme) => {
    setThemeState(value);
    setTheme(value);
  };

  const handleLangChange = (value: string) => {
    setLang(value);
    setLanguage(value as any);
  };

  return (
    <div class="settings-view">
      <h2>{t('settings_title')}</h2>

      <section class="settings-section">
        <h3>{t('settings_language')}</h3>
        <select
          value={lang()}
          onChange={(e) => handleLangChange(e.currentTarget.value)}
        >
          {SUPPORTED_LANGUAGES.map((code) => (
            <option value={code}>{LANGUAGE_NAMES[code]}</option>
          ))}
        </select>
      </section>

      <section class="settings-section">
        <h3>{t('settings_theme')}</h3>
        <div class="settings-radio-group">
          {(['light', 'dark', 'system'] as Theme[]).map((value) => (
            <label class="settings-radio">
              <input
                type="radio"
                name="theme"
                value={value}
                checked={theme() === value}
                onChange={() => handleThemeChange(value)}
              />
              {t(`settings_theme_${value}`)}
            </label>
          ))}
        </div>
      </section>

      <section class="settings-section">
        <h3>{t('settings_notifications')}</h3>
        <label class="settings-toggle">
          <input
            type="checkbox"
            checked={sounds()}
            onChange={(e) => {
              setSounds(e.currentTarget.checked);
              setSetting('notificationSound', e.currentTarget.checked);
            }}
          />
          {t('settings_sounds')}
        </label>
        <label class="settings-toggle">
          <input
            type="checkbox"
            checked={compact()}
            onChange={(e) => {
              setCompact(e.currentTarget.checked);
              setSetting('compactLayout', e.currentTarget.checked);
            }}
          />
          {t('settings_compact')}
        </label>
      </section>

      <section class="settings-section">
        <h3>{t('settings_node_url')}</h3>
        <input
          type="text"
          class="settings-input"
          value={nodeUrl()}
          placeholder="http://localhost:41721"
          onInput={(e) => setNodeUrl(e.currentTarget.value)}
          onBlur={() => setSetting('nodeUrl', nodeUrl())}
        />
      </section>

      <style>{`
        .settings-view { padding: var(--spacing-lg); overflow-y: auto; height: 100%; max-width: 600px; }
        .settings-view h2 { font-size: var(--font-size-xl); margin-bottom: var(--spacing-lg); }
        .settings-section {
          margin-bottom: var(--spacing-lg);
          padding-bottom: var(--spacing-lg);
          border-bottom: 1px solid var(--color-border);
        }
        .settings-section h3 { font-size: var(--font-size-sm); color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: var(--spacing-sm); }
        .settings-section select, .settings-input {
          width: 100%;
          padding: var(--spacing-sm) var(--spacing-md);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-md);
          background: var(--color-bg-tertiary);
          color: var(--color-text-primary);
          font-family: inherit;
          font-size: var(--font-size-md);
        }
        .settings-radio-group { display: flex; gap: var(--spacing-lg); }
        .settings-radio { display: flex; align-items: center; gap: var(--spacing-xs); font-size: var(--font-size-sm); cursor: pointer; }
        .settings-toggle { display: flex; align-items: center; gap: var(--spacing-sm); font-size: var(--font-size-sm); cursor: pointer; margin-bottom: var(--spacing-sm); }
      `}</style>
    </div>
  );
};

import { Component, createSignal, Show } from 'solid-js';
import { t, setLanguage, currentLanguage, SUPPORTED_LANGUAGES } from '../i18n/init';
import { getTheme, setTheme, getDesignStyle, setDesignStyle, DESIGN_STYLES, getColorScheme, setColorScheme, COLOR_SCHEMES, COLOR_SCHEME_LABELS, type Theme, type DesignStyle, type ColorScheme } from '../lib/theme';
import { getSetting, setSetting } from '../lib/settings';
import { authStatus, walletAddress, walletSource } from '../lib/auth';
import { navigate } from '../lib/router';
import { getClient } from '../lib/api';
import { uploadSettings, downloadSettings } from '../lib/settings-sync';
import { vaultExportKey } from '../lib/vault';
import { enablePush, disablePush } from '../lib/push';

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
  const [mediaAutoload, setMediaAutoload] = createSignal(getSetting('mediaAutoload') || 'always');
  const [sounds, setSounds] = createSignal(getSetting('notificationSound'));
  const [pushEnabled, setPushEnabled] = createSignal(getSetting('pushEnabled'));
  const [pushStatus, setPushStatus] = createSignal('');
  const [syncStatus, setSyncStatus] = createSignal('');
  const [exportStatus, setExportStatus] = createSignal('');

  const [designStyle, setDesignStyleState] = createSignal<DesignStyle>(getDesignStyle());
  const [colorScheme, setColorSchemeState] = createSignal<ColorScheme>(getColorScheme());

  const handleDesignStyleChange = (value: DesignStyle) => {
    setDesignStyleState(value);
    setDesignStyle(value);
  };

  const handleColorSchemeChange = (value: ColorScheme) => {
    setColorSchemeState(value);
    setColorScheme(value);
  };

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

        {/* Accent color scheme — changes the highlight color without
            touching the light/dark background palette */}
        <h3 style="margin-top: var(--spacing-md)">{t('settings_color_scheme') || 'Akzentfarbe'}</h3>
        <select
          class="settings-select"
          value={colorScheme()}
          onChange={(e) => handleColorSchemeChange(e.currentTarget.value as ColorScheme)}
        >
          {COLOR_SCHEMES.map((scheme) => (
            <option value={scheme}>{COLOR_SCHEME_LABELS[scheme]}</option>
          ))}
        </select>

        <h3 style="margin-top: var(--spacing-md)">{t('settings_design_style') || 'Design Style'}</h3>
        <div class="settings-style-grid">
          {DESIGN_STYLES.map((style) => (
            <button
              class={`style-card ${designStyle() === style ? 'style-card-active' : ''}`}
              onClick={() => handleDesignStyleChange(style)}
            >
              <div class={`style-preview style-preview-${style}`}>
                <div class="sp-sidebar" />
                <div class="sp-content">
                  <div class="sp-bubble sp-bubble-peer" />
                  <div class="sp-bubble sp-bubble-own" />
                  <div class="sp-bubble sp-bubble-peer sp-bubble-short" />
                </div>
              </div>
              <span class="style-card-label">{t(`settings_style_${style}`) || style.charAt(0).toUpperCase() + style.slice(1)}</span>
            </button>
          ))}
        </div>

        <label class="settings-toggle">
          <input
            type="checkbox"
            checked={compact()}
            onChange={(e) => {
              setCompact(e.currentTarget.checked);
              setSetting('compactLayout', e.currentTarget.checked);
              document.documentElement.classList.toggle('compact', e.currentTarget.checked);
            }}
          />
          {t('settings_compact')}
        </label>
        <h3 style="margin-top: var(--spacing-md)">{t('settings_media')}</h3>
        <div class="settings-radio-group">
          {(['always', 'never'] as const).map((value) => (
            <label class="settings-radio">
              <input
                type="radio"
                name="mediaAutoload"
                value={value}
                checked={mediaAutoload() === value}
                onChange={() => { setMediaAutoload(value); setSetting('mediaAutoload', value); }}
              />
              {t(`settings_media_${value}`)}
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
        <Show when={authStatus() === 'ready'}>
          <label class="settings-toggle">
            <input
              type="checkbox"
              checked={pushEnabled()}
              onChange={(e) => {
                const checked = e.currentTarget.checked;
                setPushEnabled(checked);
                setSetting('pushEnabled', checked);
                setPushStatus('');
                if (checked) {
                  enablePush().then((result) => {
                    if (result !== 'ok') {
                      setPushEnabled(false);
                      setSetting('pushEnabled', false);
                      setPushStatus(
                        result === 'denied' ? t('settings_push_denied')
                          : result === 'unsupported' ? t('settings_push_unsupported')
                          : t('settings_push_error')
                      );
                    }
                  });
                } else {
                  disablePush();
                }
              }}
            />
            {t('settings_push')}
          </label>
          <Show when={pushStatus()}>
            <div class="settings-status">{pushStatus()}</div>
          </Show>
        </Show>
      </section>

      <section class="settings-section">
        <h3>{t('settings_wallet')}</h3>
        <Show
          when={authStatus() === 'ready'}
          fallback={
            <button class="settings-wallet-btn" onClick={() => navigate('/wallet')}>
              {t('wallet_connect')}
            </button>
          }
        >
          <div class="settings-wallet-info">
            <span class="settings-wallet-addr">{walletAddress()?.slice(0, 12)}...{walletAddress()?.slice(-6)}</span>
            <span class="settings-wallet-source">
              {walletSource() === 'klever-extension' ? 'Klever Extension' :
               walletSource() === 'k5-delegation' ? 'K5 Delegation' : 'Built-in'}
            </span>
          </div>
          <div class="settings-wallet-actions">
            <button class="settings-wallet-btn" onClick={() => navigate(`/user/${walletAddress()!}`)}>
              My Profile
            </button>
            <button class="settings-wallet-btn" onClick={() => navigate('/wallet')}>
              Wallet Settings
            </button>
          </div>
        </Show>
      </section>

      <Show when={authStatus() === 'ready'}>
        <section class="settings-section">
          <h3>{t('settings_sync_title')}</h3>
          <div class="settings-sync-row">
            <button
              class="settings-wallet-btn"
              onClick={async () => {
                setSyncStatus('');
                try {
                  const key = await vaultExportKey();
                  if (!key) { setSyncStatus('No key available'); return; }
                  await uploadSettings(key);
                  setSyncStatus(t('settings_sync_success'));
                } catch (e: any) {
                  setSyncStatus(e?.message || 'Sync failed');
                }
              }}
            >
              {t('settings_sync_upload')}
            </button>
            <button
              class="settings-wallet-btn"
              onClick={async () => {
                setSyncStatus('');
                try {
                  const key = await vaultExportKey();
                  if (!key) { setSyncStatus('No key available'); return; }
                  const ok = await downloadSettings(key);
                  if (ok) {
                    setSyncStatus(t('settings_sync_success'));
                    // Refresh UI with downloaded settings
                    setThemeState(getTheme());
                    setLang(currentLanguage());
                    setCompact(getSetting('compactLayout'));
                    setSounds(getSetting('notificationSound'));
                  } else {
                    setSyncStatus('No synced settings found');
                  }
                } catch (e: any) {
                  setSyncStatus(e?.message || 'Sync failed');
                }
              }}
            >
              {t('settings_sync_download')}
            </button>
          </div>
          <Show when={syncStatus()}>
            <div class="settings-status">{syncStatus()}</div>
          </Show>
        </section>
      </Show>

      <Show when={authStatus() === 'ready'}>
        <section class="settings-section">
          <h3>{t('settings_export_title')}</h3>
          <button
            class="settings-wallet-btn"
            onClick={async () => {
              setExportStatus(t('settings_export_downloading'));
              try {
                const client = getClient();
                const data = await client.exportAccount();
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `ogmara-export-${walletAddress()?.slice(0, 8)}.json`;
                a.click();
                URL.revokeObjectURL(url);
                setExportStatus('');
              } catch (e: any) {
                setExportStatus(e?.message || 'Export failed');
              }
            }}
          >
            {t('settings_export_button')}
          </button>
          <Show when={exportStatus()}>
            <div class="settings-status">{exportStatus()}</div>
          </Show>
        </section>
      </Show>

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
        .settings-wallet-info {
          display: flex;
          align-items: center;
          gap: var(--spacing-sm);
          margin-bottom: var(--spacing-sm);
        }
        .settings-wallet-addr {
          font-family: monospace;
          font-size: var(--font-size-sm);
          color: var(--color-accent-primary);
        }
        .settings-wallet-source {
          font-size: var(--font-size-xs);
          color: var(--color-text-secondary);
          background: var(--color-bg-tertiary);
          padding: 2px 6px;
          border-radius: var(--radius-sm);
        }
        .settings-wallet-actions { display: flex; gap: var(--spacing-sm); }
        .settings-wallet-btn {
          padding: var(--spacing-sm) var(--spacing-md);
          border-radius: var(--radius-md);
          font-weight: 600;
          font-size: var(--font-size-sm);
          background: var(--color-bg-tertiary);
          color: var(--color-text-primary);
        }
        .settings-wallet-btn:hover { background: var(--color-accent-primary); color: var(--color-text-inverse); }
        .settings-sync-row { display: flex; gap: var(--spacing-sm); margin-bottom: var(--spacing-sm); }
        .settings-status { font-size: var(--font-size-sm); color: var(--color-text-secondary); margin-top: var(--spacing-xs); }

        .settings-style-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--spacing-sm); margin-bottom: var(--spacing-md); }
        .style-card {
          display: flex; flex-direction: column; align-items: center; gap: var(--spacing-xs);
          padding: var(--spacing-sm); border-radius: var(--radius-md);
          border: 2px solid var(--color-border); background: var(--color-bg-tertiary);
          cursor: pointer; transition: all 0.2s; text-align: center;
        }
        .style-card:hover { border-color: var(--color-accent-primary); }
        .style-card-active { border-color: var(--color-accent-primary); background: color-mix(in srgb, var(--color-accent-primary) 10%, var(--color-bg-tertiary)); box-shadow: 0 0 0 1px var(--color-accent-primary); }
        .style-card-label { font-size: var(--font-size-xs); font-weight: 600; color: var(--color-text-primary); }

        .style-preview {
          width: 100%; aspect-ratio: 4/3; border-radius: 6px; overflow: hidden;
          display: flex; background: #0c0c14; border: 1px solid rgba(255,255,255,0.06);
        }
        .sp-sidebar { width: 25%; background: #16161f; border-right: 1px solid rgba(255,255,255,0.06); }
        .sp-content { flex: 1; padding: 6px; display: flex; flex-direction: column; gap: 3px; justify-content: center; }
        .sp-bubble { border-radius: 3px; height: 8px; }
        .sp-bubble-peer { background: #1e1e2a; width: 60%; align-self: flex-start; }
        .sp-bubble-own { background: #2a2550; width: 55%; align-self: flex-end; }
        .sp-bubble-short { width: 40%; }

        .style-preview-glassmorphism { background: linear-gradient(135deg, #0f0a1a, #1a1035, #0d1b2a); }
        .style-preview-glassmorphism .sp-sidebar { background: rgba(255,255,255,0.06); border-right-color: rgba(255,255,255,0.1); }
        .style-preview-glassmorphism .sp-bubble-peer { background: rgba(255,255,255,0.06); border-radius: 6px; }
        .style-preview-glassmorphism .sp-bubble-own { background: rgba(162,155,254,0.2); border-radius: 6px; }

        .style-preview-elevated .sp-bubble-peer { box-shadow: 0 1px 3px rgba(0,0,0,0.3); border-radius: 6px; }
        .style-preview-elevated .sp-bubble-own { box-shadow: 0 1px 4px rgba(0,0,0,0.4); border-radius: 6px; }

        .style-preview-minimal .sp-bubble-peer { border-radius: 2px 6px 6px 6px; background: #1e1e2a; }
        .style-preview-minimal .sp-bubble-own { border-radius: 6px 2px 6px 6px; background: #2a2550; }

        .style-preview-classic .sp-bubble-peer { border-radius: 3px; border: 1px solid rgba(255,255,255,0.06); }
        .style-preview-classic .sp-bubble-own { border-radius: 3px; border: 1px solid rgba(162,155,254,0.2); }
      `}</style>
    </div>
  );
};

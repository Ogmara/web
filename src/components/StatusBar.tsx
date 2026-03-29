import { Component } from 'solid-js';
import { t } from '../i18n/init';

export const StatusBar: Component = () => {
  return (
    <footer class="status-bar">
      <span class="status-indicator connected" />
      <span class="status-text">{t('status_connected')}</span>
      <span class="status-version">v{__APP_VERSION__}</span>

      <style>{`
        .status-bar {
          display: flex;
          align-items: center;
          gap: var(--spacing-sm);
          padding: var(--spacing-xs) var(--spacing-md);
          background: var(--color-bg-secondary);
          border-top: 1px solid var(--color-border);
          font-size: var(--font-size-xs);
          color: var(--color-text-secondary);
          height: 28px;
        }
        .status-indicator {
          width: 8px;
          height: 8px;
          border-radius: var(--radius-full);
        }
        .status-indicator.connected { background: var(--color-success); }
        .status-indicator.disconnected { background: var(--color-error); }
        .status-version { margin-left: auto; opacity: 0.5; }
      `}</style>
    </footer>
  );
};

declare const __APP_VERSION__: string;

import { Component } from 'solid-js';
import { t } from '../i18n/init';
import type { View } from '../App';

interface ToolbarProps {
  onToggleSidebar: () => void;
  onNavigate: (view: View) => void;
}

export const Toolbar: Component<ToolbarProps> = (props) => {
  return (
    <header class="toolbar">
      <div class="toolbar-left">
        <button
          class="toolbar-btn"
          onClick={props.onToggleSidebar}
          aria-label={t('sidebar_collapse')}
        >
          ☰
        </button>
        <span class="toolbar-brand">{t('app_name')}</span>
      </div>
      <div class="toolbar-center">
        <button class="toolbar-nav" onClick={() => props.onNavigate('chat')}>
          {t('nav_chat')}
        </button>
        <button class="toolbar-nav" onClick={() => props.onNavigate('news')}>
          {t('nav_news')}
        </button>
      </div>
      <div class="toolbar-right">
        <button class="toolbar-btn" aria-label={t('nav_search')}>🔍</button>
        <button class="toolbar-btn" aria-label={t('nav_notifications')}>🔔</button>
        <button
          class="toolbar-btn"
          onClick={() => props.onNavigate('settings')}
          aria-label={t('nav_settings')}
        >
          ⚙
        </button>
      </div>

      <style>{`
        .toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: var(--spacing-sm) var(--spacing-md);
          background: var(--color-bg-secondary);
          border-bottom: 1px solid var(--color-border);
          height: 48px;
        }
        .toolbar-left, .toolbar-right { display: flex; align-items: center; gap: var(--spacing-sm); }
        .toolbar-center { display: flex; gap: var(--spacing-xs); }
        .toolbar-brand { font-weight: 700; font-size: var(--font-size-lg); color: var(--color-accent-primary); }
        .toolbar-btn {
          padding: var(--spacing-xs) var(--spacing-sm);
          border-radius: var(--radius-md);
          font-size: var(--font-size-md);
        }
        .toolbar-btn:hover { background: var(--color-bg-tertiary); }
        .toolbar-nav {
          padding: var(--spacing-xs) var(--spacing-md);
          border-radius: var(--radius-md);
          font-size: var(--font-size-sm);
          font-weight: 500;
        }
        .toolbar-nav:hover { background: var(--color-bg-tertiary); }
      `}</style>
    </header>
  );
};

/**
 * Toolbar — top navigation bar with route-based navigation and wallet button.
 */

import { Component } from 'solid-js';
import { t } from '../i18n/init';
import { navigate, route } from '../lib/router';
import { WalletButton } from './WalletButton';

interface ToolbarProps {
  onToggleSidebar: () => void;
}

export const Toolbar: Component<ToolbarProps> = (props) => {
  const isActive = (view: string) => {
    const r = route();
    if (view === 'chat') return r.view === 'chat';
    if (view === 'news') return r.view === 'news' || r.view === 'news-detail' || r.view === 'compose';
    if (view === 'dm') return r.view === 'dm' || r.view === 'dm-conversation';
    return false;
  };

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
        <span class="toolbar-brand" onClick={() => navigate('/chat')} style="cursor:pointer">
          {t('app_name')}
        </span>
      </div>
      <div class="toolbar-center">
        <button
          class={`toolbar-nav ${isActive('chat') ? 'active' : ''}`}
          onClick={() => navigate('/chat')}
        >
          {t('nav_chat')}
        </button>
        <button
          class={`toolbar-nav ${isActive('news') ? 'active' : ''}`}
          onClick={() => navigate('/news')}
        >
          {t('nav_news')}
        </button>
        <button
          class={`toolbar-nav ${isActive('dm') ? 'active' : ''}`}
          onClick={() => navigate('/dm')}
        >
          {t('nav_dms')}
        </button>
      </div>
      <div class="toolbar-right">
        <button
          class="toolbar-btn"
          aria-label={t('nav_search')}
          onClick={() => navigate('/search')}
        >
          🔍
        </button>
        <button
          class="toolbar-btn"
          onClick={() => navigate('/bookmarks')}
          aria-label={t('bookmarks_title')}
        >
          ★
        </button>
        <button
          class="toolbar-btn"
          onClick={() => navigate('/settings')}
          aria-label={t('nav_settings')}
        >
          ⚙
        </button>
        <WalletButton />
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
        .toolbar-nav.active {
          background: var(--color-accent-primary);
          color: var(--color-text-inverse);
        }
      `}</style>
    </header>
  );
};

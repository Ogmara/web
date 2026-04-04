/**
 * Toolbar — minimal top bar with hamburger, nav tabs, and profile button.
 *
 * Search, bookmarks, and settings are in the sidebar.
 * Profile shows avatar + display name + verified badge.
 */

import { Component, createEffect, createSignal, Show } from 'solid-js';
import { t } from '../i18n/init';
import { navigate, route } from '../lib/router';
import { authStatus, walletAddress } from '../lib/auth';
import { getClient } from '../lib/api';
import { getSetting } from '../lib/settings';
import { resolveProfile, type CachedProfile } from '../lib/profile';

interface ToolbarProps {
  onToggleSidebar: () => void;
}

export const Toolbar: Component<ToolbarProps> = (props) => {
  const [profile, setProfile] = createSignal<CachedProfile>({});

  createEffect(() => {
    const addr = walletAddress();
    if (addr) resolveProfile(addr).then(setProfile);
  });

  const displayName = () => {
    const p = profile();
    const addr = walletAddress();
    if (p.display_name) return p.display_name;
    if (addr) return `${addr.slice(0, 8)}...${addr.slice(-4)}`;
    return '';
  };

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
        <span class="toolbar-brand" onClick={() => navigate('/news')}>
          {t('app_name')}
        </span>
      </div>
      <div class="toolbar-center">
        <button
          class={`toolbar-nav ${isActive('chat') ? 'active' : ''}`}
          onClick={() => {
            const last = getSetting('lastChannel');
            navigate(last ? `/chat/${last}` : '/chat');
          }}
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
        <Show
          when={authStatus() === 'ready' && walletAddress()}
          fallback={
            <button class="toolbar-connect" onClick={() => navigate('/wallet')}>
              {t('wallet_connect')}
            </button>
          }
        >
          <button
            class="toolbar-profile"
            onClick={() => navigate(`/user/${walletAddress()}`)}
          >
            <Show when={profile().avatar_cid}>
              <img
                class="toolbar-avatar"
                src={getClient().getMediaUrl(profile().avatar_cid!)}
                alt=""
              />
            </Show>
            <Show when={!profile().avatar_cid}>
              <span class="toolbar-avatar-placeholder">
                {(profile().display_name || walletAddress() || '').slice(0, 2).toUpperCase()}
              </span>
            </Show>
            <span class="toolbar-username">{displayName()}</span>
            <Show when={profile().verified}>
              <span class="toolbar-verified">✓</span>
            </Show>
          </button>
        </Show>
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
          flex-shrink: 0;
        }
        .toolbar-left, .toolbar-right { display: flex; align-items: center; gap: var(--spacing-sm); }
        .toolbar-center { display: flex; gap: var(--spacing-xs); }
        .toolbar-brand {
          font-weight: 700;
          font-size: var(--font-size-lg);
          color: var(--color-accent-primary);
          cursor: pointer;
        }
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
        .toolbar-connect {
          color: var(--color-accent-primary);
          font-weight: 600;
          font-size: var(--font-size-sm);
          padding: var(--spacing-xs) var(--spacing-md);
          border-radius: var(--radius-md);
        }
        .toolbar-connect:hover { background: var(--color-bg-tertiary); }
        .toolbar-profile {
          display: flex;
          align-items: center;
          gap: var(--spacing-xs);
          padding: var(--spacing-xs) var(--spacing-sm);
          border-radius: var(--radius-md);
        }
        .toolbar-profile:hover { background: var(--color-bg-tertiary); }
        .toolbar-avatar {
          width: 28px;
          height: 28px;
          border-radius: var(--radius-full);
          object-fit: cover;
        }
        .toolbar-avatar-placeholder {
          width: 28px;
          height: 28px;
          border-radius: var(--radius-full);
          background: var(--color-accent-secondary);
          color: var(--color-text-inverse);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: 700;
        }
        .toolbar-username {
          font-size: var(--font-size-sm);
          font-weight: 500;
          max-width: 120px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .toolbar-verified {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 16px;
          height: 16px;
          border-radius: var(--radius-full);
          background: var(--color-accent-primary);
          color: var(--color-text-inverse);
          font-size: 10px;
          font-weight: 700;
        }

        @media (max-width: 768px) {
          .toolbar-brand { display: none; }
          .toolbar { padding: var(--spacing-xs) var(--spacing-sm); }
          .toolbar-nav { padding: var(--spacing-xs) var(--spacing-sm); font-size: var(--font-size-xs); }
          .toolbar-username { max-width: 80px; }
        }
      `}</style>
    </header>
  );
};

/**
 * Toolbar — minimal top bar with hamburger menu and profile button.
 *
 * All navigation is handled through the sidebar (burger menu).
 * The toolbar only shows: hamburger toggle + app branding + profile avatar/name.
 */

import { Component, createEffect, createSignal, Show } from 'solid-js';
import { t } from '../i18n/init';
import { navigate, route } from '../lib/router';
import { authStatus, walletAddress } from '../lib/auth';
import { getClient } from '../lib/api';
import { resolveProfile, type CachedProfile } from '../lib/profile';

interface ToolbarProps {
  onToggleSidebar: () => void;
}

export const Toolbar: Component<ToolbarProps> = (props) => {
  const [profile, setProfile] = createSignal<CachedProfile>({});

  // Resolve profile when wallet connects
  createEffect(() => {
    const addr = walletAddress();
    if (addr) {
      resolveProfile(addr).then(setProfile);
    }
  });

  const displayName = () => {
    const p = profile();
    const addr = walletAddress();
    if (p.display_name) return p.display_name;
    if (addr) return `${addr.slice(0, 8)}...${addr.slice(-4)}`;
    return '';
  };

  return (
    <header class="toolbar">
      <div class="toolbar-left">
        <button
          class="toolbar-hamburger"
          onClick={props.onToggleSidebar}
          aria-label={t('sidebar_collapse')}
        >
          ☰
        </button>
        <span class="toolbar-brand" onClick={() => navigate('/news')}>
          {t('app_name')}
        </span>
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
        .toolbar-left {
          display: flex;
          align-items: center;
          gap: var(--spacing-sm);
        }
        .toolbar-hamburger {
          padding: var(--spacing-xs) var(--spacing-sm);
          border-radius: var(--radius-md);
          font-size: var(--font-size-lg);
        }
        .toolbar-hamburger:hover { background: var(--color-bg-tertiary); }
        .toolbar-brand {
          font-weight: 700;
          font-size: var(--font-size-lg);
          color: var(--color-accent-primary);
          cursor: pointer;
        }
        .toolbar-right {
          display: flex;
          align-items: center;
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
          cursor: pointer;
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
          .toolbar-username { max-width: 80px; }
        }
      `}</style>
    </header>
  );
};

/**
 * Toolbar — minimal top bar with hamburger, nav tabs, and profile button.
 *
 * Search, bookmarks, and settings are in the sidebar.
 * Profile shows avatar + display name + verified badge.
 */

import { Component, createEffect, createSignal, Show, onCleanup } from 'solid-js';
import { t } from '../i18n/init';
import { navigate } from '../lib/router';
import { authStatus, walletAddress, disconnectWallet } from '../lib/auth';
import { getClient } from '../lib/api';
import { resolveProfile, type CachedProfile } from '../lib/profile';
import { getTheme, setTheme } from '../lib/theme';
import { showMobileDetail, showMobileList, isMobileViewport, mobileListOpen } from '../lib/mobile-nav';

interface ToolbarProps {
  onToggleSidebar: () => void;
}

export const Toolbar: Component<ToolbarProps> = (props) => {
  const [profile, setProfile] = createSignal<CachedProfile>({});
  const [burgerOpen, setBurgerOpen] = createSignal(false);
  const [currentTheme, setCurrentTheme] = createSignal(getTheme());

  // Close the burger dropdown when clicking anywhere else on the page.
  if (typeof document !== 'undefined') {
    const handleDocumentClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.toolbar-burger-wrap')) setBurgerOpen(false);
    };
    document.addEventListener('click', handleDocumentClick);
    onCleanup(() => document.removeEventListener('click', handleDocumentClick));
  }

  /** Navigate and switch to detail pane on mobile. */
  const navTo = (path: string) => {
    setBurgerOpen(false);
    navigate(path);
    if (isMobileViewport()) showMobileDetail();
  };

  const handleLogout = async () => {
    setBurgerOpen(false);
    await disconnectWallet();
    navigate('/news');
  };

  const toggleTheme = () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    setTheme(next);
    setCurrentTheme(next);
  };

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

  return (
    <header class="toolbar">
      <div class="toolbar-left">
        <div class="toolbar-burger-wrap">
          {/* On mobile detail view: show back arrow to return to sidebar.
              On desktop or mobile list view: show burger menu. */}
          <Show
            when={isMobileViewport() && !mobileListOpen()}
            fallback={
              <button
                class="toolbar-btn"
                onClick={(e) => { e.stopPropagation(); setBurgerOpen(!burgerOpen()); }}
                aria-label={t('menu') || 'Menü'}
                aria-haspopup="menu"
                aria-expanded={burgerOpen()}
                title={t('menu') || 'Menü'}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              </button>
            }
          >
            <button
              class="toolbar-btn"
              onClick={() => showMobileList()}
              aria-label={t('nav_back') || 'Zurück'}
              title={t('nav_back') || 'Zurück'}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M19 12H5" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
            </button>
          </Show>
          <Show when={burgerOpen()}>
            <div class="toolbar-menu toolbar-burger-menu" role="menu">
              {/* Profile header — only shown when logged in */}
              <Show when={authStatus() === 'ready' && walletAddress()}>
                <button
                  class="toolbar-menu-profile"
                  onClick={() => navTo(`/user/${walletAddress()}`)}
                >
                  <Show
                    when={profile().avatar_cid}
                    fallback={
                      <span class="toolbar-menu-profile-avatar-placeholder">
                        {(profile().display_name || walletAddress() || '').slice(0, 2).toUpperCase()}
                      </span>
                    }
                  >
                    <img
                      class="toolbar-menu-profile-avatar"
                      src={getClient().getMediaUrl(profile().avatar_cid!)}
                      alt=""
                    />
                  </Show>
                  <div class="toolbar-menu-profile-text">
                    <div class="toolbar-menu-profile-name">
                      {displayName()}
                      <Show when={profile().verified}>
                        <span class="toolbar-menu-profile-verified">✓</span>
                      </Show>
                    </div>
                    <div class="toolbar-menu-profile-addr">
                      {walletAddress()?.slice(0, 12)}…{walletAddress()?.slice(-6)}
                    </div>
                  </div>
                </button>
                <div class="toolbar-menu-divider" />
              </Show>

              {/* Account / wallet */}
              <Show when={authStatus() === 'ready'}>
                <button
                  class="toolbar-menu-item"
                  onClick={() => navTo(`/user/${walletAddress()}`)}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <circle cx="12" cy="8" r="4" />
                    <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
                  </svg>
                  <span>{t('menu_my_profile')}</span>
                </button>
                <button
                  class="toolbar-menu-item"
                  onClick={() => navTo('/wallet')}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
                    <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
                    <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
                  </svg>
                  <span>{t('menu_wallet')}</span>
                </button>
                <div class="toolbar-menu-divider" />
              </Show>

              {/* Create actions */}
              <Show when={authStatus() === 'ready'}>
                <button
                  class="toolbar-menu-item"
                  onClick={() => navTo('/channel/create?type=group')}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                  <span>{t('menu_new_group')}</span>
                </button>
                <button
                  class="toolbar-menu-item"
                  onClick={() => navTo('/channel/create?type=channel')}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M3 11l18-8-6 19-3-9-9-2z" />
                  </svg>
                  <span>{t('menu_new_channel')}</span>
                </button>
                <div class="toolbar-menu-divider" />
              </Show>

              {/* Navigation / settings */}
              <Show when={authStatus() === 'ready'}>
                <button
                  class="toolbar-menu-item"
                  onClick={() => {
                    localStorage.setItem('ogmara.lastSeenNotifTs', Date.now().toString());
                    navTo('/notifications');
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                  </svg>
                  <span>{t('menu_notifications')}</span>
                </button>
              </Show>
              <button
                class="toolbar-menu-item"
                onClick={() => navTo('/search')}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <span>{t('menu_search')}</span>
              </button>
              <button
                class="toolbar-menu-item"
                onClick={() => navTo('/bookmarks')}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                </svg>
                <span>{t('menu_bookmarks')}</span>
              </button>
              <button
                class="toolbar-menu-item"
                onClick={() => navTo('/settings')}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
                <span>{t('menu_settings')}</span>
              </button>

              {/* Theme toggle — click anywhere on the row flips dark/light */}
              <button
                class="toolbar-menu-item toolbar-menu-toggle"
                onClick={(e) => { e.stopPropagation(); toggleTheme(); }}
              >
                <Show
                  when={currentTheme() === 'dark'}
                  fallback={
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="5" />
                      <line x1="12" y1="1" x2="12" y2="3" />
                      <line x1="12" y1="21" x2="12" y2="23" />
                      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                      <line x1="1" y1="12" x2="3" y2="12" />
                      <line x1="21" y1="12" x2="23" y2="12" />
                      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                    </svg>
                  }
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                  </svg>
                </Show>
                <span>{currentTheme() === 'dark' ? t('menu_theme_dark') : t('menu_theme_light')}</span>
                <span class={`toolbar-menu-switch ${currentTheme() === 'dark' ? 'on' : ''}`} />
              </button>

              {/* Disconnect */}
              <Show when={authStatus() === 'ready'}>
                <div class="toolbar-menu-divider" />
                <button
                  class="toolbar-menu-item toolbar-menu-danger"
                  onClick={handleLogout}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  <span>{t('menu_disconnect')}</span>
                </button>
              </Show>
            </div>
          </Show>
        </div>
        <span class="toolbar-brand" onClick={() => navigate('/news')}>
          <span class="toolbar-brand-text">{t('app_name')}</span>
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
          {/* Profile pill — no dropdown, just a clickable shortcut to
              the user's own profile page. All other settings/wallet/logout
              live in the burger menu now. */}
          <button
            class="toolbar-profile"
            onClick={() => navigate(`/user/${walletAddress()}`)}
            title={displayName()}
            aria-label={displayName()}
          >
            <Show
              when={profile().avatar_cid}
              fallback={
                <span class="toolbar-avatar-placeholder">
                  {(profile().display_name || walletAddress() || '').slice(0, 2).toUpperCase()}
                </span>
              }
            >
              <img
                class="toolbar-avatar"
                src={getClient().getMediaUrl(profile().avatar_cid!)}
                alt=""
              />
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
          padding: 0 var(--spacing-md);
          background: var(--color-bg-secondary);
          border-bottom: 1px solid var(--color-border);
          height: 56px;
          flex-shrink: 0;
        }
        .toolbar-left {
          display: flex;
          align-items: center;
          gap: var(--spacing-xs);
        }
        .toolbar-right {
          display: flex;
          align-items: center;
          gap: var(--spacing-xs);
          margin-left: auto;
        }
        .toolbar-brand {
          display: flex;
          align-items: center;
          padding: 6px 8px;
          border-radius: var(--radius-sm);
          cursor: pointer;
          transition: background 0.15s;
        }
        .toolbar-brand:hover { background: var(--color-bg-tertiary); }
        .toolbar-brand-text {
          font-weight: 500;
          font-size: var(--font-size-md);
          color: var(--color-text-secondary);
          letter-spacing: 0.02em;
          text-transform: lowercase;
        }
        .toolbar-brand:hover .toolbar-brand-text {
          color: var(--color-text-primary);
        }
        .toolbar-btn {
          width: 38px;
          height: 38px;
          border-radius: var(--radius-full);
          color: var(--color-text-secondary);
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 0.15s, color 0.15s;
        }
        .toolbar-btn:hover {
          background: var(--color-bg-tertiary);
          color: var(--color-text-primary);
        }
        .toolbar-connect {
          color: #fff;
          font-weight: 600;
          font-size: var(--font-size-sm);
          padding: 8px 16px;
          border-radius: var(--radius-full);
          background: var(--color-accent-primary);
          transition: background 0.15s, transform 0.1s;
        }
        .toolbar-connect:hover {
          background: var(--color-accent-secondary);
          transform: translateY(-1px);
        }
        .toolbar-burger-wrap {
          position: relative;
        }
        /* Higher specificity override so burger menu opens LEFT-aligned
           (base .toolbar-menu rule further below sets right: 0 which is
           correct for the profile pill but wrong for the burger button) */
        .toolbar-burger-wrap .toolbar-burger-menu {
          left: 0;
          right: auto;
          min-width: 280px;
          max-height: calc(100vh - 80px);
          overflow-y: auto;
        }
        .toolbar-menu-profile {
          display: flex;
          align-items: center;
          gap: 12px;
          width: 100%;
          padding: 12px;
          border-radius: var(--radius-md);
          text-align: left;
          transition: background 0.15s;
        }
        .toolbar-menu-profile:hover { background: var(--color-bg-hover); }
        .toolbar-menu-profile-avatar,
        .toolbar-menu-profile-avatar-placeholder {
          width: 44px;
          height: 44px;
          border-radius: var(--radius-full);
          flex-shrink: 0;
        }
        .toolbar-menu-profile-avatar { object-fit: cover; }
        .toolbar-menu-profile-avatar-placeholder {
          background: linear-gradient(135deg, var(--color-accent-secondary), var(--color-accent-primary));
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          font-size: 14px;
        }
        .toolbar-menu-profile-text {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .toolbar-menu-profile-name {
          font-size: var(--font-size-md);
          font-weight: 700;
          color: var(--color-text-primary);
          display: flex;
          align-items: center;
          gap: 5px;
        }
        .toolbar-menu-profile-verified {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 14px;
          height: 14px;
          border-radius: var(--radius-full);
          background: var(--color-accent-primary);
          color: #fff;
          font-size: 9px;
          font-weight: 700;
        }
        .toolbar-menu-profile-addr {
          font-size: 11px;
          color: var(--color-text-secondary);
          font-family: monospace;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        /* Theme toggle row — dedicated style with a small switch on the right */
        .toolbar-menu-toggle {
          justify-content: flex-start;
        }
        .toolbar-menu-switch {
          margin-left: auto;
          width: 32px;
          height: 18px;
          border-radius: var(--radius-full);
          background: var(--color-bg-hover);
          position: relative;
          transition: background 0.15s;
          flex-shrink: 0;
        }
        .toolbar-menu-switch::after {
          content: '';
          position: absolute;
          top: 2px;
          left: 2px;
          width: 14px;
          height: 14px;
          border-radius: var(--radius-full);
          background: var(--color-text-secondary);
          transition: transform 0.15s, background 0.15s;
        }
        .toolbar-menu-switch.on {
          background: var(--color-accent-bg);
        }
        .toolbar-menu-switch.on::after {
          transform: translateX(14px);
          background: var(--color-accent-primary);
        }
        .toolbar-profile {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 4px 10px 4px 4px;
          border-radius: var(--radius-full);
          background: var(--color-bg-tertiary);
          transition: background 0.15s;
          color: var(--color-text-primary);
        }
        .toolbar-profile:hover { background: var(--color-bg-hover); }
        .toolbar-menu {
          position: absolute;
          top: calc(100% + 6px);
          right: 0;
          min-width: 220px;
          background: var(--color-bg-secondary);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-md);
          box-shadow: var(--shadow-lg);
          padding: 6px;
          z-index: 200;
          animation: tb-menu-in 0.12s ease-out;
        }
        @keyframes tb-menu-in {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .toolbar-menu-item {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          padding: 9px 12px;
          border-radius: var(--radius-sm);
          font-size: var(--font-size-sm);
          font-weight: 500;
          color: var(--color-text-primary);
          text-align: left;
          transition: background 0.1s;
        }
        .toolbar-menu-item svg {
          color: var(--color-text-secondary);
          flex-shrink: 0;
        }
        .toolbar-menu-item:hover {
          background: var(--color-bg-hover);
        }
        .toolbar-menu-item:hover svg { color: var(--color-text-primary); }
        .toolbar-menu-divider {
          height: 1px;
          background: var(--color-border);
          margin: 4px 6px;
        }
        .toolbar-menu-danger { color: var(--color-error); }
        .toolbar-menu-danger svg { color: var(--color-error); }
        .toolbar-menu-danger:hover {
          background: color-mix(in srgb, var(--color-error) 12%, transparent);
        }
        .toolbar-menu-danger:hover svg { color: var(--color-error); }
        .toolbar-avatar {
          width: 30px;
          height: 30px;
          border-radius: var(--radius-full);
          object-fit: cover;
          flex-shrink: 0;
        }
        .toolbar-avatar-placeholder {
          width: 30px;
          height: 30px;
          border-radius: var(--radius-full);
          background: linear-gradient(135deg, var(--color-accent-secondary), var(--color-accent-primary));
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: 700;
          flex-shrink: 0;
        }
        .toolbar-username {
          font-size: var(--font-size-sm);
          font-weight: 600;
          color: var(--color-text-primary);
          max-width: 120px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .toolbar-verified {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 14px;
          height: 14px;
          border-radius: var(--radius-full);
          background: var(--color-accent-primary);
          color: #fff;
          font-size: 9px;
          font-weight: 700;
          flex-shrink: 0;
        }

        @media (max-width: 768px) {
          .toolbar-brand-text { display: none; }
          .toolbar { padding: 0 var(--spacing-sm); height: 52px; }
          .toolbar-username { max-width: 80px; }
        }
      `}</style>
    </header>
  );
};

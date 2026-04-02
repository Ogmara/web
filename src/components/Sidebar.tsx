/**
 * Sidebar — main navigation with collapsible channels.
 *
 * Structure: News, Channels (collapsible, default collapsed),
 * Messages, Bookmarks, Search, Settings.
 */

import { Component, createResource, createSignal, createEffect, For, Show, onCleanup } from 'solid-js';
import { t } from '../i18n/init';
import { getClient } from '../lib/api';
import { authStatus } from '../lib/auth';
import { navigate, route } from '../lib/router';
import { getSetting, setSetting } from '../lib/settings';

export const Sidebar: Component<{ onNavigate?: () => void }> = (props) => {
  const [channelsOpen, setChannelsOpen] = createSignal(getSetting('channelsExpanded'));
  const [unreadCounts, setUnreadCounts] = createSignal<Record<string, number>>({});

  /** Navigate and auto-close sidebar on mobile. */
  const go = (path: string) => {
    navigate(path);
    props.onNavigate?.();
  };

  const [channels] = createResource(async () => {
    try {
      const client = getClient();
      const resp = await client.listChannels(1, 50);
      return resp.channels;
    } catch {
      return [];
    }
  });

  // Poll unread counts every 30 seconds when authenticated
  let unreadTimer: ReturnType<typeof setInterval> | null = null;
  const fetchUnread = async () => {
    if (authStatus() !== 'ready') return;
    try {
      const client = getClient();
      const resp = await client.getUnreadCounts();
      setUnreadCounts(resp.unread ?? {});
    } catch { /* ignore */ }
  };
  createEffect(() => {
    if (unreadTimer) clearInterval(unreadTimer);
    if (authStatus() === 'ready') {
      fetchUnread();
      unreadTimer = setInterval(fetchUnread, 30000);
    }
  });
  onCleanup(() => { if (unreadTimer) clearInterval(unreadTimer); });

  const currentChannelId = () => {
    const r = route();
    if (r.view === 'chat' && r.params.channelId) {
      return parseInt(r.params.channelId, 10);
    }
    return null;
  };

  const isView = (view: string) => {
    const r = route();
    if (view === 'news') return r.view === 'news' || r.view === 'news-detail' || r.view === 'compose';
    if (view === 'dm') return r.view === 'dm' || r.view === 'dm-conversation';
    if (view === 'bookmarks') return r.view === 'bookmarks';
    if (view === 'search') return r.view === 'search';
    if (view === 'settings') return r.view === 'settings';
    return false;
  };

  return (
    <aside class={`sidebar ${window.innerWidth <= 768 ? 'mobile-open' : ''}`}>
      {/* News */}
      <div class="sidebar-section">
        <button
          class={`sidebar-nav-item ${isView('news') ? 'active' : ''}`}
          onClick={() => go('/news')}
        >
          📰 {t('nav_news')}
        </button>
      </div>

      {/* Channels (collapsible) */}
      <div class="sidebar-section">
        <div class="sidebar-heading-row">
          <button
            class="sidebar-collapse-btn"
            onClick={() => { const next = !channelsOpen(); setChannelsOpen(next); setSetting('channelsExpanded', next); }}
          >
            <span class={`collapse-arrow ${channelsOpen() ? 'open' : ''}`}>▸</span>
            <h3 class="sidebar-heading">{t('sidebar_channels')}</h3>
            <Show when={!channelsOpen() && Object.values(unreadCounts()).reduce((a, b) => a + b, 0) > 0}>
              <span class="unread-badge">
                {Object.values(unreadCounts()).reduce((a, b) => a + b, 0)}
              </span>
            </Show>
          </button>
          <Show when={authStatus() === 'ready'}>
            <button
              class="sidebar-add-btn"
              onClick={() => go('/wallet')}
              title={t('channel_create')}
            >
              +
            </button>
          </Show>
        </div>
        <Show when={channelsOpen()}>
          <Show when={!channels.loading} fallback={<div class="sidebar-loading">{t('loading')}</div>}>
            <For each={channels()}>
              {(channel) => (
                <button
                  class={`sidebar-item ${currentChannelId() === channel.channel_id ? 'active' : ''}`}
                  onClick={() => go(`/chat/${channel.channel_id}`)}
                >
                  <span class="channel-hash">#</span>
                  <span class="channel-name">{channel.display_name || channel.slug}</span>
                  <Show when={(unreadCounts()[String(channel.channel_id)] ?? 0) > 0}>
                    <span class="unread-badge">{unreadCounts()[String(channel.channel_id)]}</span>
                  </Show>
                </button>
              )}
            </For>
          </Show>
        </Show>
      </div>

      {/* Messages */}
      <div class="sidebar-section">
        <button
          class={`sidebar-nav-item ${isView('dm') ? 'active' : ''}`}
          onClick={() => go('/dm')}
        >
          💬 {t('nav_dms')}
        </button>
      </div>

      {/* Divider */}
      <div class="sidebar-divider" />

      {/* Bookmarks */}
      <div class="sidebar-section">
        <button
          class={`sidebar-nav-item ${isView('bookmarks') ? 'active' : ''}`}
          onClick={() => go('/bookmarks')}
        >
          ★ {t('bookmarks_title')}
        </button>
      </div>

      {/* Search */}
      <div class="sidebar-section">
        <button
          class={`sidebar-nav-item ${isView('search') ? 'active' : ''}`}
          onClick={() => go('/search')}
        >
          🔍 {t('nav_search')}
        </button>
      </div>

      {/* Settings */}
      <div class="sidebar-section">
        <button
          class={`sidebar-nav-item ${isView('settings') ? 'active' : ''}`}
          onClick={() => go('/settings')}
        >
          ⚙ {t('nav_settings')}
        </button>
      </div>

      {/* Connect wallet prompt */}
      <Show when={authStatus() !== 'ready'}>
        <div class="sidebar-section">
          <button class="sidebar-connect-btn" onClick={() => go('/wallet')}>
            {t('wallet_connect')}
          </button>
        </div>
      </Show>

      <style>{`
        .sidebar {
          width: 240px;
          min-width: 240px;
          background: var(--color-bg-secondary);
          border-right: 1px solid var(--color-border);
          display: flex;
          flex-direction: column;
          overflow-y: auto;
        }
        .sidebar-section { padding: var(--spacing-xs) var(--spacing-sm); }
        .sidebar-divider {
          height: 1px;
          background: var(--color-border);
          margin: var(--spacing-xs) var(--spacing-md);
        }
        .sidebar-heading-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 var(--spacing-xs);
        }
        .sidebar-collapse-btn {
          display: flex;
          align-items: center;
          gap: var(--spacing-xs);
          padding: var(--spacing-xs);
          border-radius: var(--radius-sm);
        }
        .sidebar-collapse-btn:hover { background: var(--color-bg-tertiary); }
        .collapse-arrow {
          font-size: var(--font-size-xs);
          color: var(--color-text-secondary);
          transition: transform 0.15s;
          display: inline-block;
        }
        .collapse-arrow.open { transform: rotate(90deg); }
        .sidebar-heading {
          font-size: var(--font-size-xs);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--color-text-secondary);
          font-weight: 600;
        }
        .sidebar-add-btn {
          width: 20px;
          height: 20px;
          border-radius: var(--radius-sm);
          font-size: var(--font-size-sm);
          font-weight: 700;
          color: var(--color-text-secondary);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .sidebar-add-btn:hover { background: var(--color-bg-tertiary); color: var(--color-text-primary); }
        .sidebar-nav-item {
          display: flex;
          align-items: center;
          gap: var(--spacing-sm);
          padding: var(--spacing-sm);
          border-radius: var(--radius-md);
          width: 100%;
          text-align: left;
          font-size: var(--font-size-sm);
          font-weight: 500;
        }
        .sidebar-nav-item:hover { background: var(--color-bg-tertiary); }
        .sidebar-nav-item.active {
          background: var(--color-accent-primary);
          color: var(--color-text-inverse);
        }
        .sidebar-item {
          display: flex;
          align-items: center;
          gap: var(--spacing-xs);
          padding: var(--spacing-xs) var(--spacing-sm);
          padding-left: var(--spacing-lg);
          border-radius: var(--radius-md);
          width: 100%;
          text-align: left;
          font-size: var(--font-size-sm);
        }
        .sidebar-item:hover { background: var(--color-bg-tertiary); }
        .sidebar-item.active { background: var(--color-accent-primary); color: var(--color-text-inverse); }
        .channel-hash { opacity: 0.5; font-weight: 700; }
        .unread-badge {
          margin-left: auto;
          background: var(--color-accent-primary);
          color: var(--color-text-inverse);
          font-size: 10px;
          font-weight: 700;
          padding: 1px 6px;
          border-radius: var(--radius-full);
          min-width: 18px;
          text-align: center;
        }
        .sidebar-loading {
          padding: var(--spacing-sm) var(--spacing-lg);
          font-size: var(--font-size-sm);
          color: var(--color-text-secondary);
        }
        .sidebar-connect-btn {
          color: var(--color-accent-primary);
          font-size: var(--font-size-sm);
          font-weight: 600;
          padding: var(--spacing-sm);
          border-radius: var(--radius-md);
          width: 100%;
          text-align: left;
        }
        .sidebar-connect-btn:hover { background: var(--color-bg-tertiary); }
      `}</style>
    </aside>
  );
};

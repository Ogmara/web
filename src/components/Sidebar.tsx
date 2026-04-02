/**
 * Sidebar — main navigation with collapsible channels.
 *
 * Structure: News, Channels (collapsible, default collapsed),
 * Messages, Bookmarks, Search, Settings.
 */

import { Component, createResource, createSignal, createEffect, For, Show, onCleanup } from 'solid-js';
import { t } from '../i18n/init';
import { getClient } from '../lib/api';
import { authStatus, walletAddress } from '../lib/auth';
import { navigate, route } from '../lib/router';
import { getSetting, setSetting } from '../lib/settings';

export const Sidebar: Component<{ onNavigate?: () => void }> = (props) => {
  const [channelsOpen, setChannelsOpen] = createSignal(getSetting('channelsExpanded'));
  const [contextMenu, setContextMenu] = createSignal<{ x: number; y: number; channelId: number; creator?: string } | null>(null);

  const handleContextMenu = (e: MouseEvent, channelId: number, creator?: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, channelId, creator });
  };

  const handleMarkRead = async () => {
    const ctx = contextMenu();
    if (!ctx) return;
    setContextMenu(null);
    try {
      await getClient().markChannelRead(ctx.channelId);
      setUnreadCounts((prev) => {
        const next = { ...prev };
        delete next[String(ctx.channelId)];
        return next;
      });
    } catch { /* ignore */ }
  };

  // Close context menu on any click
  const closeContextMenu = () => setContextMenu(null);
  if (typeof document !== 'undefined') {
    document.addEventListener('click', closeContextMenu);
    onCleanup(() => document.removeEventListener('click', closeContextMenu));
  }
  const [unreadCounts, setUnreadCounts] = createSignal<Record<string, number>>({});

  /** Navigate and auto-close sidebar on mobile. */
  const go = (path: string) => {
    navigate(path);
    props.onNavigate?.();
  };

  const [channelVersion, setChannelVersion] = createSignal(0);
  const [hasLoadedOnce, setHasLoadedOnce] = createSignal(false);
  const [channels, { refetch: refetchChannels }] = createResource(
    () => channelVersion(),
    async () => {
      try {
        const client = getClient();
        const resp = await client.listChannels(1, 50);
        return resp.channels;
      } catch {
        return [];
      } finally {
        setHasLoadedOnce(true);
      }
    },
  );

  // Listen for channel list changes (create/leave/delete)
  if (typeof window !== 'undefined') {
    window.addEventListener('ogmara:channels-changed', () => setChannelVersion(v => v + 1));
  }

  // Poll unread counts + refresh channel list every 30 seconds when authenticated
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  const pollData = async () => {
    if (authStatus() !== 'ready') return;
    try {
      const client = getClient();
      const [unread] = await Promise.all([
        client.getUnreadCounts().catch(() => ({ unread: {} })),
        // Refresh channel list to sync cross-device changes (leave/delete/create)
        refetchChannels(),
      ]);
      setUnreadCounts(unread.unread ?? {});
    } catch { /* ignore */ }
  };
  createEffect(() => {
    if (pollTimer) clearInterval(pollTimer);
    if (authStatus() === 'ready') {
      pollData();
      pollTimer = setInterval(pollData, 30000);
    }
  });
  onCleanup(() => { if (pollTimer) clearInterval(pollTimer); });

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
              onClick={() => go('/channel/create')}
              title={t('channel_create')}
            >
              +
            </button>
          </Show>
        </div>
        <Show when={channelsOpen()}>
          <Show when={hasLoadedOnce() || !channels.loading} fallback={<div class="sidebar-loading">{t('loading')}</div>}>
            <For each={channels()}>
              {(channel) => (
                <button
                  class={`sidebar-item ${currentChannelId() === channel.channel_id ? 'active' : ''}`}
                  onClick={() => go(`/chat/${channel.channel_id}`)}
                  onContextMenu={(e) => handleContextMenu(e, channel.channel_id, channel.creator)}
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

      {/* Channel context menu */}
      <Show when={contextMenu()}>
        <div
          class="channel-context-menu"
          style={{ left: `${contextMenu()!.x}px`, top: `${contextMenu()!.y}px` }}
        >
          <button class="context-menu-item" onClick={handleMarkRead}>
            ✓ {t('channel_mark_read')}
          </button>
          <button class="context-menu-item" onClick={() => {
            const ctx = contextMenu();
            setContextMenu(null);
            if (ctx) navigate(`/chat/${ctx.channelId}/settings`);
          }}>
            ⚙ {t('channel_settings')}
          </button>
          <button class="context-menu-item context-menu-danger" onClick={async () => {
            const ctx = contextMenu();
            setContextMenu(null);
            if (!ctx) return;
            if (!window.confirm(t('channel_leave_confirm'))) return;
            try {
              await getClient().leaveChannel(ctx.channelId);
              window.dispatchEvent(new Event('ogmara:channels-changed'));
              navigate('/news');
            } catch { /* ignore */ }
          }}>
            ✕ {t('channel_leave')}
          </button>
          <Show when={contextMenu()?.creator === walletAddress()}>
            <button class="context-menu-item context-menu-danger" onClick={async () => {
              const ctx = contextMenu();
              setContextMenu(null);
              if (!ctx) return;
              if (!window.confirm(t('channel_delete_confirm'))) return;
              try {
                await getClient().deleteChannel(ctx.channelId);
                window.dispatchEvent(new Event('ogmara:channels-changed'));
                navigate('/news');
              } catch (e: any) {
                alert(e?.message || 'Failed to delete channel');
              }
            }}>
              🗑 Delete channel
            </button>
          </Show>
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
        .channel-context-menu {
          position: fixed;
          background: var(--color-bg-secondary);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-md);
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          z-index: 100;
          padding: 4px;
          min-width: 160px;
        }
        .context-menu-item {
          display: block;
          width: 100%;
          text-align: left;
          padding: var(--spacing-sm) var(--spacing-md);
          font-size: var(--font-size-sm);
          border-radius: var(--radius-sm);
          cursor: pointer;
          color: var(--color-text-primary);
        }
        .context-menu-item:hover { background: var(--color-bg-tertiary); }
        .context-menu-danger { color: #f44; }
        .context-menu-danger:hover { background: rgba(255,68,68,0.1); }
      `}</style>
    </aside>
  );
};

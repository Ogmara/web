/**
 * Sidebar — channel list and DM conversations with route-based navigation.
 */

import { Component, createResource, For, Show } from 'solid-js';
import { t } from '../i18n/init';
import { getClient } from '../lib/api';
import { authStatus } from '../lib/auth';
import { navigate, route } from '../lib/router';

export const Sidebar: Component = () => {
  const [channels] = createResource(async () => {
    try {
      const client = getClient();
      const resp = await client.listChannels(1, 50);
      return resp.channels;
    } catch {
      return [];
    }
  });

  const [dmConversations] = createResource(
    () => authStatus() === 'ready',
    async (isReady) => {
      if (!isReady) return [];
      try {
        const client = getClient();
        const resp = await client.getDmConversations();
        return resp.conversations?.slice(0, 10) ?? [];
      } catch {
        return [];
      }
    },
  );

  const currentChannelId = () => {
    const r = route();
    if (r.view === 'chat' && r.params.channelId) {
      return parseInt(r.params.channelId, 10);
    }
    return null;
  };

  const truncateAddress = (addr: string) =>
    `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  return (
    <aside class="sidebar">
      <div class="sidebar-section">
        <div class="sidebar-heading-row">
          <h3 class="sidebar-heading">{t('sidebar_channels')}</h3>
          <Show when={authStatus() === 'ready'}>
            <button
              class="sidebar-add-btn"
              onClick={() => navigate('/wallet')}
              title={t('channel_create')}
            >
              +
            </button>
          </Show>
        </div>
        <Show when={!channels.loading} fallback={<div class="sidebar-loading">{t('loading')}</div>}>
          <For each={channels()}>
            {(channel) => (
              <button
                class={`sidebar-item ${currentChannelId() === channel.channel_id ? 'active' : ''}`}
                onClick={() => navigate(`/chat/${channel.channel_id}`)}
              >
                <span class="channel-hash">#</span>
                <span class="channel-name">{channel.display_name || channel.slug}</span>
              </button>
            )}
          </For>
        </Show>
      </div>

      <div class="sidebar-section">
        <div class="sidebar-heading-row">
          <h3 class="sidebar-heading">{t('sidebar_dms')}</h3>
          <Show when={authStatus() === 'ready'}>
            <button
              class="sidebar-add-btn"
              onClick={() => navigate('/dm')}
              title={t('dm_compose')}
            >
              +
            </button>
          </Show>
        </div>
        <Show when={authStatus() === 'ready'}>
          <Show
            when={dmConversations() && dmConversations()!.length > 0}
            fallback={
              <button class="sidebar-item dm-item" onClick={() => navigate('/dm')}>
                <span class="dm-icon">💬</span>
                <span>{t('nav_dms')}</span>
              </button>
            }
          >
            <For each={dmConversations()}>
              {(conv: any) => (
                <button
                  class={`sidebar-item dm-item ${
                    route().view === 'dm-conversation' && route().params.address === conv.peer_address
                      ? 'active'
                      : ''
                  }`}
                  onClick={() => navigate(`/dm/${conv.peer_address}`)}
                >
                  <span class="dm-icon">💬</span>
                  <span class="dm-peer-name">{truncateAddress(conv.peer_address)}</span>
                  <Show when={conv.unread_count > 0}>
                    <span class="dm-badge">{conv.unread_count}</span>
                  </Show>
                </button>
              )}
            </For>
          </Show>
        </Show>
        <Show when={authStatus() !== 'ready'}>
          <div class="sidebar-empty">
            <button class="sidebar-connect-btn" onClick={() => navigate('/wallet')}>
              {t('wallet_connect')}
            </button>
          </div>
        </Show>
      </div>

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
        .sidebar-section { padding: var(--spacing-sm); }
        .sidebar-heading-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: var(--spacing-xs) var(--spacing-sm);
        }
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
        .sidebar-item {
          display: flex;
          align-items: center;
          gap: var(--spacing-xs);
          padding: var(--spacing-xs) var(--spacing-sm);
          border-radius: var(--radius-md);
          width: 100%;
          text-align: left;
          font-size: var(--font-size-sm);
        }
        .sidebar-item:hover { background: var(--color-bg-tertiary); }
        .sidebar-item.active { background: var(--color-accent-primary); color: var(--color-text-inverse); }
        .channel-hash { opacity: 0.5; font-weight: 700; }
        .sidebar-loading, .sidebar-empty {
          padding: var(--spacing-sm);
          font-size: var(--font-size-sm);
          color: var(--color-text-secondary);
        }
        .dm-icon { font-size: var(--font-size-xs); }
        .dm-peer-name { font-size: var(--font-size-sm); }
        .dm-badge {
          margin-left: auto;
          background: var(--color-accent-primary);
          color: var(--color-text-inverse);
          font-size: 10px;
          font-weight: 700;
          padding: 1px 5px;
          border-radius: var(--radius-full);
          min-width: 16px;
          text-align: center;
        }
        .sidebar-connect-btn {
          color: var(--color-accent-primary);
          font-size: var(--font-size-sm);
          font-weight: 600;
          padding: var(--spacing-xs) var(--spacing-sm);
          border-radius: var(--radius-md);
          width: 100%;
          text-align: left;
        }
        .sidebar-connect-btn:hover { background: var(--color-bg-tertiary); }
      `}</style>
    </aside>
  );
};

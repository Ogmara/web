import { Component, createResource, For, Show } from 'solid-js';
import { t } from '../i18n/init';
import { getClient } from '../lib/api';
import type { View } from '../App';

interface SidebarProps {
  currentChannel: number | null;
  onSelectChannel: (id: number) => void;
  onNavigate: (view: View) => void;
}

export const Sidebar: Component<SidebarProps> = (props) => {
  const [channels] = createResource(async () => {
    try {
      const client = getClient();
      const resp = await client.listChannels(1, 50);
      return resp.channels;
    } catch {
      return [];
    }
  });

  return (
    <aside class="sidebar">
      <div class="sidebar-section">
        <h3 class="sidebar-heading">{t('sidebar_channels')}</h3>
        <Show when={!channels.loading} fallback={<div class="sidebar-loading">{t('loading')}</div>}>
          <For each={channels()}>
            {(channel) => (
              <button
                class={`sidebar-item ${props.currentChannel === channel.channel_id ? 'active' : ''}`}
                onClick={() => props.onSelectChannel(channel.channel_id)}
              >
                <span class="channel-hash">#</span>
                <span class="channel-name">{channel.display_name || channel.slug}</span>
              </button>
            )}
          </For>
        </Show>
      </div>

      <div class="sidebar-section">
        <h3 class="sidebar-heading">{t('sidebar_dms')}</h3>
        <div class="sidebar-empty">{t('nav_dms')}</div>
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
        .sidebar-heading {
          font-size: var(--font-size-xs);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--color-text-secondary);
          padding: var(--spacing-xs) var(--spacing-sm);
          font-weight: 600;
        }
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
      `}</style>
    </aside>
  );
};

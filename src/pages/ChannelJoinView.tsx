/**
 * ChannelJoinView — deeplink landing page for joining a channel.
 *
 * URL: #/join/{channelId}
 * Public channels: shows channel info + join button.
 * Private channels: shows invite-required message.
 */

import { Component, createResource, createSignal, Show } from 'solid-js';
import { t } from '../i18n/init';
import { getClient } from '../lib/api';
import { authStatus, walletAddress } from '../lib/auth';
import { navigate } from '../lib/router';

interface ChannelJoinProps {
  channelId: string;
}

export const ChannelJoinView: Component<ChannelJoinProps> = (props) => {
  const [joining, setJoining] = createSignal(false);
  const [error, setError] = createSignal('');

  const channelIdNum = () => parseInt(props.channelId, 10);

  const [channel] = createResource(
    () => props.channelId,
    async (id) => {
      try {
        const client = getClient();
        return await client.getChannelDetail(parseInt(id, 10));
      } catch {
        return null;
      }
    },
  );

  const isPrivate = () => {
    const ch = channel()?.channel;
    return ch && ch.channel_type === 2;
  };

  const handleJoin = async () => {
    if (!walletAddress()) { navigate('/wallet'); return; }
    setJoining(true);
    setError('');
    try {
      const client = getClient();
      await client.joinChannel(channelIdNum());
      navigate(`/chat/${channelIdNum()}`);
    } catch (e: any) {
      setError(e?.message || 'Failed to join');
    } finally {
      setJoining(false);
    }
  };

  return (
    <div class="join-view">
      <Show when={channel()} fallback={<div class="join-loading">{t('loading')}</div>}>
        <div class="join-card">
          <h2 class="join-name">
            # {channel()!.channel.display_name || channel()!.channel.slug}
          </h2>
          <Show when={channel()!.channel.description}>
            <p class="join-desc">{(channel()!.channel as any).description}</p>
          </Show>
          <div class="join-meta">
            {channel()!.channel.member_count ?? 0} {t('channel_members')}
          </div>

          <Show when={isPrivate()}>
            <div class="join-private">{t('channel_private_invite')}</div>
          </Show>

          <Show when={!isPrivate()}>
            <Show when={authStatus() !== 'ready'}>
              <button class="join-btn" onClick={() => navigate('/wallet')}>
                {t('auth_connect_prompt')}
              </button>
            </Show>
            <Show when={authStatus() === 'ready'}>
              <button
                class="join-btn"
                onClick={handleJoin}
                disabled={joining()}
              >
                {joining() ? t('loading') : t('channel_join')}
              </button>
            </Show>
          </Show>

          <Show when={error()}>
            <div class="join-error">{error()}</div>
          </Show>
        </div>
      </Show>

      <style>{`
        .join-view {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
          padding: var(--spacing-lg);
        }
        .join-loading { color: var(--color-text-secondary); }
        .join-card {
          background: var(--color-bg-secondary);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-lg);
          padding: var(--spacing-xl);
          max-width: 400px;
          width: 100%;
          text-align: center;
        }
        .join-name { font-size: var(--font-size-xl); margin-bottom: var(--spacing-sm); }
        .join-desc { color: var(--color-text-secondary); margin-bottom: var(--spacing-md); }
        .join-meta { font-size: var(--font-size-sm); color: var(--color-text-secondary); margin-bottom: var(--spacing-lg); }
        .join-private {
          padding: var(--spacing-md);
          background: var(--color-bg-tertiary);
          border-radius: var(--radius-md);
          color: var(--color-text-secondary);
          font-size: var(--font-size-sm);
        }
        .join-btn {
          padding: var(--spacing-sm) var(--spacing-xl);
          background: var(--color-accent-primary);
          color: var(--color-text-inverse);
          border-radius: var(--radius-md);
          font-weight: 600;
          font-size: var(--font-size-md);
        }
        .join-btn:disabled { opacity: 0.5; }
        .join-error {
          margin-top: var(--spacing-md);
          color: #f44;
          font-size: var(--font-size-sm);
        }
      `}</style>
    </div>
  );
};

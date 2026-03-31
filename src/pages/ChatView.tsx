/**
 * ChatView — channel messaging with real-time updates and send functionality.
 */

import { Component, createResource, createSignal, createEffect, For, Show, onCleanup } from 'solid-js';
import { t } from '../i18n/init';
import { getClient } from '../lib/api';
import { authStatus, getSigner } from '../lib/auth';
import { onWsEvent, wsSubscribeChannels, wsUnsubscribeChannels } from '../lib/ws';
import { navigate } from '../lib/router';
import { FormattedText } from '../components/FormattedText';

interface ChatViewProps {
  channelId: number | null;
}

export const ChatView: Component<ChatViewProps> = (props) => {
  const [messageInput, setMessageInput] = createSignal('');
  const [replyTo, setReplyTo] = createSignal<{ msgId: string; author: string; preview: string } | null>(null);
  const [localMessages, setLocalMessages] = createSignal<any[]>([]);
  const [sending, setSending] = createSignal(false);

  const [messages, { refetch }] = createResource(
    () => props.channelId,
    async (channelId) => {
      if (!channelId) return [];
      setLocalMessages([]);
      try {
        const client = getClient();
        const resp = await client.getChannelMessages(channelId, 50);
        return resp.messages;
      } catch {
        return [];
      }
    },
  );

  const [pinnedMessages] = createResource(
    () => props.channelId,
    async (channelId) => {
      if (!channelId) return [];
      try {
        const client = getClient();
        const resp = await client.getChannelPins(channelId);
        return resp.pinned_messages;
      } catch {
        return [];
      }
    },
  );

  const MAX_LOCAL_MESSAGES = 200;

  // Subscribe to channel WebSocket events
  const wsCleanup = onWsEvent((event) => {
    if (event.type === 'message' && props.channelId) {
      const msg = event.envelope;
      if (msg.channel_id === props.channelId || msg.channel_id === String(props.channelId)) {
        setLocalMessages((prev) => {
          // Cap local messages to prevent unbounded growth
          const next = [...prev, msg];
          return next.length > MAX_LOCAL_MESSAGES ? next.slice(-MAX_LOCAL_MESSAGES) : next;
        });
      }
    }
  });
  onCleanup(wsCleanup);

  // Reactive channel subscription — runs when channelId changes
  let prevChannelId: string | null = null;
  createEffect(() => {
    const id = props.channelId ? String(props.channelId) : null;
    if (prevChannelId) wsUnsubscribeChannels([prevChannelId]);
    if (id) wsSubscribeChannels([id]);
    prevChannelId = id;
  });
  onCleanup(() => {
    if (prevChannelId) wsUnsubscribeChannels([prevChannelId]);
  });

  // Deduplicate messages by msg_id
  const allMessages = () => {
    const seen = new Set<string>();
    const combined = [...(messages() || []), ...localMessages()];
    return combined.filter((msg) => {
      if (!msg.msg_id || seen.has(msg.msg_id)) return false;
      seen.add(msg.msg_id);
      return true;
    });
  };

  const handleSend = async () => {
    const text = messageInput().trim();
    if (!text || !props.channelId) return;

    if (!getSigner()) {
      // No auth — prompt user
      navigate('/wallet');
      return;
    }

    setSending(true);
    try {
      const client = getClient();
      const options: any = {};
      if (replyTo()) {
        options.replyTo = replyTo()!.msgId;
      }
      await client.sendMessage(props.channelId, text, options);
      setMessageInput('');
      setReplyTo(null);
    } catch {
      // Send failed
    } finally {
      setSending(false);
    }
  };

  const handleReply = (msg: any) => {
    setReplyTo({
      msgId: msg.msg_id,
      author: msg.author,
      preview: '[message]',
    });
  };

  const cancelReply = () => setReplyTo(null);

  const truncateAddress = (addr: string) =>
    `${addr.slice(0, 8)}...${addr.slice(-4)}`;

  return (
    <div class="chat-view">
      <Show
        when={props.channelId}
        fallback={
          <div class="chat-empty">
            <p>{t('chat_no_channel')}</p>
          </div>
        }
      >
        {/* Pinned messages bar */}
        <Show when={pinnedMessages() && pinnedMessages()!.length > 0}>
          <div class="pinned-bar">
            <span class="pinned-icon">📌</span>
            <span class="pinned-count">{pinnedMessages()!.length} {t('channel_pins')}</span>
          </div>
        </Show>

        <div class="chat-messages">
          <Show
            when={allMessages().length > 0}
            fallback={<div class="chat-empty"><p>{t('chat_no_messages')}</p></div>}
          >
            <For each={allMessages()}>
              {(msg) => (
                <div class="message">
                  {/* Reply preview (if this message is a reply) */}
                  <Show when={msg.reply_to_preview}>
                    <div class="reply-preview">
                      <span class="reply-author">
                        {msg.reply_to_preview?.author?.slice(0, 8)}...
                      </span>
                      <span class="reply-text">{msg.reply_to_preview?.content_preview}</span>
                    </div>
                  </Show>
                  <div class="message-header">
                    <span
                      class="message-author"
                      onClick={() => navigate(`/user/${msg.author}`)}
                    >
                      {truncateAddress(msg.author)}
                    </span>
                    <span class="message-time">
                      {new Date(msg.timestamp).toLocaleTimeString(undefined, {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    <button class="reply-btn" onClick={() => handleReply(msg)} title={t('chat_reply')}>
                      ↩
                    </button>
                  </div>
                  <div class="message-body"><FormattedText content={msg.payload} /></div>
                </div>
              )}
            </For>
          </Show>
        </div>

        {/* Reply indicator */}
        <Show when={replyTo()}>
          <div class="reply-indicator">
            <span>{t('channel_reply_preview')} <strong>{replyTo()!.author.slice(0, 8)}...</strong></span>
            <button class="reply-cancel" onClick={cancelReply}>✕</button>
          </div>
        </Show>

        <div class="chat-input">
          <input
            type="text"
            placeholder={authStatus() === 'ready' ? t('chat_placeholder') : t('auth_connect_prompt')}
            value={messageInput()}
            onInput={(e) => setMessageInput(e.currentTarget.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter' && messageInput().trim()) {
                handleSend();
              }
            }}
            disabled={sending()}
          />
          <button
            class="send-btn"
            aria-label={t('chat_send')}
            onClick={handleSend}
            disabled={sending() || !messageInput().trim()}
          >
            {t('chat_send')}
          </button>
        </div>
      </Show>

      <style>{`
        .chat-view { display: flex; flex-direction: column; height: 100%; }
        .chat-messages { flex: 1; overflow-y: auto; padding: var(--spacing-md); }
        .chat-empty { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--color-text-secondary); }
        .message { padding: var(--spacing-sm) 0; }
        .message-header { display: flex; gap: var(--spacing-sm); align-items: baseline; }
        .message-author {
          font-weight: 600;
          font-size: var(--font-size-sm);
          color: var(--color-accent-primary);
          cursor: pointer;
        }
        .message-author:hover { text-decoration: underline; }
        .message-time { font-size: var(--font-size-xs); color: var(--color-text-secondary); }
        .message-body { margin-top: var(--spacing-xs); font-size: var(--font-size-md); line-height: 1.5; }
        .reply-btn {
          font-size: var(--font-size-xs);
          color: var(--color-text-secondary);
          cursor: pointer;
          opacity: 0;
          transition: opacity 0.15s;
          margin-left: auto;
        }
        .message:hover .reply-btn { opacity: 1; }
        .reply-btn:hover { color: var(--color-accent-primary); }

        .reply-preview {
          font-size: var(--font-size-xs);
          color: var(--color-text-secondary);
          border-left: 2px solid var(--color-accent-primary);
          padding-left: var(--spacing-sm);
          margin-bottom: var(--spacing-xs);
        }
        .reply-author { font-weight: 600; margin-right: var(--spacing-xs); }
        .reply-text { font-style: italic; }

        .reply-indicator {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: var(--spacing-xs) var(--spacing-md);
          background: var(--color-bg-tertiary);
          border-top: 1px solid var(--color-border);
          font-size: var(--font-size-sm);
        }
        .reply-cancel {
          cursor: pointer;
          color: var(--color-text-secondary);
          font-size: var(--font-size-md);
        }
        .reply-cancel:hover { color: var(--color-text-primary); }

        .pinned-bar {
          display: flex;
          align-items: center;
          gap: var(--spacing-xs);
          padding: var(--spacing-xs) var(--spacing-md);
          background: var(--color-bg-tertiary);
          border-bottom: 1px solid var(--color-border);
          font-size: var(--font-size-sm);
          cursor: pointer;
        }
        .pinned-bar:hover { background: var(--color-bg-secondary); }
        .pinned-icon { font-size: var(--font-size-md); }
        .pinned-count { color: var(--color-accent-primary); font-weight: 600; }

        .chat-input {
          display: flex;
          gap: var(--spacing-sm);
          padding: var(--spacing-md);
          border-top: 1px solid var(--color-border);
        }
        .chat-input input {
          flex: 1;
          padding: var(--spacing-sm) var(--spacing-md);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-md);
          background: var(--color-bg-tertiary);
          color: var(--color-text-primary);
          font-family: inherit;
          font-size: var(--font-size-md);
        }
        .chat-input input:focus { outline: none; border-color: var(--color-accent-primary); }
        .chat-input input:disabled { opacity: 0.6; }
        .send-btn {
          padding: var(--spacing-sm) var(--spacing-lg);
          background: var(--color-accent-primary);
          color: var(--color-text-inverse);
          border-radius: var(--radius-md);
          font-weight: 600;
          font-size: var(--font-size-sm);
        }
        .send-btn:hover { opacity: 0.9; }
        .send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      `}</style>
    </div>
  );
};

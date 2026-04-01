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
import { getPayloadContent } from '../lib/payload';

/** Format message time in user's local timezone. */
function formatMessageTime(timestamp: string | number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: '2-digit', minute: '2-digit',
  });
}

/** Get a date label for message grouping. Returns "Today", "Yesterday", or a localized date. */
function getDateLabel(timestamp: string | number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = today.getTime() - msgDay.getTime();
  if (diff === 0) return 'Today';
  if (diff === 86400000) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

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

  // Deduplicate messages by msg_id and sort chronologically
  const allMessages = () => {
    const seen = new Set<string>();
    const combined = [...(messages() || []), ...localMessages()];
    const deduped = combined.filter((msg) => {
      if (!msg.msg_id || seen.has(msg.msg_id)) return false;
      seen.add(msg.msg_id);
      return true;
    });
    // Sort oldest first
    deduped.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    return deduped;
  };

  // Auto-refresh: poll for new messages every 15 seconds as a fallback for WebSocket
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  createEffect(() => {
    if (pollTimer) clearInterval(pollTimer);
    if (props.channelId) {
      pollTimer = setInterval(() => refetch(), 15000);
    }
  });
  onCleanup(() => { if (pollTimer) clearInterval(pollTimer); });

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
    const content = getPayloadContent(msg.payload);
    const preview = content.length > 80 ? content.slice(0, 80) + '...' : content;
    setReplyTo({
      msgId: msg.msg_id,
      author: msg.author,
      preview,
    });
  };

  /** Scroll to a message by msg_id and briefly highlight it. */
  const scrollToMessage = (msgId: string) => {
    const el = document.querySelector(`[data-msg-id="${msgId}"]`) as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('message-highlight');
      setTimeout(() => el.classList.remove('message-highlight'), 1500);
    }
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
              {(msg, index) => {
                const msgs = allMessages();
                const prevMsg = index() > 0 ? msgs[index() - 1] : null;
                const currentDate = getDateLabel(msg.timestamp);
                const prevDate = prevMsg ? getDateLabel(prevMsg.timestamp) : null;
                const showDateSep = currentDate !== prevDate;

                return (
                  <>
                    <Show when={showDateSep}>
                      <div class="date-separator">
                        <span class="date-separator-label">{currentDate}</span>
                      </div>
                    </Show>
                    <div class="message" data-msg-id={msg.msg_id}>
                      {/* Reply preview — clickable to scroll to original */}
                      <Show when={msg.reply_to_preview}>
                        <div
                          class="reply-preview"
                          onClick={() => scrollToMessage(msg.reply_to_preview?.msg_id)}
                        >
                          <span class="reply-preview-author">
                            {truncateAddress(msg.reply_to_preview?.author || '')}
                          </span>
                          <span class="reply-preview-text">
                            {msg.reply_to_preview?.content_preview || '...'}
                          </span>
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
                          {formatMessageTime(msg.timestamp)}
                        </span>
                        <button class="reply-btn" onClick={() => handleReply(msg)} title={t('chat_reply')}>
                          ↩
                        </button>
                      </div>
                      <div class="message-body"><FormattedText content={getPayloadContent(msg.payload)} /></div>
                    </div>
                  </>
                );
              }}
            </For>
          </Show>
        </div>

        {/* Reply indicator above input */}
        <Show when={replyTo()}>
          <div class="reply-indicator">
            <div class="reply-indicator-content">
              <span class="reply-indicator-author">{truncateAddress(replyTo()!.author)}</span>
              <span class="reply-indicator-text">{replyTo()!.preview}</span>
            </div>
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
        .date-separator {
          display: flex;
          align-items: center;
          gap: var(--spacing-sm);
          padding: var(--spacing-sm) 0;
        }
        .date-separator::before, .date-separator::after {
          content: '';
          flex: 1;
          border-top: 1px solid var(--color-border);
        }
        .date-separator-label {
          font-size: var(--font-size-xs);
          color: var(--color-text-secondary);
          white-space: nowrap;
          font-weight: 600;
        }
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
          display: flex;
          flex-direction: column;
          border-left: 3px solid var(--color-accent-primary);
          background: var(--color-bg-tertiary);
          border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
          padding: var(--spacing-xs) var(--spacing-sm);
          margin-bottom: var(--spacing-xs);
          cursor: pointer;
          transition: background 0.15s;
          max-width: 400px;
        }
        .reply-preview:hover { background: var(--color-bg-secondary); }
        .reply-preview-author {
          font-size: var(--font-size-xs);
          font-weight: 700;
          color: var(--color-accent-primary);
          line-height: 1.3;
        }
        .reply-preview-text {
          font-size: var(--font-size-xs);
          color: var(--color-text-secondary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          line-height: 1.3;
        }

        .message-highlight {
          animation: msg-flash 1.5s ease-out;
        }
        @keyframes msg-flash {
          0% { background: var(--color-accent-primary); border-radius: var(--radius-sm); }
          100% { background: transparent; }
        }

        .reply-indicator {
          display: flex;
          align-items: stretch;
          gap: var(--spacing-sm);
          padding: var(--spacing-xs) var(--spacing-md);
          background: var(--color-bg-tertiary);
          border-top: 1px solid var(--color-border);
        }
        .reply-indicator-content {
          flex: 1;
          display: flex;
          flex-direction: column;
          border-left: 3px solid var(--color-accent-primary);
          padding-left: var(--spacing-sm);
          min-width: 0;
        }
        .reply-indicator-author {
          font-size: var(--font-size-xs);
          font-weight: 700;
          color: var(--color-accent-primary);
        }
        .reply-indicator-text {
          font-size: var(--font-size-xs);
          color: var(--color-text-secondary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .reply-cancel {
          cursor: pointer;
          color: var(--color-text-secondary);
          font-size: var(--font-size-md);
          align-self: center;
          padding: var(--spacing-xs);
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

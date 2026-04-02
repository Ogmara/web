/**
 * ChatView — channel messaging with real-time updates, emoji picker,
 * profile resolution, and optimistic message display.
 */

import { Component, createResource, createSignal, createEffect, createMemo, For, Show, onCleanup } from 'solid-js';
import { t } from '../i18n/init';
import { getClient } from '../lib/api';
import { authStatus, getSigner, walletAddress } from '../lib/auth';
import { onWsEvent, wsSubscribeChannels, wsUnsubscribeChannels } from '../lib/ws';
import { navigate } from '../lib/router';
import { FormattedText } from '../components/FormattedText';
import { EmojiPicker } from '../components/EmojiPicker';
import { getPayloadContent, decodePayload } from '../lib/payload';
import { resolveProfile, type CachedProfile } from '../lib/profile';

/** Convert a msg_id (hex string, byte array, or Uint8Array) to a consistent hex string. */
function msgIdToHex(msgId: unknown): string {
  if (typeof msgId === 'string') return msgId;
  if (msgId instanceof Uint8Array) {
    return Array.from(msgId).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  if (Array.isArray(msgId)) {
    return msgId.map((b: number) => b.toString(16).padStart(2, '0')).join('');
  }
  return String(msgId);
}

/** Extract the reply_to msg_id from a message's payload as a hex string, or null. */
function getReplyToHex(msg: any): string | null {
  if (msg.reply_to_preview?.msg_id) return msgIdToHex(msg.reply_to_preview.msg_id);
  try {
    const decoded = decodePayload(msg.payload);
    if (decoded.reply_to) return msgIdToHex(decoded.reply_to);
  } catch { /* ignore */ }
  return null;
}

/** Format message time in user's local timezone. */
function formatMessageTime(timestamp: string | number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: '2-digit', minute: '2-digit',
  });
}

/** Get a date label for message grouping. */
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
  const [showEmoji, setShowEmoji] = createSignal(false);
  const [profiles, setProfiles] = createSignal<Map<string, CachedProfile>>(new Map());
  const [userMenu, setUserMenu] = createSignal<{ x: number; y: number; address: string; msgId: string } | null>(null);
  const [myRole, setMyRole] = createSignal<'creator' | 'moderator' | 'member'>('member');
  let inputRef: HTMLTextAreaElement | undefined;
  let messagesRef: HTMLDivElement | undefined;

  // Close user context menu on any click
  if (typeof document !== 'undefined') {
    const closeUserMenu = () => setUserMenu(null);
    document.addEventListener('click', closeUserMenu);
    onCleanup(() => document.removeEventListener('click', closeUserMenu));
  }

  const handleUserAction = async (action: string) => {
    const ctx = userMenu();
    if (!ctx || !props.channelId) return;
    setUserMenu(null);

    const client = getClient();
    try {
      switch (action) {
        case 'profile':
          navigate(`/user/${ctx.address}`);
          break;
        case 'kick':
          if (window.confirm(`Kick ${ctx.address.slice(0, 12)}...?`))
            await client.kickUser(props.channelId, ctx.address);
          break;
        case 'ban': {
          const reason = window.prompt(t('channel_ban_reason'));
          if (reason !== null)
            await client.banUser(props.channelId, ctx.address, reason || undefined);
          break;
        }
        case 'mute':
          await client.muteUser({ channelId: props.channelId, targetUser: ctx.address, durationSecs: 3600 });
          break;
        case 'pin':
          await client.pinMessage(props.channelId, ctx.msgId);
          break;
      }
    } catch { /* ignore */ }
  };

  /** Scroll chat to the bottom. */
  const scrollToBottom = () => {
    if (messagesRef) messagesRef.scrollTop = messagesRef.scrollHeight;
  };

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

  // Fetch current user's channel role for permission gating
  createEffect(() => {
    const id = props.channelId;
    const me = walletAddress();
    if (!id || !me) { setMyRole('member'); return; }
    getClient().getChannelMembers(id, { limit: 200 }).then((resp) => {
      const member = resp.members.find((m) => m.address === me);
      setMyRole(member?.role as any ?? 'member');
    }).catch(() => setMyRole('member'));
  });

  const isMod = () => myRole() === 'moderator' || myRole() === 'creator';

  const MAX_LOCAL_MESSAGES = 200;

  // Subscribe to channel WebSocket events
  const wsCleanup = onWsEvent((event) => {
    if (event.type === 'message' && props.channelId) {
      const msg = event.envelope;
      if (msg.channel_id === props.channelId || msg.channel_id === String(props.channelId)) {
        setLocalMessages((prev) => {
          const next = [...prev, msg];
          return next.length > MAX_LOCAL_MESSAGES ? next.slice(-MAX_LOCAL_MESSAGES) : next;
        });
      }
    }
  });
  onCleanup(wsCleanup);

  // Reactive channel subscription
  let prevChannelId: string | null = null;
  createEffect(() => {
    const id = props.channelId ? String(props.channelId) : null;
    if (prevChannelId) wsUnsubscribeChannels([prevChannelId]);
    if (id) {
      wsSubscribeChannels([id]);
      // Mark channel as read when entering
      if (authStatus() === 'ready') {
        try { getClient().markChannelRead(parseInt(id, 10)).catch(() => {}); }
        catch { /* SDK method may not exist on older builds */ }
      }
      setTimeout(() => inputRef?.focus(), 50);
    }
    prevChannelId = id;
  });
  onCleanup(() => {
    if (prevChannelId) wsUnsubscribeChannels([prevChannelId]);
  });

  // Deduplicate and sort messages
  const allMessages = createMemo(() => {
    const seen = new Set<string>();
    const combined = [...(messages() || []), ...localMessages()];
    const deduped = combined.filter((msg) => {
      const id = msgIdToHex(msg.msg_id);
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    deduped.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    return deduped;
  });

  // Resolve profiles for all unique authors
  createEffect(() => {
    const msgs = allMessages();
    const authors = new Set(msgs.map((m) => m.author));
    authors.forEach((addr) => {
      if (!profiles().has(addr)) {
        resolveProfile(addr).then((p) => {
          setProfiles((prev) => {
            const next = new Map(prev);
            next.set(addr, p);
            return next;
          });
        });
      }
    });
  });

  const getProfile = (addr: string) => profiles().get(addr);

  const displayName = (addr: string) => {
    const p = getProfile(addr);
    return p?.display_name || `${addr.slice(0, 8)}...${addr.slice(-4)}`;
  };

  /** Lookup map: hex msg_id -> message object. */
  const msgById = createMemo(() => {
    const map = new Map<string, any>();
    for (const msg of allMessages()) map.set(msgIdToHex(msg.msg_id), msg);
    return map;
  });

  /** Resolve a reply reference. */
  const resolveReply = (msg: any): { author: string; content: string; msgId: string } | null => {
    if (msg.reply_to_preview?.author) {
      return {
        author: msg.reply_to_preview.author,
        content: msg.reply_to_preview.content_preview || '...',
        msgId: msgIdToHex(msg.reply_to_preview.msg_id),
      };
    }
    const replyHex = getReplyToHex(msg);
    if (!replyHex) return null;
    const original = msgById().get(replyHex);
    if (original) {
      const content = getPayloadContent(original.payload);
      return {
        author: original.author,
        content: content.length > 100 ? content.slice(0, 100) + '...' : content,
        msgId: replyHex,
      };
    }
    return { author: '...', content: '(original message not loaded)', msgId: replyHex };
  };

  // Poll fallback every 15s
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  createEffect(() => {
    if (pollTimer) clearInterval(pollTimer);
    if (props.channelId) pollTimer = setInterval(() => refetch(), 15000);
  });
  onCleanup(() => { if (pollTimer) clearInterval(pollTimer); });

  // Auto-scroll on new messages
  createEffect(() => {
    const msgs = allMessages();
    if (msgs.length > 0) {
      setTimeout(() => {
        if (!messagesRef) return;
        const { scrollTop, scrollHeight, clientHeight } = messagesRef;
        const isNearBottom = scrollHeight - scrollTop - clientHeight < 150;
        if (isNearBottom || scrollTop === 0) scrollToBottom();
      }, 50);
    }
  });

  const handleSend = async () => {
    const text = messageInput().trim();
    if (!text || !props.channelId) return;
    if (!getSigner() || !walletAddress()) { navigate('/wallet'); return; }

    setSending(true);
    try {
      const client = getClient();
      const options: any = {};
      if (replyTo()) options.replyTo = replyTo()!.msgId;
      await client.sendMessage(props.channelId, text, options);

      // Optimistic: add message locally for instant display
      const addr = walletAddress() || '';
      setLocalMessages((prev) => [...prev, {
        msg_id: `local-${Date.now()}`,
        author: addr,
        timestamp: Date.now(),
        payload: text, // string payloads are handled by getPayloadContent
        _optimistic: true,
      }]);

      setMessageInput('');
      setReplyTo(null);
      setShowEmoji(false);
      inputRef?.focus();
    } catch {
      // Send failed
    } finally {
      setSending(false);
    }
  };

  const handleReply = (msg: any) => {
    const content = getPayloadContent(msg.payload);
    const preview = content.length > 80 ? content.slice(0, 80) + '...' : content;
    setReplyTo({ msgId: msgIdToHex(msg.msg_id), author: msg.author, preview });
    inputRef?.focus();
  };

  const insertEmoji = (emoji: string) => {
    if (!inputRef) return;
    const start = inputRef.selectionStart ?? messageInput().length;
    const end = inputRef.selectionEnd ?? start;
    const current = messageInput();
    setMessageInput(current.slice(0, start) + emoji + current.slice(end));
    // Restore cursor after emoji
    setTimeout(() => {
      inputRef?.focus();
      const pos = start + emoji.length;
      inputRef?.setSelectionRange(pos, pos);
    }, 0);
  };

  const scrollToMessage = (msgId: string) => {
    const el = document.querySelector(`[data-msg-id="${CSS.escape(msgId)}"]`) as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('message-highlight');
      setTimeout(() => el.classList.remove('message-highlight'), 1500);
    }
  };

  const cancelReply = () => setReplyTo(null);

  return (
    <div class="chat-view">
      <Show
        when={props.channelId}
        fallback={<div class="chat-empty"><p>{t('chat_no_channel')}</p></div>}
      >
        {/* Channel header bar */}
        <div class="channel-bar">
          <Show when={pinnedMessages() && pinnedMessages()!.length > 0}>
            <span class="pinned-info">
              <span class="pinned-icon">📌</span>
              <span class="pinned-count">{pinnedMessages()!.length} {t('channel_pins')}</span>
            </span>
          </Show>
          <button
            class="channel-settings-btn"
            onClick={() => navigate(`/chat/${props.channelId}/settings`)}
            title={t('channel_settings')}
          >
            ⚙
          </button>
        </div>

        <div class="chat-messages" ref={messagesRef}>
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
                const reply = resolveReply(msg);
                const prof = () => getProfile(msg.author);

                return (
                  <>
                    <Show when={showDateSep}>
                      <div class="date-separator">
                        <span class="date-separator-label">{currentDate}</span>
                      </div>
                    </Show>
                    <div class={`message ${msg.author === walletAddress() ? 'own' : ''}`} data-msg-id={msgIdToHex(msg.msg_id)}>
                      <Show when={reply}>
                        <div class="reply-preview" onClick={() => scrollToMessage(reply!.msgId)}>
                          <span class="reply-preview-author">{displayName(reply!.author)}</span>
                          <span class="reply-preview-text">{reply!.content}</span>
                        </div>
                      </Show>
                      <div class="message-header">
                        <Show when={prof()?.avatar_cid}>
                          <img
                            class="msg-avatar"
                            src={getClient().getMediaUrl(prof()!.avatar_cid!)}
                            alt=""
                          />
                        </Show>
                        <Show when={!prof()?.avatar_cid}>
                          <span class="msg-avatar-placeholder">
                            {(prof()?.display_name || msg.author).slice(0, 2).toUpperCase()}
                          </span>
                        </Show>
                        <span
                          class="message-author"
                          onClick={() => navigate(`/user/${msg.author}`)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setUserMenu({ x: e.clientX, y: e.clientY, address: msg.author, msgId: msgIdToHex(msg.msg_id) });
                          }}
                        >
                          {displayName(msg.author)}
                        </span>
                        <Show when={prof()?.verified}>
                          <span class="msg-verified">✓</span>
                        </Show>
                        <span class="message-time">{formatMessageTime(msg.timestamp)}</span>
                        <button class="reply-btn" onClick={() => handleReply(msg)} title={t('chat_reply')}>↩</button>
                      </div>
                      <div class="message-body"><FormattedText content={getPayloadContent(msg.payload)} /></div>
                    </div>
                  </>
                );
              }}
            </For>
          </Show>
        </div>

        {/* Reply indicator */}
        <Show when={replyTo()}>
          <div class="reply-indicator">
            <div class="reply-indicator-content">
              <span class="reply-indicator-author">{displayName(replyTo()!.author)}</span>
              <span class="reply-indicator-text">{replyTo()!.preview}</span>
            </div>
            <button class="reply-cancel" onClick={cancelReply}>✕</button>
          </div>
        </Show>

        {/* Input area */}
        <div class="chat-input-area">
          <div class="chat-input">
            <textarea
              ref={inputRef}
              class="chat-textarea"
              rows={3}
              placeholder={authStatus() === 'ready' ? t('chat_placeholder') : t('auth_connect_prompt')}
              value={messageInput()}
              onInput={(e) => setMessageInput(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && messageInput().trim()) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              disabled={sending() || !walletAddress()}
            />
            <div class="chat-input-actions">
              <div class="emoji-container">
                <button
                  class="emoji-toggle"
                  onClick={() => walletAddress() && setShowEmoji(!showEmoji())}
                  title="Emoji"
                  disabled={!walletAddress()}
                >
                  😊
                </button>
                <Show when={showEmoji()}>
                  <EmojiPicker
                    onSelect={insertEmoji}
                    onClose={() => setShowEmoji(false)}
                  />
                </Show>
              </div>
              <button
                class="send-btn"
                onClick={handleSend}
                disabled={sending() || !messageInput().trim() || !walletAddress()}
              >
                {t('chat_send')}
              </button>
            </div>
          </div>
        </div>
      </Show>

      {/* User context menu for moderation */}
      <Show when={userMenu()}>
        <div
          class="user-context-menu"
          style={{ left: `${userMenu()!.x}px`, top: `${userMenu()!.y}px` }}
        >
          <button class="ctx-item" onClick={() => handleUserAction('profile')}>
            👤 {t('channel_view_profile')}
          </button>
          <button class="ctx-item" onClick={() => handleUserAction('pin')}>
            📌 {t('channel_pin_message')}
          </button>
          <Show when={isMod() && userMenu()!.address !== walletAddress()}>
            <div class="ctx-divider" />
            <button class="ctx-item ctx-warn" onClick={() => handleUserAction('mute')}>
              🔇 {t('channel_mute')}
            </button>
            <button class="ctx-item ctx-warn" onClick={() => handleUserAction('kick')}>
              ⚡ {t('channel_kick')}
            </button>
            <button class="ctx-item ctx-danger" onClick={() => handleUserAction('ban')}>
              ⛔ {t('channel_ban')}
            </button>
          </Show>
        </div>
      </Show>

      <style>{`
        .chat-view { display: flex; flex-direction: column; height: 100%; height: 100dvh; max-height: -webkit-fill-available; }
        .chat-messages { flex: 1; overflow-y: auto; padding: var(--spacing-md); display: flex; flex-direction: column; gap: var(--spacing-sm); }
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
        .message {
          padding: var(--spacing-sm) var(--spacing-md);
          border-radius: var(--radius-lg);
          max-width: 85%;
          align-self: flex-start;
          background: var(--color-bg-secondary);
          border: 1px solid var(--color-border);
        }
        .message.own {
          align-self: flex-end;
          background: color-mix(in srgb, var(--color-accent-primary) 35%, var(--color-bg-secondary));
          color: var(--color-text-primary);
          border-color: var(--color-accent-primary);
        }
        .message.own .message-author { color: var(--color-accent-primary); }
        .message.own .message-time { color: var(--color-text-secondary); }
        .message.own .reply-preview { background: rgba(0,0,0,0.15); border-left-color: var(--color-accent-primary); }
        .message-header { display: flex; gap: var(--spacing-sm); align-items: center; }
        .msg-avatar {
          width: 22px;
          height: 22px;
          border-radius: var(--radius-full);
          object-fit: cover;
          flex-shrink: 0;
        }
        .msg-avatar-placeholder {
          width: 22px;
          height: 22px;
          border-radius: var(--radius-full);
          background: var(--color-accent-secondary);
          color: var(--color-text-inverse);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 9px;
          font-weight: 700;
          flex-shrink: 0;
        }
        .message-author {
          font-weight: 600;
          font-size: var(--font-size-sm);
          color: var(--color-accent-primary);
          cursor: pointer;
        }
        .message-author:hover { text-decoration: underline; }
        .msg-verified {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 14px;
          height: 14px;
          border-radius: var(--radius-full);
          background: var(--color-accent-primary);
          color: var(--color-text-inverse);
          font-size: 9px;
          font-weight: 700;
          flex-shrink: 0;
        }
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

        .message-highlight { animation: msg-flash 1.5s ease-out; }
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
        .reply-indicator-author { font-size: var(--font-size-xs); font-weight: 700; color: var(--color-accent-primary); }
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

        .channel-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: var(--spacing-xs) var(--spacing-md);
          border-bottom: 1px solid var(--color-border);
          font-size: var(--font-size-sm);
          color: var(--color-text-secondary);
        }
        .pinned-info { display: flex; align-items: center; gap: var(--spacing-xs); }
        .pinned-icon { font-size: var(--font-size-md); }
        .pinned-count { color: var(--color-accent-primary); font-weight: 600; }
        .channel-settings-btn {
          font-size: var(--font-size-md);
          color: var(--color-text-secondary);
          cursor: pointer;
          padding: var(--spacing-xs);
          border-radius: var(--radius-sm);
        }
        .channel-settings-btn:hover { background: var(--color-bg-tertiary); color: var(--color-text-primary); }
        .user-context-menu {
          position: fixed;
          background: var(--color-bg-secondary);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-md);
          box-shadow: 0 2px 12px rgba(0,0,0,0.3);
          z-index: 100;
          padding: 4px;
          min-width: 170px;
        }
        .ctx-item {
          display: block;
          width: 100%;
          text-align: left;
          padding: var(--spacing-sm) var(--spacing-md);
          font-size: var(--font-size-sm);
          border-radius: var(--radius-sm);
          cursor: pointer;
          color: var(--color-text-primary);
        }
        .ctx-item:hover { background: var(--color-bg-tertiary); }
        .ctx-warn { color: var(--color-text-secondary); }
        .ctx-danger { color: #f44; }
        .ctx-danger:hover { background: rgba(255,68,68,0.1); }
        .ctx-divider { height: 1px; background: var(--color-border); margin: 4px 0; }

        .chat-input-area {
          border-top: 1px solid var(--color-border);
          padding: var(--spacing-sm) var(--spacing-md);
        }
        .chat-input {
          display: flex;
          gap: var(--spacing-sm);
          align-items: flex-end;
        }
        .chat-textarea {
          flex: 1;
          padding: var(--spacing-sm) var(--spacing-md);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-md);
          background: var(--color-bg-tertiary);
          color: var(--color-text-primary);
          font-family: inherit;
          font-size: var(--font-size-md);
          resize: none;
          line-height: 1.4;
        }
        .chat-textarea:focus { outline: none; border-color: var(--color-accent-primary); }
        .chat-textarea:disabled { opacity: 0.6; }
        .chat-input-actions {
          display: flex;
          flex-direction: column;
          gap: var(--spacing-xs);
          align-items: center;
        }
        .emoji-container { position: relative; }
        .emoji-toggle {
          font-size: var(--font-size-lg);
          padding: var(--spacing-xs);
          border-radius: var(--radius-sm);
          cursor: pointer;
        }
        .emoji-toggle:hover { background: var(--color-bg-tertiary); }
        .send-btn {
          padding: var(--spacing-sm) var(--spacing-lg);
          background: var(--color-accent-primary);
          color: var(--color-text-inverse);
          border-radius: var(--radius-md);
          font-weight: 600;
          font-size: var(--font-size-sm);
          white-space: nowrap;
        }
        .send-btn:hover { opacity: 0.9; }
        .send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      `}</style>
    </div>
  );
};

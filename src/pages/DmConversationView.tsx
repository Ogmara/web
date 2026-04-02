/**
 * DmConversationView — direct message conversation with a peer.
 */

import { Component, createResource, createSignal, For, Show, onCleanup, onMount } from 'solid-js';
import { t } from '../i18n/init';
import { getClient } from '../lib/api';
import { authStatus, walletAddress, getSigner } from '../lib/auth';
import { onWsEvent } from '../lib/ws';
import { navigate } from '../lib/router';
import { FormattedText } from '../components/FormattedText';
import { getPayloadContent } from '../lib/payload';
import { EmojiPicker } from '../components/EmojiPicker';
import { buildDirectMessage } from '@ogmara/sdk';

interface DmConversationProps {
  peerAddress: string;
}

export const DmConversationView: Component<DmConversationProps> = (props) => {
  const [messageInput, setMessageInput] = createSignal('');
  const [localMessages, setLocalMessages] = createSignal<any[]>([]);
  const [sending, setSending] = createSignal(false);
  const [showEmoji, setShowEmoji] = createSignal(false);
  let inputRef: HTMLTextAreaElement | undefined;

  const [messages] = createResource(
    () => props.peerAddress,
    async (address) => {
      if (!address) return [];
      try {
        const client = getClient();
        const resp = await client.getDmMessages(address);
        return resp.messages;
      } catch {
        return [];
      }
    },
  );

  const MAX_LOCAL_MESSAGES = 200;

  // Real-time DM updates
  const cleanup = onWsEvent((event) => {
    if (event.type === 'dm') {
      const msg = event.envelope;
      if (msg.author === props.peerAddress || msg.author === walletAddress()) {
        setLocalMessages((prev) => {
          const next = [...prev, msg];
          return next.length > MAX_LOCAL_MESSAGES ? next.slice(-MAX_LOCAL_MESSAGES) : next;
        });
      }
    }
  });
  onCleanup(cleanup);

  // Deduplicate by msg_id
  const allMessages = () => {
    const seen = new Set<string>();
    const combined = [...(messages() || []), ...localMessages()];
    return combined.filter((msg) => {
      if (!msg.msg_id || seen.has(msg.msg_id)) return false;
      seen.add(msg.msg_id);
      return true;
    });
  };

  // Mark conversation as read on mount
  onMount(async () => {
    if (authStatus() === 'ready' && props.peerAddress) {
      try {
        const client = getClient();
        await client.markDmRead(props.peerAddress);
      } catch {
        // Non-critical — ignore
      }
    }
  });

  const handleSend = async () => {
    const text = messageInput().trim();
    if (!text || sending()) return;

    const signer = getSigner();
    if (!signer || !walletAddress()) return;

    setSending(true);
    try {
      const client = getClient();
      const envelope = await buildDirectMessage(signer, {
        recipient: props.peerAddress,
        content: text,
      });
      await client.sendDm(props.peerAddress, envelope);
      setMessageInput('');

      // Optimistic: show sent message immediately
      setLocalMessages((prev) => [...prev, {
        msg_id: `local-${Date.now()}`,
        author: walletAddress(),
        timestamp: Date.now(),
        payload: text,
      }]);

      setTimeout(() => inputRef?.focus(), 50);
    } catch {
      // Send failed
    } finally {
      setSending(false);
    }
  };

  const insertEmoji = (emoji: string) => {
    if (!inputRef) return;
    const start = inputRef.selectionStart ?? messageInput().length;
    const end = inputRef.selectionEnd ?? start;
    const current = messageInput();
    setMessageInput(current.slice(0, start) + emoji + current.slice(end));
    setTimeout(() => {
      inputRef?.focus();
      const pos = start + emoji.length;
      inputRef?.setSelectionRange(pos, pos);
    }, 0);
  };

  const truncateAddress = (addr: string) =>
    `${addr.slice(0, 8)}...${addr.slice(-4)}`;

  return (
    <div class="dm-conv-view">
      <div class="dm-conv-header">
        <button class="dm-back-btn" onClick={() => navigate('/dm')}>
          ← {t('nav_dms')}
        </button>
        <span
          class="dm-conv-peer"
          onClick={() => navigate(`/user/${props.peerAddress}`)}
        >
          {truncateAddress(props.peerAddress)}
        </span>
      </div>

      <div class="dm-conv-messages">
        <Show
          when={allMessages().length > 0}
          fallback={<div class="dm-conv-empty">{t('dm_no_messages')}</div>}
        >
          <For each={allMessages()}>
            {(msg) => (
              <div
                class={`dm-msg ${msg.author === walletAddress() ? 'own' : 'peer'}`}
              >
                <div class="dm-msg-body">
                  <FormattedText content={getPayloadContent(msg.payload)} />
                </div>
                <span class="dm-msg-time">
                  {new Date(msg.timestamp).toLocaleTimeString(undefined, {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            )}
          </For>
        </Show>
      </div>

      <Show when={authStatus() === 'ready'}>
        <div class="dm-conv-input-area">
          <div class="dm-conv-input">
            <textarea
              ref={inputRef}
              class="dm-textarea"
              rows={3}
              placeholder={t('chat_placeholder')}
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
            <div class="dm-input-actions">
              <div class="dm-emoji-container">
                <button
                  class="dm-emoji-toggle"
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
                class="dm-send-btn"
                onClick={handleSend}
                disabled={sending() || !messageInput().trim() || !walletAddress()}
              >
                {t('chat_send')}
              </button>
            </div>
          </div>
        </div>
      </Show>

      <style>{`
        .dm-conv-view { display: flex; flex-direction: column; height: 100%; }
        .dm-conv-header {
          display: flex;
          align-items: center;
          gap: var(--spacing-md);
          padding: var(--spacing-sm) var(--spacing-md);
          border-bottom: 1px solid var(--color-border);
          background: var(--color-bg-secondary);
        }
        .dm-back-btn {
          font-size: var(--font-size-sm);
          color: var(--color-text-secondary);
          padding: var(--spacing-xs) var(--spacing-sm);
          border-radius: var(--radius-md);
        }
        .dm-back-btn:hover { background: var(--color-bg-tertiary); }
        .dm-conv-peer {
          font-weight: 600;
          color: var(--color-accent-primary);
          cursor: pointer;
          font-size: var(--font-size-sm);
        }
        .dm-conv-peer:hover { text-decoration: underline; }
        .dm-conv-messages {
          flex: 1;
          overflow-y: auto;
          padding: var(--spacing-md);
          display: flex;
          flex-direction: column;
          gap: var(--spacing-sm);
        }
        .dm-conv-empty {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
          color: var(--color-text-secondary);
        }
        .dm-msg {
          max-width: 70%;
          padding: var(--spacing-sm) var(--spacing-md);
          border-radius: var(--radius-lg);
        }
        .dm-msg.own {
          align-self: flex-end;
          background: color-mix(in srgb, var(--color-accent-primary) 35%, var(--color-bg-secondary));
          border: 1px solid var(--color-accent-primary);
        }
        .dm-msg.peer {
          align-self: flex-start;
          background: var(--color-bg-secondary);
          border: 1px solid var(--color-border);
        }
        .dm-msg-body { font-size: var(--font-size-md); line-height: 1.5; }
        .dm-msg-time {
          display: block;
          font-size: var(--font-size-xs);
          color: var(--color-text-secondary);
          text-align: right;
          margin-top: var(--spacing-xs);
        }
        .dm-conv-input-area {
          border-top: 1px solid var(--color-border);
          padding: var(--spacing-md);
        }
        .dm-conv-input {
          display: flex;
          flex-direction: column;
          gap: var(--spacing-sm);
        }
        .dm-textarea {
          width: 100%;
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
        .dm-textarea:focus { outline: none; border-color: var(--color-accent-primary); }
        .dm-input-actions {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .dm-emoji-container { position: relative; }
        .dm-emoji-toggle {
          font-size: var(--font-size-lg);
          padding: var(--spacing-xs);
          border-radius: var(--radius-sm);
          cursor: pointer;
        }
        .dm-emoji-toggle:hover { background: var(--color-bg-tertiary); }
        .dm-emoji-toggle:disabled { opacity: 0.4; cursor: default; }
        .dm-send-btn {
          padding: var(--spacing-sm) var(--spacing-lg);
          background: var(--color-accent-primary);
          color: var(--color-text-inverse);
          border-radius: var(--radius-md);
          font-weight: 600;
          font-size: var(--font-size-sm);
        }
        .dm-send-btn:disabled { opacity: 0.5; cursor: default; }
      `}</style>
    </div>
  );
};

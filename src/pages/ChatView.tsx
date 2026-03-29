import { Component, createResource, createSignal, For, Show } from 'solid-js';
import { t } from '../i18n/init';
import { getClient } from '../lib/api';

interface ChatViewProps {
  channelId: number | null;
}

export const ChatView: Component<ChatViewProps> = (props) => {
  const [messageInput, setMessageInput] = createSignal('');

  const [messages] = createResource(
    () => props.channelId,
    async (channelId) => {
      if (!channelId) return [];
      try {
        const client = getClient();
        const resp = await client.getChannelMessages(channelId, 50);
        return resp.messages;
      } catch {
        return [];
      }
    },
  );

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
        <div class="chat-messages">
          <Show
            when={messages() && messages()!.length > 0}
            fallback={<div class="chat-empty"><p>{t('chat_no_messages')}</p></div>}
          >
            <For each={messages()}>
              {(msg) => (
                <div class="message">
                  <div class="message-header">
                    <span class="message-author">
                      {msg.author.slice(0, 8)}...{msg.author.slice(-4)}
                    </span>
                    <span class="message-time">
                      {new Date(msg.timestamp).toLocaleTimeString(undefined, {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <div class="message-body">[message]</div>
                </div>
              )}
            </For>
          </Show>
        </div>

        <div class="chat-input">
          <input
            type="text"
            placeholder={t('chat_placeholder')}
            value={messageInput()}
            onInput={(e) => setMessageInput(e.currentTarget.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter' && messageInput().trim()) {
                // Send message via SDK
                setMessageInput('');
              }
            }}
          />
          <button class="send-btn" aria-label={t('chat_send')}>
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
        .message-author { font-weight: 600; font-size: var(--font-size-sm); color: var(--color-accent-primary); }
        .message-time { font-size: var(--font-size-xs); color: var(--color-text-secondary); }
        .message-body { margin-top: var(--spacing-xs); font-size: var(--font-size-md); line-height: 1.5; }
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
        .send-btn {
          padding: var(--spacing-sm) var(--spacing-lg);
          background: var(--color-accent-primary);
          color: var(--color-text-inverse);
          border-radius: var(--radius-md);
          font-weight: 600;
          font-size: var(--font-size-sm);
        }
        .send-btn:hover { opacity: 0.9; }
      `}</style>
    </div>
  );
};

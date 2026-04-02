/**
 * ComposeView — create a new news post.
 */

import { Component, createSignal, Show } from 'solid-js';
import { t } from '../i18n/init';
import { getClient } from '../lib/api';
import { authStatus, getSigner } from '../lib/auth';
import { navigate } from '../lib/router';
import { MediaUpload, type MediaAttachment } from '../components/MediaUpload';

export const ComposeView: Component = () => {
  const [title, setTitle] = createSignal('');
  const [content, setContent] = createSignal('');
  const [tags, setTags] = createSignal('');
  const [attachments, setAttachments] = createSignal<MediaAttachment[]>([]);
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal('');

  const handleSubmit = async () => {
    if (!content().trim()) return;
    if (!getSigner()) {
      setError(t('auth_required'));
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const tagList = tags()
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);

      const client = getClient();
      await client.postNews(title().trim(), content().trim(), {
        tags: tagList.length > 0 ? tagList : undefined,
        attachments: attachments().length > 0 ? attachments() : undefined,
      });
      navigate('/news');
    } catch (e: any) {
      setError(e.message || t('error_generic'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div class="compose-view">
      <div class="compose-header">
        <h2>{t('news_new_post')}</h2>
        <button class="compose-cancel" onClick={() => navigate('/news')}>
          {t('compose_cancel')}
        </button>
      </div>

      <Show when={authStatus() !== 'ready'}>
        <div class="compose-auth-prompt">{t('auth_connect_prompt')}</div>
      </Show>

      <Show when={error()}>
        <div class="compose-error">{error()}</div>
      </Show>

      <div class="compose-form">
        <input
          type="text"
          class="compose-input"
          placeholder={t('compose_title')}
          value={title()}
          onInput={(e) => setTitle(e.currentTarget.value)}
          maxLength={200}
        />
        <textarea
          class="compose-textarea"
          placeholder={t('compose_content')}
          value={content()}
          onInput={(e) => setContent(e.currentTarget.value)}
          rows={10}
          maxLength={10000}
        />
        <input
          type="text"
          class="compose-input"
          placeholder={t('compose_tags')}
          value={tags()}
          onInput={(e) => setTags(e.currentTarget.value)}
        />
        <MediaUpload
          attachments={attachments()}
          onAttach={(att) => setAttachments((prev) => [...prev, att])}
          onRemove={(i) => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}
          disabled={submitting()}
        />
        <button
          class="compose-submit"
          onClick={handleSubmit}
          disabled={submitting() || !content().trim() || authStatus() !== 'ready'}
        >
          {submitting() ? t('loading') : t('compose_submit')}
        </button>
      </div>

      <style>{`
        .compose-view {
          padding: var(--spacing-lg);
          overflow-y: auto;
          height: 100%;
          max-width: 700px;
        }
        .compose-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: var(--spacing-lg);
        }
        .compose-header h2 { font-size: var(--font-size-xl); }
        .compose-cancel {
          padding: var(--spacing-sm) var(--spacing-md);
          border-radius: var(--radius-md);
          font-size: var(--font-size-sm);
          color: var(--color-text-secondary);
        }
        .compose-cancel:hover { background: var(--color-bg-tertiary); }
        .compose-form { display: flex; flex-direction: column; gap: var(--spacing-md); }
        .compose-input, .compose-textarea {
          width: 100%;
          padding: var(--spacing-sm) var(--spacing-md);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-md);
          background: var(--color-bg-tertiary);
          color: var(--color-text-primary);
          font-family: inherit;
          font-size: var(--font-size-md);
        }
        .compose-textarea { resize: vertical; min-height: 200px; line-height: 1.6; }
        .compose-input:focus, .compose-textarea:focus { outline: none; border-color: var(--color-accent-primary); }
        .compose-submit {
          padding: var(--spacing-sm) var(--spacing-lg);
          background: var(--color-accent-primary);
          color: var(--color-text-inverse);
          border-radius: var(--radius-md);
          font-weight: 600;
          font-size: var(--font-size-md);
          align-self: flex-end;
        }
        .compose-submit:hover { opacity: 0.9; }
        .compose-submit:disabled { opacity: 0.5; cursor: not-allowed; }
        .compose-error {
          padding: var(--spacing-sm) var(--spacing-md);
          background: var(--color-error);
          color: white;
          border-radius: var(--radius-md);
          font-size: var(--font-size-sm);
          margin-bottom: var(--spacing-md);
        }
        .compose-auth-prompt {
          padding: var(--spacing-md);
          background: var(--color-bg-secondary);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-md);
          text-align: center;
          color: var(--color-text-secondary);
          margin-bottom: var(--spacing-md);
        }
      `}</style>
    </div>
  );
};

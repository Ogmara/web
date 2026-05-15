/**
 * ComposeView — create or edit a news post.
 *
 * Edit mode: navigate to /compose?edit=<msgId>
 */

import { Component, createSignal, Show, onMount } from 'solid-js';
import { t } from '../i18n/init';
import { getClient } from '../lib/api';
import { authStatus, getSigner, walletAddress, isRegistered } from '../lib/auth';
import { navigate, queryParam } from '../lib/router';
import { MediaUpload, type MediaAttachment } from '../components/MediaUpload';
import { EmojiPicker } from '../components/EmojiPicker';
import { getPayloadContent, getPayloadTitle, decodePayload } from '../lib/payload';

export const ComposeView: Component = () => {
  const editMsgId = () => queryParam('edit');
  const isEditMode = () => !!editMsgId();

  const [title, setTitle] = createSignal('');
  const [content, setContent] = createSignal('');
  const [tags, setTags] = createSignal('');
  const [attachments, setAttachments] = createSignal<MediaAttachment[]>([]);
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal('');
  // `loaded` stays false on fetch failure so the Save button stays disabled —
  // editing a post we couldn't load would otherwise overwrite the original
  // payload with empty title/tags/attachments.
  const [loaded, setLoaded] = createSignal(false);
  const [showEmoji, setShowEmoji] = createSignal(false);
  let contentRef: HTMLTextAreaElement | undefined;

  // In edit mode, fetch the existing post and pre-fill fields.
  //
  // Captures the active edit msg_id at the start of the fetch so that a
  // navigation away (Cancel, or routing to compose for a DIFFERENT post
  // via query param change) does not clobber the form with stale data.
  // If `editMsgId()` no longer matches, drop the response silently.
  onMount(async () => {
    const eid = editMsgId();
    if (!eid) { setLoaded(true); return; }
    const capturedId = eid;
    try {
      const client = getClient();
      const resp = await client.getNewsPost(eid);
      // Guard: user navigated away OR opened a different post during the
      // fetch. A stale response would otherwise overwrite whatever fresh
      // state the new view set up.
      if (editMsgId() !== capturedId) return;
      if (!resp?.post) {
        setError(t('error_generic'));
        return; // leave loaded() false → Save stays disabled
      }
      const post = resp.post;
      setTitle(getPayloadTitle(post.payload) || '');
      setContent(getPayloadContent(post.payload));
      try {
        const decoded = decodePayload(post.payload);
        if (decoded.tags) setTags(decoded.tags.join(', '));
        // Preload attachments so they're visible in the MediaUpload list —
        // and so the SDK can resend them in the edit envelope. Without
        // this, saving would drop every attachment because the L2 node now
        // treats an explicit `attachments: []` as a wholesale replace.
        if (decoded.attachments && decoded.attachments.length > 0) {
          setAttachments(
            decoded.attachments.map((a) => ({
              cid: a.cid,
              mime_type: a.mime_type,
              size_bytes: a.size_bytes,
              filename: a.filename,
              thumbnail_cid: a.thumbnail_cid,
            })),
          );
        }
      } catch { /* ignore tag decode errors — title/content already set */ }
      setLoaded(true);
    } catch {
      // Same nav-away guard — a thrown fetch for a post we're no longer
      // editing isn't actionable from the user's perspective.
      if (editMsgId() === capturedId) {
        setError(t('error_generic'));
      }
    }
  });

  const insertEmoji = (emoji: string) => {
    const ta = contentRef;
    if (!ta) {
      setContent((c) => c + emoji);
      setShowEmoji(false);
      return;
    }
    const start = ta.selectionStart ?? content().length;
    const end = ta.selectionEnd ?? content().length;
    const next = content().slice(0, start) + emoji + content().slice(end);
    setContent(next);
    // Move the caret past the inserted emoji on the next tick so the
    // textarea has caught up with the new value first.
    queueMicrotask(() => {
      try {
        ta.focus();
        const caret = start + emoji.length;
        ta.setSelectionRange(caret, caret);
      } catch { /* ignore — focus may have shifted */ }
    });
    setShowEmoji(false);
  };

  const handleSubmit = async () => {
    if (!content().trim()) return;
    if (!getSigner() || !walletAddress()) {
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

      if (isEditMode()) {
        // Edit existing post — must include attachments so the server's
        // wholesale-replace projection (L2 v0.37 onward) keeps them visible.
        await client.editNews(editMsgId()!, content().trim(), {
          title: title().trim() || undefined,
          tags: tagList.length > 0 ? tagList : undefined,
          attachments: attachments(),
        });
        navigate(`/news/${editMsgId()}`);
      } else {
        // Create new post
        await client.postNews(title().trim(), content().trim(), {
          tags: tagList.length > 0 ? tagList : undefined,
          attachments: attachments().length > 0 ? attachments() : undefined,
        });
        navigate('/news');
      }
    } catch (e: any) {
      setError(e.message || t('error_generic'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div class="compose-view">
      <div class="compose-header">
        <h2>{isEditMode() ? t('news_edit') : t('news_new_post')}</h2>
        <button class="compose-cancel" onClick={() => isEditMode() ? navigate(`/news/${editMsgId()}`) : navigate('/news')}>
          {t('compose_cancel')}
        </button>
      </div>

      <Show when={authStatus() !== 'ready'}>
        <div class="compose-auth-prompt">{t('auth_connect_prompt')}</div>
      </Show>

      <Show when={isEditMode() && authStatus() === 'ready' && !isRegistered()}>
        <div class="compose-auth-prompt">
          <p>{t('verification_required')}</p>
          <button onClick={() => navigate('/wallet')}>{t('verification_go_to_wallet')}</button>
        </div>
      </Show>

      <Show when={error()}>
        <div class="compose-error">{error()}</div>
      </Show>

      <Show when={!isEditMode() || isRegistered()}>
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
          ref={contentRef}
          class="compose-textarea"
          placeholder={t('compose_content')}
          value={content()}
          onInput={(e) => setContent(e.currentTarget.value)}
          rows={10}
          maxLength={10000}
        />
        <div class="compose-emoji-row">
          <button
            type="button"
            class="compose-emoji-toggle"
            onClick={() => setShowEmoji(!showEmoji())}
            title={t('emoji_picker') || 'Emoji'}
          >
            😊
          </button>
          <Show when={showEmoji()}>
            <EmojiPicker onSelect={insertEmoji} onClose={() => setShowEmoji(false)} />
          </Show>
        </div>
        <input
          type="text"
          class="compose-input"
          placeholder={t('compose_tags')}
          value={tags()}
          onInput={(e) => setTags(e.currentTarget.value)}
        />
        {/* MediaUpload visible in both new + edit mode. In edit mode the
            existing attachments are preloaded above and `attachments()` is
            sent verbatim to `editNews` so the L2 node's wholesale-replace
            projection keeps them visible (see L2 v0.37 release notes). */}
        <MediaUpload
          attachments={attachments()}
          onAttach={(att) => setAttachments((prev) => [...prev, att])}
          onRemove={(i) => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}
          disabled={submitting()}
        />
        <button
          class="compose-submit"
          onClick={handleSubmit}
          disabled={
            submitting() ||
            !content().trim() ||
            authStatus() !== 'ready' ||
            (isEditMode() && !isRegistered()) ||
            (isEditMode() && !loaded())
          }
        >
          {submitting() ? t('loading') : isEditMode() ? t('news_save_edit') : t('compose_submit')}
        </button>
      </div>
      </Show>

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
        .compose-emoji-row { position: relative; }
        .compose-emoji-toggle {
          padding: 4px 8px;
          font-size: var(--font-size-md);
          border-radius: var(--radius-sm);
          background: transparent;
          border: 1px solid var(--color-border);
          color: var(--color-text-secondary);
          cursor: pointer;
        }
        .compose-emoji-toggle:hover { background: var(--color-bg-tertiary); }
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

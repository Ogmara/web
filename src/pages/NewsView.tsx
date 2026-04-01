/**
 * NewsView — news feed with reactions, bookmarks, reposts (auth-gated).
 */

import { Component, createResource, createSignal, createEffect, For, Show } from 'solid-js';
import { t } from '../i18n/init';
import { getClient } from '../lib/api';
import { authStatus, getSigner, l2Address, walletAddress } from '../lib/auth';
import { navigate } from '../lib/router';
import { FormattedText } from '../components/FormattedText';
import { getPayloadContent, getPayloadTitle, decodePayload } from '../lib/payload';
import { sendTip, kleverAvailable, getExplorerUrl } from '../lib/klever';
import { resolveProfile } from '../lib/profile';
import { ensureHexMsgId, formatLocalTime, NEWS_REACTIONS, truncateAddress } from '../lib/news-utils';

export const NewsView: Component = () => {
  const [news] = createResource(async () => {
    try {
      const client = getClient();
      const resp = await client.listNews(1, 20);
      return resp.posts;
    } catch {
      return [];
    }
  });

  const handleNewPost = () => {
    if (authStatus() !== 'ready') {
      navigate('/wallet');
      return;
    }
    navigate('/compose');
  };

  return (
    <div class="news-view">
      <div class="news-header">
        <h2>{t('news_title')}</h2>
        <button class="new-post-btn" onClick={handleNewPost}>{t('news_new_post')}</button>
      </div>
      <div class="news-feed">
        <Show
          when={news() && news()!.length > 0}
          fallback={<div class="news-empty">{t('news_no_posts')}</div>}
        >
          <For each={news()}>
            {(post) => <NewsCard post={post} />}
          </For>
        </Show>
      </div>

      <style>{`
        .news-view { padding: var(--spacing-md); overflow-y: auto; height: 100%; }
        .news-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--spacing-lg); }
        .news-header h2 { font-size: var(--font-size-xl); }
        .new-post-btn {
          padding: var(--spacing-sm) var(--spacing-lg);
          background: var(--color-accent-primary);
          color: var(--color-text-inverse);
          border-radius: var(--radius-md);
          font-weight: 600;
        }
        .news-feed { display: flex; flex-direction: column; gap: var(--spacing-md); }
        .news-card {
          background: var(--color-bg-secondary);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-lg);
          padding: var(--spacing-lg);
        }
        .news-card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--spacing-sm); }
        .news-author-row {
          display: flex;
          align-items: center;
          gap: var(--spacing-sm);
          cursor: pointer;
        }
        .news-author-row:hover .news-author { text-decoration: underline; }
        .news-avatar {
          width: 28px;
          height: 28px;
          border-radius: var(--radius-full);
          object-fit: cover;
        }
        .news-avatar-placeholder {
          width: 28px;
          height: 28px;
          border-radius: var(--radius-full);
          background: var(--color-accent-secondary);
          color: var(--color-text-inverse);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: 700;
          flex-shrink: 0;
        }
        .news-author {
          font-weight: 600;
          color: var(--color-accent-primary);
          font-size: var(--font-size-sm);
        }
        .news-verified {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 16px;
          height: 16px;
          border-radius: var(--radius-full);
          background: var(--color-accent-primary);
          color: var(--color-text-inverse);
          font-size: 10px;
          font-weight: 700;
          flex-shrink: 0;
        }
        .news-time { font-size: var(--font-size-xs); color: var(--color-text-secondary); }
        .news-tags {
          display: flex;
          flex-wrap: wrap;
          gap: var(--spacing-xs);
          margin-bottom: var(--spacing-sm);
        }
        .news-tag {
          font-size: var(--font-size-xs);
          color: var(--color-accent-primary);
          background: var(--color-bg-tertiary);
          padding: 2px 8px;
          border-radius: var(--radius-full);
          cursor: pointer;
        }
        .news-tag:hover { background: var(--color-accent-primary); color: var(--color-text-inverse); }
        .news-action-error {
          font-size: var(--font-size-sm);
          color: var(--color-error);
          background: var(--color-bg-tertiary);
          padding: var(--spacing-sm) var(--spacing-md);
          border-radius: var(--radius-sm);
          border-left: 3px solid var(--color-error);
        }
        .news-title { cursor: pointer; }
        .news-title:hover { color: var(--color-accent-primary); }
        .news-card-body { line-height: 1.6; margin-bottom: var(--spacing-md); }
        .news-empty { text-align: center; color: var(--color-text-secondary); padding: var(--spacing-xl); }

        .news-actions {
          display: flex;
          gap: var(--spacing-sm);
          align-items: center;
          border-top: 1px solid var(--color-border);
          padding-top: var(--spacing-sm);
          flex-wrap: wrap;
        }
        .reaction-btn {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 4px 8px;
          border-radius: var(--radius-sm);
          font-size: var(--font-size-sm);
          background: var(--color-bg-tertiary);
          cursor: pointer;
          transition: background 0.15s;
        }
        .reaction-btn:hover { background: var(--color-accent-primary); color: var(--color-text-inverse); }
        .reaction-btn.active { background: var(--color-accent-primary); color: var(--color-text-inverse); }
        .reaction-count { font-size: var(--font-size-xs); font-weight: 600; }
        .action-btn {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 4px 8px;
          border-radius: var(--radius-sm);
          font-size: var(--font-size-sm);
          color: var(--color-text-secondary);
          cursor: pointer;
          margin-left: auto;
        }
        .action-btn:hover { color: var(--color-accent-primary); }
        .action-btn.bookmarked { color: var(--color-accent-primary); }
        .action-btn.has-comments { color: var(--color-accent-primary); }
        .tip-btn {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 4px 8px;
          border-radius: var(--radius-sm);
          font-size: var(--font-size-sm);
          color: var(--color-warning);
          cursor: pointer;
        }
        .tip-btn:hover { color: var(--color-accent-primary); }
        .tip-dialog {
          margin-top: var(--spacing-sm);
          padding: var(--spacing-md);
          background: var(--color-bg-tertiary);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-md);
        }
        .tip-dialog-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: var(--spacing-sm);
          font-size: var(--font-size-sm);
        }
        .tip-dialog-close {
          color: var(--color-text-secondary);
          font-size: var(--font-size-md);
          cursor: pointer;
        }
        .tip-dialog-close:hover { color: var(--color-text-primary); }
        .tip-dialog-body { display: flex; flex-direction: column; gap: var(--spacing-xs); }
        .tip-label { font-size: var(--font-size-xs); color: var(--color-text-secondary); }
        .tip-input {
          padding: var(--spacing-xs) var(--spacing-sm);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-sm);
          background: var(--color-bg-secondary);
          color: var(--color-text-primary);
          font-family: inherit;
          font-size: var(--font-size-sm);
        }
        .tip-input:focus { outline: none; border-color: var(--color-accent-primary); }
        .tip-confirm-btn {
          margin-top: var(--spacing-xs);
          padding: var(--spacing-sm);
          background: var(--color-warning);
          color: #1a1a1a;
          border-radius: var(--radius-md);
          font-weight: 600;
          font-size: var(--font-size-sm);
          cursor: pointer;
        }
        .tip-confirm-btn:hover { opacity: 0.9; }
        .tip-confirm-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .tip-success {
          padding: var(--spacing-sm);
          background: var(--color-accent-primary);
          color: var(--color-text-inverse);
          border-radius: var(--radius-md);
          font-size: var(--font-size-sm);
          font-weight: 600;
          text-align: center;
        }
        .tip-tx-link { color: var(--color-text-inverse); text-decoration: underline; }
      `}</style>
    </div>
  );
};


/** Individual news card with reactions, repost, bookmark, tip. */
const NewsCard: Component<{ post: any }> = (props) => {
  const [reactionCounts, setReactionCounts] = createSignal<Record<string, number>>(
    props.post.reaction_counts ?? {},
  );
  const [bookmarked, setBookmarked] = createSignal(false);
  const [reposted, setReposted] = createSignal(false);
  const [actionError, setActionError] = createSignal('');
  const [profile, setProfile] = createSignal<{ display_name?: string; avatar_cid?: string; verified?: boolean }>({});
  const [showTip, setShowTip] = createSignal(false);
  const [tipAmount, setTipAmount] = createSignal('1');
  const [tipNote, setTipNote] = createSignal('');
  const [tipPending, setTipPending] = createSignal(false);
  const [tipTxHash, setTipTxHash] = createSignal('');

  // Resolve author profile (username + avatar)
  createEffect(() => {
    resolveProfile(props.post.author).then(setProfile);
  });

  const requireAuthOrRedirect = (): boolean => {
    if (!getSigner()) {
      navigate('/wallet');
      return false;
    }
    return true;
  };

  const handleReaction = async (emoji: string) => {
    if (!requireAuthOrRedirect()) return;
    setActionError('');
    try {
      const client = getClient();
      const current = reactionCounts()[emoji] ?? 0;
      await client.reactToNews(ensureHexMsgId(props.post.msg_id), emoji);
      setReactionCounts((prev) => ({ ...prev, [emoji]: current + 1 }));
    } catch (e: any) {
      setActionError(e?.message || 'Reaction failed');
    }
  };

  const handleBookmark = async () => {
    if (!requireAuthOrRedirect()) return;
    setActionError('');
    try {
      const client = getClient();
      if (bookmarked()) {
        await client.removeBookmark(ensureHexMsgId(props.post.msg_id));
        setBookmarked(false);
      } else {
        await client.saveBookmark(ensureHexMsgId(props.post.msg_id));
        setBookmarked(true);
      }
    } catch (e: any) {
      setActionError(e?.message || 'Bookmark failed');
    }
  };

  const handleRepost = async () => {
    if (!requireAuthOrRedirect()) return;
    if (reposted()) return;
    // Prevent self-repost (the L2 node also rejects it, but give clear feedback)
    const author = props.post.author;
    if (author === l2Address() || author === walletAddress()) {
      setActionError(t('news_repost_own'));
      return;
    }
    setActionError('');
    try {
      const client = getClient();
      await client.repostNews(ensureHexMsgId(props.post.msg_id), author);
      setReposted(true);
    } catch (e: any) {
      setActionError(e?.message || 'Repost failed');
    }
  };

  const handleTip = async () => {
    if (!requireAuthOrRedirect()) return;
    if (!kleverAvailable()) {
      setActionError('Klever Extension required for tipping');
      return;
    }
    const amount = parseFloat(tipAmount());
    if (isNaN(amount) || amount <= 0) {
      setActionError('Enter a valid tip amount');
      return;
    }
    setActionError('');
    setTipTxHash('');
    setTipPending(true);
    try {
      const msgId = ensureHexMsgId(props.post.msg_id);
      const txHash = await sendTip(props.post.author, msgId, 0, tipNote(), amount);
      setTipTxHash(txHash);
      setTipAmount('1');
      setTipNote('');
    } catch (e: any) {
      setActionError(e?.message || 'Tip failed');
    } finally {
      setTipPending(false);
    }
  };

  const displayName = () => profile().display_name || truncateAddress(props.post.author);

  // Extract tags from decoded payload
  const postTags = () => {
    if (typeof props.post.payload === 'string') return [];
    try {
      return decodePayload(props.post.payload).tags ?? [];
    } catch {
      return [];
    }
  };

  return (
    <article class="news-card">
      <div class="news-card-header">
        <div class="news-author-row" onClick={() => navigate(`/user/${props.post.author}`)}>
          <Show when={profile().avatar_cid}>
            <img
              class="news-avatar"
              src={getClient().getMediaUrl(profile().avatar_cid!)}
              alt=""
              loading="lazy"
            />
          </Show>
          <Show when={!profile().avatar_cid}>
            <span class="news-avatar-placeholder">
              {(profile().display_name || props.post.author).slice(0, 2).toUpperCase()}
            </span>
          </Show>
          <span class="news-author">{displayName()}</span>
          <Show when={profile().verified}>
            <span class="news-verified" title="On-chain verified">✓</span>
          </Show>
        </div>
        <span class="news-time">{formatLocalTime(props.post.timestamp)}</span>
      </div>
      <Show when={getPayloadTitle(props.post.payload)}>
        <h3 class="news-title" onClick={() => navigate(`/news/${ensureHexMsgId(props.post.msg_id)}`)}>
          {getPayloadTitle(props.post.payload)}
        </h3>
      </Show>
      <div class="news-card-body"><FormattedText content={getPayloadContent(props.post.payload)} /></div>
      <Show when={postTags().length > 0}>
        <div class="news-tags">
          <For each={postTags()}>
            {(tag) => (
              <button class="news-tag" onClick={() => navigate(`/search?q=${encodeURIComponent('#' + tag)}`)}>
                #{tag}
              </button>
            )}
          </For>
        </div>
      </Show>
      <Show when={actionError()}>
        <div class="news-action-error">{actionError()}</div>
      </Show>
      <div class="news-actions">
        <For each={NEWS_REACTIONS}>
          {(r) => (
            <button
              class={`reaction-btn ${(reactionCounts()[r.emoji] ?? 0) > 0 ? 'active' : ''}`}
              onClick={() => handleReaction(r.emoji)}
              title={r.label}
            >
              {r.emoji}
              <Show when={(reactionCounts()[r.emoji] ?? 0) > 0}>
                <span class="reaction-count">{reactionCounts()[r.emoji]}</span>
              </Show>
            </button>
          )}
        </For>
        <button
          class={`action-btn ${reposted() ? 'bookmarked' : ''}`}
          onClick={handleRepost}
          title={t('news_repost')}
        >
          ↗ {t('news_repost')}
        </button>
        <button
          class={`action-btn ${bookmarked() ? 'bookmarked' : ''}`}
          onClick={handleBookmark}
          title={bookmarked() ? t('news_bookmarked') : t('news_bookmark')}
        >
          {bookmarked() ? '★' : '☆'} {bookmarked() ? t('news_bookmarked') : t('news_bookmark')}
        </button>
        <button
          class={`action-btn ${(props.post.comment_count ?? 0) > 0 ? 'has-comments' : ''}`}
          onClick={() => navigate(`/news/${ensureHexMsgId(props.post.msg_id)}`)}
          title={t('news_comments')}
        >
          💬 {t('news_comments')}
          <Show when={(props.post.comment_count ?? 0) > 0}>
            <span class="reaction-count">{props.post.comment_count}</span>
          </Show>
        </button>
        <button
          class="tip-btn"
          onClick={() => {
            if (!requireAuthOrRedirect()) return;
            setShowTip(!showTip());
          }}
          title={t('chat_tip')}
        >
          💰 {t('chat_tip')}
        </button>
      </div>
      <Show when={showTip()}>
        <div class="tip-dialog">
          <div class="tip-dialog-header">
            <strong>Tip {displayName()}</strong>
            <button class="tip-dialog-close" onClick={() => setShowTip(false)}>✕</button>
          </div>
          <div class="tip-dialog-body">
            <label class="tip-label">Amount (KLV)</label>
            <input
              type="number"
              class="tip-input"
              min="0.1"
              step="0.1"
              value={tipAmount()}
              onInput={(e) => setTipAmount(e.currentTarget.value)}
            />
            <label class="tip-label">Note (optional)</label>
            <input
              type="text"
              class="tip-input"
              maxLength={128}
              placeholder="Say thanks..."
              value={tipNote()}
              onInput={(e) => setTipNote(e.currentTarget.value)}
            />
            <Show when={!tipTxHash()}>
              <button
                class="tip-confirm-btn"
                onClick={handleTip}
                disabled={tipPending()}
              >
                {tipPending() ? 'Sending...' : `Send ${tipAmount()} KLV`}
              </button>
            </Show>
            <Show when={tipTxHash()}>
              <div class="tip-success">
                Tip sent!{' '}
                <a
                  href={`${getExplorerUrl()}/transaction/${tipTxHash()}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="tip-tx-link"
                >
                  {tipTxHash().slice(0, 12)}...
                </a>
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </article>
  );
};

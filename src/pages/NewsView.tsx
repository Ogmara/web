/**
 * NewsView — news feed with reactions, bookmarks, reposts (auth-gated).
 */

import { Component, createResource, createSignal, For, Show } from 'solid-js';
import { t } from '../i18n/init';
import { getClient } from '../lib/api';
import { authStatus, getSigner } from '../lib/auth';
import { navigate } from '../lib/router';
import { FormattedText } from '../components/FormattedText';
import { getPayloadContent, getPayloadTitle } from '../lib/payload';

/** Predefined reaction emojis for news posts. */
const NEWS_REACTIONS = [
  { emoji: '👍', label: 'Like' },
  { emoji: '👎', label: 'Dislike' },
  { emoji: '❤️', label: 'Love' },
  { emoji: '🔥', label: 'Fire' },
  { emoji: '😂', label: 'Funny' },
];

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
        .news-card-header { display: flex; justify-content: space-between; margin-bottom: var(--spacing-sm); }
        .news-author {
          font-weight: 600;
          color: var(--color-accent-primary);
          font-size: var(--font-size-sm);
          cursor: pointer;
        }
        .news-author:hover { text-decoration: underline; }
        .news-time { font-size: var(--font-size-xs); color: var(--color-text-secondary); }
        .news-card-body { line-height: 1.6; margin-bottom: var(--spacing-md); }
        .news-empty { text-align: center; color: var(--color-text-secondary); padding: var(--spacing-xl); }

        .news-actions {
          display: flex;
          gap: var(--spacing-sm);
          align-items: center;
          border-top: 1px solid var(--color-border);
          padding-top: var(--spacing-sm);
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
      `}</style>
    </div>
  );
};

/** Individual news card with reactions, repost, bookmark, tip. */
const NewsCard: Component<{ post: any }> = (props) => {
  const [reactionCounts, setReactionCounts] = createSignal<Record<string, number>>({});
  const [bookmarked, setBookmarked] = createSignal(false);
  const [reposted, setReposted] = createSignal(false);

  const requireAuthOrRedirect = (): boolean => {
    if (!getSigner()) {
      navigate('/wallet');
      return false;
    }
    return true;
  };

  const handleReaction = async (emoji: string) => {
    if (!requireAuthOrRedirect()) return;
    try {
      const client = getClient();
      const current = reactionCounts()[emoji] ?? 0;
      await client.reactToNews(props.post.msg_id, emoji);
      setReactionCounts((prev) => ({ ...prev, [emoji]: current + 1 }));
    } catch {
      // reaction failed silently
    }
  };

  const handleBookmark = async () => {
    if (!requireAuthOrRedirect()) return;
    try {
      const client = getClient();
      if (bookmarked()) {
        await client.removeBookmark(props.post.msg_id);
        setBookmarked(false);
      } else {
        await client.saveBookmark(props.post.msg_id);
        setBookmarked(true);
      }
    } catch {
      // bookmark failed silently
    }
  };

  const handleRepost = async () => {
    if (!requireAuthOrRedirect()) return;
    if (reposted()) return;
    try {
      const client = getClient();
      await client.repostNews(props.post.msg_id, props.post.author);
      setReposted(true);
    } catch {
      // repost failed silently
    }
  };

  const truncateAddress = (addr: string) =>
    `${addr.slice(0, 8)}...${addr.slice(-4)}`;

  return (
    <article class="news-card">
      <div class="news-card-header">
        <span
          class="news-author"
          onClick={() => navigate(`/user/${props.post.author}`)}
        >
          {truncateAddress(props.post.author)}
        </span>
        <span class="news-time">
          {new Date(props.post.timestamp).toLocaleDateString()}
        </span>
      </div>
      <Show when={getPayloadTitle(props.post.payload)}>
        <h3 class="news-title">{getPayloadTitle(props.post.payload)}</h3>
      </Show>
      <div class="news-card-body"><FormattedText content={getPayloadContent(props.post.payload)} /></div>
      <div class="news-actions">
        <For each={NEWS_REACTIONS}>
          {(r) => (
            <button
              class="reaction-btn"
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
          class="tip-btn"
          onClick={() => navigate('/wallet')}
          title={t('chat_tip')}
        >
          💰 {t('chat_tip')}
        </button>
      </div>
    </article>
  );
};

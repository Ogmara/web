import { Component, createResource, For, Show } from 'solid-js';
import { t } from '../i18n/init';
import { getClient } from '../lib/api';

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

  return (
    <div class="news-view">
      <div class="news-header">
        <h2>{t('news_title')}</h2>
        <button class="new-post-btn">{t('news_new_post')}</button>
      </div>
      <div class="news-feed">
        <Show
          when={news() && news()!.length > 0}
          fallback={<div class="news-empty">{t('news_no_posts')}</div>}
        >
          <For each={news()}>
            {(post) => (
              <article class="news-card">
                <div class="news-card-header">
                  <span class="news-author">
                    {post.author.slice(0, 8)}...{post.author.slice(-4)}
                  </span>
                  <span class="news-time">
                    {new Date(post.timestamp).toLocaleDateString()}
                  </span>
                </div>
                <div class="news-card-body">[post content]</div>
              </article>
            )}
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
        .news-author { font-weight: 600; color: var(--color-accent-primary); font-size: var(--font-size-sm); }
        .news-time { font-size: var(--font-size-xs); color: var(--color-text-secondary); }
        .news-card-body { line-height: 1.6; }
        .news-empty { text-align: center; color: var(--color-text-secondary); padding: var(--spacing-xl); }
      `}</style>
    </div>
  );
};

import { Component, createResource, For, Show } from 'solid-js';
import { t } from '../i18n/init';
import { getClient } from '../lib/api';

export const BookmarksView: Component = () => {
  const [bookmarks] = createResource(async () => {
    try {
      const client = getClient();
      const resp = await client.listBookmarks({ page: 1, limit: 50 });
      return resp.bookmarks;
    } catch {
      return [];
    }
  });

  return (
    <div class="bookmarks-view">
      <div class="bookmarks-header">
        <h2>{t('bookmarks_title')}</h2>
      </div>
      <div class="bookmarks-list">
        <Show
          when={bookmarks() && bookmarks()!.length > 0}
          fallback={<div class="bookmarks-empty">{t('bookmarks_empty')}</div>}
        >
          <For each={bookmarks()}>
            {(post) => (
              <article class="bookmark-card">
                <div class="bookmark-header">
                  <span class="bookmark-author">
                    {post.author.slice(0, 8)}...{post.author.slice(-4)}
                  </span>
                  <span class="bookmark-time">
                    {new Date(post.timestamp).toLocaleDateString()}
                  </span>
                </div>
                <div class="bookmark-body">[saved post content]</div>
              </article>
            )}
          </For>
        </Show>
      </div>

      <style>{`
        .bookmarks-view { padding: var(--spacing-md); overflow-y: auto; height: 100%; }
        .bookmarks-header { margin-bottom: var(--spacing-lg); }
        .bookmarks-header h2 { font-size: var(--font-size-xl); }
        .bookmarks-list { display: flex; flex-direction: column; gap: var(--spacing-md); }
        .bookmark-card {
          background: var(--color-bg-secondary);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-lg);
          padding: var(--spacing-lg);
        }
        .bookmark-header { display: flex; justify-content: space-between; margin-bottom: var(--spacing-sm); }
        .bookmark-author { font-weight: 600; color: var(--color-accent-primary); font-size: var(--font-size-sm); }
        .bookmark-time { font-size: var(--font-size-xs); color: var(--color-text-secondary); }
        .bookmark-body { line-height: 1.6; }
        .bookmarks-empty { text-align: center; color: var(--color-text-secondary); padding: var(--spacing-xl); }
      `}</style>
    </div>
  );
};

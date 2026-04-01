/**
 * SearchView — search posts by tag, channels by name, users by address.
 */

import { Component, createSignal, For, Show } from 'solid-js';
import { t } from '../i18n/init';
import { getClient } from '../lib/api';
import { navigate, queryParam } from '../lib/router';
import { FormattedText } from '../components/FormattedText';
import { getPayloadContent, getPayloadTitle } from '../lib/payload';

export const SearchView: Component = () => {
  const [query, setQuery] = createSignal(queryParam('q') || '');
  const [results, setResults] = createSignal<{ posts: any[]; channels: any[] }>({ posts: [], channels: [] });
  const [searching, setSearching] = createSignal(false);
  const [hasSearched, setHasSearched] = createSignal(false);

  const handleSearch = async () => {
    const q = query().trim();
    if (!q) return;

    // If it looks like a klv1 address, navigate to user profile
    if (q.startsWith('klv1') && q.length > 20) {
      navigate(`/user/${q}`);
      return;
    }

    setSearching(true);
    setHasSearched(true);

    try {
      const client = getClient();

      // If query starts with #, strip it and use as tag filter on server side
      const isHashtag = q.startsWith('#');
      const tagQuery = isHashtag ? q.slice(1) : undefined;

      // Fetch more posts for client-side filtering when doing text search
      const fetchLimit = isHashtag ? 20 : 100;
      const [newsResp, channelsResp] = await Promise.all([
        client.listNews(1, fetchLimit, tagQuery).catch(() => ({ posts: [] })),
        client.listChannels(1, 50).catch(() => ({ channels: [] })),
      ]);

      let posts = newsResp.posts || [];

      // Client-side text filtering when not a hashtag search
      if (!isHashtag && posts.length > 0) {
        const lq = q.toLowerCase();
        posts = posts.filter((post: any) => {
          const content = getPayloadContent(post.payload).toLowerCase();
          const title = (getPayloadTitle(post.payload) || '').toLowerCase();
          const author = (post.author || '').toLowerCase();
          return content.includes(lq) || title.includes(lq) || author.includes(lq);
        });
      }

      // Filter channels by slug/name match
      const lq = q.replace(/^#/, '').toLowerCase();
      const matchedChannels = (channelsResp.channels || []).filter((ch: any) => {
        return (
          ch.slug?.toLowerCase().includes(lq) ||
          ch.display_name?.toLowerCase().includes(lq)
        );
      });

      setResults({ posts, channels: matchedChannels });
    } catch {
      setResults({ posts: [], channels: [] });
    } finally {
      setSearching(false);
    }
  };

  const truncateAddress = (addr: string) =>
    `${addr.slice(0, 8)}...${addr.slice(-4)}`;

  return (
    <div class="search-view">
      <h2>{t('search_title')}</h2>

      <div class="search-bar">
        <input
          type="text"
          class="search-input"
          placeholder={t('search_placeholder')}
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
        />
        <button class="search-btn" onClick={handleSearch} disabled={searching()}>
          {searching() ? t('loading') : t('nav_search')}
        </button>
      </div>

      <Show when={hasSearched()}>
        {/* Channel results */}
        <Show when={results().channels.length > 0}>
          <section class="search-section">
            <h3>{t('search_channels')}</h3>
            <For each={results().channels}>
              {(ch) => (
                <button class="search-channel" onClick={() => navigate(`/chat/${ch.channel_id}`)}>
                  <span class="channel-hash">#</span>
                  <span class="channel-name">{ch.display_name || ch.slug}</span>
                  <Show when={ch.description}>
                    <span class="channel-desc">{ch.description}</span>
                  </Show>
                </button>
              )}
            </For>
          </section>
        </Show>

        {/* Post results */}
        <Show when={results().posts.length > 0}>
          <section class="search-section">
            <h3>{t('search_posts')}</h3>
            <For each={results().posts}>
              {(post) => (
                <article class="search-post">
                  <div class="search-post-header">
                    <span
                      class="search-post-author"
                      onClick={() => navigate(`/user/${post.author}`)}
                    >
                      {truncateAddress(post.author)}
                    </span>
                    <span class="search-post-time">
                      {new Date(post.timestamp).toLocaleString(undefined, {
                        month: 'short', day: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <div class="search-post-body">
                    <FormattedText content={getPayloadContent(post.payload)} />
                  </div>
                </article>
              )}
            </For>
          </section>
        </Show>

        <Show when={results().posts.length === 0 && results().channels.length === 0 && !searching()}>
          <div class="search-empty">{t('search_no_results')}</div>
        </Show>
      </Show>

      <style>{`
        .search-view { padding: var(--spacing-lg); overflow-y: auto; height: 100%; max-width: 700px; }
        .search-view h2 { font-size: var(--font-size-xl); margin-bottom: var(--spacing-lg); }
        .search-bar {
          display: flex;
          gap: var(--spacing-sm);
          margin-bottom: var(--spacing-lg);
        }
        .search-input {
          flex: 1;
          padding: var(--spacing-sm) var(--spacing-md);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-md);
          background: var(--color-bg-tertiary);
          color: var(--color-text-primary);
          font-family: inherit;
          font-size: var(--font-size-md);
        }
        .search-input:focus { outline: none; border-color: var(--color-accent-primary); }
        .search-btn {
          padding: var(--spacing-sm) var(--spacing-lg);
          background: var(--color-accent-primary);
          color: var(--color-text-inverse);
          border-radius: var(--radius-md);
          font-weight: 600;
          font-size: var(--font-size-sm);
        }
        .search-btn:disabled { opacity: 0.5; }
        .search-section { margin-bottom: var(--spacing-lg); }
        .search-section h3 {
          font-size: var(--font-size-sm);
          color: var(--color-text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: var(--spacing-sm);
        }
        .search-channel {
          display: flex;
          align-items: center;
          gap: var(--spacing-sm);
          padding: var(--spacing-sm) var(--spacing-md);
          border-radius: var(--radius-md);
          width: 100%;
          text-align: left;
          margin-bottom: var(--spacing-xs);
        }
        .search-channel:hover { background: var(--color-bg-secondary); }
        .search-channel .channel-hash { opacity: 0.5; font-weight: 700; }
        .search-channel .channel-name { font-weight: 600; }
        .search-channel .channel-desc { font-size: var(--font-size-xs); color: var(--color-text-secondary); margin-left: auto; }
        .search-post {
          background: var(--color-bg-secondary);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-lg);
          padding: var(--spacing-md);
          margin-bottom: var(--spacing-sm);
        }
        .search-post-header { display: flex; justify-content: space-between; margin-bottom: var(--spacing-xs); }
        .search-post-author {
          font-weight: 600;
          color: var(--color-accent-primary);
          font-size: var(--font-size-sm);
          cursor: pointer;
        }
        .search-post-author:hover { text-decoration: underline; }
        .search-post-time { font-size: var(--font-size-xs); color: var(--color-text-secondary); }
        .search-post-body { line-height: 1.6; }
        .search-empty { text-align: center; color: var(--color-text-secondary); padding: var(--spacing-xl); }
      `}</style>
    </div>
  );
};

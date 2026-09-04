/**
 * Topics Settings — manage followed hashtags and topic groups.
 *
 * Moved out of the News sidebar (`NewsFeedTopics.tsx`), which now only
 * BROWSES this data — one row per followed-topics feed and one per group,
 * styled the same as the Global/Following pills above them. All the editing
 * (follow/unfollow, create/rename/delete group, add/remove a topic from a
 * group) lives here instead, on a page with room for it.
 *
 * Ported from desktop (1.74.0), with one deliberate difference: web keeps
 * `window.confirm` for the delete-group prompt. Desktop had to replace it
 * because Tauri's dialog plugin unconditionally hijacks `window.confirm` to
 * call an IPC command the Rust side never registers, so it throws instead of
 * showing anything — a Tauri-only problem. In a real browser `window.confirm`
 * works, and it's what every other destructive action in this app already
 * uses (NewsDetailView, DmConversationView, Sidebar's own channel/group
 * deletes), so using anything else here would be the inconsistent choice.
 */

import { Component, createSignal, For, Show } from 'solid-js';
import { t } from '../i18n/init';
import { goBack } from '../lib/router';
import {
  topicGroups,
  topicCaps,
  followTag,
  unfollowTag,
  createGroup,
  renameGroup,
  deleteGroup,
  addTagToGroup,
  removeTagFromGroup,
} from '../lib/topic-groups';

export const TopicsSettingsView: Component = () => {
  const tg = topicGroups;
  const caps = () => topicCaps();

  const [followValue, setFollowValue] = createSignal('');
  const [newGroupName, setNewGroupName] = createSignal('');
  const [renamingGroup, setRenamingGroup] = createSignal<string | null>(null);
  const [addingTagTo, setAddingTagTo] = createSignal<string | null>(null);

  const submitFollow = (e: Event) => {
    e.preventDefault();
    const v = followValue().trim();
    if (v) {
      followTag(v);
      setFollowValue('');
    }
  };

  const submitNewGroup = (e: Event) => {
    e.preventDefault();
    const v = newGroupName().trim();
    if (v) {
      createGroup(v);
      setNewGroupName('');
    }
  };

  const commitRename = (id: string, value: string) => {
    const v = value.trim();
    if (v) renameGroup(id, v);
    setRenamingGroup(null);
  };

  const commitAddTag = (id: string, value: string) => {
    const v = value.trim();
    if (v) addTagToGroup(id, v);
    setAddingTagTo(null);
  };

  const handleDeleteGroup = (id: string) => {
    if (window.confirm(t('news_topic_group_delete_confirm'))) deleteGroup(id);
  };

  return (
    <div class="settings-view">
      <header class="topics-view-header">
        <h1>{t('news_topics_manage')}</h1>
        <p class="topics-muted">{t('news_topics_manage_hint')}</p>
      </header>

      <section class="settings-section">
        <h3>{t('news_topics_followed')}</h3>
        <form onSubmit={submitFollow} class="topics-inline-form">
          <input
            class="topics-input"
            type="text"
            value={followValue()}
            onInput={(e) => setFollowValue(e.currentTarget.value)}
            placeholder={t('news_topic_add')}
            disabled={caps().follows.full}
          />
          <button
            class="topics-btn-primary"
            type="submit"
            disabled={caps().follows.full || !followValue().trim()}
          >
            {t('news_topic_add_button')}
          </button>
        </form>
        <Show when={caps().follows.full}>
          <p class="topics-muted">{t('news_topics_cap_reached')}</p>
        </Show>
        <Show when={tg().follows.length > 0} fallback={<p class="topics-muted">{t('news_topics_empty')}</p>}>
          <div class="topic-pill-list">
            <For each={tg().follows}>
              {(tag) => (
                <span class="topic-pill">
                  #{tag}
                  <button
                    class="topic-pill-remove"
                    title={t('news_topic_unfollow')}
                    aria-label={`${t('news_topic_unfollow')} #${tag}`}
                    onClick={() => unfollowTag(tag)}
                  >
                    ✕
                  </button>
                </span>
              )}
            </For>
          </div>
        </Show>
      </section>

      <section class="settings-section">
        <h3>{t('news_topic_group_new')}</h3>
        <form onSubmit={submitNewGroup} class="topics-inline-form">
          <input
            class="topics-input"
            type="text"
            value={newGroupName()}
            onInput={(e) => setNewGroupName(e.currentTarget.value)}
            placeholder={t('news_topic_group_new_prompt')}
            disabled={caps().groups.full}
          />
          <button
            class="topics-btn-primary"
            type="submit"
            disabled={caps().groups.full || !newGroupName().trim()}
          >
            {t('news_topic_group_new')}
          </button>
        </form>
        <Show when={caps().groups.full}>
          <p class="topics-muted">{t('news_topics_cap_reached')}</p>
        </Show>

        <For each={tg().groups}>
          {(g) => (
            <div class="topic-group-card">
              <div class="topic-group-header">
                <Show when={renamingGroup() === g.id} fallback={<strong class="topic-group-name">{g.name}</strong>}>
                  <input
                    class="topics-input"
                    value={g.name}
                    ref={(el) => setTimeout(() => el.focus(), 0)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(g.id, e.currentTarget.value);
                      else if (e.key === 'Escape') setRenamingGroup(null);
                    }}
                    onBlur={(e) => commitRename(g.id, e.currentTarget.value)}
                  />
                </Show>
                <div class="topic-group-actions">
                  <button
                    class="topics-icon-btn"
                    title={t('news_topic_group_rename')}
                    onClick={() => setRenamingGroup(g.id)}
                  >
                    ✎
                  </button>
                  <button
                    class="topics-icon-btn topics-icon-btn-danger"
                    title={t('news_topic_group_delete')}
                    onClick={() => handleDeleteGroup(g.id)}
                  >
                    🗑
                  </button>
                </div>
              </div>

              <Show when={g.tags.length > 0} fallback={<p class="topics-muted">{t('news_topic_group_empty')}</p>}>
                <div class="topic-pill-list">
                  <For each={g.tags}>
                    {(tag) => (
                      <span class="topic-pill">
                        #{tag}
                        <button
                          class="topic-pill-remove"
                          title={t('news_topic_remove_from_group')}
                          aria-label={`${t('news_topic_remove_from_group')} #${tag}`}
                          onClick={() => removeTagFromGroup(g.id, tag)}
                        >
                          ✕
                        </button>
                      </span>
                    )}
                  </For>
                </div>
              </Show>

              <Show
                when={addingTagTo() === g.id}
                fallback={
                  <button class="topics-btn-secondary topic-group-add-btn" onClick={() => setAddingTagTo(g.id)}>
                    {t('news_topic_add')}
                  </button>
                }
              >
                <input
                  class="topics-input"
                  placeholder={t('news_topic_add')}
                  ref={(el) => setTimeout(() => el.focus(), 0)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitAddTag(g.id, e.currentTarget.value);
                    else if (e.key === 'Escape') setAddingTagTo(null);
                  }}
                  onBlur={() => setAddingTagTo(null)}
                />
              </Show>
            </div>
          )}
        </For>
      </section>

      <button class="topics-btn-secondary" onClick={() => goBack('/news')}>
        {t('done')}
      </button>
    </div>
  );
};

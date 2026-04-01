/**
 * UserProfileView — user profile with posts, follow/unfollow.
 */

import { Component, createResource, createSignal, For, Show } from 'solid-js';
import { t } from '../i18n/init';
import { getClient } from '../lib/api';
import { authStatus, walletAddress, getSigner } from '../lib/auth';
import { navigate } from '../lib/router';
import { FormattedText } from '../components/FormattedText';
import { getPayloadContent } from '../lib/payload';

interface UserProfileProps {
  address: string;
}

export const UserProfileView: Component<UserProfileProps> = (props) => {
  const [following, setFollowing] = createSignal(false);
  const [editing, setEditing] = createSignal(false);
  const [editName, setEditName] = createSignal('');
  const [editBio, setEditBio] = createSignal('');
  const [editSaving, setEditSaving] = createSignal(false);
  const [editError, setEditError] = createSignal('');
  const [editSuccess, setEditSuccess] = createSignal('');
  const [avatarFile, setAvatarFile] = createSignal<File | null>(null);

  const isOwnProfile = () => walletAddress() === props.address;

  const [profile, { refetch: refetchProfile }] = createResource(
    () => props.address,
    async (address) => {
      if (!address) return null;
      try {
        const client = getClient();
        return await client.getUserProfile(address);
      } catch {
        // Endpoint may 404 — degrade gracefully
        return null;
      }
    },
  );

  const [posts] = createResource(
    () => props.address,
    async (address) => {
      if (!address) return [];
      try {
        const client = getClient();
        // Try user posts endpoint first, fall back to filtering news
        const resp = await client.listNews(1, 50);
        return resp.posts.filter((p: any) => p.author === address);
      } catch {
        return [];
      }
    },
  );

  const [followers] = createResource(
    () => props.address,
    async (address) => {
      if (!address) return { total: 0 };
      try {
        const client = getClient();
        return await client.getFollowers(address);
      } catch {
        return { total: 0 };
      }
    },
  );

  const handleFollow = async () => {
    try {
      const client = getClient();
      if (following()) {
        await client.unfollow(props.address);
        setFollowing(false);
      } else {
        await client.follow(props.address);
        setFollowing(true);
      }
    } catch {
      // Failed silently
    }
  };

  const startEditing = () => {
    setEditName(profile()?.user?.display_name || '');
    setEditBio(profile()?.user?.bio || '');
    setAvatarFile(null);
    setEditError('');
    setEditSuccess('');
    setEditing(true);
  };

  const handleSaveProfile = async () => {
    if (!getSigner()) return;
    setEditSaving(true);
    setEditError('');
    setEditSuccess('');
    try {
      const client = getClient();
      let avatarCid = profile()?.user?.avatar_cid;

      // Upload new avatar if selected (max 5 MB)
      if (avatarFile()) {
        if (avatarFile()!.size > 5 * 1024 * 1024) {
          throw new Error('Image too large (max 5 MB)');
        }
        try {
          const result = await client.uploadMedia(avatarFile()!);
          avatarCid = result.cid;
        } catch {
          throw new Error('Avatar upload failed — media upload not available on this node');
        }
      }

      await client.updateProfile({
        display_name: editName() || undefined,
        avatar_cid: avatarCid || undefined,
        bio: editBio() || undefined,
      });
      setEditSuccess('Profile updated!');
      setEditing(false);
      refetchProfile();
    } catch (e: any) {
      setEditError(e?.message || 'Failed to save profile');
    } finally {
      setEditSaving(false);
    }
  };

  const truncateAddress = (addr: string) =>
    `${addr.slice(0, 12)}...${addr.slice(-6)}`;

  return (
    <div class="profile-view">
      <div class="profile-header">
        <div class="profile-avatar">
          <Show when={profile()?.user?.avatar_cid} fallback={<div class="avatar-placeholder">{props.address.slice(3, 5).toUpperCase()}</div>}>
            <img src={`/api/v1/media/${profile()!.user.avatar_cid}`} alt="Avatar" class="avatar-img" />
          </Show>
        </div>
        <div class="profile-info">
          <h2 class="profile-name">
            {profile()?.user?.display_name || truncateAddress(props.address)}
          </h2>
          <code class="profile-address-text">{props.address}</code>
          <Show when={profile()?.user?.bio}>
            <p class="profile-bio-text">{profile()!.user.bio}</p>
          </Show>
        </div>
      </div>

      <div class="profile-stats">
        <div class="stat">
          <span class="stat-value">{posts()?.length ?? 0}</span>
          <span class="stat-label">{t('profile_posts')}</span>
        </div>
        <div class="stat">
          <span class="stat-value">{followers()?.total ?? 0}</span>
          <span class="stat-label">{t('profile_followers')}</span>
        </div>
        <div class="stat">
          <span class="stat-value">{profile()?.following_count ?? 0}</span>
          <span class="stat-label">{t('profile_following')}</span>
        </div>
      </div>

      {/* Own profile: edit button */}
      <Show when={isOwnProfile() && authStatus() === 'ready'}>
        <Show when={!editing()}>
          <div class="profile-actions">
            <button class="profile-action-btn" onClick={startEditing}>
              Edit Profile
            </button>
          </div>
        </Show>
        <Show when={editing()}>
          <div class="profile-edit-form">
            <label class="edit-label">Display Name</label>
            <input
              type="text"
              class="edit-input"
              maxLength={50}
              placeholder="Your name"
              value={editName()}
              onInput={(e) => setEditName(e.currentTarget.value)}
            />
            <label class="edit-label">Bio</label>
            <textarea
              class="edit-input edit-textarea"
              maxLength={200}
              placeholder="About you..."
              value={editBio()}
              onInput={(e) => setEditBio(e.currentTarget.value)}
            />
            <label class="edit-label">Profile Image</label>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              class="edit-file"
              onChange={(e) => setAvatarFile(e.currentTarget.files?.[0] ?? null)}
            />
            <Show when={editError()}>
              <div class="edit-error">{editError()}</div>
            </Show>
            <Show when={editSuccess()}>
              <div class="edit-success">{editSuccess()}</div>
            </Show>
            <div class="edit-buttons">
              <button
                class="profile-action-btn"
                onClick={handleSaveProfile}
                disabled={editSaving()}
              >
                {editSaving() ? 'Saving...' : 'Save'}
              </button>
              <button
                class="profile-action-btn following"
                onClick={() => setEditing(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </Show>
      </Show>

      {/* Other user: follow/DM/tip */}
      <Show when={!isOwnProfile() && authStatus() === 'ready'}>
        <div class="profile-actions">
          <button
            class={`profile-action-btn ${following() ? 'following' : ''}`}
            onClick={handleFollow}
          >
            {following() ? t('profile_unfollow') : t('profile_follow')}
          </button>
          <button
            class="profile-action-btn"
            onClick={() => navigate(`/dm/${props.address}`)}
          >
            {t('profile_send_dm')}
          </button>
          <button
            class="profile-action-btn tip"
            onClick={() => navigate(`/wallet`)}
          >
            {t('profile_tip')}
          </button>
        </div>
      </Show>

      <div class="profile-posts">
        <h3>{t('profile_posts')}</h3>
        <Show
          when={posts() && posts()!.length > 0}
          fallback={<div class="profile-no-posts">{t('profile_no_posts')}</div>}
        >
          <For each={posts()}>
            {(post) => (
              <article class="profile-post-card">
                <div class="profile-post-time">
                  {new Date(post.timestamp).toLocaleDateString()}
                </div>
                <div class="profile-post-body">
                  <FormattedText content={getPayloadContent(post.payload)} />
                </div>
              </article>
            )}
          </For>
        </Show>
      </div>

      <style>{`
        .profile-view { padding: var(--spacing-lg); overflow-y: auto; height: 100%; max-width: 700px; }
        .profile-header { display: flex; gap: var(--spacing-lg); margin-bottom: var(--spacing-lg); }
        .profile-avatar { flex-shrink: 0; }
        .avatar-placeholder {
          width: 80px;
          height: 80px;
          border-radius: var(--radius-full);
          background: var(--color-accent-primary);
          color: var(--color-text-inverse);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: var(--font-size-xl);
          font-weight: 700;
        }
        .avatar-img {
          width: 80px;
          height: 80px;
          border-radius: var(--radius-full);
          object-fit: cover;
        }
        .profile-info { flex: 1; min-width: 0; }
        .profile-name { font-size: var(--font-size-xl); margin-bottom: var(--spacing-xs); }
        .profile-address-text {
          font-size: var(--font-size-xs);
          color: var(--color-text-secondary);
          word-break: break-all;
          display: block;
          margin-bottom: var(--spacing-xs);
        }
        .profile-bio-text { font-size: var(--font-size-sm); color: var(--color-text-secondary); line-height: 1.5; }
        .profile-stats {
          display: flex;
          gap: var(--spacing-xl);
          margin-bottom: var(--spacing-lg);
          padding-bottom: var(--spacing-lg);
          border-bottom: 1px solid var(--color-border);
        }
        .stat { display: flex; flex-direction: column; align-items: center; }
        .stat-value { font-size: var(--font-size-lg); font-weight: 700; }
        .stat-label { font-size: var(--font-size-xs); color: var(--color-text-secondary); text-transform: uppercase; }
        .profile-actions {
          display: flex;
          gap: var(--spacing-sm);
          margin-bottom: var(--spacing-lg);
        }
        .profile-action-btn {
          padding: var(--spacing-sm) var(--spacing-lg);
          border-radius: var(--radius-md);
          font-weight: 600;
          font-size: var(--font-size-sm);
          background: var(--color-accent-primary);
          color: var(--color-text-inverse);
        }
        .profile-action-btn.following {
          background: var(--color-bg-tertiary);
          color: var(--color-text-primary);
          border: 1px solid var(--color-border);
        }
        .profile-action-btn.tip {
          background: var(--color-warning);
          color: #1a1a1a;
        }
        .profile-posts h3 {
          font-size: var(--font-size-md);
          margin-bottom: var(--spacing-md);
        }
        .profile-post-card {
          background: var(--color-bg-secondary);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-lg);
          padding: var(--spacing-md);
          margin-bottom: var(--spacing-sm);
        }
        .profile-post-time { font-size: var(--font-size-xs); color: var(--color-text-secondary); margin-bottom: var(--spacing-xs); }
        .profile-post-body { line-height: 1.6; }
        .profile-no-posts { text-align: center; color: var(--color-text-secondary); padding: var(--spacing-xl); }
        .profile-edit-form {
          display: flex;
          flex-direction: column;
          gap: var(--spacing-xs);
          margin-bottom: var(--spacing-lg);
          padding: var(--spacing-md);
          background: var(--color-bg-secondary);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-lg);
        }
        .edit-label {
          font-size: var(--font-size-xs);
          color: var(--color-text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.03em;
        }
        .edit-input {
          padding: var(--spacing-sm) var(--spacing-md);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-md);
          background: var(--color-bg-tertiary);
          color: var(--color-text-primary);
          font-family: inherit;
          font-size: var(--font-size-sm);
        }
        .edit-input:focus { outline: none; border-color: var(--color-accent-primary); }
        .edit-textarea { min-height: 60px; resize: vertical; }
        .edit-file {
          font-size: var(--font-size-sm);
          color: var(--color-text-secondary);
        }
        .edit-buttons {
          display: flex;
          gap: var(--spacing-sm);
          margin-top: var(--spacing-xs);
        }
        .edit-error { font-size: var(--font-size-xs); color: var(--color-error); }
        .edit-success { font-size: var(--font-size-xs); color: var(--color-success); }
      `}</style>
    </div>
  );
};

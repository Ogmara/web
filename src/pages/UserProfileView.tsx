/**
 * UserProfileView — user profile with posts, follow/unfollow.
 */

import { Component, createResource, createSignal, For, Show } from 'solid-js';
import { JSX } from 'solid-js/jsx-runtime';
import { t } from '../i18n/init';
import { getClient } from '../lib/api';
import { authStatus, walletAddress, walletSource, l2Address, getSigner } from '../lib/auth';
import { kleverAvailable, registerUser } from '../lib/klever';
import { navigate } from '../lib/router';
import { FormattedText } from '../components/FormattedText';
import { getPayloadContent } from '../lib/payload';

/** Render bio text with URLs as clickable links. */
const URL_RE = /(https?:\/\/[^\s<]+)/g;
const BioText: Component<{ text: string }> = (props) => {
  const parts = () => {
    const result: JSX.Element[] = [];
    let lastIndex = 0;
    URL_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = URL_RE.exec(props.text)) !== null) {
      if (match.index > lastIndex) {
        result.push(<>{props.text.slice(lastIndex, match.index)}</>);
      }
      const url = match[0];
      result.push(
        <a href={url} target="_blank" rel="noopener noreferrer" class="bio-link">{url}</a>,
      );
      lastIndex = match.index + url.length;
    }
    if (lastIndex < props.text.length) {
      result.push(<>{props.text.slice(lastIndex)}</>);
    }
    return result;
  };
  return <>{parts()}</>;
};

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

  const isOwnProfile = () =>
    walletAddress() === props.address || l2Address() === props.address;

  /** The L2 address used for profile data (device key when using extension). */
  const profileL2Address = () => {
    if (isOwnProfile() && walletSource() === 'klever-extension' && l2Address()) {
      return l2Address()!;
    }
    return props.address;
  };

  const isVerified = () => {
    const pk = profile()?.user?.public_key;
    return pk && pk.length > 0;
  };
  const [regPending, setRegPending] = createSignal(false);

  const [profile, { refetch: refetchProfile }] = createResource(
    () => profileL2Address(),
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
        } catch (uploadErr: any) {
          throw new Error(`Avatar upload failed: ${uploadErr?.message || 'unknown error'}`);
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

  const handleRegister = async () => {
    const signer = getSigner();
    if (!signer) return;
    setRegPending(true);
    setEditError('');
    try {
      const txHash = await registerUser(signer.publicKeyHex);
      setEditSuccess(`Registered on-chain! TX: ${txHash.slice(0, 16)}...`);
      // Refetch to get the public_key set by chain scanner
      setTimeout(() => refetchProfile(), 5000);
    } catch (e: any) {
      setEditError(e?.message || 'Registration failed');
    } finally {
      setRegPending(false);
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
            <Show when={isVerified()}>
              <span class="verified-badge" title="On-chain verified">✓</span>
            </Show>
          </h2>
          <code class="profile-address-text">{props.address}</code>
          <Show when={isOwnProfile() && l2Address() && l2Address() !== props.address}>
            <div class="profile-l2-hint">
              L2 signing key: <code>{l2Address()!.slice(0, 12)}...{l2Address()!.slice(-6)}</code>
            </div>
          </Show>
          <Show when={profile()?.user?.bio}>
            <p class="profile-bio-text"><BioText text={profile()!.user.bio!} /></p>
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

      {/* Own profile: edit / setup */}
      <Show when={isOwnProfile() && authStatus() === 'ready'}>
        <Show when={!editing()}>
          <Show when={!profile()?.user?.display_name}>
            <div class="profile-setup-hint">
              You haven't set up your profile yet. Add a name and avatar so others can recognize you.
            </div>
          </Show>
          <div class="profile-actions">
            <button class="profile-action-btn" onClick={startEditing}>
              {profile()?.user?.display_name ? 'Edit Profile' : 'Set Up Profile'}
            </button>
            <Show when={!isVerified() && kleverAvailable()}>
              <button
                class="profile-action-btn verify"
                onClick={handleRegister}
                disabled={regPending()}
              >
                {regPending() ? 'Registering...' : 'Verify On-Chain'}
              </button>
            </Show>
            <Show when={isVerified()}>
              <span class="profile-verified-status">✓ On-chain verified</span>
            </Show>
          </div>
          <Show when={editError()}>
            <div class="edit-error">{editError()}</div>
          </Show>
          <Show when={editSuccess()}>
            <div class="edit-success">{editSuccess()}</div>
          </Show>
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
        .profile-name { font-size: var(--font-size-xl); margin-bottom: var(--spacing-xs); display: flex; align-items: center; gap: var(--spacing-xs); }
        .verified-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          border-radius: var(--radius-full);
          background: var(--color-accent-primary);
          color: var(--color-text-inverse);
          font-size: 13px;
          font-weight: 700;
          flex-shrink: 0;
        }
        .profile-address-text {
          font-size: var(--font-size-xs);
          color: var(--color-text-secondary);
          word-break: break-all;
          display: block;
          margin-bottom: var(--spacing-xs);
        }
        .profile-l2-hint {
          font-size: var(--font-size-xs);
          color: var(--color-text-secondary);
          opacity: 0.6;
          margin-bottom: var(--spacing-xs);
        }
        .profile-l2-hint code { font-size: inherit; }
        .profile-bio-text { font-size: var(--font-size-sm); color: var(--color-text-secondary); line-height: 1.5; }
        .bio-link { color: var(--color-accent-primary); text-decoration: underline; word-break: break-all; }
        .bio-link:hover { opacity: 0.8; }
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
        .profile-action-btn.verify {
          background: var(--color-success);
          color: #1a1a1a;
        }
        .profile-verified-status {
          font-size: var(--font-size-sm);
          color: var(--color-success);
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: var(--spacing-xs);
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
        .profile-setup-hint {
          padding: var(--spacing-sm) var(--spacing-md);
          background: var(--color-bg-tertiary);
          border: 1px solid var(--color-accent-primary);
          border-radius: var(--radius-md);
          font-size: var(--font-size-sm);
          color: var(--color-text-secondary);
          margin-bottom: var(--spacing-sm);
        }
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

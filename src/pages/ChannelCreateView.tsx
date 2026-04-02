/**
 * ChannelCreateView — create a new channel (public or private).
 *
 * Flow: fill form → on-chain SC call (gets channel_id) → L2 envelope → navigate to channel.
 */

import { Component, createSignal, Show } from 'solid-js';
import { t } from '../i18n/init';
import { getClient } from '../lib/api';
import { authStatus, walletAddress, getSigner } from '../lib/auth';
import { navigate, goBack } from '../lib/router';

export const ChannelCreateView: Component = () => {
  const [slug, setSlug] = createSignal('');
  const [displayName, setDisplayName] = createSignal('');
  const [description, setDescription] = createSignal('');
  const [channelType, setChannelType] = createSignal(0); // 0=Public, 1=ReadPublic, 2=Private
  const [rules, setRules] = createSignal('');
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal('');

  const handleCreate = async () => {
    const s = slug().trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!s) { setError('Slug is required'); return; }
    if (!getSigner() || !walletAddress()) { setError(t('auth_required')); return; }

    setSubmitting(true);
    setError('');

    try {
      const client = getClient();

      // Derive a deterministic channel_id from creator + slug + timestamp.
      // For public channels, this should come from the on-chain SC.
      // TODO: Integrate Klever SC call for public channels.
      const ts = Date.now();
      const raw = new TextEncoder().encode(walletAddress()! + s + ts);
      const hashBytes = await crypto.subtle.digest('SHA-256', raw);
      const view = new DataView(hashBytes);
      const channelId = Number(view.getBigUint64(0) % BigInt(Number.MAX_SAFE_INTEGER));

      await client.createChannel({
        channelId,
        slug: s,
        channelType: channelType(),
        displayName: displayName().trim() || undefined,
        description: description().trim() || undefined,
        rules: rules().trim() || undefined,
      });

      navigate(`/chat/${channelId}`);
    } catch (e: any) {
      setError(e?.message || 'Failed to create channel');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div class="channel-create-view">
      <div class="create-header">
        <button class="create-back" onClick={goBack}>← {t('nav_back')}</button>
        <h2>{t('channel_create')}</h2>
      </div>

      <Show when={authStatus() !== 'ready'}>
        <div class="create-auth-prompt">
          <button onClick={() => navigate('/wallet')}>{t('auth_connect_prompt')}</button>
        </div>
      </Show>

      <Show when={authStatus() === 'ready'}>
        <div class="create-form">
          <label class="create-label">{t('channel_create_slug')}</label>
          <input
            class="create-input"
            type="text"
            maxLength={64}
            placeholder="my-channel"
            value={slug()}
            onInput={(e) => setSlug(e.currentTarget.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
          />
          <span class="create-hint">{t('channel_slug_hint')}</span>

          <label class="create-label">{t('channel_name_label')}</label>
          <input
            class="create-input"
            type="text"
            maxLength={64}
            placeholder={t('channel_create_name')}
            value={displayName()}
            onInput={(e) => setDisplayName(e.currentTarget.value)}
          />

          <label class="create-label">{t('channel_description_label')}</label>
          <textarea
            class="create-textarea"
            rows={3}
            maxLength={256}
            placeholder={t('channel_create_description')}
            value={description()}
            onInput={(e) => setDescription(e.currentTarget.value)}
          />

          <label class="create-label">{t('channel_create_type')}</label>
          <select
            class="create-select"
            value={channelType()}
            onChange={(e) => setChannelType(parseInt(e.currentTarget.value, 10))}
          >
            <option value={0}>{t('channel_type_public')}</option>
            <option value={1}>{t('channel_type_read_public')}</option>
            <option value={2}>{t('channel_type_private')}</option>
          </select>

          <Show when={error()}>
            <div class="create-error">{error()}</div>
          </Show>

          <button
            class="create-submit"
            onClick={handleCreate}
            disabled={submitting() || !slug().trim()}
          >
            {submitting() ? t('loading') : t('channel_create')}
          </button>
        </div>
      </Show>

      <style>{`
        .channel-create-view { padding: var(--spacing-md); max-width: 500px; overflow-y: auto; height: 100%; }
        .create-header { display: flex; align-items: center; gap: var(--spacing-md); margin-bottom: var(--spacing-lg); }
        .create-header h2 { font-size: var(--font-size-xl); }
        .create-back { font-size: var(--font-size-sm); color: var(--color-text-secondary); }
        .create-back:hover { color: var(--color-text-primary); }
        .create-auth-prompt {
          text-align: center;
          padding: var(--spacing-xl);
          color: var(--color-text-secondary);
        }
        .create-auth-prompt button {
          color: var(--color-accent-primary);
          font-weight: 600;
        }
        .create-form { display: flex; flex-direction: column; gap: var(--spacing-sm); }
        .create-label { font-size: var(--font-size-sm); font-weight: 600; margin-top: var(--spacing-sm); }
        .create-input, .create-textarea, .create-select {
          padding: var(--spacing-sm) var(--spacing-md);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-md);
          background: var(--color-bg-tertiary);
          color: var(--color-text-primary);
          font-family: inherit;
          font-size: var(--font-size-md);
        }
        .create-input:focus, .create-textarea:focus, .create-select:focus {
          outline: none;
          border-color: var(--color-accent-primary);
        }
        .create-textarea { resize: none; line-height: 1.4; }
        .create-select { cursor: pointer; }
        .create-hint { font-size: var(--font-size-xs); color: var(--color-text-secondary); }
        .create-error {
          padding: var(--spacing-sm);
          background: rgba(255,0,0,0.1);
          border-radius: var(--radius-sm);
          color: #f44;
          font-size: var(--font-size-sm);
        }
        .create-submit {
          margin-top: var(--spacing-md);
          padding: var(--spacing-sm) var(--spacing-lg);
          background: var(--color-accent-primary);
          color: var(--color-text-inverse);
          border-radius: var(--radius-md);
          font-weight: 600;
          font-size: var(--font-size-md);
        }
        .create-submit:disabled { opacity: 0.5; cursor: default; }
      `}</style>
    </div>
  );
};

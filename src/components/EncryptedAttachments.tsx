/**
 * EncryptedAttachments — renders the encrypted-media descriptors (P5) carried
 * INSIDE a decrypted message's content (`media[]`), as opposed to the plaintext
 * `attachments[]` array that FormattedText handles for non-encrypted channels.
 *
 * Each descriptor's blob on IPFS is ciphertext, so we can't point an <img> at the
 * media URL directly. Instead we fetch + `decryptMedia` (cached by CID in
 * mediaCrypto) and render the resulting plaintext `blob:` object URL. While that
 * async work runs we show a placeholder; on failure (missing key / decrypt error)
 * we show a "🔒 encrypted attachment" fallback so a broken file never looks like a
 * silent drop.
 */
import { Component, For, Show, createSignal, createEffect, onCleanup } from 'solid-js';
import type { MediaDescriptor } from '@ogmara/sdk';
import { t } from '../i18n/init';
import { decryptedMediaUrl } from '../lib/mediaCrypto';
import { safeAttachmentName } from '../lib/payload';

/** Image MIME types rendered inline. SVG excluded — can carry scripts. */
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
/** Video MIME types rendered as inline <video>. */
const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/ogg'];

/** One descriptor → placeholder → decrypted media (image/video/download). */
const EncryptedItem: Component<{ media: MediaDescriptor }> = (props) => {
  const [url, setUrl] = createSignal<string | null>(null);
  const [failed, setFailed] = createSignal(false);

  // Decrypt when the descriptor's CID changes. The object URL itself is owned by
  // the mediaCrypto cache (keyed by CID, revoked on logout/teardown), so we must
  // NOT revoke it here — other bubbles may share the same CID.
  createEffect(() => {
    const m = props.media;
    let active = true;
    setUrl(null);
    setFailed(false);
    decryptedMediaUrl(m)
      .then((u) => { if (active) setUrl(u); })
      .catch(() => { if (active) setFailed(true); });
    onCleanup(() => { active = false; });
  });

  const name = () => safeAttachmentName({ filename: props.media.name, cid: props.media.cid });
  const isImage = () => IMAGE_TYPES.includes(props.media.mime);
  const isVideo = () => VIDEO_TYPES.includes(props.media.mime);

  return (
    <Show
      when={!failed()}
      fallback={
        <span class="enc-att-locked" title={name()}>🔒 {t('encrypted_attachment')}</span>
      }
    >
      <Show
        when={url()}
        fallback={
          <span class="enc-att-loading">🔒 {t('media_decrypting')}</span>
        }
      >
        {isImage() ? (
          <a href={url()!} target="_blank" rel="noopener noreferrer">
            <img class="msg-image" src={url()!} alt={name()} loading="lazy" />
          </a>
        ) : isVideo() ? (
          <video class="msg-video" controls preload="metadata" src={url()!}>
            <a href={url()!} target="_blank" rel="noopener noreferrer">{name()}</a>
          </video>
        ) : (
          <a class="msg-file" href={url()!} download={name()} target="_blank" rel="noopener noreferrer">
            🔒 {name()}
          </a>
        )}
      </Show>
    </Show>
  );
};

export const EncryptedAttachments: Component<{ media?: MediaDescriptor[] }> = (props) => (
  <Show when={props.media && props.media.length > 0}>
    <div class="msg-attachments">
      <For each={props.media}>{(m) => <EncryptedItem media={m} />}</For>
    </div>
    <style>{`
      .enc-att-loading, .enc-att-locked {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: var(--spacing-xs) var(--spacing-sm);
        background: var(--color-bg-tertiary);
        border-radius: var(--radius-sm);
        color: var(--color-text-secondary);
        font-size: var(--font-size-sm);
      }
    `}</style>
  </Show>
);

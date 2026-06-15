/**
 * MediaUpload — file picker and upload component for attaching media to posts/comments.
 *
 * Uploads files to IPFS via the L2 node's media endpoint, returns Attachment objects
 * ready to include in post/comment envelopes.
 */

import { Component, createSignal, For, Show, onCleanup } from 'solid-js';
import type { MediaDescriptor } from '@ogmara/sdk';
import { t } from '../i18n/init';
import { getClient } from '../lib/api';
import { mediaUploadsAvailable } from '../lib/media';
import { safeAttachmentName } from '../lib/payload';
import { uploadEncryptedFile } from '../lib/mediaCrypto';

/** Attachment data returned after successful upload. */
export interface MediaAttachment {
  cid: string;
  mime_type: string;
  size_bytes: number;
  filename?: string;
  thumbnail_cid?: string;
  /** P5: when this attachment is encrypted, the per-file descriptor (key+nonce+
   *  real mime/name) sealed inside the message content on send. Present ⇒ the
   *  blob at `cid` is ciphertext; pass via the `media` param, NOT `attachments`. */
  descriptor?: MediaDescriptor;
  /** Local object URL of the ORIGINAL file for the composer preview (the CID is
   *  ciphertext and can't be shown directly). Revoked on removal/unmount. */
  previewUrl?: string;
}

/** Accepted file types for uploads. */
const ACCEPTED_TYPES = 'image/*,video/*,audio/*,.pdf,.txt,.md,.csv,.json';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

/** File extensions that are always blocked (executable/scripting). */
const BLOCKED_EXTENSIONS = new Set([
  'exe', 'bat', 'cmd', 'com', 'msi', 'scr', 'pif', 'vbs', 'vbe',
  'js', 'jse', 'wsf', 'wsh', 'ps1', 'psm1', 'psd1',
  'sh', 'bash', 'csh', 'ksh',
  'app', 'action', 'command', 'workflow',
  'dll', 'sys', 'drv', 'ocx',
  'jar', 'class', 'war',
  'apk', 'deb', 'rpm', 'dmg', 'iso',
  'reg', 'inf', 'lnk', 'url',
  'hta', 'cpl', 'msc', 'gadget',
]);

export const MediaUpload: Component<{
  attachments: MediaAttachment[];
  onAttach: (attachment: MediaAttachment) => void;
  onRemove: (index: number) => void;
  disabled?: boolean;
  /** P5: when true the target is encrypted (DM / private / public-encrypted
   *  channel) — file bytes are encrypted BEFORE upload and a descriptor is
   *  attached; the preview uses a local object URL of the original file. */
  encrypted?: boolean;
}> = (props) => {
  const [uploading, setUploading] = createSignal(false);
  const [uploadError, setUploadError] = createSignal('');
  let fileInputRef: HTMLInputElement | undefined;

  // Revoke any composer-preview object URLs this component created if the whole
  // composer unmounts with attachments still pending (e.g. navigating away).
  onCleanup(() => {
    for (const a of props.attachments) if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
  });

  // Whether the CURRENT node can host files (IPFS up). When false we disable
  // the picker and explain why, so the user never hits the "upload failed" /
  // broken-image path on a text-only node.
  const mediaOff = () => !mediaUploadsAvailable();

  const handleFileSelect = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    // Defensive: button is disabled when media is off, but guard the handler
    // too (drag/drop etc.).
    if (mediaOff()) {
      input.value = '';
      setUploadError(t('media_node_no_upload_hint'));
      return;
    }

    // Reset input so the same file can be re-selected
    input.value = '';

    // Block executable file types
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (BLOCKED_EXTENSIONS.has(ext)) {
      setUploadError(t('media_blocked_type'));
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setUploadError(t('media_too_large'));
      return;
    }

    setUploading(true);
    setUploadError('');
    try {
      if (props.encrypted) {
        // Encrypt-before-upload: the IPFS blob is opaque ciphertext, so the
        // composer preview must use a LOCAL object URL of the original file.
        const descriptor = await uploadEncryptedFile(file);
        props.onAttach({
          cid: descriptor.cid,
          mime_type: descriptor.mime,
          size_bytes: descriptor.size,
          filename: descriptor.name,
          descriptor,
          previewUrl: URL.createObjectURL(file),
        });
      } else {
        const client = getClient();
        const result = await client.uploadMedia(file, file.name);
        props.onAttach({
          cid: result.cid,
          mime_type: file.type || 'application/octet-stream',
          size_bytes: file.size,
          filename: file.name,
          thumbnail_cid: result.thumbnail_cid,
        });
      }
    } catch (e: any) {
      setUploadError(e?.message || t('media_upload_failed'));
    } finally {
      setUploading(false);
    }
  };

  const isImage = (mime: string) => mime.startsWith('image/');

  const removeAt = (i: number) => {
    const att = props.attachments[i];
    if (att?.previewUrl) URL.revokeObjectURL(att.previewUrl);
    props.onRemove(i);
  };

  /** Preview thumbnail source: the local file URL for an encrypted attachment
   *  (the CID is ciphertext), else the node's plaintext media URL. */
  const thumbSrc = (att: MediaAttachment) =>
    att.previewUrl ?? getClient().getMediaUrl(att.thumbnail_cid || att.cid);

  return (
    <div class="media-upload">
      {/* Attached files list */}
      <Show when={props.attachments.length > 0}>
        <div class="media-attachments">
          <For each={props.attachments}>
            {(att, i) => (
              <div class="media-attachment-item">
                <Show when={isImage(att.mime_type)}>
                  <img
                    class="media-thumb"
                    src={thumbSrc(att)}
                    alt={safeAttachmentName(att)}
                    loading="lazy"
                  />
                </Show>
                <Show when={!isImage(att.mime_type)}>
                  <span class="media-file-icon">{att.descriptor ? '🔒' : '📎'}</span>
                </Show>
                <span class="media-filename">{safeAttachmentName(att)}</span>
                <button
                  class="media-remove"
                  onClick={() => removeAt(i())}
                  title={t('cancel')}
                >
                  ✕
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>

      {/* Upload button + hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        style="display:none"
        onChange={handleFileSelect}
      />
      <button
        class="media-upload-btn"
        onClick={() => fileInputRef?.click()}
        disabled={props.disabled || uploading() || mediaOff()}
        title={mediaOff() ? t('media_node_no_upload_hint') : t('media_attach')}
      >
        {uploading() ? '⏳' : '📎'}{' '}
        {uploading()
          ? t('media_uploading')
          : mediaOff()
            ? t('media_node_no_upload')
            : t('media_attach')}
      </button>

      <span class="media-hint">
        {mediaOff() ? t('media_node_no_upload_hint') : t('media_hint')}
      </span>

      <Show when={uploadError()}>
        <span class="media-error">{uploadError()}</span>
      </Show>

      <style>{`
        .media-upload { display: flex; flex-wrap: wrap; align-items: center; gap: var(--spacing-xs); }
        .media-attachments {
          display: flex;
          flex-wrap: wrap;
          gap: var(--spacing-xs);
          width: 100%;
          margin-bottom: var(--spacing-xs);
        }
        .media-attachment-item {
          display: flex;
          align-items: center;
          gap: var(--spacing-xs);
          padding: 4px 8px;
          background: var(--color-bg-tertiary);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-sm);
          font-size: var(--font-size-xs);
        }
        .media-thumb {
          width: 32px;
          height: 32px;
          object-fit: cover;
          border-radius: var(--radius-sm);
        }
        .media-file-icon { font-size: var(--font-size-sm); }
        .media-filename {
          max-width: 120px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: var(--color-text-secondary);
        }
        .media-remove {
          font-size: var(--font-size-xs);
          color: var(--color-text-secondary);
          cursor: pointer;
          padding: 0 2px;
        }
        .media-remove:hover { color: var(--color-error); }
        .media-upload-btn {
          font-size: var(--font-size-xs);
          color: var(--color-text-secondary);
          cursor: pointer;
          padding: 4px 8px;
          border-radius: var(--radius-sm);
        }
        .media-upload-btn:hover { color: var(--color-accent-primary); background: var(--color-bg-tertiary); }
        .media-upload-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .media-hint {
          font-size: var(--font-size-xs);
          color: var(--color-text-secondary);
          opacity: 0.7;
        }
        .media-error {
          font-size: var(--font-size-xs);
          color: var(--color-error);
        }
      `}</style>
    </div>
  );
};

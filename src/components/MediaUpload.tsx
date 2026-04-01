/**
 * MediaUpload — file picker and upload component for attaching media to posts/comments.
 *
 * Uploads files to IPFS via the L2 node's media endpoint, returns Attachment objects
 * ready to include in post/comment envelopes.
 */

import { Component, createSignal, For, Show } from 'solid-js';
import { t } from '../i18n/init';
import { getClient } from '../lib/api';

/** Attachment data returned after successful upload. */
export interface MediaAttachment {
  cid: string;
  mime_type: string;
  size_bytes: number;
  filename?: string;
  thumbnail_cid?: string;
}

/** Accepted file types for uploads. */
const ACCEPTED_TYPES = 'image/*,video/*,audio/*,.pdf,.txt,.md';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB (matches L2 node body limit)

export const MediaUpload: Component<{
  attachments: MediaAttachment[];
  onAttach: (attachment: MediaAttachment) => void;
  onRemove: (index: number) => void;
  disabled?: boolean;
}> = (props) => {
  const [uploading, setUploading] = createSignal(false);
  const [uploadError, setUploadError] = createSignal('');
  let fileInputRef: HTMLInputElement | undefined;

  const handleFileSelect = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    // Reset input so the same file can be re-selected
    input.value = '';

    if (file.size > MAX_FILE_SIZE) {
      setUploadError(t('media_too_large'));
      return;
    }

    setUploading(true);
    setUploadError('');
    console.log('[MediaUpload] Starting upload:', file.name, file.type, file.size, 'bytes');
    try {
      const client = getClient();
      const result = await client.uploadMedia(file, file.name);
      console.log('[MediaUpload] Upload succeeded:', result);
      props.onAttach({
        cid: result.cid,
        mime_type: file.type || 'application/octet-stream',
        size_bytes: file.size,
        filename: file.name,
        thumbnail_cid: result.thumbnail_cid,
      });
    } catch (e: any) {
      console.error('[MediaUpload] Upload failed:', e);
      setUploadError(e?.message || t('media_upload_failed'));
    } finally {
      setUploading(false);
    }
  };

  const isImage = (mime: string) => mime.startsWith('image/');

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
                    src={getClient().getMediaUrl(att.thumbnail_cid || att.cid)}
                    alt={att.filename || ''}
                    loading="lazy"
                  />
                </Show>
                <Show when={!isImage(att.mime_type)}>
                  <span class="media-file-icon">📎</span>
                </Show>
                <span class="media-filename">{att.filename || att.cid.slice(0, 12)}</span>
                <button
                  class="media-remove"
                  onClick={() => props.onRemove(i())}
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
        disabled={props.disabled || uploading()}
        title={t('media_attach')}
      >
        {uploading() ? '⏳' : '📎'} {uploading() ? t('media_uploading') : t('media_attach')}
      </button>

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
        .media-error {
          font-size: var(--font-size-xs);
          color: var(--color-error);
        }
      `}</style>
    </div>
  );
};

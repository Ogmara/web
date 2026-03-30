/**
 * FormattedText — renders message content with clickable URLs and inline formatting.
 *
 * Supports: **bold**, *italic*, __underline__, `code`, ~~strikethrough~~, and auto-linked URLs.
 * URLs open in a new browser tab.
 */

import { Component, For, Show } from 'solid-js';
import { parseMessageContent, type TextSegment, type Attachment } from '@ogmara/sdk';
import { getClient } from '../lib/api';

interface Props {
  content: string;
  /** IPFS attachments from the message envelope. */
  attachments?: Attachment[];
}

/** Image MIME types that should render inline. SVG excluded — can contain scripts. */
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

export const FormattedText: Component<Props> = (props) => {
  const segments = () => parseMessageContent(props.content);

  return (
    <span class="formatted-text">
      <For each={segments()}>
        {(seg) => {
          switch (seg.type) {
            case 'url': {
              // Defense-in-depth: only allow http/https links
              const safe = seg.url.startsWith('http://') || seg.url.startsWith('https://');
              return safe ? (
                <a
                  href={seg.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="msg-link"
                >
                  {seg.display}
                </a>
              ) : (
                <span>{seg.display}</span>
              );
            }
            case 'bold':
              return <strong>{seg.content}</strong>;
            case 'italic':
              return <em>{seg.content}</em>;
            case 'underline':
              return <u>{seg.content}</u>;
            case 'code':
              return <code class="msg-code">{seg.content}</code>;
            case 'strikethrough':
              return <s>{seg.content}</s>;
            default:
              return <>{seg.content}</>;
          }
        }}
      </For>

      {/* Render inline images from attachments */}
      <Show when={props.attachments && props.attachments.length > 0}>
        <div class="msg-attachments">
          <For each={props.attachments}>
            {(att) => {
              const isImage = IMAGE_TYPES.includes(att.mime_type);
              const mediaUrl = getClient().getMediaUrl(att.cid);
              return isImage ? (
                <a href={mediaUrl} target="_blank" rel="noopener noreferrer">
                  <img
                    src={att.thumbnail_cid
                      ? getClient().getMediaUrl(att.thumbnail_cid)
                      : mediaUrl}
                    alt={att.filename || 'image'}
                    class="msg-image"
                    loading="lazy"
                  />
                </a>
              ) : (
                <a
                  href={mediaUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="msg-file"
                >
                  {att.filename || att.cid.slice(0, 12) + '...'}
                </a>
              );
            }}
          </For>
        </div>
      </Show>

      <style>{`
        .msg-link {
          color: var(--color-accent-primary);
          text-decoration: underline;
          word-break: break-all;
        }
        .msg-link:hover { opacity: 0.8; }
        .msg-code {
          background: var(--color-bg-tertiary);
          padding: 1px 4px;
          border-radius: var(--radius-sm);
          font-family: monospace;
          font-size: 0.9em;
        }
        .msg-attachments {
          display: flex;
          flex-wrap: wrap;
          gap: var(--spacing-sm);
          margin-top: var(--spacing-sm);
        }
        .msg-image {
          max-width: 400px;
          max-height: 300px;
          border-radius: var(--radius-md);
          cursor: pointer;
          object-fit: cover;
        }
        .msg-image:hover { opacity: 0.9; }
        .msg-file {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: var(--spacing-xs) var(--spacing-sm);
          background: var(--color-bg-tertiary);
          border-radius: var(--radius-sm);
          color: var(--color-accent-primary);
          font-size: var(--font-size-sm);
          text-decoration: none;
        }
        .msg-file:hover { background: var(--color-bg-secondary); }
      `}</style>
    </span>
  );
};

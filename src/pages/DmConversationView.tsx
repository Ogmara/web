/**
 * DmConversationView — direct message conversation with a peer.
 */

import { Component, createResource, createSignal, createEffect, createMemo, For, Show, onCleanup, onMount, untrack } from 'solid-js';
import { t } from '../i18n/init';
import { getClient, awaitNodeUrl, getCurrentNodeUrl } from '../lib/api';
import { readCachedMessages, writeCachedMessages, clearCachedMessages, mergeMessages, isAccessRevokedError } from '../lib/messageCache';
import { authStatus, walletAddress, getSigner, isRegistered } from '../lib/auth';
import { onWsEvent } from '../lib/ws';
import { navigate, goBack } from '../lib/router';
import { showMobileList } from '../lib/mobile-nav';
import { isModernStyle } from '../lib/theme';
import type { MediaDescriptor } from '@ogmara/sdk';
import { FormattedText } from '../components/FormattedText';
import { EncryptedAttachments } from '../components/EncryptedAttachments';
import { MediaUpload, type MediaAttachment } from '../components/MediaUpload';
import { buildOptimisticChatPayload, safeAttachmentName } from '../lib/payload';
import { uploadEncryptedFile } from '../lib/mediaCrypto';
import { EmojiPicker } from '../components/EmojiPicker';
import { buildEncryptedDm, buildEncryptedDmEditEnvelope, decryptDmMessage, coverPeerDevices, type DmDisplay } from '../lib/dmCrypto';
import { resolveProfile, type CachedProfile } from '../lib/profile';

interface DmConversationProps {
  peerAddress: string;
}

export const DmConversationView: Component<DmConversationProps> = (props) => {
  const [messageInput, setMessageInput] = createSignal('');
  const [localMessages, setLocalMessages] = createSignal<any[]>([]);
  // Local message-history cache (`lib/messageCache.ts`) — paints a resumed
  // DM conversation instantly instead of blanking on every (re-)open. See
  // ChatView.tsx's identical integration and messageCache.ts's doc comment
  // for why this is reconciled against every full fetch via `mergeMessages`
  // rather than refreshed through an `after` cursor.
  const [cachedMessages, setCachedMessages] = createSignal<any[]>([]);
  const [sending, setSending] = createSignal(false);
  const [showEmoji, setShowEmoji] = createSignal(false);
  const [editingMsg, setEditingMsg] = createSignal<{ msgId: string; content: string } | null>(null);
  const [showReactPicker, setShowReactPicker] = createSignal<string | null>(null);
  const [attachments, setAttachments] = createSignal<MediaAttachment[]>([]);
  const [sendError, setSendError] = createSignal<string | null>(null);
  // Shown when an UNVERIFIED wallet tries an edit/delete: the node gates these
  // "trust features" behind on-chain registration (requires_verified_identity).
  // Rather than silently hiding the action, we prompt the user to verify — a
  // gentle nudge toward registering their wallet.
  const [showVerifyPrompt, setShowVerifyPrompt] = createSignal(false);

  // Right-click / long-press message context menu (parity with channel chat).
  const [dmMenu, setDmMenu] = createSignal<{ x: number; y: number; msg: any } | null>(null);
  let dmMenuRef: HTMLDivElement | undefined;
  let dmLongPressTimer: ReturnType<typeof setTimeout> | null = null;
  const DM_MENU_W = 260, DM_MENU_H = 220, DM_MENU_MARGIN = 8;
  const openDmMenu = (clientX: number, clientY: number, msg: any) => {
    if (!walletAddress()) return; // nothing actionable when not connected
    const maxX = window.innerWidth - DM_MENU_W - DM_MENU_MARGIN;
    const maxY = window.innerHeight - DM_MENU_H - DM_MENU_MARGIN;
    setShowReactPicker(null);
    setDmMenu({
      x: Math.max(DM_MENU_MARGIN, Math.min(clientX, maxX)),
      y: Math.max(DM_MENU_MARGIN, Math.min(clientY, maxY)),
      msg,
    });
  };
  const handleDmTouchStart = (e: TouchEvent, msg: any) => {
    if (dmLongPressTimer) clearTimeout(dmLongPressTimer);
    const touch = e.touches[0];
    dmLongPressTimer = setTimeout(() => openDmMenu(touch.clientX, touch.clientY, msg), 500);
  };
  const cancelDmLongPress = () => { if (dmLongPressTimer) { clearTimeout(dmLongPressTimer); dmLongPressTimer = null; } };
  if (typeof document !== 'undefined') {
    const closeDmMenu = (e: MouseEvent) => {
      if (dmMenuRef && dmMenuRef.contains(e.target as Node)) return;
      setDmMenu(null);
    };
    document.addEventListener('click', closeDmMenu);
    onCleanup(() => document.removeEventListener('click', closeDmMenu));
  }

  // Peer profile for header
  const [peerProfile, setPeerProfile] = createSignal<CachedProfile>({});
  createEffect(() => {
    if (props.peerAddress) resolveProfile(props.peerAddress).then(setPeerProfile);
  });
  const peerName = () => peerProfile().display_name || `${props.peerAddress.slice(0, 8)}...${props.peerAddress.slice(-4)}`;
  const EDIT_WINDOW_MS = 30 * 60 * 1000;
  let inputRef: HTMLTextAreaElement | undefined;
  let messagesRef: HTMLDivElement | undefined;
  // A DOM-detached `document.createElement('input')` + synchronous `.click()`
  // (the old pattern here) is unreliable in some browser/webview engines:
  // nothing keeps the element referenced once the click handler returns and
  // the native file dialog is async, so it can silently get GC'd before
  // `onchange` ever fires — no error, the attach just does nothing. A
  // persistent, DOM-mounted input (matching ChatView's modern-input pattern)
  // doesn't have this problem.
  let modernDmAttachInputRef: HTMLInputElement | undefined;

  // Auto-scroll DM messages
  let prevDmCount = 0;
  let dmInitialLoad = true;
  createEffect(() => {
    const msgs = allMessages();
    const count = msgs.length;
    if (count === 0 || count === prevDmCount) { prevDmCount = count; return; }
    const isFirst = dmInitialLoad;
    prevDmCount = count;
    dmInitialLoad = false;
    setTimeout(() => {
      if (!messagesRef) return;
      if (isFirst) {
        messagesRef.scrollTop = messagesRef.scrollHeight;
      } else {
        const { scrollTop, scrollHeight, clientHeight } = messagesRef;
        if (scrollHeight - scrollTop - clientHeight < 150) {
          messagesRef.scrollTo({ top: messagesRef.scrollHeight, behavior: 'smooth' });
        }
      }
    }, 0);
  });

  // `authStatus()` is part of the source (not just read inside the
  // fetcher): on a cold reload this resource would otherwise fire before
  // the signer is attached, the authenticated DM fetch would 401 → [], and
  // (since only `peerAddress` would be a dependency) it would never
  // refetch until the 8 s poll — the conversation looks empty on reload.
  // Including `authStatus` in the source makes it refetch the moment auth
  // lands.
  //
  // The source is an ALWAYS-TRUTHY object (matching ChatView.tsx's
  // `messages` resource), not `authStatus() === 'ready' ? peerAddress :
  // undefined` as this previously read. Round-3 re-audit finding: Solid's
  // `createResource` SHORT-CIRCUITS entirely when the source function
  // returns `null`/`undefined`/`false` — no fetch starts, and critically
  // `loading` stays `false` while `value()` keeps whatever the PREVIOUS
  // peer's fetch last returned. That silently defeated the persist
  // effect's `messages.loading` guard specifically across a
  // disconnect/reconnect (auth leaves 'ready' momentarily), reopening the
  // exact cross-conversation write bug that guard exists to close —
  // reproduced empirically. Returning a plain object here is always
  // truthy, so `createResource` always actually runs the fetcher (which
  // decides internally whether there's anything to do), and `loading`
  // always flips through its real lifecycle.
  const [messages, { refetch: refetchDmMessages }] = createResource(
    () => ({ peer: props.peerAddress, auth: authStatus() }),
    async ({ peer, auth }) => {
      const address = auth === 'ready' ? peer : undefined;
      if (!address) return [];
      await awaitNodeUrl(); // don't fetch DM history against an unchosen node
      try {
        const client = getClient();
        const resp = await client.getDmMessages(address);
        return resp.messages;
      } catch (e) {
        // 403/404 means access was actually revoked/gone (not a generic
        // network blip, which a stale local cache should survive) — clear
        // the cache too, so the next open doesn't paint it from disk again.
        if (isAccessRevokedError(e)) {
          clearCachedMessages('dm', address, getCurrentNodeUrl());
          // `clearCachedMessages` only wipes disk + the module's in-memory
          // `warm` layer — the LIVE `cachedMessages` signal, already
          // seeded for this peer earlier in this same fetcher run, would
          // otherwise keep rendering the pre-revocation content for the
          // rest of the session regardless.
          setCachedMessages([]);
        }
        return [];
      }
    },
  );
  // The SDK default page size this fetch requests (`getDmMessages`'s own
  // `limit = 50` default — this call passes no explicit limit).
  const DM_REQUESTED_LIMIT = 50;

  // Reconcile the cache seed against the fetch above once it resolves —
  // NOT via an `after`-cursor refresh; see `mergeMessages`'s doc comment
  // in `lib/messageCache.ts` for why that can never surface an edit/delete
  // on an already-cached row. This DM view already refetches wholesale on
  // any edit/delete WS event (see `onWsEvent` below), so this reconciliation
  // is what keeps the CACHE ITSELF from re-serving a stale row on the next
  // cold open, not just the live view.
  //
  // CRITICAL (re-audit finding — see ChatView.tsx's identical fix for the
  // full explanation of the underlying `createResource` behavior):
  // `messages()` retains the PREVIOUS peer's rows while a new fetch for a
  // just-switched-to peer is in flight, and this effect also tracks
  // `props.peerAddress`, so it can re-run mid-switch with a stale, wrong-
  // peer `fresh`. Guarded on `messages.loading`, which defers until the
  // CURRENT peer's fetch has actually resolved. An EARLIER version also
  // added an author-based spot-check ("every row is authored by either
  // the peer or me") as belt-and-suspenders — removed (round-3 re-audit
  // finding): it rejects the wrong peer's INBOUND rows, but every message
  // I have ever SENT, to ANY peer, is authored by `me` — so my own
  // outbound history with a DIFFERENT peer passed the check unchanged.
  // Sound as a guard against the wrong peer's inbound content, useless
  // against the actual failure mode here. Removed rather than kept as an
  // inert check that reads as a stronger guarantee than it provides —
  // matches the identical decision in ChatView.tsx.
  //
  // This effect's `messages()` source is now an ALWAYS-TRUTHY object
  // (`{ peer, auth }`, below) rather than `authStatus() === 'ready' ?
  // peerAddress : undefined` — that previous shape made `createResource`
  // short-circuit entirely on `undefined` (e.g. across a disconnect),
  // leaving `loading` stuck `false` while `value()` kept the previous
  // peer's rows — bypassing this very guard (round-3 re-audit finding,
  // reproduced empirically).
  createEffect(() => {
    if (messages.loading) return;
    const fresh = messages();
    const peer = props.peerAddress;
    if (!peer || fresh === undefined) return;
    setCachedMessages((prev) => mergeMessages(prev, fresh, DM_REQUESTED_LIMIT));
  });

  // The DM view component may be reused across conversations (only the route param
  // changes), so clear per-conversation local state when the peer changes —
  // otherwise the previous peer's messages (including your own optimistic sends)
  // leak into the newly-opened conversation.
  createEffect(() => {
    const peer = props.peerAddress;
    setLocalMessages([]);
    // Seed from the local cache — paints the conversation instantly from
    // its last-seen snapshot instead of a blank screen while the fetch
    // below is in flight. Reconciled once that fetch resolves; see the
    // merge effect after the resource.
    setCachedMessages(peer ? readCachedMessages('dm', peer, getCurrentNodeUrl()) : []);
    // Reset the auto-scroll trackers so each opened conversation scrolls to its
    // newest message once (these are component-scoped and would otherwise stay
    // `dmInitialLoad=false` from the first conversation → the next one opens
    // scrolled to the oldest message).
    prevDmCount = 0;
    dmInitialLoad = true;
  });

  // Auto-refresh: the open conversation otherwise only loads once (on open), so a
  // DM that arrives while you're viewing only shows after leaving + returning. The
  // node can't push DM bodies over the shared WS broadcast (it would leak to every
  // client), so poll the recipient's own authenticated endpoint. The dedup below
  // drops the optimistic copy when the real one arrives, so there's no duplication.
  let dmPollTimer: ReturnType<typeof setInterval> | null = null;
  onMount(() => {
    dmPollTimer = setInterval(() => {
      if (props.peerAddress && authStatus() === 'ready') refetchDmMessages();
    }, 8000);
  });
  onCleanup(() => { if (dmPollTimer) clearInterval(dmPollTimer); });

  const MAX_LOCAL_MESSAGES = 200;

  // Real-time DM updates
  const cleanup = onWsEvent((event) => {
    if (event.type === 'dm') {
      const msg = event.envelope;
      // A DM edit/delete carries `target_msg_id` (vs a fresh message which doesn't).
      // It changes an EXISTING message in place, so pull the authoritative,
      // server-projected conversation rather than appending a phantom entry. Covers
      // both the peer's edits and our own (the node echoes to both participants).
      if (msg.target_msg_id) {
        if (props.peerAddress && authStatus() === 'ready') refetchDmMessages();
        return;
      }
      // Only incoming messages from THIS peer. Our own sends are shown
      // optimistically; matching `author === me` here would pull a DM we sent to a
      // DIFFERENT peer into whichever conversation happens to be open.
      if (msg.author === props.peerAddress) {
        setLocalMessages((prev) => {
          const next = [...prev, msg];
          return next.length > MAX_LOCAL_MESSAGES ? next.slice(-MAX_LOCAL_MESSAGES) : next;
        });
        // The peer is active → ensure my key is wrapped to all their current
        // devices, so a device of theirs that joined after I established my key can
        // read my messages without an app reload (throttled inside coverPeerDevices).
        void coverPeerDevices(props.peerAddress);
        // Mark as read while viewing so unread badge doesn't appear
        if (authStatus() === 'ready') {
          getClient().markDmRead(props.peerAddress).catch(() => {});
        }
      }
    }
  });
  onCleanup(cleanup);

  // Combine server + local messages. First drop optimistic (`local-`) sends once
  // the server has the real copy (matched by author + timestamp window) so a poll
  // refetch doesn't show the message twice; then dedup by msg_id.
  const normTs = (t: any) => { const n = Number(t) || 0; return n < 1e12 ? n * 1000 : n; };
  const allMessages = () => {
    const real = messages() || [];
    const local = localMessages().filter((lm) => {
      if (!String(lm.msg_id ?? '').startsWith('local-')) return true;
      return !real.some((rm) =>
        rm.author === lm.author &&
        Math.abs(normTs(rm.timestamp) - normTs(lm.timestamp)) < 15000);
    });
    const seen = new Set<string>();
    // cachedMessages last (lowest priority) — already reconciled against
    // `real` by the merge effect above, kept here only so a still-loading
    // fetch (or a transient failure) doesn't blank a conversation that has
    // a valid cached snapshot.
    return [...real, ...local, ...cachedMessages()].filter((msg) => {
      if (!msg.msg_id || seen.has(msg.msg_id)) return false;
      seen.add(msg.msg_id);
      return true;
    });
  };
  // `allMessages` above is a plain (unmemoized) function — this wraps it
  // purely so the persist effect below can track its dependencies
  // (messages/localMessages/cachedMessages) as one unit, without changing
  // any of the many existing `allMessages()` call sites elsewhere in this
  // file. Returns raw (still-encrypted) envelopes, same as `allMessages`
  // itself — decryption happens separately into `dmDisplays` below, so
  // what gets cached here is ciphertext, matching `messageCache.ts`'s
  // ciphertext-only design.
  const allMessagesMemo = createMemo(allMessages);
  // CRITICAL, round 2 (re-audit finding — round 1's fix here was
  // INCOMPLETE, not wrong in direction; see ChatView.tsx's identical fix
  // for the full explanation of the underlying `createResource` behavior).
  // Capturing `{ peer, snapshot }` at schedule time closes the "switch-
  // then-flush" race, but `allMessagesMemo()` still transitively includes
  // `messages()`, and `createResource` retains the PREVIOUS peer's
  // `value()` while a new fetch is in flight. Round 1's mitigation —
  // filtering the snapshot by `author === peer || author === me` — was
  // insufficient: it rejects the wrong peer's INBOUND rows, but every
  // message I've ever SENT, to ANY peer, is authored by `me` — so my own
  // outbound history with peer A passes the filter unchanged when it gets
  // captured for peer B. Reproduced empirically. Fixed the same way as
  // ChatView: `messages.loading` read unconditionally (keeps it tracked)
  // and arming a new pending write skipped while `true`, deferring to the
  // next run once the CURRENT peer's fetch has resolved. The author filter
  // is removed rather than kept as inert "defense in depth".
  let dmPersistTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingDmPersist: { peer: string; snapshot: any[] } | null = null;
  const writeDmPending = () => {
    if (!pendingDmPersist) return;
    const { peer, snapshot } = pendingDmPersist;
    pendingDmPersist = null;
    writeCachedMessages('dm', peer, snapshot, getCurrentNodeUrl());
  };
  const flushDmCachePersist = () => {
    if (dmPersistTimer) { clearTimeout(dmPersistTimer); dmPersistTimer = null; }
    writeDmPending();
  };
  createEffect(() => {
    const peer = props.peerAddress;
    const snapshot = allMessagesMemo(); // always read — keeps tracking
    const loading = messages.loading; // complete regardless of branch below.
    if (dmPersistTimer) clearTimeout(dmPersistTimer);
    // A peer switch mid-debounce would otherwise silently drop the
    // PREVIOUS peer's still-unwritten snapshot — flush it first.
    if (pendingDmPersist && pendingDmPersist.peer !== peer) writeDmPending();
    if (!peer) { pendingDmPersist = null; return; }
    // Don't arm a write while the resource is between peers — this run
    // fires again once `loading` flips back to `false`, at which point
    // `allMessagesMemo()` (re-read fresh then) reflects the CURRENT peer.
    if (loading) return;
    pendingDmPersist = { peer, snapshot };
    dmPersistTimer = setTimeout(writeDmPending, 1000);
  });
  onCleanup(flushDmCachePersist);
  if (typeof document !== 'undefined') {
    const onDmVisChange = () => { if (document.visibilityState === 'hidden') flushDmCachePersist(); };
    document.addEventListener('visibilitychange', onDmVisChange);
    onCleanup(() => document.removeEventListener('visibilitychange', onDmVisChange));
  }

  // Per-message decrypted display, keyed by msg_id. Decryption is async (the
  // conv_key may need a node round-trip), so we resolve it off to the side and
  // render from this map. `waiting` entries are retried on the next poll/refetch
  // (e.g. once a key envelope arrives for a freshly-joined device).
  const [dmDisplays, setDmDisplays] = createSignal<Record<string, DmDisplay>>({});
  // Non-reactive record of the edit stamp we last decrypted per msg_id. An edit
  // replaces the message's ciphertext (node-side projection), so a resolved bubble
  // must be re-decrypted when `last_edited_at` advances — otherwise an edited DM
  // (mine OR the peer's) keeps showing the pre-edit text until a full reload.
  const decodedEditStamp = new Map<string, number>();
  createEffect(() => {
    const msgs = allMessages(); // track
    const cur = untrack(() => dmDisplays());
    for (const msg of msgs) {
      const id = msg.msg_id;
      if (!id) continue;
      const stamp = Number(msg.last_edited_at ?? 0);
      const existing = cur[id];
      // Skip only if resolved AND not edited since we last decrypted it.
      if (existing && existing.kind !== 'waiting' && decodedEditStamp.get(id) === stamp) continue;
      decodedEditStamp.set(id, stamp);
      decryptDmMessage(msg.payload, msg.author)
        .then((disp) => setDmDisplays((prev) => ({ ...prev, [id]: disp })))
        .catch(() => setDmDisplays((prev) => ({ ...prev, [id]: { kind: 'error' } })));
    }
  });

  /** Display text for a DM message bubble (decrypted, or a lock placeholder). */
  const dmText = (msg: any): string => {
    const d = dmDisplays()[msg.msg_id];
    if (!d) return '…'; // decrypting (resolves async) — avoids a blank bubble on load
    if (d.kind === 'text' || d.kind === 'plain') return d.text;
    if (d.kind === 'waiting') return `🔒 ${t('dm_waiting_for_key')}`;
    return `🔒 ${t('dm_cannot_decrypt')}`;
  };

  /** Encrypted-media descriptors (P5) for a DM bubble. Optimistic local echoes
   *  carry them directly (`_media`); server-echoed DMs surface them via decrypt. */
  const dmMedia = (msg: any): MediaDescriptor[] => {
    if (msg._media) return msg._media as MediaDescriptor[];
    const d = dmDisplays()[msg.msg_id];
    return d && d.kind === 'text' && d.media ? d.media : [];
  };

  // Mark conversation as read on mount
  onMount(async () => {
    if (authStatus() === 'ready' && props.peerAddress) {
      try {
        const client = getClient();
        await client.markDmRead(props.peerAddress);
      } catch {
        // Non-critical — ignore
      }
    }
  });

  // Reaching the latest message marks the DM read (once per scroll-to-bottom).
  let dmWasAtBottom = true;
  const handleDmScroll = () => {
    if (!messagesRef) return;
    const { scrollTop, scrollHeight, clientHeight } = messagesRef;
    const atBottom = scrollHeight - scrollTop - clientHeight < 150;
    if (atBottom && !dmWasAtBottom && authStatus() === 'ready' && props.peerAddress) {
      getClient().markDmRead(props.peerAddress).catch(() => {});
    }
    dmWasAtBottom = atBottom;
  };

  // Encrypt a picked/pasted file and append it as a pending attachment. DMs are
  // always E2E-encrypted, so the bytes are sealed before upload (P5) and the
  // composer preview uses a local object URL of the original file.
  const attachFile = async (file: File) => {
    try {
      const descriptor = await uploadEncryptedFile(file);
      setAttachments((p) => [...p, {
        cid: descriptor.cid, mime_type: descriptor.mime, size_bytes: descriptor.size,
        filename: descriptor.name, descriptor, previewUrl: URL.createObjectURL(file),
      }]);
    } catch { /* best-effort; MediaUpload surfaces its own errors */ }
  };

  const handleSend = async () => {
    if (editingMsg()) { await handleEdit(); return; }

    const text = messageInput().trim();
    const atts = attachments();
    if ((!text && atts.length === 0) || sending()) return;

    const signer = getSigner();
    if (!signer || !walletAddress()) return;

    setSending(true);
    setSendError(null);
    try {
      const client = getClient();
      // P5: file bytes were already encrypted on pick — the per-file descriptors
      // ride INSIDE the sealed DM content via `media` (the wire attachments are
      // opaque ciphertext), so the node never sees the plaintext bytes or mime/name.
      const media = atts.map((a) => a.descriptor).filter((d): d is MediaDescriptor => !!d);
      const envelope = await buildEncryptedDm(props.peerAddress, text, undefined, media.length > 0 ? media : undefined);
      await client.sendDm(props.peerAddress, envelope);
      setMessageInput('');

      // Optimistic: show sent message immediately. The encrypted-media descriptors
      // render via `_media` (the wire attachments would be ciphertext), and the
      // body is plain text in the optimistic payload.
      setLocalMessages((prev) => [...prev, {
        msg_id: `local-${Date.now()}`,
        author: walletAddress(),
        timestamp: Date.now(),
        payload: buildOptimisticChatPayload({ content: text }),
        ...(media.length > 0 ? { _media: media } : {}),
      }]);

      // Composer previews are local object URLs of the originals — revoke on send.
      for (const a of atts) if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
      setAttachments([]);

      setTimeout(() => {
        inputRef?.focus();
        if (messagesRef) messagesRef.scrollTo({ top: messagesRef.scrollHeight, behavior: 'smooth' });
      }, 50);
    } catch (err: any) {
      console.error('sendDm failed:', err);
      const raw = err?.message || String(err);
      // Recipient has no registered encryption keys → they can't receive E2E DMs.
      const msg = raw.includes('RECIPIENT_NO_ENC_KEYS')
        ? t('dm_recipient_no_encryption')
        : raw;
      setSendError(msg);
      setTimeout(() => setSendError(null), 6000);
    } finally {
      setSending(false);
    }
  };

  const insertEmoji = (emoji: string) => {
    if (!inputRef) return;
    const start = inputRef.selectionStart ?? messageInput().length;
    const end = inputRef.selectionEnd ?? start;
    const current = messageInput();
    setMessageInput(current.slice(0, start) + emoji + current.slice(end));
    setTimeout(() => {
      inputRef?.focus();
      const pos = start + emoji.length;
      inputRef?.setSelectionRange(pos, pos);
    }, 0);
  };

  const msgIdToHex = (id: unknown): string => {
    if (typeof id === 'string') return id;
    if (id instanceof Uint8Array) return Array.from(id).map((b) => b.toString(16).padStart(2, '0')).join('');
    if (Array.isArray(id)) return id.map((b: number) => b.toString(16).padStart(2, '0')).join('');
    return String(id);
  };

  // NOTE: unlike NewsEdit, the node does NOT require on-chain registration for DM
  // (or chat) edits/deletes — only own-message + within the edit window. Gating on
  // isRegistered() here wrongly hid the actions whenever registration detection was
  // stale (e.g. the node-not-ready boot race), so it's deliberately omitted.
  const canEdit = (msg: any) =>
    msg.author === walletAddress() && !msg.deleted &&
    (Date.now() - new Date(msg.timestamp).getTime()) < EDIT_WINDOW_MS;

  const canDelete = (msg: any) =>
    msg.author === walletAddress() && !msg.deleted;

  const startEdit = (msg: any) => {
    // Editing is a verified-wallet feature (node `requires_verified_identity`).
    // Nudge unverified users to verify instead of letting the edit fail with a 400.
    if (!isRegistered()) { setShowVerifyPrompt(true); return; }
    // Prefill with the decrypted text (the raw payload content is ciphertext for
    // encrypted DMs). The edit is re-encrypted under the conv_key on save, so the
    // node never sees the new plaintext (see handleEdit).
    const text = dmText(msg);
    setEditingMsg({ msgId: msgIdToHex(msg.msg_id), content: text });
    setMessageInput(text);
    inputRef?.focus();
  };

  const cancelEdit = () => { setEditingMsg(null); setMessageInput(''); };

  const handleEdit = async () => {
    const edit = editingMsg();
    if (!edit || !messageInput().trim()) return;
    setSending(true);
    try {
      const client = getClient();
      const newText = messageInput().trim();
      // Re-encrypt the new content under the conv_key and send as a DM edit
      // envelope via the same DM POST path as a fresh message.
      const envelope = await buildEncryptedDmEditEnvelope(props.peerAddress, edit.msgId, newText);
      await client.sendDm(props.peerAddress, envelope);
      // Optimistic: show the new text immediately. The decrypt effect re-confirms
      // it from the re-encrypted server echo once `last_edited_at` advances.
      setDmDisplays((p) => ({ ...p, [edit.msgId]: { kind: 'text', text: newText } }));
      setLocalMessages((prev) => prev.map((m) =>
        msgIdToHex(m.msg_id) === edit.msgId ? { ...m, edited: true } : m,
      ));
      setEditingMsg(null);
      setMessageInput('');
    } catch (err) {
      console.error('DM edit failed:', err);
    }
    finally { setSending(false); }
  };

  const handleDeleteDm = async (msg: any) => {
    // Deleting is likewise a verified-wallet feature — prompt instead of failing.
    if (!isRegistered()) { setShowVerifyPrompt(true); return; }
    if (!window.confirm(t('chat_delete_confirm'))) return;
    try {
      const client = getClient();
      await client.deleteDm(props.peerAddress, msgIdToHex(msg.msg_id));
      setLocalMessages((prev) => prev.map((m) =>
        msgIdToHex(m.msg_id) === msgIdToHex(msg.msg_id) ? { ...m, deleted: true } : m,
      ));
    } catch { /* failed */ }
  };

  const handleReactDm = async (msg: any, emoji: string) => {
    if (!walletAddress()) return;
    setShowReactPicker(null);
    try {
      const client = getClient();
      await client.reactToDm(props.peerAddress, msgIdToHex(msg.msg_id), emoji);
    } catch { /* failed */ }
  };

  const truncateAddress = (addr: string) =>
    `${addr.slice(0, 8)}...${addr.slice(-4)}`;

  return (
    <div class="dm-conv-view">
      <div class="dm-conv-header">
        <Show when={isModernStyle()} fallback={
          <>
            <button class="dm-back-btn" onClick={() => goBack('/dm')}>← {t('nav_dms')}</button>
            <span class="dm-conv-peer" onClick={() => navigate(`/user/${props.peerAddress}`)}>{truncateAddress(props.peerAddress)}</span>
          </>
        }>
          <button class="channel-back-btn content-back-btn" onClick={() => showMobileList()}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><polyline points="12 19 5 12 12 5"/></svg>
          </button>
          <div style="width:36px; height:36px; border-radius:50%; flex-shrink:0; overflow:hidden; cursor:pointer" onClick={() => navigate(`/user/${props.peerAddress}`)}>
            <Show when={peerProfile().avatar_cid} fallback={
              <div style="width:36px; height:36px; border-radius:50%; background:var(--color-dm); color:#fff; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:14px">
                {peerName().slice(0, 1).toUpperCase()}
              </div>
            }>
              <img src={getClient().getMediaUrl(peerProfile().avatar_cid!)} alt="" style="width:36px; height:36px; border-radius:50%; object-fit:cover" />
            </Show>
          </div>
          <span class="dm-conv-peer" onClick={() => navigate(`/user/${props.peerAddress}`)}>{peerName()}</span>
        </Show>
      </div>

      <div class="dm-conv-messages" ref={messagesRef} onScroll={handleDmScroll}>
        <Show
          when={allMessages().length > 0}
          fallback={<div class="dm-conv-empty">{t('dm_no_messages')}</div>}
        >
          <For each={allMessages()}>
            {(msg) => (
              <div
                class={`dm-msg ${msg.author === walletAddress() ? 'own' : 'peer'} ${msg.deleted ? 'deleted' : ''}`}
                onContextMenu={(e) => { if (msg.deleted) return; e.preventDefault(); openDmMenu(e.clientX, e.clientY, msg); }}
                onTouchStart={(e) => handleDmTouchStart(e, msg)}
                onTouchEnd={cancelDmLongPress}
                onTouchMove={cancelDmLongPress}
              >
                <Show
                  when={!msg.deleted}
                  fallback={<div class="dm-msg-body dm-msg-deleted">{t('message_deleted')}</div>}
                >
                  <div class="dm-msg-body">
                    {/* DMs are always E2E-encrypted, so the on-wire attachments are
                        opaque ciphertext — render the sealed `media` descriptors
                        (P5) instead of the plaintext attachment path. */}
                    <FormattedText content={dmText(msg)} attachments={[]} />
                    <EncryptedAttachments media={dmMedia(msg)} />
                  </div>
                </Show>
                <span class="dm-msg-time">
                  {new Date(msg.timestamp).toLocaleTimeString(undefined, {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  <Show when={msg.edited}>
                    <span class="dm-edited"> ({t('message_edited')})</span>
                  </Show>
                </span>
                <Show when={!msg.deleted}>
                  <div class="dm-msg-actions">
                    <Show when={walletAddress()}>
                      <button class="dm-action-btn" onClick={() => setShowReactPicker(showReactPicker() === msgIdToHex(msg.msg_id) ? null : msgIdToHex(msg.msg_id))} title={t('chat_react')}>😊</button>
                    </Show>
                    <Show when={canEdit(msg)}>
                      <button class="dm-action-btn" onClick={() => startEdit(msg)} title={t('chat_edit')}>✏</button>
                    </Show>
                    <Show when={canDelete(msg)}>
                      <button class="dm-action-btn" onClick={() => handleDeleteDm(msg)} title={t('chat_delete')}>🗑</button>
                    </Show>
                  </div>
                </Show>
                <Show when={showReactPicker() === msgIdToHex(msg.msg_id)}>
                  <div class="dm-react-picker">
                    {['👍', '👎', '❤️', '🔥', '😂', '😮'].map((emoji) => (
                      <button class="dm-react-btn" onClick={() => handleReactDm(msg, emoji)}>{emoji}</button>
                    ))}
                  </div>
                </Show>
                <Show when={msg.reactions && Object.keys(msg.reactions).length > 0}>
                  <div class="dm-msg-reactions">
                    {Object.entries(msg.reactions as Record<string, number>).map(([emoji, count]) => (
                      <span class="reaction-badge">{emoji} {count}</span>
                    ))}
                  </div>
                </Show>
              </div>
            )}
          </For>
        </Show>
      </div>

      {/* Verify-wallet nudge — shown when an unverified wallet tries edit/delete */}
      <Show when={showVerifyPrompt()}>
        <div class="dm-verify-overlay" onClick={() => setShowVerifyPrompt(false)}>
          <div class="dm-verify-modal" onClick={(e) => e.stopPropagation()}>
            <div class="dm-verify-icon">🔓</div>
            <p class="dm-verify-text">{t('verification_required')}</p>
            <div class="dm-verify-actions">
              <button class="dm-verify-cancel" onClick={() => setShowVerifyPrompt(false)}>{t('chat_edit_cancel')}</button>
              <button class="dm-verify-go" onClick={() => { setShowVerifyPrompt(false); navigate('/wallet'); }}>{t('verification_go_to_wallet')}</button>
            </div>
          </div>
        </div>
      </Show>

      {/* Right-click / long-press message context menu */}
      <Show when={dmMenu()}>
        <div
          class="dm-context-menu"
          style={{ left: `${dmMenu()!.x}px`, top: `${dmMenu()!.y}px` }}
          ref={(el) => {
            dmMenuRef = el;
            // The pre-clamp uses an ESTIMATED size; the emoji row makes the real
            // menu wider, so re-measure once mounted and nudge fully on-screen.
            if (!el) return;
            requestAnimationFrame(() => {
              const r = el.getBoundingClientRect();
              if (r.right > window.innerWidth - DM_MENU_MARGIN) {
                el.style.left = `${Math.max(DM_MENU_MARGIN, window.innerWidth - r.width - DM_MENU_MARGIN)}px`;
              }
              if (r.bottom > window.innerHeight - DM_MENU_MARGIN) {
                el.style.top = `${Math.max(DM_MENU_MARGIN, window.innerHeight - r.height - DM_MENU_MARGIN)}px`;
              }
            });
          }}
        >
          <Show when={walletAddress() && !dmMenu()!.msg.deleted}>
            <div class="dm-ctx-emoji">
              {['👍', '❤️', '😂', '🔥', '😮', '👎'].map((emoji) => (
                <button onClick={() => { handleReactDm(dmMenu()!.msg, emoji); setDmMenu(null); }}>{emoji}</button>
              ))}
            </div>
          </Show>
          <Show when={canEdit(dmMenu()!.msg)}>
            <button class="dm-ctx-item" onClick={() => { startEdit(dmMenu()!.msg); setDmMenu(null); }}>✏ {t('chat_edit')}</button>
          </Show>
          <Show when={canDelete(dmMenu()!.msg)}>
            <button class="dm-ctx-item dm-ctx-danger" onClick={() => { handleDeleteDm(dmMenu()!.msg); setDmMenu(null); }}>🗑 {t('chat_delete')}</button>
          </Show>
        </div>
      </Show>

      <Show when={editingMsg()}>
        <div class="dm-edit-indicator">
          <span class="dm-edit-label">✏ {t('chat_edit_mode')}</span>
          <button class="dm-edit-cancel" onClick={cancelEdit}>{t('chat_edit_cancel')}</button>
        </div>
      </Show>

      <Show when={authStatus() === 'ready'}>
        <Show when={sendError()}>
          <div class="dm-send-error" onClick={() => setSendError(null)}>{sendError()}</div>
        </Show>
        <Show when={isModernStyle()} fallback={
          /* Classic DM input */
          <>
            <Show when={!editingMsg()}>
              <div class="dm-media-bar">
                <MediaUpload attachments={attachments()} encrypted={true} onAttach={(a) => setAttachments((prev) => [...prev, a])} onRemove={(i) => setAttachments((prev) => { const a = prev[i]; if (a?.previewUrl) URL.revokeObjectURL(a.previewUrl); return prev.filter((_, idx) => idx !== i); })} disabled={sending()} />
              </div>
            </Show>
            <div class="dm-input-area">
              <div class="dm-input-row">
                <textarea ref={inputRef} class="dm-textarea" rows={3} placeholder={t('chat_placeholder')} value={messageInput()}
                  onInput={(e) => setMessageInput(e.currentTarget.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && (messageInput().trim() || attachments().length > 0)) { e.preventDefault(); handleSend(); } }}
                  onPaste={(e) => { const items = e.clipboardData?.items; if (!items || !walletAddress()) return; const img = Array.from(items).find((i) => i.type.startsWith('image/')); if (!img) return; e.preventDefault(); const raw = img.getAsFile(); if (!raw) return; void attachFile(new File([raw], `paste-${Date.now()}.${raw.type.split('/')[1] || 'png'}`, { type: raw.type })); }}
                  disabled={sending() || !walletAddress()} />
                <div class="dm-input-actions">
                  <div class="dm-emoji-container">
                    <button class="dm-emoji-toggle" onClick={() => walletAddress() && setShowEmoji(!showEmoji())} disabled={!walletAddress()}>😊</button>
                    <Show when={showEmoji()}><EmojiPicker onSelect={insertEmoji} onClose={() => setShowEmoji(false)} /></Show>
                  </div>
                  <button class="dm-send-btn" onClick={handleSend} disabled={sending() || (!messageInput().trim() && attachments().length === 0) || !walletAddress()}>{t('chat_send')}</button>
                </div>
              </div>
            </div>
          </>
        }>
          {/* Modern DM input: [emoji] [attach] [textarea] [send] */}
          <div class="dm-input-area">
            {/* Attachment preview strip — same fix as ChatView's modern
                input. `.dm-media-bar` is hidden in modern, so without
                this strip the upload looks like a no-op to the user. */}
            <Show when={attachments().length > 0}>
              <div class="modern-attachments-preview">
                <For each={attachments()}>
                  {(att, i) => (
                    <div class="modern-attach-chip">
                      <Show
                        when={att.mime_type.startsWith('image/')}
                        fallback={<span class="modern-attach-icon">{att.mime_type.startsWith('video/') ? '🎬' : '📎'}</span>}
                      >
                        <img
                          class="modern-attach-thumb"
                          src={att.previewUrl || getClient().getMediaUrl(att.thumbnail_cid || att.cid)}
                          alt={att.filename || ''}
                          loading="lazy"
                        />
                      </Show>
                      <span class="modern-attach-name">{safeAttachmentName(att, 10)}</span>
                      <button
                        class="modern-attach-remove"
                        onClick={() =>
                          setAttachments((prev) => {
                            const gone = prev[i()];
                            if (gone?.previewUrl) URL.revokeObjectURL(gone.previewUrl);
                            return prev.filter((_, idx) => idx !== i());
                          })
                        }
                        title={t('cancel')}
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </For>
              </div>
            </Show>
            <div class="dm-input-row">
              <div class="dm-emoji-container">
                <button class="input-icon-btn" onClick={() => walletAddress() && setShowEmoji(!showEmoji())} disabled={!walletAddress()}>😊</button>
                <Show when={showEmoji()}><EmojiPicker onSelect={insertEmoji} onClose={() => setShowEmoji(false)} /></Show>
              </div>
              <button class="input-icon-btn" onClick={() => modernDmAttachInputRef?.click()} disabled={!walletAddress()}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
              </button>
              <input
                type="file"
                ref={modernDmAttachInputRef}
                style="display:none"
                onChange={(e) => {
                  const file = e.currentTarget.files?.[0];
                  if (file) void attachFile(file);
                  e.currentTarget.value = '';
                }}
              />
              <textarea ref={inputRef} class="dm-textarea" rows={1} placeholder={t('chat_placeholder')} value={messageInput()}
                onInput={(e) => { setMessageInput(e.currentTarget.value); e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = Math.min(e.currentTarget.scrollHeight, 160) + 'px'; }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && (messageInput().trim() || attachments().length > 0)) { e.preventDefault(); handleSend(); } }}
                onPaste={(e) => { const items = e.clipboardData?.items; if (!items || !walletAddress()) return; const img = Array.from(items).find((i) => i.type.startsWith('image/')); if (!img) return; e.preventDefault(); const raw = img.getAsFile(); if (!raw) return; void attachFile(new File([raw], `paste-${Date.now()}.${raw.type.split('/')[1] || 'png'}`, { type: raw.type })); }}
                disabled={sending() || !walletAddress()} />
              <button class="dm-send-btn" onClick={handleSend} disabled={sending() || (!messageInput().trim() && attachments().length === 0) || !walletAddress()} title={t('chat_send')}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></svg>
              </button>
            </div>
          </div>
        </Show>
      </Show>

      <style>{`
        .dm-conv-view { display: flex; flex-direction: column; height: 100%; height: 100dvh; max-height: -webkit-fill-available; }
        .dm-conv-header {
          display: flex;
          align-items: center;
          gap: var(--spacing-md);
          padding: var(--spacing-sm) var(--spacing-md);
          border-bottom: 1px solid var(--color-border);
          background: var(--color-bg-secondary);
        }
        .dm-back-btn {
          font-size: var(--font-size-sm);
          color: var(--color-text-secondary);
          padding: var(--spacing-xs) var(--spacing-sm);
          border-radius: var(--radius-md);
        }
        .dm-back-btn:hover { background: var(--color-bg-tertiary); }
        .dm-conv-peer {
          font-weight: 600;
          color: var(--color-accent-primary);
          cursor: pointer;
          font-size: var(--font-size-sm);
        }
        .dm-conv-peer:hover { text-decoration: underline; }
        .dm-conv-messages {
          flex: 1;
          overflow-y: auto;
          padding: var(--spacing-md);
          display: flex;
          flex-direction: column;
          gap: var(--spacing-sm);
        }
        .dm-conv-empty {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 100%;
          color: var(--color-text-secondary);
        }
        .dm-msg {
          max-width: 70%;
          padding: var(--spacing-sm) var(--spacing-md);
          border-radius: var(--radius-lg);
        }
        .dm-msg.own {
          align-self: flex-end;
          background: color-mix(in srgb, var(--color-accent-primary) 35%, var(--color-bg-secondary));
          border: 1px solid var(--color-accent-primary);
        }
        .dm-msg.peer {
          align-self: flex-start;
          background: var(--color-bg-secondary);
          border: 1px solid var(--color-border);
        }
        .dm-msg-body { font-size: var(--font-size-md); line-height: 1.5; }
        .dm-msg-time {
          display: block;
          font-size: var(--font-size-xs);
          color: var(--color-text-secondary);
          text-align: right;
          margin-top: var(--spacing-xs);
        }
        .dm-media-bar {
          padding: var(--spacing-xs) var(--spacing-md);
          border-top: 1px solid var(--color-border);
        }
        .dm-send-error {
          padding: var(--spacing-xs) var(--spacing-md);
          background: var(--color-error);
          color: white;
          font-size: var(--font-size-sm);
          cursor: pointer;
          text-align: center;
        }
        .dm-input-area {
          border-top: 1px solid var(--color-border);
          padding: var(--spacing-sm) var(--spacing-md);
        }
        .dm-input-row {
          display: flex;
          gap: var(--spacing-sm);
          align-items: flex-end;
        }
        .dm-textarea {
          flex: 1;
          padding: var(--spacing-sm) var(--spacing-md);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-md);
          background: var(--color-bg-tertiary);
          color: var(--color-text-primary);
          font-family: inherit;
          font-size: var(--font-size-md);
          resize: none;
          line-height: 1.4;
        }
        .dm-textarea:focus { outline: none; border-color: var(--color-accent-primary); }
        .dm-textarea:disabled { opacity: 0.6; }
        .dm-input-actions {
          display: flex;
          flex-direction: column;
          gap: var(--spacing-xs);
          align-items: center;
        }
        .dm-emoji-container { position: relative; }
        .dm-emoji-toggle {
          font-size: var(--font-size-lg);
          padding: var(--spacing-xs);
          border-radius: var(--radius-sm);
          cursor: pointer;
        }
        .dm-emoji-toggle:hover { background: var(--color-bg-tertiary); }
        .dm-emoji-toggle:disabled { opacity: 0.4; cursor: default; }
        .dm-send-btn {
          padding: var(--spacing-sm) var(--spacing-lg);
          background: var(--color-accent-primary);
          color: var(--color-text-inverse);
          border-radius: var(--radius-md);
          font-weight: 600;
          font-size: var(--font-size-sm);
        }
        .dm-send-btn:disabled { opacity: 0.5; cursor: default; }
        .dm-msg-actions { display: flex; gap: 2px; opacity: 0; transition: opacity 0.15s; margin-top: var(--spacing-xs); }
        .dm-msg:hover .dm-msg-actions { opacity: 1; }
        .dm-action-btn { font-size: var(--font-size-xs); color: var(--color-text-secondary); cursor: pointer; padding: 2px 4px; border-radius: var(--radius-sm); }
        .dm-action-btn:hover { color: var(--color-accent-primary); background: var(--color-bg-tertiary); }
        .dm-context-menu {
          position: fixed;
          z-index: 1000;
          min-width: 160px;
          background: var(--color-bg-secondary);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-md);
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
          padding: 4px;
          display: flex;
          flex-direction: column;
        }
        .dm-ctx-emoji {
          display: flex;
          gap: 2px;
          padding: 4px 6px;
          border-bottom: 1px solid var(--color-border);
          margin-bottom: 4px;
        }
        .dm-ctx-emoji button {
          font-size: 20px;
          padding: 4px 5px;
          border-radius: var(--radius-sm);
          cursor: pointer;
          line-height: 1;
          background: none;
          border: none;
          transition: transform 0.1s;
        }
        .dm-ctx-emoji button:hover { transform: scale(1.2); }
        .dm-ctx-item {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          padding: 8px 12px;
          background: none;
          border: none;
          border-radius: var(--radius-sm);
          color: var(--color-text-primary);
          font-size: var(--font-size-sm);
          text-align: left;
          cursor: pointer;
        }
        .dm-ctx-item:hover { background: var(--color-bg-tertiary); }
        .dm-ctx-danger { color: var(--color-error, #e5484d); }
        .dm-verify-overlay {
          position: fixed;
          inset: 0;
          z-index: 1100;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: var(--spacing-lg);
        }
        .dm-verify-modal {
          background: var(--color-bg-secondary);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-lg);
          box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
          padding: var(--spacing-xl);
          max-width: 360px;
          text-align: center;
          display: flex;
          flex-direction: column;
          gap: var(--spacing-md);
        }
        .dm-verify-icon { font-size: 32px; }
        .dm-verify-text { margin: 0; color: var(--color-text-primary); line-height: 1.5; }
        .dm-verify-actions { display: flex; gap: var(--spacing-sm); justify-content: center; }
        .dm-verify-cancel, .dm-verify-go {
          padding: 8px 16px;
          border-radius: var(--radius-md);
          cursor: pointer;
          font-size: var(--font-size-sm);
          border: 1px solid var(--color-border);
        }
        .dm-verify-cancel { background: var(--color-bg-tertiary); color: var(--color-text-secondary); }
        .dm-verify-go { background: var(--color-accent-primary); color: #fff; border-color: var(--color-accent-primary); font-weight: 600; }
        .dm-verify-go:hover { opacity: 0.9; }
        .dm-react-picker { display: flex; gap: 4px; padding: var(--spacing-xs) 0; }
        .dm-react-btn { font-size: var(--font-size-md); padding: 2px 4px; border-radius: var(--radius-sm); cursor: pointer; }
        .dm-react-btn:hover { background: var(--color-bg-tertiary); }
        .dm-edit-indicator {
          display: flex; align-items: center; justify-content: space-between;
          padding: var(--spacing-xs) var(--spacing-md); background: var(--color-bg-tertiary);
          border-top: 1px solid var(--color-accent-primary); font-size: var(--font-size-sm);
        }
        .dm-edit-label { color: var(--color-accent-primary); font-weight: 600; }
        .dm-edit-cancel { font-size: var(--font-size-xs); color: var(--color-text-secondary); cursor: pointer; padding: var(--spacing-xs); }
        .dm-edit-cancel:hover { color: var(--color-text-primary); }
        .dm-msg.deleted { opacity: 0.5; }
        .dm-msg-deleted { font-style: italic; color: var(--color-text-secondary); }
        .dm-edited { font-size: var(--font-size-xs); color: var(--color-text-secondary); }
        .dm-msg-reactions { display: flex; flex-wrap: wrap; gap: 4px; margin-top: var(--spacing-xs); }
        .reaction-badge {
          display: inline-flex; align-items: center; gap: 2px;
          padding: 2px 6px; font-size: var(--font-size-xs);
          background: var(--color-bg-tertiary); border: 1px solid var(--color-border);
          border-radius: var(--radius-full);
        }
      `}</style>
    </div>
  );
};

/**
 * ChatView — channel messaging with real-time updates, emoji picker,
 * profile resolution, and optimistic message display.
 */

import { Component, createResource, createSignal, createEffect, createMemo, For, Show, onCleanup } from 'solid-js';
import { t } from '../i18n/init';
import { getClient } from '../lib/api';
import { authStatus, getSigner, walletAddress, isRegistered } from '../lib/auth';
import { onWsEvent, wsSubscribeChannels, wsUnsubscribeChannels } from '../lib/ws';
import { navigate } from '../lib/router';
import { showMobileList } from '../lib/mobile-nav';
import { setSetting } from '../lib/settings';
import { FormattedText } from '../components/FormattedText';
import { EmojiPicker } from '../components/EmojiPicker';
import { type MediaAttachment } from '../components/MediaUpload';
import { getPayloadContent, getPayloadAttachments, decodePayload } from '../lib/payload';
import { resolveProfile, type CachedProfile } from '../lib/profile';
import '../styles/chat-view.css';

/** Convert a msg_id (hex string, byte array, or Uint8Array) to a consistent hex string. */
function msgIdToHex(msgId: unknown): string {
  if (typeof msgId === 'string') return msgId;
  if (msgId instanceof Uint8Array) {
    return Array.from(msgId).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  if (Array.isArray(msgId)) {
    return msgId.map((b: number) => b.toString(16).padStart(2, '0')).join('');
  }
  return String(msgId);
}

/** Extract the reply_to msg_id from a message's payload as a hex string, or null. */
function getReplyToHex(msg: any): string | null {
  if (msg.reply_to_preview?.msg_id) return msgIdToHex(msg.reply_to_preview.msg_id);
  try {
    const decoded = decodePayload(msg.payload);
    if (decoded.reply_to) return msgIdToHex(decoded.reply_to);
  } catch { /* ignore */ }
  return null;
}

/** Format message time in user's local timezone. */
function formatMessageTime(timestamp: string | number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: '2-digit', minute: '2-digit',
  });
}

/** Get a date label for message grouping. */
function getDateLabel(timestamp: string | number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = today.getTime() - msgDay.getTime();
  if (diff === 0) return 'Today';
  if (diff === 86400000) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

interface ChatViewProps {
  channelId: number | null;
}

export const ChatView: Component<ChatViewProps> = (props) => {
  const [messageInput, setMessageInput] = createSignal('');
  const [replyTo, setReplyTo] = createSignal<{ msgId: string; author: string; preview: string } | null>(null);
  const [localMessages, setLocalMessages] = createSignal<any[]>([]);
  const [sending, setSending] = createSignal(false);
  const [showEmoji, setShowEmoji] = createSignal(false);
  const [profiles, setProfiles] = createSignal<Map<string, CachedProfile>>(new Map());
  const [userMenu, setUserMenu] = createSignal<{ x: number; y: number; address: string; msgId: string } | null>(null);

  /**
   * Open the user/message context menu at the given viewport coordinates,
   * clamping the position so the menu stays fully inside the viewport
   * (otherwise bottom items disappear under the Windows taskbar / browser
   * chrome when right-clicking a message near the bottom of the chat).
   *
   * Uses worst-case menu dimensions — safer to slightly over-estimate than
   * to let content overflow. A second-pass ref-based adjustment in the
   * menu element fine-tunes using the real measured size.
   */
  const MENU_ESTIMATED_WIDTH = 200;
  const MENU_ESTIMATED_HEIGHT = 360; // worst case: all items visible (mod + owner)
  const MENU_EDGE_MARGIN = 8;
  const openUserMenu = (clientX: number, clientY: number, address: string, msgId: string) => {
    const maxX = window.innerWidth - MENU_ESTIMATED_WIDTH - MENU_EDGE_MARGIN;
    const maxY = window.innerHeight - MENU_ESTIMATED_HEIGHT - MENU_EDGE_MARGIN;
    setUserMenu({
      x: Math.max(MENU_EDGE_MARGIN, Math.min(clientX, maxX)),
      y: Math.max(MENU_EDGE_MARGIN, Math.min(clientY, maxY)),
      address,
      msgId,
    });
  };
  const [myRole, setMyRole] = createSignal<'creator' | 'moderator' | 'member'>('member');
  const [expandedMuted, setExpandedMuted] = createSignal<Set<string>>(new Set());
  const [editingMsg, setEditingMsg] = createSignal<{ msgId: string; content: string } | null>(null);
  const [sendError, setSendError] = createSignal<string | null>(null);
  const [attachments, setAttachments] = createSignal<MediaAttachment[]>([]);
  const [uploadingAttach, setUploadingAttach] = createSignal(false);
  let attachFileInput: HTMLInputElement | undefined;
  // Blocked extensions (executables/scripts) — same list as MediaUpload.tsx
  const BLOCKED_ATTACH_EXT = new Set([
    'exe','bat','cmd','com','msi','scr','pif','vbs','vbe','js','jse','wsf','wsh',
    'ps1','psm1','psd1','sh','bash','csh','ksh','app','action','command','workflow',
    'dll','sys','drv','ocx','jar','class','war','apk','deb','rpm','dmg','iso',
    'reg','inf','lnk','url','hta','cpl','msc','gadget',
  ]);
  const MAX_ATTACH_BYTES = 10 * 1024 * 1024;
  /** Upload a single file and push it to the attachments list. */
  const uploadAttachment = async (file: File) => {
    if (!walletAddress()) return;
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (BLOCKED_ATTACH_EXT.has(ext)) {
      setSendError(t('media_blocked_type'));
      setTimeout(() => setSendError(null), 4000);
      return;
    }
    if (file.size > MAX_ATTACH_BYTES) {
      setSendError(t('media_too_large'));
      setTimeout(() => setSendError(null), 4000);
      return;
    }
    setUploadingAttach(true);
    try {
      const result = await getClient().uploadMedia(file, file.name);
      setAttachments((prev) => [...prev, {
        cid: result.cid,
        mime_type: file.type || 'application/octet-stream',
        size_bytes: file.size,
        filename: file.name,
        thumbnail_cid: result.thumbnail_cid,
      }]);
    } catch (e: any) {
      setSendError(e?.message || 'Upload fehlgeschlagen');
      setTimeout(() => setSendError(null), 4000);
    } finally {
      setUploadingAttach(false);
    }
  };

  // Track which emojis the current user has reacted with, per message — for highlighting "own" reactions.
  // Populated optimistically on react; not persisted across reloads.
  const [ownReactions, setOwnReactions] = createSignal<Map<string, Set<string>>>(new Map());
  // Floating "scroll to bottom" UI state — shown when user is scrolled away from the latest message.
  const [showScrollBtn, setShowScrollBtn] = createSignal(false);
  const [newMsgCount, setNewMsgCount] = createSignal(0);
  const EDIT_WINDOW_MS = 30 * 60 * 1000; // 30 minutes
  const GROUP_WINDOW_MS = 2 * 60 * 1000; // 2 minutes — combine consecutive messages
  const SCROLL_NEAR_BOTTOM_PX = 150;
  let inputRef: HTMLTextAreaElement | undefined;
  let messagesRef: HTMLDivElement | undefined;
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;

  // Close user context menu on any click
  if (typeof document !== 'undefined') {
    const closeUserMenu = () => setUserMenu(null);
    document.addEventListener('click', closeUserMenu);
    onCleanup(() => document.removeEventListener('click', closeUserMenu));
  }

  const handleUserAction = async (action: string) => {
    const ctx = userMenu();
    if (!ctx || !props.channelId) return;
    setUserMenu(null);

    const client = getClient();
    const targetMsg = msgById().get(ctx.msgId);
    try {
      switch (action) {
        case 'profile':
          navigate(`/user/${ctx.address}`);
          break;
        case 'reply':
          if (targetMsg) handleReply(targetMsg);
          break;
        case 'edit':
          if (targetMsg) startEdit(targetMsg);
          break;
        case 'delete':
          if (targetMsg) await handleDelete(targetMsg);
          break;
        case 'kick':
          if (window.confirm(`Kick ${ctx.address.slice(0, 12)}...?`))
            await client.kickUser(props.channelId, ctx.address);
          break;
        case 'ban': {
          const reason = window.prompt(t('channel_ban_reason'));
          if (reason !== null)
            await client.banUser(props.channelId, ctx.address, reason || undefined);
          break;
        }
        case 'mute':
          await client.muteUser({ channelId: props.channelId, targetUser: ctx.address, durationSecs: 3600 });
          break;
        case 'pin':
          await client.pinMessage(props.channelId, ctx.msgId);
          break;
        case 'report': {
          const reason = window.prompt(t('report_reason'));
          if (reason !== null) {
            await client.reportMessage(ctx.msgId, (reason || 'No reason provided').slice(0, 500), 'other');
          }
          break;
        }
      }
    } catch { /* ignore */ }
  };

  /** Scroll chat to the bottom. */
  const scrollToBottom = () => {
    if (messagesRef) messagesRef.scrollTop = messagesRef.scrollHeight;
  };

  let lastChannelId: number | null = null;
  let prevMsgCount = 0;
  let initialLoad = true;
  const [lastReadTs, setLastReadTs] = createSignal<number | null>(null);
  const [messages] = createResource(
    () => props.channelId,
    async (channelId) => {
      if (!channelId) return [];
      // Only clear local messages on channel switch
      if (channelId !== lastChannelId) {
        setLocalMessages([]);
        lastChannelId = channelId;
        prevMsgCount = 0;
        initialLoad = true;
        setLastReadTs(null);
      }
      try {
        const client = getClient();
        const resp = await client.getChannelMessages(channelId, 200);
        if (resp.last_read_ts !== undefined) setLastReadTs(resp.last_read_ts);
        return resp.messages;
      } catch {
        return [];
      }
    },
  );

  const [pinnedMessages] = createResource(
    () => props.channelId,
    async (channelId) => {
      if (!channelId) return [];
      try {
        const client = getClient();
        const resp = await client.getChannelPins(channelId);
        return resp.pinned_messages;
      } catch {
        return [];
      }
    },
  );

  /** Channel metadata (name, description, member count) for the header bar. */
  const [channelInfo] = createResource(
    () => props.channelId,
    async (channelId) => {
      if (!channelId) return null;
      try {
        const client = getClient();
        return await client.getChannel(channelId);
      } catch {
        return null;
      }
    },
  );

  // Fetch current user's channel role for permission gating
  createEffect(() => {
    const id = props.channelId;
    const me = walletAddress();
    if (!id || !me) { setMyRole('member'); return; }
    getClient().getChannelMembers(id, { limit: 200 }).then((resp) => {
      const member = resp.members.find((m) => m.address === me);
      setMyRole(member?.role as any ?? 'member');
    }).catch(() => setMyRole('member'));
  });

  const isMod = () => myRole() === 'moderator' || myRole() === 'creator';

  const MAX_LOCAL_MESSAGES = 200;

  // Subscribe to channel WebSocket events
  const wsCleanup = onWsEvent((event) => {
    if (event.type === 'message' && props.channelId) {
      const msg = event.envelope;
      if (msg.channel_id === props.channelId || msg.channel_id === String(props.channelId)) {
        // Handle edit/delete events by updating existing messages
        if (msg.msg_type === 'ChatEdit' || msg.msg_type === 'ChatDelete') {
          const targetId = msg.target_msg_id || msg.msg_id;
          if (targetId) {
            setLocalMessages((prev) => prev.map((m) => {
              if (msgIdToHex(m.msg_id) === msgIdToHex(targetId)) {
                if (msg.msg_type === 'ChatDelete') return { ...m, deleted: true };
                if (msg.msg_type === 'ChatEdit') return { ...m, payload: msg.payload, edited: true, last_edited_at: msg.timestamp };
              }
              return m;
            }));
            return;
          }
        }
        setLocalMessages((prev) => {
          // Remove optimistic messages that match this real message
          // (same author, timestamp within 10s)
          const filtered = prev.filter((m) => {
            if (!m._optimistic) return true;
            return !(m.author === msg.author &&
              Math.abs(new Date(m.timestamp).getTime() - new Date(msg.timestamp).getTime()) < 10000);
          });
          // Skip if already present (WS can re-deliver)
          if (filtered.some((m) => msgIdToHex(m.msg_id) === msgIdToHex(msg.msg_id))) return filtered;
          const next = [...filtered, msg];
          return next.length > MAX_LOCAL_MESSAGES ? next.slice(-MAX_LOCAL_MESSAGES) : next;
        });
        // If the user has scrolled away from the bottom, increment the badge counter on the
        // floating scroll-to-bottom button so they know new messages have arrived.
        if (messagesRef && msg.author !== walletAddress()) {
          const { scrollTop, scrollHeight, clientHeight } = messagesRef;
          const distFromBottom = scrollHeight - scrollTop - clientHeight;
          if (distFromBottom >= SCROLL_NEAR_BOTTOM_PX) {
            setNewMsgCount((c) => c + 1);
          }
        }
        // Mark channel as read while viewing so unread badge doesn't appear
        if (authStatus() === 'ready') {
          getClient().markChannelRead(props.channelId!).catch(() => {});
        }
      }
    }
  });
  onCleanup(wsCleanup);

  // Reactive channel subscription
  let prevChannelId: string | null = null;
  createEffect(() => {
    const id = props.channelId ? String(props.channelId) : null;
    if (prevChannelId) wsUnsubscribeChannels([prevChannelId]);
    if (id) {
      wsSubscribeChannels([id]);
      // Remember last opened channel for the Chat nav link
      setSetting('lastChannel', parseInt(id, 10));
      // Mark channel as read when entering
      if (authStatus() === 'ready') {
        try { getClient().markChannelRead(parseInt(id, 10)).catch(() => {}); }
        catch { /* SDK method may not exist on older builds */ }
      }
      setTimeout(() => inputRef?.focus(), 50);
    }
    prevChannelId = id;
  });
  onCleanup(() => {
    if (prevChannelId) wsUnsubscribeChannels([prevChannelId]);
  });

  // Deduplicate and sort messages
  const allMessages = createMemo(() => {
    const seen = new Set<string>();
    const apiMsgs = messages() || [];
    const local = localMessages();
    // Remove optimistic messages that now have a real counterpart from the API
    // (same author, similar timestamp, optimistic flag)
    const filteredLocal = local.filter((lm) => {
      if (!lm._optimistic) return true;
      return !apiMsgs.some((am) =>
        am.author === lm.author &&
        Math.abs(new Date(am.timestamp).getTime() - new Date(lm.timestamp).getTime()) < 10000,
      );
    });
    // localMessages first so optimistic updates (delete, edit, react) take priority in dedup
    const combined = [...filteredLocal, ...apiMsgs];
    const deduped = combined.filter((msg) => {
      const id = msgIdToHex(msg.msg_id);
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    deduped.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    return deduped;
  });

  // Resolve profiles for all unique authors.
  //
  // `requestedProfiles` tracks addresses we have ALREADY kicked off a
  // resolveProfile() call for. Without this, every setProfiles() update
  // re-runs the effect, which re-queues .then() handlers on the same
  // inflight promises — for N unique authors that's O(N²) setProfiles
  // calls and O(N³) total map clones. On a busy channel with ~50 unique
  // authors this froze the UI for minutes.
  const requestedProfiles = new Set<string>();
  createEffect(() => {
    const msgs = allMessages();
    for (const m of msgs) {
      const addr = m.author;
      if (requestedProfiles.has(addr)) continue;
      requestedProfiles.add(addr);
      resolveProfile(addr).then((p) => {
        setProfiles((prev) => {
          const next = new Map(prev);
          next.set(addr, p);
          return next;
        });
      });
    }
  });

  const getProfile = (addr: string) => profiles().get(addr);

  const displayName = (addr: string) => {
    const p = getProfile(addr);
    return p?.display_name || `${addr.slice(0, 8)}...${addr.slice(-4)}`;
  };

  /** Lookup map: hex msg_id -> message object. */
  const msgById = createMemo(() => {
    const map = new Map<string, any>();
    for (const msg of allMessages()) map.set(msgIdToHex(msg.msg_id), msg);
    return map;
  });

  /** Resolve a reply reference. */
  const resolveReply = (msg: any): { author: string; content: string; msgId: string } | null => {
    if (msg.reply_to_preview?.author) {
      return {
        author: msg.reply_to_preview.author,
        content: msg.reply_to_preview.content_preview || '...',
        msgId: msgIdToHex(msg.reply_to_preview.msg_id),
      };
    }
    const replyHex = getReplyToHex(msg);
    if (!replyHex) return null;
    const original = msgById().get(replyHex);
    if (original) {
      const content = getPayloadContent(original.payload);
      return {
        author: original.author,
        content: content.length > 100 ? content.slice(0, 100) + '...' : content,
        msgId: replyHex,
      };
    }
    return { author: '...', content: '(original message not loaded)', msgId: replyHex };
  };

  // Incremental poll fallback every 15s — fetch only new messages since the latest known msg_id
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  const pollNewMessages = async () => {
    const channelId = props.channelId;
    if (!channelId) return;
    const msgs = allMessages();
    if (msgs.length === 0) return;
    // Find the latest REAL message (skip optimistic ones with 'local-' ids)
    let latestMsgId: string | null = null;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const id = msgIdToHex(msgs[i].msg_id);
      if (id && !id.startsWith('local-')) { latestMsgId = id; break; }
    }
    if (!latestMsgId) return;
    try {
      const client = getClient();
      const resp = await client.getChannelMessages(channelId, 200, undefined, latestMsgId);
      if (resp.messages && resp.messages.length > 0) {
        setLocalMessages((prev) => {
          // Dedup: only add messages not already in localMessages
          const existingIds = new Set(prev.map((m) => msgIdToHex(m.msg_id)));
          const newMsgs = resp.messages.filter((m: any) => !existingIds.has(msgIdToHex(m.msg_id)));
          if (newMsgs.length === 0) return prev;
          const next = [...prev, ...newMsgs];
          return next.length > MAX_LOCAL_MESSAGES ? next.slice(-MAX_LOCAL_MESSAGES) : next;
        });
      }
    } catch { /* poll failure is non-critical */ }
  };
  createEffect(() => {
    if (pollTimer) clearInterval(pollTimer);
    if (props.channelId) pollTimer = setInterval(pollNewMessages, 15000);
  });
  onCleanup(() => { if (pollTimer) clearInterval(pollTimer); });

  // Auto-scroll only when new messages arrive and user is near bottom.
  // All scrolls are INSTANT (no animation) — the smooth scroll-behavior was
  // removed from CSS so the user doesn't see a visual scroll jump when
  // switching channels or when new messages arrive.
  createEffect(() => {
    // IMPORTANT: skip runs while the messages resource is refetching after
    // a channel switch. SolidJS's createResource keeps the old value during
    // refetch, so `allMessages()` briefly returns messages from the PREVIOUS
    // channel — if we scroll on that, the initialLoad flag is "used up" and
    // we don't scroll when the new messages actually arrive.
    if (messages.loading) return;
    const msgs = allMessages();
    const count = msgs.length;
    if (count === 0 || count === prevMsgCount) {
      prevMsgCount = count;
      return;
    }
    const wasMore = count > prevMsgCount;
    const isFirst = initialLoad;
    prevMsgCount = count;
    initialLoad = false;
    if (!wasMore && !isFirst) return; // only scroll on new messages, not removals

    if (isFirst) {
      // Initial load: jump to the unread divider (if any) or the bottom.
      // Uses setTimeout(0) so SolidJS has definitely committed the <For>
      // items to DOM by the time we measure scrollHeight. Bare RAF can
      // fire too early when the list is large. The scroll itself is
      // instant because we removed `scroll-behavior: smooth` from the CSS.
      setTimeout(() => {
        if (!messagesRef) return;
        const divider = messagesRef.querySelector('.unread-divider') as HTMLElement | null;
        if (divider) {
          messagesRef.scrollTop = Math.max(0, (divider as HTMLElement).offsetTop - 8);
        } else {
          messagesRef.scrollTop = messagesRef.scrollHeight;
        }
        // Belt-and-suspenders: re-apply on the next frame in case images
        // inside the last few messages finished loading and changed the
        // total height. Still instant.
        requestAnimationFrame(() => {
          if (!messagesRef) return;
          if (!divider) messagesRef.scrollTop = messagesRef.scrollHeight;
        });
      }, 0);
    } else {
      // Subsequent messages — only auto-scroll if user was near bottom.
      requestAnimationFrame(() => {
        if (!messagesRef) return;
        const { scrollTop, scrollHeight, clientHeight } = messagesRef;
        const isNearBottom = scrollHeight - scrollTop - clientHeight < 150;
        if (isNearBottom) messagesRef.scrollTop = messagesRef.scrollHeight;
      });
    }
  });

  const handleSend = async () => {
    // Route to edit handler when in edit mode
    if (editingMsg()) { await handleEdit(); return; }

    const text = messageInput().trim();
    const atts = attachments();
    if ((!text && atts.length === 0) || !props.channelId) return;
    if (!getSigner() || !walletAddress()) { navigate('/wallet'); return; }

    setSending(true);
    setSendError(null);
    try {
      const client = getClient();
      const options: any = {};
      if (replyTo()) options.replyTo = replyTo()!.msgId;
      if (atts.length > 0) options.attachments = atts;
      // Extract @mentions (klv1 addresses) from the message text
      const mentionMatches = text.match(/@(klv1[a-z0-9]{58})/g);
      if (mentionMatches) {
        options.mentions = [...new Set(mentionMatches.map((m: string) => m.slice(1)))];
      }
      await client.sendMessage(props.channelId, text, options);

      // Optimistic: add message locally for instant display.
      // _attachments is read by the renderer so the image shows up
      // immediately instead of only after the WS event arrives with the
      // real (MessagePack-encoded) payload.
      const addr = walletAddress() || '';
      setLocalMessages((prev) => [...prev, {
        msg_id: `local-${Date.now()}`,
        author: addr,
        timestamp: Date.now(),
        payload: text, // string payloads are handled by getPayloadContent
        _optimistic: true,
        _attachments: atts.length > 0 ? atts : undefined,
      }]);

      setMessageInput('');
      setReplyTo(null);
      setShowEmoji(false);
      setAttachments([]);
      if (inputRef) inputRef.style.height = 'auto';
    } catch (err: any) {
      console.error('sendMessage failed:', err);
      const msg = err?.message || String(err);
      setSendError(msg);
      // Auto-clear error after 6 seconds
      setTimeout(() => setSendError(null), 6000);
    } finally {
      setSending(false);
      // Focus after sending is cleared (textarea is no longer disabled)
      setTimeout(() => inputRef?.focus(), 0);
    }
  };

  const handleReply = (msg: any) => {
    const content = getPayloadContent(msg.payload);
    const preview = content.length > 80 ? content.slice(0, 80) + '...' : content;
    setReplyTo({ msgId: msgIdToHex(msg.msg_id), author: msg.author, preview });
    inputRef?.focus();
  };

  const insertEmoji = (emoji: string) => {
    if (!inputRef) return;
    const start = inputRef.selectionStart ?? messageInput().length;
    const end = inputRef.selectionEnd ?? start;
    const current = messageInput();
    setMessageInput(current.slice(0, start) + emoji + current.slice(end));
    // Restore cursor after emoji
    setTimeout(() => {
      inputRef?.focus();
      const pos = start + emoji.length;
      inputRef?.setSelectionRange(pos, pos);
    }, 0);
  };

  const scrollToMessage = (msgId: string) => {
    const el = document.querySelector(`[data-msg-id="${CSS.escape(msgId)}"]`) as HTMLElement | null;
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('message-highlight');
      setTimeout(() => el.classList.remove('message-highlight'), 1500);
    }
  };

  const cancelReply = () => setReplyTo(null);

  const canEdit = (msg: any) =>
    isRegistered() &&
    msg.author === walletAddress() &&
    !msg.deleted &&
    (Date.now() - new Date(msg.timestamp).getTime()) < EDIT_WINDOW_MS;

  const canDelete = (msg: any) =>
    isRegistered() && msg.author === walletAddress() && !msg.deleted;

  const startEdit = (msg: any) => {
    setEditingMsg({ msgId: msgIdToHex(msg.msg_id), content: getPayloadContent(msg.payload) });
    setMessageInput(getPayloadContent(msg.payload));
    inputRef?.focus();
  };

  const cancelEdit = () => {
    setEditingMsg(null);
    setMessageInput('');
    if (inputRef) inputRef.style.height = 'auto';
  };

  const handleEdit = async () => {
    const edit = editingMsg();
    const newContent = messageInput().trim();
    if (!edit || !newContent || !props.channelId) return;
    setSending(true);
    try {
      const client = getClient();
      await client.editMessage(props.channelId, edit.msgId, newContent);
      // Optimistic update — add/update in localMessages so it wins in dedup
      setLocalMessages((prev) => {
        const updates = { payload: newContent, edited: true, last_edited_at: Date.now() };
        const exists = prev.some((m) => msgIdToHex(m.msg_id) === edit.msgId);
        if (exists) return prev.map((m) => msgIdToHex(m.msg_id) === edit.msgId ? { ...m, ...updates } : m);
        // Find original message in allMessages to clone
        const original = allMessages().find((m) => msgIdToHex(m.msg_id) === edit.msgId);
        return original ? [...prev, { ...original, ...updates }] : prev;
      });
      setEditingMsg(null);
      setMessageInput('');
    } catch (e) {
      console.warn('Edit message failed:', e);
    } finally { setSending(false); }
  };

  const handleDelete = async (msg: any) => {
    if (!props.channelId) return;
    if (!window.confirm(t('chat_delete_confirm'))) return;
    try {
      const client = getClient();
      await client.deleteMessage(props.channelId, msgIdToHex(msg.msg_id));
      // Optimistic update — add/update in localMessages so it wins in dedup
      setLocalMessages((prev) => {
        const id = msgIdToHex(msg.msg_id);
        const exists = prev.some((m) => msgIdToHex(m.msg_id) === id);
        if (exists) return prev.map((m) => msgIdToHex(m.msg_id) === id ? { ...m, deleted: true } : m);
        return [...prev, { ...msg, deleted: true }];
      });
    } catch (e) {
      console.warn('Delete message failed:', e);
    }
  };

  const handleReact = async (msg: any, emoji: string) => {
    if (!props.channelId || !walletAddress()) return;
    try {
      const client = getClient();
      await client.reactToMessage(props.channelId, msgIdToHex(msg.msg_id), emoji);
      // Optimistic update — increment reaction count locally
      const id = msgIdToHex(msg.msg_id);
      const updateReactions = (m: any) => {
        const reactions = { ...(m.reactions || {}) };
        reactions[emoji] = (reactions[emoji] || 0) + 1;
        return { ...m, reactions };
      };
      setLocalMessages((prev) => {
        const exists = prev.some((m) => msgIdToHex(m.msg_id) === id);
        if (exists) return prev.map((m) => msgIdToHex(m.msg_id) === id ? updateReactions(m) : m);
        return [...prev, updateReactions(msg)];
      });
      // Track that this user reacted with this emoji (for visual highlight)
      setOwnReactions((prev) => {
        const next = new Map(prev);
        const set = new Set(next.get(id) || []);
        set.add(emoji);
        next.set(id, set);
        return next;
      });
    } catch (e) {
      console.warn('React to message failed:', e);
    }
  };

  /** True if the current user has reacted with `emoji` on this message (this session). */
  const hasOwnReaction = (msgId: string, emoji: string): boolean => {
    return ownReactions().get(msgId)?.has(emoji) ?? false;
  };

  /** Update floating "scroll to bottom" button visibility on user scroll. */
  const handleScroll = () => {
    if (!messagesRef) return;
    const { scrollTop, scrollHeight, clientHeight } = messagesRef;
    const distFromBottom = scrollHeight - scrollTop - clientHeight;
    const isNearBottom = distFromBottom < SCROLL_NEAR_BOTTOM_PX;
    setShowScrollBtn(!isNearBottom);
    if (isNearBottom) setNewMsgCount(0);
  };

  /** Auto-grow the chat textarea up to a max height. */
  const autoResizeTextarea = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    const max = 160;
    el.style.height = Math.min(el.scrollHeight, max) + 'px';
  };

  /** Long-press handler for mobile — opens context menu after 500ms hold. */
  const handleTouchStart = (e: TouchEvent, msg: any) => {
    if (longPressTimer) clearTimeout(longPressTimer);
    const touch = e.touches[0];
    if (!touch) return;
    const x = touch.clientX;
    const y = touch.clientY;
    longPressTimer = setTimeout(() => {
      openUserMenu(x, y, msg.author, msgIdToHex(msg.msg_id));
    }, 500);
  };
  const cancelLongPress = () => {
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
  };
  onCleanup(() => cancelLongPress());

  return (
    <div class="chat-view">
      <Show
        when={props.channelId}
        fallback={
          <div class="chat-empty">
            <div class="chat-empty-icon">💬</div>
            <p class="chat-empty-title">{t('chat_no_channel')}</p>
          </div>
        }
      >
        {/* Channel header bar — avatar, name, members, actions */}
        <div class="channel-bar">
          {/* Mobile-only back button — returns to the sidebar (chat list) */}
          <button
            class="content-back-btn channel-back-btn"
            onClick={() => showMobileList()}
            aria-label="Zurück"
            title="Zurück"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div
            class="channel-bar-info"
            onClick={() => navigate(`/chat/${props.channelId}/settings`)}
            title="Kanal-Details öffnen"
          >
            <div class="channel-bar-avatar">
              <Show
                when={channelInfo()?.channel.logo_cid}
                fallback={
                  <span>{(channelInfo()?.channel.display_name || channelInfo()?.channel.slug || '#').slice(0, 1).toUpperCase()}</span>
                }
              >
                <img
                  class="channel-bar-avatar-img"
                  src={getClient().getMediaUrl(channelInfo()!.channel.logo_cid!)}
                  alt=""
                />
              </Show>
            </div>
            <div class="channel-bar-text">
              <div class="channel-bar-title">
                {channelInfo()?.channel.display_name || channelInfo()?.channel.slug || `Channel ${props.channelId}`}
              </div>
              <div class="channel-bar-meta">
                <Show when={channelInfo()?.member_count !== undefined}>
                  <span class="channel-bar-members">
                    {t('chat_member_count', { count: channelInfo()!.member_count })}
                  </span>
                </Show>
                <Show when={pinnedMessages() && pinnedMessages()!.length > 0}>
                  <span class="channel-bar-sep">•</span>
                  <span class="pinned-info">
                    <span class="pinned-icon">📌</span>
                    <span class="pinned-count">{pinnedMessages()!.length}</span>
                  </span>
                </Show>
              </div>
            </div>
          </div>
          <div class="channel-bar-actions">
            <button
              class="channel-action-btn"
              title="Suche"
              aria-label="Suche"
              onClick={() => navigate('/search')}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </button>
            <button
              class="channel-action-btn"
              onClick={() => navigate(`/chat/${props.channelId}/settings`)}
              title={t('channel_settings')}
              aria-label={t('channel_settings')}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="5" r="1.5" />
                <circle cx="12" cy="12" r="1.5" />
                <circle cx="12" cy="19" r="1.5" />
              </svg>
            </button>
          </div>
        </div>

        <div class="chat-messages-wrap">
          <div class="chat-messages" ref={messagesRef} onScroll={handleScroll}>
            <Show
              when={allMessages().length > 0}
              fallback={
                <div class="chat-empty">
                  <div class="chat-empty-icon">✉️</div>
                  <p class="chat-empty-title">{t('chat_no_messages')}</p>
                </div>
              }
            >
              <For each={allMessages()}>
                {(msg, index) => {
                  const msgs = allMessages();
                  const prevMsg = index() > 0 ? msgs[index() - 1] : null;
                  const currentDate = getDateLabel(msg.timestamp);
                  const prevDate = prevMsg ? getDateLabel(prevMsg.timestamp) : null;
                  const showDateSep = currentDate !== prevDate;
                  const reply = resolveReply(msg);
                  const prof = () => getProfile(msg.author);
                  const isOwn = msg.author === walletAddress();
                  // Group consecutive messages from the same author within 2 minutes
                  const isContinuation = !showDateSep && !reply && prevMsg
                    && prevMsg.author === msg.author
                    && !prevMsg.deleted && !msg.deleted
                    && (Math.abs(new Date(msg.timestamp).getTime() - new Date(prevMsg.timestamp).getTime()) < GROUP_WINDOW_MS);

                  // Show unread divider before the first message after last_read_ts
                  const readTs = lastReadTs();
                  const msgTs = new Date(msg.timestamp).getTime();
                  const prevMsgTs = prevMsg ? new Date(prevMsg.timestamp).getTime() : 0;
                  const showUnreadDivider = readTs !== null
                    && msgTs > readTs
                    && (prevMsgTs <= readTs || !prevMsg)
                    && !isOwn;

                  const msgHex = msgIdToHex(msg.msg_id);

                  return (
                    <>
                      <Show when={showUnreadDivider}>
                        <div class="unread-divider">
                          <span class="unread-divider-label">{t('chat_new_messages')}</span>
                        </div>
                      </Show>
                      <Show when={showDateSep}>
                        <div class="date-separator">
                          <span class="date-separator-label">{currentDate}</span>
                        </div>
                      </Show>
                      <div
                        class={`message-row ${isOwn ? 'own' : ''} ${msg.deleted ? 'deleted' : ''} ${msg.muted ? 'muted' : ''} ${isContinuation ? 'continuation' : ''}`}
                        data-msg-id={msgHex}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          openUserMenu(e.clientX, e.clientY, msg.author, msgHex);
                        }}
                        onTouchStart={(e) => handleTouchStart(e, msg)}
                        onTouchEnd={cancelLongPress}
                        onTouchMove={cancelLongPress}
                        onTouchCancel={cancelLongPress}
                      >
                        {/* Avatar column — only for non-own messages, only on first message in group */}
                        <Show when={!isOwn}>
                          <div class="message-avatar-col">
                            <Show when={!isContinuation}>
                              <Show
                                when={prof()?.avatar_cid}
                                fallback={
                                  <div
                                    class="msg-avatar-placeholder"
                                    onClick={() => navigate(`/user/${msg.author}`)}
                                    title={displayName(msg.author)}
                                  >
                                    {(prof()?.display_name || msg.author).slice(0, 2).toUpperCase()}
                                  </div>
                                }
                              >
                                <img
                                  class="msg-avatar"
                                  src={getClient().getMediaUrl(prof()!.avatar_cid!)}
                                  alt=""
                                  onClick={() => navigate(`/user/${msg.author}`)}
                                />
                              </Show>
                            </Show>
                          </div>
                        </Show>

                        <div class={`message message-bubble ${isOwn ? 'own' : ''} ${msg.deleted ? 'deleted' : ''} ${msg.muted ? 'muted' : ''}`}>
                          <Show when={reply && !msg.deleted}>
                            <div class="reply-preview" onClick={() => scrollToMessage(reply!.msgId)}>
                              <span class="reply-preview-author">{displayName(reply!.author)}</span>
                              <span class="reply-preview-text">{reply!.content}</span>
                            </div>
                          </Show>
                          <Show when={!isContinuation && !isOwn}>
                            <div class="message-header">
                              <span
                                class="message-author"
                                onClick={() => navigate(`/user/${msg.author}`)}
                              >
                                {displayName(msg.author)}
                              </span>
                              <Show when={prof()?.verified}>
                                <span class="msg-verified" title="Verified">✓</span>
                              </Show>
                            </div>
                          </Show>
                          <Show
                            when={!msg.deleted}
                            fallback={<div class="message-body message-deleted-text">{t('message_deleted')}</div>}
                          >
                            <Show
                              when={!msg.muted || expandedMuted().has(msgHex)}
                              fallback={
                                <div
                                  class="message-body message-muted-text"
                                  onClick={() => setExpandedMuted(prev => { const next = new Set(prev); next.add(msgHex); return next; })}
                                >
                                  {t('message_muted_show')}
                                </div>
                              }
                            >
                              <div class="message-body">
                                <FormattedText
                                  content={getPayloadContent(msg.payload)}
                                  attachments={msg._attachments ?? getPayloadAttachments(msg.payload)}
                                />
                              </div>
                            </Show>
                          </Show>
                          <div class="message-meta">
                            <Show when={msg.edited}>
                              <span class="edited-indicator" title={msg.last_edited_at ? new Date(msg.last_edited_at).toLocaleString() : ''}>
                                {t('message_edited')}
                              </span>
                            </Show>
                            <span class="message-time">{formatMessageTime(msg.timestamp)}</span>
                          </div>
                          <Show when={msg.reactions && Object.keys(msg.reactions).length > 0}>
                            <div class="message-reactions">
                              {Object.entries(msg.reactions as Record<string, number>).map(([emoji, count]) => (
                                <button
                                  class={`reaction-badge ${hasOwnReaction(msgHex, emoji) ? 'reaction-own' : ''}`}
                                  onClick={() => walletAddress() && handleReact(msg, emoji)}
                                  disabled={!walletAddress()}
                                  title={`${emoji} × ${count}`}
                                >
                                  <span class="reaction-emoji">{emoji}</span>
                                  <span class="reaction-count">{count}</span>
                                </button>
                              ))}
                            </div>
                          </Show>
                          {/* Floating action bar on hover — quick reactions + ⋯ menu */}
                          <Show when={walletAddress() && !msg.deleted}>
                            <div class="msg-react-hover">
                              {['👍', '❤️', '🔥', '😂', '😮', '😢'].map((emoji) => (
                                <button
                                  class="react-hover-btn"
                                  onClick={() => handleReact(msg, emoji)}
                                  aria-label={`React ${emoji}`}
                                >
                                  {emoji}
                                </button>
                              ))}
                              <button
                                class="react-hover-btn react-more-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openUserMenu(e.clientX, e.clientY, msg.author, msgHex);
                                }}
                                aria-label="More actions"
                                title="More actions"
                              >
                                ⋯
                              </button>
                            </div>
                          </Show>
                        </div>
                      </div>
                    </>
                  );
                }}
              </For>
            </Show>
          </div>
          {/* Floating scroll-to-bottom button — visible when user is scrolled away from latest */}
          <Show when={showScrollBtn()}>
            <button
              class="scroll-to-bottom-btn"
              onClick={() => { scrollToBottom(); setNewMsgCount(0); setShowScrollBtn(false); }}
              aria-label="Scroll to bottom"
              title="Scroll to bottom"
            >
              <Show when={newMsgCount() > 0}>
                <span class="scroll-badge">{newMsgCount()}</span>
              </Show>
              <span class="scroll-arrow">↓</span>
            </button>
          </Show>
        </div>

        {/* Send error banner */}
        <Show when={sendError()}>
          <div class="send-error-banner" onClick={() => setSendError(null)} role="alert">
            <span class="send-error-icon">⚠</span>
            <span class="send-error-text">{sendError()}</span>
            <span class="send-error-close" aria-label="Dismiss">✕</span>
          </div>
        </Show>

        {/* Edit mode indicator */}
        <Show when={editingMsg()}>
          <div class="edit-indicator">
            <span class="edit-indicator-label">✏ {t('chat_edit_mode')}</span>
            <button class="edit-cancel" onClick={cancelEdit}>{t('chat_edit_cancel')}</button>
          </div>
        </Show>

        {/* Reply indicator — shows author avatar + content snippet */}
        <Show when={replyTo() && !editingMsg()}>
          <div class="reply-indicator">
            <span class="reply-indicator-icon">↩</span>
            <Show
              when={getProfile(replyTo()!.author)?.avatar_cid}
              fallback={
                <div class="reply-indicator-avatar-placeholder">
                  {(getProfile(replyTo()!.author)?.display_name || replyTo()!.author).slice(0, 2).toUpperCase()}
                </div>
              }
            >
              <img
                class="reply-indicator-avatar"
                src={getClient().getMediaUrl(getProfile(replyTo()!.author)!.avatar_cid!)}
                alt=""
              />
            </Show>
            <div class="reply-indicator-content">
              <span class="reply-indicator-author">{displayName(replyTo()!.author)}</span>
              <span class="reply-indicator-text">{replyTo()!.preview}</span>
            </div>
            <button class="reply-cancel" onClick={cancelReply} aria-label="Cancel reply">✕</button>
          </div>
        </Show>

        {/* Attached-files chips (shown above input when any attachments) */}
        <Show when={walletAddress() && attachments().length > 0}>
          <div class="chat-attached">
            <For each={attachments()}>
              {(att, i) => (
                <div class="chat-attached-item">
                  <Show
                    when={att.mime_type.startsWith('image/')}
                    fallback={<span class="chat-attached-icon">📎</span>}
                  >
                    <img
                      class="chat-attached-thumb"
                      src={getClient().getMediaUrl(att.thumbnail_cid || att.cid)}
                      alt=""
                    />
                  </Show>
                  <span class="chat-attached-name">{att.filename || att.cid.slice(0, 10)}</span>
                  <button
                    class="chat-attached-remove"
                    onClick={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i()))}
                    aria-label="Entfernen"
                  >
                    ✕
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>

        {/* Input area — smiley | clip | auto-growing textarea | send button */}
        <div class="chat-input-area">
          <div class="chat-input">
            <div class="emoji-container">
              <button
                class="input-icon-btn"
                onClick={() => walletAddress() && setShowEmoji(!showEmoji())}
                title="Emoji"
                aria-label="Emoji"
                disabled={!walletAddress()}
              >
                😊
              </button>
              <Show when={showEmoji()}>
                <EmojiPicker
                  onSelect={insertEmoji}
                  onClose={() => setShowEmoji(false)}
                />
              </Show>
            </div>
            <input
              ref={attachFileInput}
              type="file"
              accept="image/*,video/*,audio/*,.pdf,.txt,.md,.csv,.json"
              style="display:none"
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                if (file) uploadAttachment(file);
                e.currentTarget.value = '';
              }}
            />
            <button
              class="input-icon-btn"
              onClick={() => walletAddress() && attachFileInput?.click()}
              title="Anhängen"
              aria-label="Anhängen"
              disabled={!walletAddress() || uploadingAttach()}
            >
              <Show
                when={!uploadingAttach()}
                fallback={
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" stroke-opacity="0.25" />
                    <path d="M4 12a8 8 0 0 1 8-8" stroke-linecap="round">
                      <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite" />
                    </path>
                  </svg>
                }
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
              </Show>
            </button>
            <textarea
              ref={inputRef}
              class="chat-textarea"
              rows={1}
              placeholder={authStatus() === 'ready' ? t('chat_placeholder') : t('auth_connect_prompt')}
              value={messageInput()}
              onInput={(e) => {
                setMessageInput(e.currentTarget.value);
                autoResizeTextarea(e.currentTarget);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && (messageInput().trim() || attachments().length > 0)) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              onPaste={(e) => {
                const items = e.clipboardData?.items;
                if (!items || !walletAddress()) return;
                const imageItem = Array.from(items).find((i) => i.type.startsWith('image/'));
                if (!imageItem) return;
                e.preventDefault();
                const file = imageItem.getAsFile();
                if (file) uploadAttachment(file);
              }}
              disabled={sending() || !walletAddress()}
            />
            <button
              class="send-btn"
              onClick={handleSend}
              disabled={sending() || (!messageInput().trim() && attachments().length === 0) || !walletAddress()}
              aria-label={t('chat_send')}
              title={t('chat_send')}
            >
              <svg class="send-btn-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            </button>
          </div>
        </div>
      </Show>

      {/* User context menu for moderation */}
      <Show when={userMenu()}>
        <div
          class="user-context-menu"
          style={{ left: `${userMenu()!.x}px`, top: `${userMenu()!.y}px` }}
          ref={(el) => {
            // After the menu mounts, measure its actual size and nudge it
            // back into the viewport if the worst-case estimate in
            // openUserMenu() still leaves it overflowing (e.g. huge menus
            // with all moderator actions visible on a small window).
            if (!el) return;
            requestAnimationFrame(() => {
              const rect = el.getBoundingClientRect();
              const margin = MENU_EDGE_MARGIN;
              if (rect.bottom > window.innerHeight - margin) {
                el.style.top = `${Math.max(margin, window.innerHeight - rect.height - margin)}px`;
              }
              if (rect.right > window.innerWidth - margin) {
                el.style.left = `${Math.max(margin, window.innerWidth - rect.width - margin)}px`;
              }
            });
          }}
        >
          {/* Message actions — always available */}
          <button class="ctx-item" onClick={() => handleUserAction('reply')}>
            ↩ {t('chat_reply')}
          </button>
          <Show when={(() => { const m = msgById().get(userMenu()!.msgId); return m && canEdit(m); })()}>
            <button class="ctx-item" onClick={() => handleUserAction('edit')}>
              ✏ {t('chat_edit')}
            </button>
          </Show>
          <Show when={(() => { const m = msgById().get(userMenu()!.msgId); return m && canDelete(m); })()}>
            <button class="ctx-item ctx-danger" onClick={() => handleUserAction('delete')}>
              🗑 {t('chat_delete')}
            </button>
          </Show>
          <div class="ctx-divider" />
          {/* User actions */}
          <button class="ctx-item" onClick={() => handleUserAction('profile')}>
            👤 {t('channel_view_profile')}
          </button>
          <Show when={isMod()}>
            <button class="ctx-item" onClick={() => handleUserAction('pin')}>
              📌 {t('channel_pin_message')}
            </button>
          </Show>
          <Show when={walletAddress() && userMenu()!.address !== walletAddress()}>
            <button class="ctx-item" onClick={() => handleUserAction('report')}>
              🚩 {t('report_title')}
            </button>
          </Show>
          <Show when={isMod() && userMenu()!.address !== walletAddress()}>
            <div class="ctx-divider" />
            <button class="ctx-item ctx-warn" onClick={() => handleUserAction('mute')}>
              🔇 {t('channel_mute')}
            </button>
            <button class="ctx-item ctx-warn" onClick={() => handleUserAction('kick')}>
              ⚡ {t('channel_kick')}
            </button>
            <button class="ctx-item ctx-danger" onClick={() => handleUserAction('ban')}>
              ⛔ {t('channel_ban')}
            </button>
          </Show>
        </div>
      </Show>

    </div>
  );
};

/**
 * Sidebar — main navigation with collapsible channels.
 *
 * Structure: News, Channels (collapsible, default collapsed),
 * Messages, Bookmarks, Search, Settings.
 */

import { Component, createResource, createSignal, createEffect, createMemo, For, Show, onCleanup } from 'solid-js';
import { t } from '../i18n/init';
import { getClient } from '../lib/api';
import { authStatus, walletAddress, disconnectWallet } from '../lib/auth';
import { navigate, route } from '../lib/router';
import { getSetting, setSetting } from '../lib/settings';
import { resolveProfile, type CachedProfile } from '../lib/profile';
import { isMobileViewport, showMobileDetail, showMobileList, mobileListOpen } from '../lib/mobile-nav';
import { getTheme, setTheme } from '../lib/theme';

/** Default channel slug shown to all users (even unauthenticated). */
const DEFAULT_CHANNEL_SLUG = 'ogmara';

// --- Reactive joined-channel tracking ---
// SolidJS signal backed by localStorage so the sidebar memo reacts to changes.

function loadJoinedFromStorage(): Set<number> {
  try {
    const raw = localStorage.getItem('ogmara_joined_channels');
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return new Set(arr);
  } catch { /* ignore */ }
  return new Set();
}

function storageInitialized(): boolean {
  return localStorage.getItem('ogmara_joined_channels') !== null;
}

const [joinedSignal, setJoinedSignal] = createSignal<Set<number>>(loadJoinedFromStorage());

function persistJoined(ids: Set<number>): void {
  localStorage.setItem('ogmara_joined_channels', JSON.stringify([...ids]));
  setJoinedSignal(new Set(ids));
}

export function addJoinedChannel(channelId: number): void {
  const ids = new Set(joinedSignal());
  ids.add(channelId);
  persistJoined(ids);
}

export function removeJoinedChannel(channelId: number): void {
  const ids = new Set(joinedSignal());
  ids.delete(channelId);
  persistJoined(ids);
}

/**
 * Sync the joined set with the API channel list.
 * - Private channels in the list → user IS a member (L2 node pre-filters) → auto-add
 * - First-time migration: seed with EVERY channel the API returns so the user
 *   sees the same list they get on the production site. Without this, a fresh
 *   localStorage (e.g. dev environment, different origin) shows an empty
 *   sidebar because the previous behavior only seeded a hardcoded slug
 *   ("ogmara") that doesn't actually exist on testnet — the find() returned
 *   undefined and joined stayed empty forever.
 */
function syncJoinedWithApi(apiChannels: { channel_id: number; channel_type: number; slug: string }[]): void {
  const current = new Set(joinedSignal());
  let changed = false;

  if (!storageInitialized() && apiChannels.length > 0) {
    // First-time: seed with everything the API hands us. Users can leave
    // channels they don't want via the channel context menu.
    for (const ch of apiChannels) {
      if (!current.has(ch.channel_id)) {
        current.add(ch.channel_id);
        changed = true;
      }
    }
  } else {
    // Auto-add private channels the API returns (user must be a member)
    for (const ch of apiChannels) {
      if (ch.channel_type === 2 && !current.has(ch.channel_id)) {
        current.add(ch.channel_id);
        changed = true;
      }
    }
  }

  if (changed) persistJoined(current);
}

type SidebarTab = 'chats' | 'feed' | 'dms';

const SIDEBAR_MIN_W = 200;
const SIDEBAR_MAX_W = 600;
const SIDEBAR_DEFAULT_W = 320;

export const Sidebar: Component<{ onNavigate?: () => void }> = (props) => {
  const [channelsOpen, setChannelsOpen] = createSignal(getSetting('channelsExpanded'));
  const [contextMenu, setContextMenu] = createSignal<{ x: number; y: number; channelId: number; creator?: string } | null>(null);
  const [activeTab, setActiveTab] = createSignal<SidebarTab>('chats');
  const [searchQuery, setSearchQuery] = createSignal('');
  void channelsOpen; // retained for compatibility; not used in new layout
  void setChannelsOpen;

  // --- Burger menu (moved from Toolbar) ---
  const [burgerOpen, setBurgerOpen] = createSignal(false);
  const [currentTheme, setCurrentTheme] = createSignal(getTheme());
  const [burgerProfile, setBurgerProfile] = createSignal<CachedProfile>({});

  if (typeof document !== 'undefined') {
    const closeBurger = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.sidebar-burger-wrap')) setBurgerOpen(false);
    };
    document.addEventListener('click', closeBurger);
    onCleanup(() => document.removeEventListener('click', closeBurger));
  }

  createEffect(() => {
    const addr = walletAddress();
    if (addr) resolveProfile(addr).then(setBurgerProfile);
  });

  const navTo = (path: string) => {
    setBurgerOpen(false);
    navigate(path);
    if (isMobileViewport()) showMobileDetail();
  };

  const toggleTheme = () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    setTheme(next);
    setCurrentTheme(next);
  };

  const handleLogout = async () => {
    setBurgerOpen(false);
    await disconnectWallet();
    navigate('/news');
  };

  // --- Resizable sidebar width ---
  const savedW = parseInt(localStorage.getItem('ogmara_sidebar_width') || '', 10);
  const [sidebarWidth, setSidebarWidth] = createSignal(
    Number.isFinite(savedW) ? Math.max(SIDEBAR_MIN_W, Math.min(SIDEBAR_MAX_W, savedW)) : SIDEBAR_DEFAULT_W,
  );
  let dragging = false;
  const onResizeStart = (e: MouseEvent) => {
    e.preventDefault();
    dragging = true;
    const onMove = (ev: MouseEvent) => {
      if (!dragging) return;
      const newW = Math.max(SIDEBAR_MIN_W, Math.min(SIDEBAR_MAX_W, ev.clientX));
      setSidebarWidth(newW);
    };
    const onUp = () => {
      dragging = false;
      localStorage.setItem('ogmara_sidebar_width', String(sidebarWidth()));
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const handleContextMenu = (e: MouseEvent, channelId: number, creator?: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, channelId, creator });
  };

  const handleMarkRead = async () => {
    const ctx = contextMenu();
    if (!ctx) return;
    setContextMenu(null);
    try {
      await getClient().markChannelRead(ctx.channelId);
      setUnreadCounts((prev) => {
        const next = { ...prev };
        delete next[String(ctx.channelId)];
        return next;
      });
    } catch { /* ignore */ }
  };

  // Close context menu on any click
  const closeContextMenu = () => setContextMenu(null);
  if (typeof document !== 'undefined') {
    document.addEventListener('click', closeContextMenu);
    onCleanup(() => document.removeEventListener('click', closeContextMenu));
  }
  const [unreadCounts, setUnreadCounts] = createSignal<Record<string, number>>({});
  const [dmUnreadTotal, setDmUnreadTotal] = createSignal(0);
  const [notifUnread, setNotifUnread] = createSignal(0);

  // --- Private channel member list (collapsible per channel) ---
  const [expandedMembers, setExpandedMembers] = createSignal<Set<number>>(new Set());
  const [channelMembers, setChannelMembers] = createSignal<Record<number, { address: string; role: string }[]>>({});
  const [memberProfiles, setMemberProfiles] = createSignal<Map<string, CachedProfile>>(new Map());

  const toggleMembers = async (channelId: number) => {
    const expanded = new Set(expandedMembers());
    if (expanded.has(channelId)) {
      expanded.delete(channelId);
      setExpandedMembers(expanded);
      return;
    }
    expanded.add(channelId);
    setExpandedMembers(expanded);
    // Fetch members if not already loaded
    if (!channelMembers()[channelId]) {
      try {
        const resp = await getClient().getChannelMembers(channelId, { limit: 100 });
        // Resolve profiles first, then sort
        const members = resp.members;
        for (const m of members) {
          if (!memberProfiles().has(m.address)) {
            resolveProfile(m.address).then((p) => {
              setMemberProfiles((prev) => { const next = new Map(prev); next.set(m.address, p); return next; });
              // Re-sort after profile resolves
              sortAndStoreMembers(channelId, members);
            });
          }
        }
        sortAndStoreMembers(channelId, members);
      } catch { /* ignore */ }
    }
  };

  /** Sort members: creator > moderator > named users > wallets, alphabetically within each. */
  const sortAndStoreMembers = (channelId: number, members: { address: string; role: string }[]) => {
    const roleOrder = (role: string) => role === 'creator' ? 0 : role === 'moderator' ? 1 : 2;
    const sorted = [...members].sort((a, b) => {
      const ra = roleOrder(a.role), rb = roleOrder(b.role);
      if (ra !== rb) return ra - rb;
      const nameA = memberProfiles().get(a.address)?.display_name || '';
      const nameB = memberProfiles().get(b.address)?.display_name || '';
      // Named users before wallets
      if (nameA && !nameB) return -1;
      if (!nameA && nameB) return 1;
      // Alphabetical within group
      const labelA = (nameA || a.address).toLowerCase();
      const labelB = (nameB || b.address).toLowerCase();
      return labelA.localeCompare(labelB);
    });
    setChannelMembers((prev) => ({ ...prev, [channelId]: sorted }));
  };

  const memberDisplayName = (addr: string) => {
    const p = memberProfiles().get(addr);
    return p?.display_name || `${addr.slice(0, 8)}...${addr.slice(-4)}`;
  };

  // --- Member context menu (right-click on member in sidebar) ---
  const [memberMenu, setMemberMenu] = createSignal<{
    x: number; y: number; channelId: number; address: string; role: string; creator?: string;
  } | null>(null);

  const closeMemberMenu = () => setMemberMenu(null);
  if (typeof document !== 'undefined') {
    document.addEventListener('click', closeMemberMenu);
    onCleanup(() => document.removeEventListener('click', closeMemberMenu));
  }

  /** Get the current user's role in a channel from the cached member list. */
  const myRoleIn = (channelId: number): string => {
    const members = channelMembers()[channelId];
    if (!members) return 'member';
    const me = walletAddress();
    const entry = members.find((m) => m.address === me);
    return entry?.role || 'member';
  };

  const isModOrOwner = (channelId: number) => {
    const role = myRoleIn(channelId);
    return role === 'creator' || role === 'moderator';
  };

  const isOwner = (channelId: number) => myRoleIn(channelId) === 'creator';

  /** Refresh member list for a channel after moderation action. */
  const refreshMembers = async (channelId: number) => {
    try {
      const resp = await getClient().getChannelMembers(channelId, { limit: 100 });
      setChannelMembers((prev) => ({ ...prev, [channelId]: resp.members }));
      for (const m of resp.members) {
        if (!memberProfiles().has(m.address)) {
          resolveProfile(m.address).then((p) => {
            setMemberProfiles((prev) => { const next = new Map(prev); next.set(m.address, p); return next; });
          });
        }
      }
    } catch { /* ignore */ }
  };

  const handleMemberAction = async (action: string) => {
    const ctx = memberMenu();
    if (!ctx) return;
    setMemberMenu(null);
    const client = getClient();
    try {
      switch (action) {
        case 'profile':
          go(`/user/${ctx.address}`);
          break;
        case 'kick':
          if (window.confirm(`Kick ${memberDisplayName(ctx.address)}?`))  {
            await client.kickUser(ctx.channelId, ctx.address);
            await refreshMembers(ctx.channelId);
          }
          break;
        case 'ban': {
          const reason = window.prompt(t('channel_ban_reason'));
          if (reason !== null) {
            await client.banUser(ctx.channelId, ctx.address, reason || undefined);
            await refreshMembers(ctx.channelId);
          }
          break;
        }
        case 'promote': {
          await client.addModerator(ctx.channelId, ctx.address);
          await refreshMembers(ctx.channelId);
          break;
        }
        case 'demote': {
          await client.removeModerator(ctx.channelId, ctx.address);
          await refreshMembers(ctx.channelId);
          break;
        }
      }
    } catch (e: any) {
      alert(e?.message || 'Action failed');
    }
  };

  /** Navigate and auto-close sidebar on mobile. */
  const go = (path: string) => {
    navigate(path);
    props.onNavigate?.();
  };

  const [channelVersion, setChannelVersion] = createSignal(0);
  const [hasLoadedOnce, setHasLoadedOnce] = createSignal(false);
  const [allChannels, { refetch: refetchChannels }] = createResource(
    () => channelVersion(),
    async () => {
      try {
        const client = getClient();
        const resp = await client.listChannels(1, 50);
        return resp.channels;
      } catch {
        return [];
      } finally {
        setHasLoadedOnce(true);
      }
    },
  );

  // Sync joined set with API data whenever the channel list refreshes.
  // Handles first-time migration and auto-adds private channels.
  createEffect(() => {
    const all = allChannels();
    if (authStatus() === 'ready' && all && all.length > 0) {
      syncJoinedWithApi(all);
    }
  });

  // Filter: show only joined channels + default "ogmara" channel.
  // Unauthenticated users see only the default channel.
  const channels = createMemo(() => {
    const all = allChannels() || [];
    if (authStatus() !== 'ready') {
      return all.filter((ch) => ch.slug === DEFAULT_CHANNEL_SLUG);
    }
    const joined = joinedSignal(); // reactive — memo re-runs when join/leave changes it
    return all.filter((ch) =>
      ch.slug === DEFAULT_CHANNEL_SLUG || joined.has(ch.channel_id),
    );
  });

  // Listen for channel list changes (create/leave/delete)
  if (typeof window !== 'undefined') {
    const onChannelsChanged = () => setChannelVersion(v => v + 1);
    window.addEventListener('ogmara:channels-changed', onChannelsChanged);
    onCleanup(() => window.removeEventListener('ogmara:channels-changed', onChannelsChanged));
  }

  // Poll unread counts + refresh channel list every 30 seconds when authenticated
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  const pollData = async () => {
    if (authStatus() !== 'ready') return;
    try {
      const client = getClient();
      const lastSeenNotif = parseInt(localStorage.getItem('ogmara.lastSeenNotifTs') || '0', 10);
      const [unread, dmUnread, notifResp] = await Promise.all([
        client.getUnreadCounts().catch(() => ({ unread: {} })),
        client.getDmUnread().catch(() => ({ unread: {} })),
        client.getNotifications(lastSeenNotif || undefined, 50).catch(() => ({ notifications: [] })),
        // Refresh channel list + DM conversations to sync cross-device changes
        refetchChannels(),
        refetchDms(),
      ]);
      setUnreadCounts(unread.unread ?? {});
      const dmCounts = dmUnread.unread ?? {};
      setDmUnreadTotal(Object.values(dmCounts).reduce((a: number, b: number) => a + b, 0));
      setNotifUnread((notifResp as any).notifications?.length ?? 0);
    } catch { /* ignore */ }
  };
  createEffect(() => {
    if (pollTimer) clearInterval(pollTimer);
    if (authStatus() === 'ready') {
      pollData();
      pollTimer = setInterval(pollData, 30000);
    }
  });
  onCleanup(() => { if (pollTimer) clearInterval(pollTimer); });

  const currentChannelId = () => {
    const r = route();
    if (r.view === 'chat' && r.params.channelId) {
      return parseInt(r.params.channelId, 10);
    }
    return null;
  };

  const isView = (view: string) => {
    const r = route();
    if (view === 'news') return r.view === 'news' || r.view === 'news-detail' || r.view === 'compose';
    if (view === 'dm') return r.view === 'dm' || r.view === 'dm-conversation';
    if (view === 'bookmarks') return r.view === 'bookmarks';
    if (view === 'search') return r.view === 'search';
    if (view === 'settings') return r.view === 'settings';
    return false;
  };

  // ---- Ogmara Sidebar ----

  /** Filter channel list against the search query. */
  const filteredChannels = () => {
    const all = channels() ?? [];
    const q = searchQuery().trim().toLowerCase();
    if (!q) return all;
    return all.filter((ch) =>
      (ch.display_name || '').toLowerCase().includes(q) ||
      ch.slug.toLowerCase().includes(q),
    );
  };

  /** Short relative time label (e.g. "14:32", "Mo", "31.03."). Currently
   *  unused until we wire up per-channel last-message timestamps. */
  const shortTime = (ts?: number): string => {
    if (!ts) return '';
    // L2 node timestamps may be in seconds or milliseconds — normalize.
    const ms = ts < 1e12 ? ts * 1000 : ts;
    const d = new Date(ms);
    const now = new Date();
    const same = d.toDateString() === now.toDateString();
    if (same) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    const diff = (now.getTime() - d.getTime()) / 86_400_000;
    if (diff < 7) return d.toLocaleDateString(undefined, { weekday: 'short' });
    return d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' });
  };
  // DM conversations resource — fetched when the DMs tab is active
  const [dmConversations, { refetch: refetchDms }] = createResource(
    () => activeTab() === 'dms' && authStatus() === 'ready',
    async (shouldFetch) => {
      if (!shouldFetch) return [];
      try {
        const resp = await getClient().getDmConversations({ limit: 50 });
        // Resolve profiles for DM peers
        for (const conv of resp.conversations) {
          if (!memberProfiles().has(conv.peer)) {
            resolveProfile(conv.peer).then((p) => {
              setMemberProfiles((prev) => { const next = new Map(prev); next.set(conv.peer, p); return next; });
            });
          }
        }
        return resp.conversations;
      } catch {
        return [];
      }
    },
  );

  /** One-letter channel "avatar". */
  const channelInitial = (channel: { display_name?: string; slug: string }) =>
    (channel.display_name || channel.slug || '#').slice(0, 1).toUpperCase();

  return (
    <aside
      class={`sidebar ${isMobileViewport() ? 'mobile-open' : ''}`}
      style={isMobileViewport() ? undefined : { width: `${sidebarWidth()}px`, 'min-width': `${sidebarWidth()}px` }}
    >
      {/* ---------- Header: burger + search + notifications ---------- */}
      <div class="sidebar-header">
        {/* Burger / Back button */}
        <div class="sidebar-burger-wrap">
          <Show
            when={isMobileViewport() && !mobileListOpen()}
            fallback={
              <button
                class="sidebar-header-btn"
                onClick={(e) => { e.stopPropagation(); setBurgerOpen(!burgerOpen()); }}
                aria-label={t('menu') || 'Menü'}
                title={t('menu') || 'Menü'}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </svg>
              </button>
            }
          >
            <button
              class="sidebar-header-btn"
              onClick={() => showMobileList()}
              aria-label={t('nav_back') || 'Zurück'}
              title={t('nav_back') || 'Zurück'}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M19 12H5" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
            </button>
          </Show>

          {/* Burger dropdown menu */}
          <Show when={burgerOpen()}>
            <div class="sidebar-burger-menu" role="menu">
              <Show when={authStatus() === 'ready' && walletAddress()}>
                <button class="sidebar-menu-profile" onClick={() => navTo(`/user/${walletAddress()}`)}>
                  <Show
                    when={burgerProfile().avatar_cid}
                    fallback={<span class="sidebar-menu-avatar-ph">{(burgerProfile().display_name || walletAddress() || '').slice(0, 2).toUpperCase()}</span>}
                  >
                    <img class="sidebar-menu-avatar" src={getClient().getMediaUrl(burgerProfile().avatar_cid!)} alt="" />
                  </Show>
                  <div class="sidebar-menu-profile-text">
                    <div class="sidebar-menu-profile-name">
                      {burgerProfile().display_name || `${walletAddress()?.slice(0, 8)}...${walletAddress()?.slice(-4)}`}
                      <Show when={burgerProfile().verified}><span class="sidebar-menu-verified">✓</span></Show>
                    </div>
                    <div class="sidebar-menu-profile-addr">{walletAddress()?.slice(0, 12)}…{walletAddress()?.slice(-6)}</div>
                  </div>
                </button>
                <div class="sidebar-menu-divider" />
              </Show>
              <Show when={authStatus() === 'ready'}>
                <button class="sidebar-menu-item" onClick={() => navTo(`/user/${walletAddress()}`)}>{t('menu_my_profile')}</button>
                <button class="sidebar-menu-item" onClick={() => navTo('/wallet')}>{t('menu_wallet')}</button>
                <div class="sidebar-menu-divider" />
                <button class="sidebar-menu-item" onClick={() => navTo('/channel/create?type=group')}>{t('menu_new_group')}</button>
                <button class="sidebar-menu-item" onClick={() => navTo('/channel/create?type=channel')}>{t('menu_new_channel')}</button>
                <div class="sidebar-menu-divider" />
                <button class="sidebar-menu-item" onClick={() => { localStorage.setItem('ogmara.lastSeenNotifTs', Date.now().toString()); navTo('/notifications'); }}>{t('menu_notifications')}</button>
              </Show>
              <button class="sidebar-menu-item" onClick={() => navTo('/search')}>{t('menu_search')}</button>
              <button class="sidebar-menu-item" onClick={() => navTo('/bookmarks')}>{t('menu_bookmarks')}</button>
              <button class="sidebar-menu-item" onClick={() => navTo('/settings')}>{t('menu_settings')}</button>
              <button class="sidebar-menu-item" onClick={(e) => { e.stopPropagation(); toggleTheme(); }}>
                {currentTheme() === 'dark' ? t('menu_theme_dark') : t('menu_theme_light')}
              </button>
              <Show when={authStatus() === 'ready'}>
                <div class="sidebar-menu-divider" />
                <button class="sidebar-menu-item sidebar-menu-danger" onClick={handleLogout}>{t('menu_disconnect')}</button>
              </Show>
              <Show when={authStatus() !== 'ready'}>
                <div class="sidebar-menu-divider" />
                <button class="sidebar-menu-item" onClick={() => navTo('/wallet')}>{t('wallet_connect')}</button>
              </Show>
            </div>
          </Show>
        </div>
        <div class="sidebar-search">
          <svg class="sidebar-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            class="sidebar-search-input"
            type="text"
            placeholder={t('nav_search')}
            value={searchQuery()}
            onInput={(e) => setSearchQuery(e.currentTarget.value)}
          />
          <Show when={searchQuery()}>
            <button class="sidebar-search-clear" onClick={() => setSearchQuery('')} aria-label="Clear">✕</button>
          </Show>
        </div>
        <Show when={authStatus() === 'ready'}>
          <button
            class="sidebar-header-btn"
            onClick={() => {
              localStorage.setItem('ogmara.lastSeenNotifTs', Date.now().toString());
              setNotifUnread(0);
              go('/notifications');
            }}
            title={t('nav_notifications')}
            aria-label={t('nav_notifications')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            <Show when={notifUnread() > 0}>
              <span class="sidebar-header-badge">{notifUnread()}</span>
            </Show>
          </button>
        </Show>
      </div>

      {/* ---------- Tab row: Chats / Feed / DMs ---------- */}
      <div class="sidebar-tabs" role="tablist">
        <button
          class={`sidebar-tab ${activeTab() === 'chats' ? 'active' : ''}`}
          role="tab"
          onClick={() => setActiveTab('chats')}
        >
          {t('nav_chat')}
          <Show when={Object.values(unreadCounts()).reduce((a, b) => a + b, 0) > 0}>
            <span class="sidebar-tab-badge">
              {Object.values(unreadCounts()).reduce((a, b) => a + b, 0)}
            </span>
          </Show>
        </button>
        <button
          class={`sidebar-tab ${activeTab() === 'feed' ? 'active' : ''}`}
          role="tab"
          onClick={() => { setActiveTab('feed'); go('/news'); }}
        >
          {t('nav_news')}
        </button>
        <button
          class={`sidebar-tab ${activeTab() === 'dms' ? 'active' : ''}`}
          role="tab"
          onClick={() => { setActiveTab('dms'); go('/dm'); }}
        >
          {t('nav_dms')}
          <Show when={dmUnreadTotal() > 0}>
            <span class="sidebar-tab-badge">{dmUnreadTotal()}</span>
          </Show>
        </button>
      </div>

      {/* ---------- Tab content ---------- */}
      <div class="sidebar-content">
        <Show when={activeTab() === 'chats'}>
          <Show when={hasLoadedOnce() || !allChannels.loading} fallback={<div class="sidebar-loading">{t('loading')}</div>}>
            <Show
              when={filteredChannels().length > 0}
              fallback={
                <div class="sidebar-empty">
                  <div class="sidebar-empty-icon">💬</div>
                  <p>{searchQuery() ? 'Keine Treffer' : 'Keine Kanäle'}</p>
                </div>
              }
            >
              <For each={filteredChannels()}>
                {(channel) => {
                  const unread = () => unreadCounts()[String(channel.channel_id)] ?? 0;
                  const isActive = () => currentChannelId() === channel.channel_id;
                  return (
                    <button
                      class={`chat-row ${isActive() ? 'active' : ''} ${unread() > 0 ? 'has-unread' : ''}`}
                      onClick={() => go(`/chat/${channel.channel_id}`)}
                      onContextMenu={(e) => handleContextMenu(e, channel.channel_id, channel.creator)}
                    >
                      <div class="chat-row-avatar">
                        <Show
                          when={channel.logo_cid}
                          fallback={<span>{channelInitial(channel)}</span>}
                        >
                          <img
                            class="chat-row-avatar-img"
                            src={getClient().getMediaUrl(channel.logo_cid!)}
                            alt=""
                          />
                        </Show>
                      </div>
                      <div class="chat-row-body">
                        <div class="chat-row-top">
                          <span class="chat-row-name">
                            <Show when={channel.channel_type === 2}>
                              <svg
                                class="chat-row-name-lock"
                                width="12"
                                height="12"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2.5"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                aria-hidden="true"
                              >
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                              </svg>
                            </Show>
                            {channel.display_name || channel.slug}
                          </span>
                          {/* Timestamp intentionally hidden: channel.created_at
                              makes every row look "21.01." on testnet, which
                              is worse than no timestamp. Re-enable once we
                              have real last-message info. */}
                        </div>
                        <div class="chat-row-bottom">
                          <span class="chat-row-preview">
                            {channel.description || (channel.channel_type === 2 ? t('sidebar_private_channel') || 'Privater Kanal' : t('sidebar_public_channel') || 'Öffentlicher Kanal')}
                          </span>
                          <Show when={unread() > 0}>
                            <span class="chat-row-badge">{unread()}</span>
                          </Show>
                        </div>
                      </div>
                    </button>
                  );
                }}
              </For>
            </Show>
          </Show>
        </Show>

        <Show when={activeTab() === 'feed'}>
          <div class="sidebar-cta" onClick={() => go('/news')}>
            <div class="sidebar-cta-icon">📰</div>
            <div class="sidebar-cta-title">{t('news_title')}</div>
            <div class="sidebar-cta-sub">Öffnet den News-Feed</div>
          </div>
        </Show>

        <Show when={activeTab() === 'dms'}>
          <Show when={authStatus() === 'ready'} fallback={
            <div class="sidebar-empty">
              <div class="sidebar-empty-icon">✉️</div>
              <p>{t('auth_connect_prompt')}</p>
            </div>
          }>
            <Show when={dmConversations() && dmConversations()!.length > 0} fallback={
              <div class="sidebar-empty">
                <div class="sidebar-empty-icon">✉️</div>
                <p>{t('dm_empty')}</p>
              </div>
            }>
              <For each={dmConversations()}>
                {(conv) => {
                  const isActive = () => route().view === 'dm-conversation' && route().params.address === conv.peer;
                  const dmProfile = () => memberProfiles().get(conv.peer);
                  const dmName = () => dmProfile()?.display_name || `${conv.peer.slice(0, 8)}...${conv.peer.slice(-4)}`;
                  const dmInitial = () => (dmProfile()?.display_name || conv.peer).slice(0, 1).toUpperCase();
                  return (
                    <button
                      class={`chat-row ${isActive() ? 'active' : ''} ${conv.unread_count > 0 ? 'has-unread' : ''}`}
                      onClick={() => go(`/dm/${conv.peer}`)}
                    >
                      <div class="chat-row-avatar dm-avatar">
                        <Show
                          when={dmProfile()?.avatar_cid}
                          fallback={<span>{dmInitial()}</span>}
                        >
                          <img
                            class="chat-row-avatar-img"
                            src={getClient().getMediaUrl(dmProfile()!.avatar_cid!)}
                            alt=""
                          />
                        </Show>
                      </div>
                      <div class="chat-row-body">
                        <div class="chat-row-top">
                          <span class="chat-row-name">{dmName()}</span>
                          <Show when={conv.last_message_at}>
                            <span class="chat-row-time">{shortTime(conv.last_message_at)}</span>
                          </Show>
                        </div>
                        <div class="chat-row-bottom">
                          <span class="chat-row-preview">{conv.last_message_preview || '...'}</span>
                          <Show when={conv.unread_count > 0}>
                            <span class="chat-row-badge">{conv.unread_count}</span>
                          </Show>
                        </div>
                      </div>
                    </button>
                  );
                }}
              </For>
            </Show>
          </Show>
        </Show>
      </div>

      {/* ---------- Footer: connect prompt (if not logged in) ---------- */}
      <Show when={authStatus() !== 'ready'}>
        <div class="sidebar-footer">
          <button class="sidebar-footer-connect" onClick={() => go('/wallet')}>
            {t('wallet_connect')}
          </button>
        </div>
      </Show>

      {/* Channel context menu */}
      <Show when={contextMenu()}>
        <div
          class="channel-context-menu"
          style={{ left: `${contextMenu()!.x}px`, top: `${contextMenu()!.y}px` }}
        >
          <button class="context-menu-item" onClick={handleMarkRead}>
            ✓ {t('channel_mark_read')}
          </button>
          <button class="context-menu-item" onClick={() => {
            const ctx = contextMenu();
            setContextMenu(null);
            if (ctx) navigate(`/chat/${ctx.channelId}/settings`);
          }}>
            ⚙ {t('channel_settings')}
          </button>
          <button class="context-menu-item context-menu-danger" onClick={async () => {
            const ctx = contextMenu();
            setContextMenu(null);
            if (!ctx) return;
            if (!window.confirm(t('channel_leave_confirm'))) return;
            try {
              await getClient().leaveChannel(ctx.channelId);
              removeJoinedChannel(ctx.channelId);
              window.dispatchEvent(new Event('ogmara:channels-changed'));
              navigate('/news');
            } catch (e: any) {
              alert(e?.message || 'Failed to leave channel');
            }
          }}>
            ✕ {t('channel_leave')}
          </button>
          <Show when={contextMenu()?.creator === walletAddress()}>
            <button class="context-menu-item context-menu-danger" onClick={async () => {
              const ctx = contextMenu();
              setContextMenu(null);
              if (!ctx) return;
              if (!window.confirm(t('channel_delete_confirm'))) return;
              try {
                await getClient().deleteChannel(ctx.channelId);
                removeJoinedChannel(ctx.channelId);
                window.dispatchEvent(new Event('ogmara:channels-changed'));
                navigate('/news');
              } catch (e: any) {
                alert(e?.message || 'Failed to delete channel');
              }
            }}>
              🗑 {t('channel_delete')}
            </button>
          </Show>
        </div>
      </Show>

      {/* Member context menu (right-click on member in sidebar) */}
      <Show when={memberMenu()}>
        <div
          class="channel-context-menu"
          style={{ left: `${memberMenu()!.x}px`, top: `${memberMenu()!.y}px` }}
        >
          <button class="context-menu-item" onClick={() => handleMemberAction('profile')}>
            👤 {t('channel_view_profile')}
          </button>
          {/* Kick/ban: visible to mods and owner, but not on yourself or the owner */}
          <Show when={
            isModOrOwner(memberMenu()!.channelId) &&
            memberMenu()!.address !== walletAddress() &&
            memberMenu()!.role !== 'creator'
          }>
            <div class="ctx-divider" />
            <button class="context-menu-item context-menu-warn" onClick={() => handleMemberAction('kick')}>
              ⚡ {t('channel_kick')}
            </button>
            <button class="context-menu-item context-menu-danger" onClick={() => handleMemberAction('ban')}>
              ⛔ {t('channel_ban')}
            </button>
          </Show>
          {/* Promote/demote: owner only, not on yourself */}
          <Show when={
            isOwner(memberMenu()!.channelId) &&
            memberMenu()!.address !== walletAddress()
          }>
            <div class="ctx-divider" />
            <Show when={memberMenu()!.role !== 'moderator'}>
              <button class="context-menu-item" onClick={() => handleMemberAction('promote')}>
                ⬆ {t('channel_promote_mod')}
              </button>
            </Show>
            <Show when={memberMenu()!.role === 'moderator'}>
              <button class="context-menu-item context-menu-warn" onClick={() => handleMemberAction('demote')}>
                ⬇ {t('channel_demote_mod')}
              </button>
            </Show>
          </Show>
        </div>
      </Show>

      <style>{`
        .sidebar {
          position: relative;
          background: var(--color-bg-secondary);
          border-right: 1px solid var(--color-border);
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        /* ---------- Header: search + notifications ---------- */
        .sidebar-header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 12px;
          border-bottom: 1px solid var(--color-border);
          flex-shrink: 0;
        }
        .sidebar-search {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 8px;
          height: 38px;
          padding: 0 12px;
          background: var(--color-bg-tertiary);
          border-radius: var(--radius-full);
          transition: background 0.15s;
        }
        .sidebar-search:focus-within { background: var(--color-bg-hover); }
        .sidebar-search-icon {
          color: var(--color-text-secondary);
          flex-shrink: 0;
        }
        .sidebar-search-input {
          flex: 1;
          background: transparent;
          border: none;
          outline: none;
          color: var(--color-text-primary);
          font-size: var(--font-size-sm);
          font-family: inherit;
        }
        .sidebar-search-input::placeholder { color: var(--color-text-secondary); }
        .sidebar-search-clear {
          color: var(--color-text-secondary);
          font-size: 14px;
          padding: 2px;
          border-radius: var(--radius-full);
          cursor: pointer;
        }
        .sidebar-search-clear:hover { color: var(--color-text-primary); }
        .sidebar-header-btn {
          position: relative;
          width: 38px;
          height: 38px;
          border-radius: var(--radius-full);
          color: var(--color-text-secondary);
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 0.15s, color 0.15s;
          flex-shrink: 0;
        }
        .sidebar-header-btn:hover {
          background: var(--color-bg-tertiary);
          color: var(--color-text-primary);
        }
        .sidebar-header-badge {
          position: absolute;
          top: 4px;
          right: 4px;
          min-width: 16px;
          height: 16px;
          padding: 0 4px;
          background: var(--color-accent-primary);
          color: #fff;
          font-size: 10px;
          font-weight: 700;
          border-radius: var(--radius-full);
          display: flex;
          align-items: center;
          justify-content: center;
        }

        /* ---------- Tabs: Chats / Feed / DMs ---------- */
        .sidebar-tabs {
          display: flex;
          padding: 8px 12px;
          gap: 4px;
          border-bottom: 1px solid var(--color-border);
          flex-shrink: 0;
        }
        .sidebar-tab {
          flex: 1;
          padding: 8px 10px;
          border-radius: var(--radius-full);
          font-size: var(--font-size-sm);
          font-weight: 600;
          color: var(--color-text-secondary);
          text-align: center;
          transition: background 0.15s, color 0.15s;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          white-space: nowrap;
        }
        .sidebar-tab:hover {
          background: var(--color-bg-hover);
          color: var(--color-text-primary);
        }
        .sidebar-tab.active {
          background: var(--color-accent-bg);
          color: var(--color-accent-primary);
        }
        .sidebar-tab-badge {
          min-width: 18px;
          padding: 1px 6px;
          background: var(--color-accent-primary);
          color: #fff;
          font-size: 10px;
          font-weight: 700;
          border-radius: var(--radius-full);
          line-height: 1.4;
        }
        .sidebar-tab.active .sidebar-tab-badge {
          background: var(--color-accent-primary);
          color: #fff;
        }

        /* ---------- Scrollable content area ---------- */
        .sidebar-content {
          flex: 1;
          overflow-y: auto;
          padding: 4px 0;
        }

        /* ---------- Empty / loading / CTA states ---------- */
        .sidebar-loading,
        .sidebar-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          padding: 60px 24px;
          color: var(--color-text-secondary);
          font-size: var(--font-size-sm);
          text-align: center;
        }
        .sidebar-empty-icon {
          font-size: 40px;
          opacity: 0.5;
        }
        .sidebar-cta {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          margin: 20px 16px;
          padding: 28px 20px;
          background: var(--color-bg-tertiary);
          border-radius: var(--radius-lg);
          cursor: pointer;
          transition: background 0.15s, transform 0.1s;
          text-align: center;
        }
        .sidebar-cta:hover {
          background: var(--color-bg-hover);
          transform: translateY(-1px);
        }
        .sidebar-cta-icon { font-size: 40px; }
        .sidebar-cta-title {
          font-weight: 700;
          font-size: var(--font-size-md);
          color: var(--color-text-primary);
        }
        .sidebar-cta-sub {
          font-size: var(--font-size-xs);
          color: var(--color-text-secondary);
        }

        /* ---------- Chat preview row ---------- */
        .chat-row {
          display: flex;
          align-items: center;
          gap: 12px;
          width: 100%;
          padding: 10px 12px;
          text-align: left;
          transition: background 0.12s;
          border-radius: 0;
          position: relative;
        }
        .chat-row:hover { background: var(--color-bg-hover); }
        .chat-row.active {
          background: var(--color-accent-primary);
        }
        .chat-row-avatar {
          position: relative;
          width: 48px;
          height: 48px;
          flex-shrink: 0;
          border-radius: var(--radius-full);
          background: linear-gradient(135deg, var(--color-accent-primary), var(--color-accent-secondary));
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
          font-weight: 700;
          user-select: none;
          overflow: hidden;
        }
        .chat-row-avatar-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
        .chat-row-name-lock {
          display: inline-block;
          vertical-align: -1px;
          margin-right: 4px;
          color: var(--color-text-secondary);
          flex-shrink: 0;
        }
        .chat-row.active .chat-row-name-lock { color: rgba(255, 255, 255, 0.85); }
        .chat-row-body {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .chat-row-top {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 8px;
        }
        .chat-row-name {
          flex: 1;
          font-weight: 600;
          font-size: var(--font-size-md);
          color: var(--color-text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .chat-row.active .chat-row-name { color: #fff; }
        .chat-row-time {
          font-size: 12px;
          color: var(--color-text-secondary);
          flex-shrink: 0;
        }
        .chat-row.active .chat-row-time { color: rgba(255, 255, 255, 0.75); }
        .chat-row-bottom {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .chat-row-preview {
          flex: 1;
          font-size: 13px;
          color: var(--color-text-secondary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          line-height: 1.4;
        }
        .chat-row.active .chat-row-preview { color: rgba(255, 255, 255, 0.85); }
        .chat-row-badge {
          min-width: 22px;
          height: 22px;
          padding: 0 7px;
          background: var(--color-accent-primary);
          color: #fff;
          font-size: 11px;
          font-weight: 700;
          border-radius: var(--radius-full);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .chat-row.active .chat-row-badge {
          background: rgba(255, 255, 255, 0.28);
        }

        /* ---------- Footer: quick-action icons ---------- */
        .sidebar-footer {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 12px;
          border-top: 1px solid var(--color-border);
          flex-shrink: 0;
        }
        .sidebar-footer-btn {
          width: 36px;
          height: 36px;
          border-radius: var(--radius-full);
          color: var(--color-text-secondary);
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 0.15s, color 0.15s;
        }
        .sidebar-footer-btn:hover {
          background: var(--color-bg-tertiary);
          color: var(--color-text-primary);
        }
        .sidebar-footer-btn.active {
          background: var(--color-accent-bg);
          color: var(--color-accent-primary);
        }
        .sidebar-fab {
          background: var(--color-accent-primary);
          color: #fff;
          margin-right: auto;
        }
        .sidebar-fab:hover {
          background: var(--color-accent-secondary);
          color: #fff;
        }
        .sidebar-footer-connect {
          flex: 1;
          padding: 8px 16px;
          background: var(--color-accent-primary);
          color: #fff;
          font-weight: 600;
          font-size: var(--font-size-sm);
          border-radius: var(--radius-full);
          text-align: center;
          transition: background 0.15s;
        }
        .sidebar-footer-connect:hover { background: var(--color-accent-secondary); }
        .channel-context-menu {
          position: fixed;
          background: var(--color-bg-secondary);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-md);
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          z-index: 100;
          padding: 4px;
          min-width: 160px;
        }
        .context-menu-item {
          display: block;
          width: 100%;
          text-align: left;
          padding: var(--spacing-sm) var(--spacing-md);
          font-size: var(--font-size-sm);
          border-radius: var(--radius-sm);
          cursor: pointer;
          color: var(--color-text-primary);
        }
        .context-menu-item:hover { background: var(--color-bg-tertiary); }
        .context-menu-warn { color: var(--color-text-secondary); }
        .context-menu-danger { color: #f44; }
        .context-menu-danger:hover { background: rgba(255,68,68,0.1); }
        .ctx-divider { height: 1px; background: var(--color-border); margin: 4px 0; }
        .channel-group { display: flex; flex-direction: column; }
        .sidebar-members-toggle {
          display: flex;
          align-items: center;
          gap: var(--spacing-xs);
          padding: 2px var(--spacing-sm);
          padding-left: calc(var(--spacing-lg) + var(--spacing-sm));
          font-size: var(--font-size-xs);
          color: var(--color-text-secondary);
          width: 100%;
          text-align: left;
        }
        .sidebar-members-toggle:hover { color: var(--color-text-primary); }
        .sidebar-member-list {
          display: flex;
          flex-direction: column;
        }
        .sidebar-member-item {
          display: flex;
          align-items: center;
          gap: var(--spacing-xs);
          padding: 2px var(--spacing-sm);
          padding-left: calc(var(--spacing-lg) + var(--spacing-lg));
          font-size: var(--font-size-xs);
          color: var(--color-text-secondary);
          width: 100%;
          text-align: left;
        }
        .sidebar-member-item:hover { background: var(--color-bg-tertiary); color: var(--color-text-primary); }
        .member-dot {
          width: 6px;
          height: 6px;
          border-radius: var(--radius-full);
          background: var(--color-text-secondary);
          flex-shrink: 0;
        }
        .member-dot.member-mod { background: var(--color-accent-primary); }
        .member-dot.member-owner { background: var(--color-success); }
        .member-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sidebar-resize-handle {
          position: absolute;
          top: 0;
          right: -3px;
          width: 6px;
          height: 100%;
          cursor: col-resize;
          z-index: 20;
          background: transparent;
          transition: background 0.15s;
        }
        .sidebar-resize-handle:hover,
        .sidebar-resize-handle:active {
          background: var(--color-accent-primary);
        }

        /* --- Burger menu (in sidebar header) --- */
        .sidebar-burger-wrap { position: relative; flex-shrink: 0; }
        .sidebar-burger-menu {
          position: absolute;
          top: 42px;
          left: 0;
          background: var(--color-bg-secondary);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-md);
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
          z-index: 10000;
          padding: 4px;
          min-width: 220px;
          animation: pop-in 0.12s ease-out;
        }
        @keyframes pop-in {
          from { opacity: 0; transform: scale(0.95) translateY(-4px); }
          to { opacity: 1; transform: none; }
        }
        .sidebar-menu-item {
          display: block;
          width: 100%;
          text-align: left;
          padding: var(--spacing-sm) var(--spacing-md);
          font-size: var(--font-size-sm);
          border-radius: var(--radius-sm);
          cursor: pointer;
          color: var(--color-text-primary);
        }
        .sidebar-menu-item:hover { background: var(--color-bg-tertiary); }
        .sidebar-menu-danger { color: #f44; }
        .sidebar-menu-danger:hover { background: rgba(255, 68, 68, 0.1); }
        .sidebar-menu-divider { height: 1px; background: var(--color-border); margin: 4px 0; }
        .sidebar-menu-profile {
          display: flex;
          align-items: center;
          gap: var(--spacing-sm);
          padding: var(--spacing-sm) var(--spacing-md);
          width: 100%;
          text-align: left;
          border-radius: var(--radius-sm);
          cursor: pointer;
        }
        .sidebar-menu-profile:hover { background: var(--color-bg-tertiary); }
        .sidebar-menu-avatar, .sidebar-menu-avatar-ph {
          width: 36px;
          height: 36px;
          border-radius: var(--radius-full);
          flex-shrink: 0;
          object-fit: cover;
        }
        .sidebar-menu-avatar-ph {
          background: var(--color-accent-bg);
          color: var(--color-accent-primary);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 13px;
          font-weight: 700;
        }
        .sidebar-menu-profile-text { overflow: hidden; }
        .sidebar-menu-profile-name {
          font-weight: 600;
          font-size: var(--font-size-sm);
          color: var(--color-text-primary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .sidebar-menu-verified {
          color: var(--color-accent-primary);
          font-size: 12px;
          margin-left: 4px;
        }
        .sidebar-menu-profile-addr {
          font-size: 11px;
          color: var(--color-text-secondary);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      `}</style>
      <Show when={!isMobileViewport()}>
        <div class="sidebar-resize-handle" onMouseDown={onResizeStart} />
      </Show>
    </aside>
  );
};

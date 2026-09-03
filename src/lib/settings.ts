/**
 * Local settings storage — persists user preferences to localStorage.
 *
 * Keys and defaults from spec 06-frontend.md section 4.1.
 */

import { scopedKey } from './walletScope';

export interface Settings {
  lang: string;
  theme: string;
  notificationSound: boolean;
  pushEnabled: boolean;
  notificationPreview: boolean;
  compactLayout: boolean;
  mediaAutoload: string;
  lastChannel: number | null;
  sidebarCollapsed: boolean;
  fontSize: string;
  walletAddress: string | null;
  pinnedChannels: number[];
  mutedChannels: number[];
  mutedUsers: string[];
  walletSource: string;
  nodeUrl: string;
  channelsExpanded: boolean;
  /** Cached device registration status: "wallet:device" key to avoid re-registration. */
  deviceRegistered: string;
  /** Cached enc-key binding marker "v2:wallet:enc_pub" to avoid re-publishing (§2.4). */
  encKeyBound: string;
  /**
   * Stable per-install device id (32-byte hex) for the BUILT-IN wallet E2E model
   * (§2.4). Minted once; the public device identifier other users wrap keys to.
   * External (Extension/K5) wallets use their delegated device signing key instead.
   */
  deviceId: string;
  /** Push gateway URL. Empty = auto-derive from nodeUrl (same host, port 41722). */
  pushGatewayUrl: string;
  /** Default tab to land on when opening the app with no explicit hash route. */
  defaultLandingView: 'chat' | 'news';
  /**
   * Which feed mode the news view defaults to when opened without an
   * explicit `?feed=` query param. Auto-saved every time the user
   * switches via the sidebar pills, so their last choice IS the
   * default on next launch. `following` is only meaningful when a
   * wallet is connected — the news view falls back to a value-prop
   * card when the user isn't authenticated.
   */
  defaultFeed: 'global' | 'following';
  /**
   * News Feed resume-position state (v0.71.0+). The client persists the hex
   * `msg_id` of the topmost visible post per feed mode, plus a "last viewed"
   * wall-clock ms timestamp. On reopening the feed within 24h it restores that
   * post as the scroll anchor so the user scrolls up for what's new; idle > 24h
   * (or no saved id) opens at the newest post. Empty string / 0 = none.
   */
  newsLastReadGlobal: string;
  newsLastReadFollowing: string;
  newsLastViewedAt: number;
  /**
   * User-known L2 node URLs the picker should always remember.
   *
   * Auto-populated every time the user successfully `switchNode`s to a
   * new URL. Persists across switches so a user who picks a new node
   * still sees their previous one in the dropdown — the new node's
   * `/api/v1/network/nodes` doesn't necessarily advertise the old
   * back. The default node URL is implicitly included by the picker;
   * only manually-added URLs end up in this array.
   */
  knownNodes: string[];
  /**
   * User-pinned "always connect here first" node URL (v0.36.0+).
   *
   * Empty string = no pin → boot picks the lowest-ping node from
   * `knownNodes ∪ DEFAULT_NODE_URL ∪ peers-of-current-node`.
   *
   * Set via the `★` toggle in the node picker. When set, the boot
   * sequence tries this URL first with a 3 s timeout; on failure it
   * silently falls back to best-ping and surfaces a one-time
   * "default unreachable" notice. Useful for private channels
   * hosted natively at a specific node — pinning it guarantees the
   * client always lands there first.
   */
  defaultNodeUrl: string;

  /**
   * Last-known Klever network ('mainnet' | 'testnet'), persisted from a
   * node's `networkStats.network`. Read at cold load so on-chain SC node
   * discovery targets the right registry before any node is reached.
   * Defaults to mainnet (the production registry).
   */
  kleverNetwork: 'mainnet' | 'testnet';
}

const defaults: Settings = {
  lang: 'auto',
  theme: 'system',
  notificationSound: true,
  pushEnabled: false,
  notificationPreview: true,
  compactLayout: false,
  mediaAutoload: 'wifi',
  lastChannel: null,
  sidebarCollapsed: false,
  fontSize: 'medium',
  walletAddress: null,
  pinnedChannels: [],
  mutedChannels: [],
  mutedUsers: [],
  channelsExpanded: false,
  walletSource: '',
  nodeUrl: '',
  deviceRegistered: '',
  encKeyBound: '',
  deviceId: '',
  pushGatewayUrl: '',
  defaultLandingView: 'chat',
  defaultFeed: 'global',
  newsLastReadGlobal: '',
  newsLastReadFollowing: '',
  newsLastViewedAt: 0,
  knownNodes: [],
  defaultNodeUrl: '',
  kleverNetwork: 'mainnet',
};

/**
 * Settings that belong to the ACCOUNT, not the browser.
 *
 * These are namespaced per wallet (see `walletScope.ts`). Everything else —
 * language, theme, node URL, font size, sidebar width, push — belongs to the
 * browser profile and stays global, so connecting a different wallet does not
 * reset the user's app preferences.
 *
 * `walletAddress` and `walletSource` are deliberately NOT here: they identify
 * WHICH wallet is active, so scoping them to that wallet would be circular.
 */
const PER_WALLET: ReadonlySet<keyof Settings> = new Set([
  'pinnedChannels',
  'mutedChannels',
  'mutedUsers',
  'lastChannel',
  'newsLastReadGlobal',
  'newsLastReadFollowing',
  'newsLastViewedAt',
  // Registration and E2E binding state are per account: `deviceRegistered`
  // holds `${externalAddress}:${deviceAddr}`, and a shared `deviceId` would
  // publish one identifier for two wallets, publicly linking them.
  'deviceRegistered',
  'encKeyBound',
  'deviceId',
] as (keyof Settings)[]);

/** Whether a key is account-scoped rather than browser-scoped. */
export function isPerWalletSetting(key: keyof Settings): boolean {
  return PER_WALLET.has(key);
}

/**
 * Resolve a key to its actual storage location.
 *
 * Per-wallet keys resolve to `<base>::<address>`; with no wallet active they
 * fall back to the bare key, which is only reachable before connect and holds
 * nothing after the one-time migration has run.
 */
function storageKey(key: keyof Settings): string {
  const base = `ogmara.${key}`;
  if (!PER_WALLET.has(key)) return base;
  return scopedKey(base) ?? base;
}

/** Load a setting from localStorage with fallback to default. */
export function getSetting<K extends keyof Settings>(key: K): Settings[K] {
  const stored = localStorage.getItem(storageKey(key));
  if (stored === null) return defaults[key];
  try {
    return JSON.parse(stored);
  } catch {
    return stored as unknown as Settings[K];
  }
}

/** Save a setting to localStorage. */
export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  localStorage.setItem(storageKey(key), JSON.stringify(value));
}

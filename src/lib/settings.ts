/**
 * Local settings storage — persists user preferences to localStorage.
 *
 * Keys and defaults from spec 06-frontend.md section 4.1.
 */

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
  pushGatewayUrl: '',
  defaultLandingView: 'chat',
  defaultFeed: 'global',
  knownNodes: [],
};

/** Load a setting from localStorage with fallback to default. */
export function getSetting<K extends keyof Settings>(key: K): Settings[K] {
  const stored = localStorage.getItem(`ogmara.${key}`);
  if (stored === null) return defaults[key];
  try {
    return JSON.parse(stored);
  } catch {
    return stored as unknown as Settings[K];
  }
}

/** Save a setting to localStorage. */
export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  localStorage.setItem(`ogmara.${key}`, JSON.stringify(value));
}

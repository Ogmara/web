/**
 * Settings sync — encrypt/decrypt user settings for cross-device sync via L2 node.
 *
 * Key derivation: HKDF from wallet signing key → AES-256-GCM.
 */

import { getSetting, setSetting, type Settings } from './settings';
import { getClient } from './api';
import { getChannelOrg, applyRemoteOrg } from './channel-org';
import { addJoinedChannels } from './joined-channels';
import { getHiddenDms, applyRemoteHiddenDms } from './dm-hide';
import { getTopicGroups, applyRemoteTopicGroups } from './topic-groups';

/** JSON-encoded settings keys synced across devices (read/write via getSetting/setSetting). */
const SYNC_KEYS = ['lang', 'notificationSound', 'compactLayout', 'fontSize'] as const;

/** Theme-style keys stored as raw strings in localStorage (read/write via lib/theme.ts).
 *  Kept on a separate path to avoid JSON-encoding breakage. */
const RAW_SYNC_KEYS = ['theme', 'designStyle', 'colorScheme'] as const;

/** Object-valued synced settings. Stored under their own key in the blob and
 *  applied with bespoke merge logic rather than the scalar setSetting path. */
const CHANNEL_ORG_KEY = 'channelOrg';
/** Hidden DM conversations (per-peer hide timestamp) — same object-valued pattern. */
const HIDDEN_DMS_KEY = 'hiddenDms';
/** Followed news hashtags + user-named subgroups — same LWW-by-`updatedAt` pattern. */
const TOPIC_GROUPS_KEY = 'topicGroups';

/** Highest `updatedAt` across the object-valued synced settings — the blob's
 *  cleartext "content last-edited at". Sent as `SettingsSyncData.updated_at` so
 *  the node can last-writer-wins across devices + the profile-topic gossip
 *  relay (l2-node 0.125.0+), and used here to decide whether this device's copy
 *  is newer than a node's and should be re-uploaded to seed it. hiddenDms has
 *  no single `updatedAt` (hiding is monotonic per peer) — take the max entry. */
function syncedContentTimestamp(): number {
  const org = getChannelOrg();
  const tg = getTopicGroups();
  const hidden = getHiddenDms();
  const hiddenMax = Object.values(hidden).reduce((m, v) => (typeof v === 'number' && v > m ? v : m), 0);
  return Math.max(org?.updatedAt ?? 0, tg?.updatedAt ?? 0, hiddenMax);
}

/** The highest `updatedAt` present in a decrypted remote blob (mirror of
 *  `syncedContentTimestamp` over the node's copy). */
function remoteContentTimestamp(settings: Record<string, unknown>): number {
  const org = settings?.[CHANNEL_ORG_KEY] as { updatedAt?: number } | undefined;
  const tg = settings?.[TOPIC_GROUPS_KEY] as { updatedAt?: number } | undefined;
  const hidden = settings?.[HIDDEN_DMS_KEY] as Record<string, number> | undefined;
  const hiddenMax = hidden
    ? Object.values(hidden).reduce((m, v) => (typeof v === 'number' && v > m ? v : m), 0)
    : 0;
  return Math.max(org?.updatedAt ?? 0, tg?.updatedAt ?? 0, hiddenMax);
}

/** Derive an AES-256-GCM key from a hex private key using HKDF. */
async function deriveKey(hexKey: string): Promise<CryptoKey> {
  if (!hexKey || !/^[0-9a-fA-F]+$/.test(hexKey)) {
    throw new Error('Invalid key format');
  }
  const keyBytes = fromHex(hexKey);
  // audit 2026-06-07 B4.1: copy into a plain ArrayBuffer-backed view so the bytes
  // satisfy BufferSource under TS5.9's stricter ArrayBufferLike typing.
  const baseKey = await crypto.subtle.importKey('raw', new Uint8Array(keyBytes), 'HKDF', false, ['deriveKey']);
  // Zero the intermediate key bytes
  keyBytes.fill(0);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      // Include wallet-specific salt for domain separation (SEC-W4)
      salt: new TextEncoder().encode('ogmara-settings-sync'),
      info: new TextEncoder().encode('aes-256-gcm'),
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  if (!hex || hex.length === 0) return new Uint8Array(0);
  const matches = hex.match(/.{1,2}/g);
  if (!matches) return new Uint8Array(0);
  return new Uint8Array(matches.map((b) => parseInt(b, 16)));
}

/** Collect current settings and encrypt them. */
export async function encryptSettings(hexKey: string): Promise<{ encrypted_settings: Uint8Array; nonce: Uint8Array; key_epoch: number; updated_at: number }> {
  const settings: Record<string, unknown> = {};
  for (const key of SYNC_KEYS) {
    settings[key] = getSetting(key);
  }
  for (const key of RAW_SYNC_KEYS) {
    const raw = localStorage.getItem(`ogmara.${key}`);
    if (raw !== null) settings[key] = raw;
  }
  // Channel organization (groups + custom ordering) — an object value, carried
  // with its own LWW `updatedAt` so the receiver can resolve multi-device edits.
  settings[CHANNEL_ORG_KEY] = getChannelOrg();
  // Hidden DM conversations — per-peer hide timestamps, merged by max() on receipt.
  settings[HIDDEN_DMS_KEY] = getHiddenDms();
  // Followed news topics — hashtags + subgroups, LWW by `updatedAt` on receipt.
  settings[TOPIC_GROUPS_KEY] = getTopicGroups();
  const plaintext = new TextEncoder().encode(JSON.stringify(settings));
  const key = await deriveKey(hexKey);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plaintext);
  return {
    encrypted_settings: new Uint8Array(ciphertext),
    nonce,
    key_epoch: 0,
    // Cleartext LWW key for the node — the content's own edit time, NOT "now",
    // so re-uploading an unchanged copy to seed a fresh node can't jump ahead of
    // a newer copy on another node.
    updated_at: syncedContentTimestamp(),
  };
}

/** Decrypt settings blob and apply to local storage. */
export async function decryptAndApplySettings(
  hexKey: string,
  encryptedSettings: Uint8Array,
  nonce: Uint8Array,
): Promise<void> {
  const key = await deriveKey(hexKey);
  const plaintext = await crypto.subtle.decrypt(
    // audit 2026-06-07 B4.1: wrap in fresh Uint8Array views (plain ArrayBuffer
    // backing) to satisfy BufferSource under TS5.9's stricter typing.
    { name: 'AES-GCM', iv: new Uint8Array(nonce) },
    key,
    new Uint8Array(encryptedSettings),
  );
  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new Error('Failed to parse synced settings');
  }
  if (typeof settings !== 'object' || settings === null) {
    throw new Error('Invalid settings format');
  }
  for (const [k, v] of Object.entries(settings)) {
    // JSON-encoded keys: write via setSetting
    if (SYNC_KEYS.includes(k as any) && (typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number')) {
      // audit 2026-06-07 B4.1: SYNC_KEYS.includes already gated k to a valid
      // settings key; cast to keyof Settings to match setSetting's signature
      // (value cast consistent with the existing `as any` guard above).
      setSetting(k as keyof Settings, v as Settings[keyof Settings]);
    }
    // Raw-string theme keys: write directly to preserve theme.ts storage format
    if (RAW_SYNC_KEYS.includes(k as any) && typeof v === 'string') {
      localStorage.setItem(`ogmara.${k}`, v);
    }
    // Channel organization: apply via LWW (only if the remote copy is newer) and
    // auto-join any channel the remote org places, so a channel grouped on
    // another device becomes visible here.
    if (k === CHANNEL_ORG_KEY && v && typeof v === 'object') {
      const placedIds = applyRemoteOrg(v);
      if (placedIds.length) addJoinedChannels(placedIds);
    }
    // Hidden DM conversations: per-peer max() merge (see dm-hide.ts).
    if (k === HIDDEN_DMS_KEY && v && typeof v === 'object') {
      applyRemoteHiddenDms(v);
    }
    // Followed news topics: LWW by `updatedAt` (see topic-groups.ts).
    if (k === TOPIC_GROUPS_KEY && v && typeof v === 'object') {
      applyRemoteTopicGroups(v);
    }
  }
  // This device's object settings are newer than the node's → seed it (and, via
  // its re-gossip, the mesh). See downloadChannelOrg for the rationale.
  if (syncedContentTimestamp() > remoteContentTimestamp(settings)) {
    void uploadSettings(hexKey);
  }
}

/** Upload current settings to L2 node. */
export async function uploadSettings(hexKey: string): Promise<void> {
  const data = await encryptSettings(hexKey);
  const client = getClient();
  await client.syncSettings(data);
}

/** Download and apply settings from L2 node. */
export async function downloadSettings(hexKey: string): Promise<boolean> {
  const client = getClient();
  const resp = await client.getSettings();
  if (!resp) return false;
  await decryptAndApplySettings(
    hexKey,
    new Uint8Array(resp.encrypted_settings),
    new Uint8Array(resp.nonce),
  );
  return true;
}

/**
 * Download the synced blob and apply ONLY the device-local-but-synced object
 * settings (channel organization, hidden DMs, followed news topics) — not
 * theme/lang/etc. Used for the automatic on-login pull, AND on the
 * `settings_changed` WebSocket nudge (l2-node 0.124.0+) so a second device
 * picks up an edit made elsewhere without waiting for the next login. Each
 * object applies under its own last-writer-wins merge, so re-running this is
 * idempotent. Best-effort: swallows errors and returns false on any failure.
 *
 * (Name kept for source compatibility; it now downloads all synced objects.)
 */
export async function downloadChannelOrg(hexKey: string): Promise<boolean> {
  try {
    const resp = await getClient().getSettings();
    if (!resp) {
      // Fresh node with nothing for this wallet. If THIS device holds real
      // synced state, seed the node once — it then gossips it to the mesh so
      // every node converges. Safe: the upload carries the content's own
      // `updated_at`, so a node that already has a newer copy (via gossip)
      // will LWW-drop this one.
      if (syncedContentTimestamp() > 0) void uploadSettings(hexKey);
      return false;
    }
    const key = await deriveKey(hexKey);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(resp.nonce) },
      key,
      new Uint8Array(resp.encrypted_settings),
    );
    const settings = JSON.parse(new TextDecoder().decode(plaintext));
    let applied = false;
    const org = settings?.[CHANNEL_ORG_KEY];
    if (org && typeof org === 'object') {
      const placedIds = applyRemoteOrg(org);
      if (placedIds.length) addJoinedChannels(placedIds);
      applied = true;
    }
    const hidden = settings?.[HIDDEN_DMS_KEY];
    if (hidden && typeof hidden === 'object') {
      applyRemoteHiddenDms(hidden);
      applied = true;
    }
    const topics = settings?.[TOPIC_GROUPS_KEY];
    if (topics && typeof topics === 'object') {
      applyRemoteTopicGroups(topics);
      applied = true;
    }
    // If this device's copy is strictly newer than the node's (offline edits, or
    // a node that missed the gossip), push it up once so this node — and, via
    // its re-gossip, every other node — converges to it. The per-object
    // `applyRemote*` LWW above already left local state untouched in this case.
    if (syncedContentTimestamp() > remoteContentTimestamp(settings)) {
      void uploadSettings(hexKey);
    }
    return applied;
  } catch {
    return false;
  }
}

/**
 * Settings sync — encrypt/decrypt user settings for cross-device sync via L2 node.
 *
 * Key derivation: HKDF from wallet signing key → AES-256-GCM.
 */

import { getSetting, setSetting, type Settings } from './settings';
import { getClient } from './api';
import { getChannelOrg, applyRemoteOrg } from './channel-org';
import { addJoinedChannels } from './joined-channels';

/** JSON-encoded settings keys synced across devices (read/write via getSetting/setSetting). */
const SYNC_KEYS = ['lang', 'notificationSound', 'compactLayout', 'fontSize'] as const;

/** Theme-style keys stored as raw strings in localStorage (read/write via lib/theme.ts).
 *  Kept on a separate path to avoid JSON-encoding breakage. */
const RAW_SYNC_KEYS = ['theme', 'designStyle', 'colorScheme'] as const;

/** Object-valued synced settings. Stored under their own key in the blob and
 *  applied with bespoke merge logic rather than the scalar setSetting path. */
const CHANNEL_ORG_KEY = 'channelOrg';

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
export async function encryptSettings(hexKey: string): Promise<{ encrypted_settings: Uint8Array; nonce: Uint8Array; key_epoch: number }> {
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
  const plaintext = new TextEncoder().encode(JSON.stringify(settings));
  const key = await deriveKey(hexKey);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plaintext);
  return {
    encrypted_settings: new Uint8Array(ciphertext),
    nonce,
    key_epoch: 0,
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
 * Download the synced blob and apply ONLY the channel organization (LWW), not
 * theme/lang/etc. Used for the automatic on-login pull so a fresh device shows
 * the user's groups + ordering without overriding this device's other prefs.
 * Best-effort: swallows errors and returns false on any failure.
 */
export async function downloadChannelOrg(hexKey: string): Promise<boolean> {
  try {
    const resp = await getClient().getSettings();
    if (!resp) return false;
    const key = await deriveKey(hexKey);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(resp.nonce) },
      key,
      new Uint8Array(resp.encrypted_settings),
    );
    const settings = JSON.parse(new TextDecoder().decode(plaintext));
    const org = settings?.[CHANNEL_ORG_KEY];
    if (org && typeof org === 'object') {
      const placedIds = applyRemoteOrg(org);
      if (placedIds.length) addJoinedChannels(placedIds);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

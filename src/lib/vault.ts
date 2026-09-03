/**
 * Browser vault — secure key storage using IndexedDB + SubtleCrypto.
 *
 * Private keys are stored in IndexedDB (not localStorage) and optionally
 * encrypted with AES-256-GCM using a passphrase-derived key (PBKDF2).
 *
 * The WalletSigner instance is held in a module-scoped variable and
 * never exposed directly — consumers use vaultGetSigner().
 */

import { WalletSigner } from '@ogmara/sdk';
import { getWalletScope } from './walletScope';

const DB_NAME = 'ogmara-vault';
const STORE_NAME = 'keys';
const KEY_PRIVATE = 'private_key';
const KEY_MODE = 'mode';
const KEY_SALT = 'salt';
const KEY_VERSION = 'vault_version';

/** Current vault format version. Increment when changing storage format. */
const VAULT_VERSION = 1;

type VaultMode = 'raw' | 'encrypted';

let cachedSigner: WalletSigner | null = null;
let cachedAddress: string | null = null;

// --- IndexedDB helpers ---

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => { db.close(); reject(req.error); };
    tx.oncomplete = () => db.close();
  });
}

async function dbPut(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function dbDelete(key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

// --- Crypto helpers (SubtleCrypto AES-256-GCM + PBKDF2) ---

// OWASP 2023 recommends 600k+ for PBKDF2-SHA256 protecting private keys
const PBKDF2_ITERATIONS = 600_000;

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase) as unknown as BufferSource,
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptData(data: string, passphrase: string): Promise<{ cipher: string; salt: string }> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const key = await deriveKey(passphrase, salt);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    new TextEncoder().encode(data) as unknown as BufferSource,
  );
  // Store as: iv (12 bytes) + ciphertext
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  return {
    cipher: bytesToHex(combined),
    salt: bytesToHex(salt),
  };
}

async function decryptData(cipherHex: string, saltHex: string, passphrase: string): Promise<string> {
  const combined = hexToBytes(cipherHex);
  const salt = hexToBytes(saltHex);
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const key = await deriveKey(passphrase, salt);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    ciphertext as unknown as BufferSource,
  );
  return new TextDecoder().decode(decrypted);
}

// --- Hex helpers ---

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

// --- Public vault API ---

/** Run vault migrations on startup. Safe to call every launch. */
async function runVaultMigrations(): Promise<void> {
  const version = await dbGet<number>(KEY_VERSION);
  if (version == null) {
    // First launch or pre-versioning vault — stamp current version
    const mode = await dbGet<VaultMode>(KEY_MODE);
    if (mode) {
      await dbPut(KEY_VERSION, VAULT_VERSION);
    }
  }
  // Future migrations: if (version === 1) { migrate to v2; }
}

/** Initialize vault on app startup. Returns wallet address or null. */
export async function vaultInit(): Promise<string | null> {
  try {
    await runVaultMigrations();

    const mode = await dbGet<VaultMode>(KEY_MODE);
    if (!mode) return null;

    if (mode === 'raw') {
      const hexKey = await dbGet<string>(KEY_PRIVATE);
      if (!hexKey) return null;
      cachedSigner = await WalletSigner.fromHex(hexKey);
      cachedAddress = cachedSigner.address;
      return cachedAddress;
    }

    // Encrypted mode — signer can only be created after unlock
    cachedAddress = null;
    cachedSigner = null;
    return null; // Caller must call vaultUnlock() to get the signer
  } catch {
    return null;
  }
}

/** Store a hex-encoded private key and return the derived address. */
export async function vaultStore(hexKey: string): Promise<string> {
  // Validate hex format before attempting to create signer
  if (!/^[0-9a-fA-F]{64}$/.test(hexKey)) {
    throw new Error('Invalid private key: must be 64 hex characters');
  }
  const signer = await WalletSigner.fromHex(hexKey);
  await dbPut(KEY_PRIVATE, hexKey);
  await dbPut(KEY_MODE, 'raw' as VaultMode);
  await dbPut(KEY_VERSION, VAULT_VERSION);
  cachedSigner = signer;
  cachedAddress = signer.address;
  return signer.address;
}

/** Generate a new random wallet, store it, return the address. */
export async function vaultGenerate(): Promise<string> {
  // WalletSigner.generate() uses its own random bytes internally,
  // but we need the raw key to store it. Generate our own and create from that.
  const privateKey = new Uint8Array(32);
  crypto.getRandomValues(privateKey);
  const newSigner = await WalletSigner.fromPrivateKey(privateKey);
  const privHex = bytesToHex(privateKey);
  // Best-effort zeroing of raw key bytes
  privateKey.fill(0);
  await dbPut(KEY_PRIVATE, privHex);
  await dbPut(KEY_MODE, 'raw' as VaultMode);
  await dbPut(KEY_VERSION, VAULT_VERSION);
  cachedSigner = newSigner;
  cachedAddress = newSigner.address;
  return newSigner.address;
}

// ---------------------------------------------------------------------------
// Device-key vault (extension / K5 delegation flows)
//
// A SEPARATE slot from the built-in wallet (`KEY_PRIVATE`). The extension/K5
// flows use an EPHEMERAL device key that signs L2 ops on behalf of the wallet
// (the wallet authorizes it via delegation). Keeping it in its own slot means
// we can freely (re)generate it — e.g. when switching wallets — and NEVER risk
// overwriting a user's built-in wallet. No function below ever writes or clears
// `KEY_PRIVATE`. Device keys are always stored raw (no passphrase) — ephemeral.
// ---------------------------------------------------------------------------
const KEY_DEVICE_PRIVATE = 'device_private_key';
let cachedDeviceSigner: WalletSigner | null = null;

/** Load the existing device key from its own slot. Returns null if none. */
export async function deviceVaultInit(): Promise<WalletSigner | null> {
  if (cachedDeviceSigner) return cachedDeviceSigner;
  const hex = await dbGet<string>(KEY_DEVICE_PRIVATE);
  if (!hex) return null;
  try {
    cachedDeviceSigner = await WalletSigner.fromHex(hex);
    return cachedDeviceSigner;
  } catch {
    return null;
  }
}

/** Mint a FRESH device key in the device slot and return it. SAFE — only ever
 *  writes `KEY_DEVICE_PRIVATE`, never the built-in wallet's `KEY_PRIVATE`. */
export async function deviceVaultGenerate(): Promise<WalletSigner> {
  const privateKey = new Uint8Array(32);
  crypto.getRandomValues(privateKey);
  const signer = await WalletSigner.fromPrivateKey(privateKey);
  const privHex = bytesToHex(privateKey);
  privateKey.fill(0); // best-effort zeroing
  await dbPut(KEY_DEVICE_PRIVATE, privHex);
  cachedDeviceSigner = signer;
  return signer;
}

/** The cached device signer (null until init/generate this session). */
export function deviceVaultGetSigner(): WalletSigner | null {
  return cachedDeviceSigner;
}

// --- Device encryption key (X25519, E2E P0 — protocol §2.4) ---
//
// A per-device X25519 *encryption* secret, separate from the Ed25519 device
// SIGNING key above. Stored in its own slot; never overwrites KEY_PRIVATE or
// KEY_DEVICE_PRIVATE. NOTE: not yet used to decrypt anything (message encryption
// is P1); the wallet-encrypted key vault (P3, §2.5) supersedes raw storage.
const KEY_DEVICE_ENC_PRIVATE = 'device_enc_private_key';

/**
 * The enc secret's slot for the ACTIVE wallet.
 *
 * Per wallet, not per browser. `enc_pub` is published to the node's directory
 * in the clear, so one secret shared across wallets publishes the SAME
 * `enc_pub` for both — proving to the node, and to anyone who reads the
 * directory, that they are the same person. It also means a ciphertext wrapped
 * to wallet A is decryptable by wallet B on this browser, which is a
 * cross-account key exposure rather than merely a privacy leak.
 *
 * This matters most on the extension/K5 path, where disconnect deliberately
 * KEEPS the device key so the same L2 identity is reused on reconnect — so
 * without scoping, the next wallet inherits the previous one's enc identity.
 *
 * Falls back to the legacy device-global slot only when no wallet is active.
 * See protocol spec §2.4 ("Multi-account clients mint the `device_id` PER
 * ACCOUNT").
 */
/** Marker so the legacy secret is adopted by exactly one wallet, ever. */
const LEGACY_ENC_ADOPTED = 'device_enc_private_key.adopted';

function encSlot(): string {
  const addr = getWalletScope();
  return addr ? `${KEY_DEVICE_ENC_PRIVATE}::${addr}` : KEY_DEVICE_ENC_PRIVATE;
}

/**
 * Load this wallet's X25519 encryption secret (32 bytes), or null.
 *
 * One-time adoption: a browser that predates per-wallet slots has its secret
 * in the legacy global slot. The FIRST wallet to look claims it by COPY —
 * never a move — so an interrupted adoption can never destroy the only copy of
 * a key that existing envelopes are wrapped to. Later wallets find their own
 * slot empty and mint a fresh secret, which is the intended behaviour.
 */
export async function encVaultGet(): Promise<Uint8Array | null> {
  const slot = encSlot();
  const hex = await dbGet<string>(slot);
  if (hex) return hexToBytes(hex);
  if (slot === KEY_DEVICE_ENC_PRIVATE) return null;
  // Adopt the legacy secret for whichever wallet is active when this first
  // runs — that wallet is the one whose published enc_pub it already is.
  const legacyAdopted = await dbGet<string>(LEGACY_ENC_ADOPTED);
  if (legacyAdopted) return null;
  const legacy = await dbGet<string>(KEY_DEVICE_ENC_PRIVATE);
  if (!legacy) return null;
  await dbPut(slot, legacy);
  await dbPut(LEGACY_ENC_ADOPTED, '1');
  return hexToBytes(legacy);
}


/** The slot name for the active wallet, so callers can capture it once. */
export function encSlotName(): string {
  return encSlot();
}

/**
 * Persist an X25519 encryption secret into an EXPLICIT slot.
 *
 * Taking the slot rather than re-resolving it is the point: `getOrCreateEncKeypair`
 * resolves a slot, awaits IndexedDB, then stores. Re-resolving after those
 * awaits meant a wallet switch in the window made the store land in the NEW
 * wallet's slot, overwriting its live secret — every envelope wrapped to that
 * `enc_pub` permanently undecryptable.
 *
 * Refuses to overwrite a slot that already holds a secret: minting only ever
 * happens for a slot found empty, so a non-empty slot here means the target
 * moved under us.
 */
export async function encVaultStoreAt(slot: string, secret: Uint8Array): Promise<void> {
  const existing = await dbGet<string>(slot);
  if (existing) {
    throw new Error('refusing to overwrite an existing device encryption key');
  }
  await dbPut(slot, bytesToHex(secret));
}

/** Persist this wallet's X25519 encryption secret (32 bytes). */
export async function encVaultStore(secret: Uint8Array): Promise<void> {
  await encVaultStoreAt(encSlot(), secret);
}

/** Wipe this wallet's encryption secret (whole-DB wipe also drops it). */
export async function encVaultWipe(): Promise<void> {
  await dbDelete(encSlot());
}

/** One-time migration for users created before the device slot existed: their
 *  device key lived in the shared `KEY_PRIVATE` slot. If the device slot is
 *  empty AND the main slot holds a RAW key, COPY it into the device slot so the
 *  existing device key keeps working (no re-registration). An ENCRYPTED
 *  `KEY_PRIVATE` is a passphrase-protected WALLET and is never adopted. Only
 *  READS `KEY_PRIVATE`; never writes/clears it — even a mistaken adopt copies,
 *  so the original wallet can never be destroyed. Returns the signer or null. */
export async function deviceVaultAdoptFromMainIfEmpty(): Promise<WalletSigner | null> {
  if (await dbGet<string>(KEY_DEVICE_PRIVATE)) return deviceVaultInit();
  const mode = await dbGet<VaultMode>(KEY_MODE);
  if (mode !== 'raw') return null; // encrypted → it's a wallet; don't adopt
  const hex = await dbGet<string>(KEY_PRIVATE);
  if (!hex) return null;
  try {
    const signer = await WalletSigner.fromHex(hex);
    await dbPut(KEY_DEVICE_PRIVATE, hex); // copy into device slot; KEY_PRIVATE untouched
    cachedDeviceSigner = signer;
    return signer;
  } catch {
    return null;
  }
}

/** Get the cached signer (null if locked or no wallet). */
export function vaultGetSigner(): WalletSigner | null {
  return cachedSigner;
}

/** Get the cached address (null if no wallet). */
export function vaultGetAddress(): string | null {
  return cachedAddress;
}

/**
 * Encrypt the stored key with a passphrase (upgrades raw → encrypted). Locks the vault.
 * Currently unreferenced by the UI but retained as the sole consumer of the
 * `encryptData` raw→encrypted upgrade path (do not prune without the helper).
 */
export async function vaultEncryptWithPassphrase(passphrase: string): Promise<void> {
  const hexKey = await dbGet<string>(KEY_PRIVATE);
  if (!hexKey) throw new Error('No wallet to encrypt');

  const { cipher, salt } = await encryptData(hexKey, passphrase);
  await dbPut(KEY_PRIVATE, cipher);
  await dbPut(KEY_SALT, salt);
  await dbPut(KEY_MODE, 'encrypted' as VaultMode);

  // Lock the vault — signer only available again after vaultUnlock()
  cachedSigner = null;
  cachedAddress = null;
}

/** Unlock an encrypted vault with a passphrase. Returns address or throws. */
export async function vaultUnlock(passphrase: string): Promise<string> {
  const cipher = await dbGet<string>(KEY_PRIVATE);
  const salt = await dbGet<string>(KEY_SALT);
  if (!cipher || !salt) throw new Error('No encrypted wallet found');

  const hexKey = await decryptData(cipher, salt, passphrase);
  cachedSigner = await WalletSigner.fromHex(hexKey);
  cachedAddress = cachedSigner.address;
  return cachedSigner.address;
}

/** Export the raw private key hex. Only works if unlocked. */
export async function vaultExportKey(): Promise<string | null> {
  const mode = await dbGet<VaultMode>(KEY_MODE);
  if (mode === 'raw') {
    return (await dbGet<string>(KEY_PRIVATE)) ?? null;
  }
  // For encrypted mode, we cannot export without decrypting first
  // The caller must have unlocked the vault already; re-derive from signer is not possible
  // Return null — caller should prompt for passphrase and call vaultUnlock first
  return null;
}

/** Completely wipe the vault — deletes all keys and the database. */
export async function vaultWipe(): Promise<void> {
  cachedSigner = null;
  cachedAddress = null;
  // `deleteDatabase` drops the whole DB (incl. KEY_DEVICE_PRIVATE), so clear the
  // device-signer cache too — otherwise a stale in-memory device signer would
  // survive a wipe and point at a key no longer on disk.
  cachedDeviceSigner = null;
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

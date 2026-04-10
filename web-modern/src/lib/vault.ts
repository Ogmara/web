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

/** Check if a wallet exists in the vault (either raw or encrypted). */
export async function vaultHasWallet(): Promise<boolean> {
  const mode = await dbGet<VaultMode>(KEY_MODE);
  return mode != null;
}

/** Check if the vault is encrypted (requires passphrase to unlock). */
export async function vaultIsEncrypted(): Promise<boolean> {
  const mode = await dbGet<VaultMode>(KEY_MODE);
  return mode === 'encrypted';
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

/** Get the cached signer (null if locked or no wallet). */
export function vaultGetSigner(): WalletSigner | null {
  return cachedSigner;
}

/** Get the cached address (null if no wallet). */
export function vaultGetAddress(): string | null {
  return cachedAddress;
}

/** Encrypt the stored key with a passphrase (upgrades raw → encrypted). Locks the vault. */
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
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

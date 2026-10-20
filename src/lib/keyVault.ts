/**
 * E2E key-recovery vault wiring (P3, protocol §2.5). Persists this wallet's symmetric
 * content keys — DM `conv_key`s and channel epoch `channel_key`s — to the node, sealed
 * under a backup key derived from `signMessage("ogmara-keyvault-v1")`, so a fresh
 * device / reinstall can restore full message history. The node stores the blob
 * opaquely (it never holds the backup key).
 *
 * Flow (state machine in lib/keyVaultCore.ts `createVaultController`):
 *  - **Backup:** whenever a content key is cached, `scheduleBackup` debounces a
 *    `sealKeyVault` → `syncKeyVault` publish (one LWW record per wallet) — but only
 *    once restore is `done` for this account, so a publish never overwrites a vault
 *    this session hasn't read (or confirmed verifiably empty).
 *  - **Restore:** a decrypt-miss (key wrapped only to a prior device) triggers a
 *    session-once background pull → `openKeyVault` → merge into the in-memory caches.
 *  - **Blocked:** a vault our own key can't open, or a 404 for a vault this device has
 *    seen before, pauses backups until the user confirms "Replace backup"
 *    (`KeyVaultBanner`).
 *
 * The wallet backup key is derived ONCE per session (a `signMessage` popup for
 * external wallets; silent for built-in), and only from a signature VERIFIED to come
 * from the connected wallet (lib/walletSigVerify.ts). If the extension signs as a
 * different account, nothing is derived and the wallet is not asked again until the
 * user presses Retry or the session changes.
 */
import { createSignal } from 'solid-js';
import * as ed from '@noble/ed25519';
import { keccak_256 } from '@noble/hashes/sha3';
import {
  deriveVaultBackupKey,
  sealKeyVault,
  openKeyVault,
  normalizeWalletSig,
  addressToPubkey,
  VAULT_SIGN_CLAIM,
  type VaultKeyring,
} from '@ogmara/sdk';
import { getClient } from './api';
import { walletAddress } from './auth';
import { walletSignFn } from './deviceEnc';
import {
  setKeyringChangeListener,
  setVaultRestoreRequester,
  exportConvKeysForVault,
  importConvKeysFromVault,
} from './dmCrypto';
import {
  exportChannelKeysForVault,
  importChannelKeysFromVault,
} from './channelCrypto';
import { e2elog } from './e2eDebug';
import { getSwitchGeneration, getWalletScope } from './walletScope';
import { getSetting, setSetting } from './settings';
import { verifyWalletSig, type WalletSigCrypto } from './walletSigVerify';
import {
  createBackupKeySource,
  createVaultController,
  type PublishOutcome,
  type AccountStamp,
} from './keyVaultCore';

const sigCrypto: WalletSigCrypto = {
  keccak256: keccak_256,
  ed25519Verify: (sig, msg, pub) => ed.verifyAsync(sig, msg, pub),
  addressToPubkey,
  normalize: normalizeWalletSig,
};

/** What the user needs to act on, if anything (drives `KeyVaultBanner`). */
export type KeyVaultIssueKind = 'wallet-mismatch' | 'unreadable' | 'missing';
export interface KeyVaultIssue {
  kind: KeyVaultIssueKind;
  /** The connected wallet the issue is about. */
  wallet: string;
}

const [issueRaw, setIssueRaw] = createSignal<KeyVaultIssue | null>(null);

/**
 * The current key-vault problem for the connected wallet, or null. Reactive
 * (Solid signal); an issue recorded for another wallet reads as null.
 */
export function keyVaultIssue(): KeyVaultIssue | null {
  const issue = issueRaw();
  const w = walletAddress();
  return issue && w && issue.wallet === w ? issue : null;
}

const keySource = createBackupKeySource({
  currentWallet: walletAddress,
  generation: getSwitchGeneration,
  sign: () => walletSignFn()(VAULT_SIGN_CLAIM),
  verify: (wallet, raw) => verifyWalletSig(sigCrypto, wallet, VAULT_SIGN_CLAIM, raw),
  derive: deriveVaultBackupKey,
  log: e2elog,
  onIssueChange: () => refreshIssue(),
});

function currentKeyring(): VaultKeyring {
  return { conv: exportConvKeysForVault(), chan: exportChannelKeysForVault() };
}

const isEmptyKeyring = (kr: VaultKeyring): boolean =>
  Object.keys(kr.conv).length === 0 && Object.keys(kr.chan).length === 0;

/** `keyVaultSeen` holds the wallet address itself, read only while per-wallet
 *  storage points at that wallet (null = can't tell now). */
function seenMarker(wallet: string): boolean | null {
  if (getWalletScope() !== wallet) return null;
  return getSetting('keyVaultSeen') === wallet;
}

function markSeen(wallet: string): void {
  if (getWalletScope() !== wallet) return;
  if (getSetting('keyVaultSeen') !== wallet) setSetting('keyVaultSeen', wallet);
}

const controller = createVaultController({
  currentWallet: walletAddress,
  generation: getSwitchGeneration,
  ensureBackupKey: () => keySource.ensure(),
  log: e2elog,
  fetchVault: () => getClient().getKeyVault(), // null only on a true 404
  open: openKeyVault,
  importKeys: (keyring) => ({
    conv: importConvKeysFromVault(keyring.conv),
    chan: importChannelKeysFromVault(keyring.chan),
  }),
  seenMarker,
  markSeen,
  snapshot: currentKeyring,
  isEmpty: isEmptyKeyring,
  seal: sealKeyVault,
  publish: async (sealed) => {
    await getClient().syncKeyVault(sealed);
    e2elog('keyvault: backup published', { bytes: sealed.encrypted_vault.length });
  },
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  onStateChange: () => refreshIssue(),
});

function refreshIssue(): void {
  const w = walletAddress();
  if (!w) {
    setIssueRaw(null);
    return;
  }
  const m = keySource.mismatch();
  if (m && m.wallet === w && m.generation === getSwitchGeneration()) {
    setIssueRaw({ kind: 'wallet-mismatch', wallet: w });
    return;
  }
  const st = controller.status();
  setIssueRaw(st.restore === 'blocked' && st.blockReason ? { kind: st.blockReason, wallet: w } : null);
}

/** Forget the cached backup key + all session state (call on wallet disconnect/switch).
 *  Cancels any pending backup so a debounced publish can't fire under a NEW wallet,
 *  and clears the wallet-mismatch latch. */
export function clearKeyVaultSession(): void {
  keySource.clear();
  controller.clearSession();
  refreshIssue();
}

/** Pull + decrypt the vault and merge restored keys into the in-memory caches.
 *  Session-once, coalesced and idempotent; safe to call from a decrypt-miss render
 *  path. A transient failure stays retryable; `blocked` waits for the user. */
export function tryRestoreKeyVault(): void {
  controller.tryRestore();
}

/** User Retry (banner): ask the wallet again after a mismatch, and re-check a
 *  blocked vault. */
export function retryKeyVault(): void {
  keySource.clearMismatch();
  controller.retry();
  refreshIssue();
}

/** The account a confirmation is being asked FOR: capture it BEFORE opening the
 *  confirm and pass it to {@link replaceKeyVault}. */
export function keyVaultAccount(): AccountStamp | null {
  const wallet = walletAddress();
  return wallet ? { wallet, generation: getSwitchGeneration() } : null;
}

/** User-confirmed "Replace backup" (banner, behind a confirm): overwrite an
 *  unreadable / missing remote vault with this device's keyring. Only acts while
 *  restore is `blocked`, and only for `forAccount` — the account the user
 *  confirmed for. If the active wallet or switch generation changed while the
 *  confirm was open, returns 'stale' and publishes nothing. */
export async function replaceKeyVault(forAccount?: AccountStamp | null): Promise<PublishOutcome> {
  if (forAccount === null) return 'stale';
  const out = await controller.replace(forAccount);
  refreshIssue();
  return out;
}

// Register into the crypto caches at module load (imported for side effects).
setKeyringChangeListener(() => controller.scheduleBackup());
setVaultRestoreRequester(tryRestoreKeyVault);

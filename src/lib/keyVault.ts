/**
 * E2E key-recovery vault wiring (P3, protocol §2.5). Persists this wallet's symmetric
 * content keys — DM `conv_key`s and channel epoch `channel_key`s — to the node, sealed
 * under a backup key derived from `signMessage("ogmara-keyvault-v1")`, so a fresh
 * device / reinstall can restore full message history. The node stores the blob
 * opaquely (it never holds the backup key).
 *
 * Flow:
 *  - **Backup:** whenever a content key is cached, {@link scheduleBackup} debounces a
 *    `sealKeyVault` → `syncKeyVault` publish (one LWW record per wallet).
 *  - **Restore:** a decrypt-miss (key wrapped only to a prior device) triggers a
 *    session-once background pull → `openKeyVault` → merge into the in-memory caches.
 *
 * The wallet backup key `bk` is derived ONCE per session (a `signMessage` popup for
 * external wallets; silent for built-in) and cached in memory.
 */
import {
  deriveVaultBackupKey,
  sealKeyVault,
  openKeyVault,
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
import { getSwitchGeneration } from './walletScope';
import { runRestore, runPublish, type OwnedKey } from './keyVaultCore';

let bk: Uint8Array | null = null;
let bkWallet: string | null = null;
let bkInflight: Promise<OwnedKey | null> | null = null;
/** Wallet + switch generation the in-flight derivation was started for. */
let bkInflightWallet: string | null = null;
let bkInflightGen = -1;
/** Identifies the in-flight derivation (a token, not the promise: the promise
 *  is not assigned yet if the derivation settles synchronously). */
let bkToken = 0;
let bkInflightToken = 0;

/** Derive (once per session) and cache the wallet backup key. Dedupes concurrent
 *  callers so restore + backup racing produce a single wallet popup — but only
 *  callers of the SAME wallet and switch generation: a derivation started for
 *  another account is never handed out. Returns the key WITH the wallet it was
 *  derived for, so callers can verify ownership. */
async function ensureBackupKey(): Promise<OwnedKey | null> {
  const wallet = walletAddress();
  if (!wallet) return null;
  const gen = getSwitchGeneration();
  if (bk && bkWallet === wallet) return { key: bk, wallet };
  if (bkInflight && bkInflightWallet === wallet && bkInflightGen === gen) return bkInflight;
  const token = ++bkToken;
  bkInflightToken = token;
  const run: Promise<OwnedKey | null> = (async () => {
    try {
      const sig = await walletSignFn()(VAULT_SIGN_CLAIM);
      const derived = deriveVaultBackupKey(sig);
      // The account may have changed while the wallet was signing: never cache
      // (or return) a key under a wallet that is no longer the one it was for.
      if (walletAddress() !== wallet || getSwitchGeneration() !== gen) {
        derived.fill(0);
        return null;
      }
      bk = derived;
      bkWallet = wallet;
      return { key: derived, wallet };
    } catch (e) {
      e2elog('keyvault: backup-key derivation failed/declined', { err: (e as Error)?.message });
      return null;
    } finally {
      // Only clear the slot if it is still ours (a switch may have replaced it).
      if (bkInflightToken === token) {
        bkInflightToken = 0;
        bkInflight = null;
        bkInflightWallet = null;
        bkInflightGen = -1;
      }
    }
  })();
  // Publish the slot only if the derivation hasn't already settled (a
  // synchronous failure runs `finally` before we get here).
  if (bkInflightToken === token) {
    bkInflight = run;
    bkInflightWallet = wallet;
    bkInflightGen = gen;
  }
  return run;
}

/** Forget the cached backup key + all session state (call on wallet disconnect/switch).
 *  Cancels any pending backup so a debounced publish can't fire under a NEW wallet. */
export function clearKeyVaultSession(): void {
  bk?.fill(0);
  bk = null;
  bkWallet = null;
  // Forget an in-flight derivation too: it belongs to the departing account
  // and must never be handed to the next one (it also refuses to cache itself
  // once it sees the account changed).
  bkInflight = null;
  bkInflightWallet = null;
  bkInflightGen = -1;
  bkInflightToken = 0;
  // Invalidate any restore still in flight so its completion can't touch the
  // next account's restore state.
  restoreRun++;
  restoreState = 'idle';
  pendingBackup = false;
  if (backupTimer) {
    clearTimeout(backupTimer);
    backupTimer = null;
  }
}

function currentKeyring(): VaultKeyring {
  return { conv: exportConvKeysForVault(), chan: exportChannelKeysForVault() };
}

const isEmptyKeyring = (kr: VaultKeyring): boolean =>
  Object.keys(kr.conv).length === 0 && Object.keys(kr.chan).length === 0;

// --- backup (debounced) -----------------------------------------------------

const BACKUP_DEBOUNCE_MS = 4_000;
let backupTimer: ReturnType<typeof setTimeout> | null = null;
let pendingBackup = false;
let publishing = false;

/**
 * Arm a debounced backup. CRITICAL ordering: never publish before the remote vault
 * has been pulled + merged this session, or a fresh device would clobber its own
 * history (LWW) with a partial keyring. While restore is not yet `done`, record the
 * intent and kick restore; the restore completion re-arms the backup.
 */
function scheduleBackup(): void {
  if (restoreState !== 'done') {
    pendingBackup = true;
    tryRestoreKeyVault();
    return;
  }
  if (backupTimer) clearTimeout(backupTimer);
  backupTimer = setTimeout(() => {
    backupTimer = null;
    void publishBackup();
  }, BACKUP_DEBOUNCE_MS);
}

async function publishBackup(): Promise<void> {
  if (publishing) return;
  publishing = true;
  try {
    // Seals and publishes only if the wallet + switch generation captured at
    // the start still hold after the key derivation AND the key was derived
    // for that wallet (lib/keyVaultCore.ts) — never A's keys into B's vault.
    await runPublish({
      currentWallet: walletAddress,
      generation: getSwitchGeneration,
      ensureBackupKey,
      log: e2elog,
      snapshot: currentKeyring,
      isEmpty: isEmptyKeyring,
      seal: sealKeyVault,
      publish: async (sealed) => {
        await getClient().syncKeyVault(sealed);
        e2elog('keyvault: backup published', { bytes: sealed.encrypted_vault.length });
      },
    });
  } finally {
    publishing = false;
  }
}

// --- restore (session-once, background) -------------------------------------

let restoreState: 'idle' | 'inflight' | 'done' = 'idle';
/** Bumped per restore and by clearKeyVaultSession; a run only writes the
 *  restore state while it is still the latest. */
let restoreRun = 0;

/** Pull + decrypt the vault and merge restored keys into the in-memory caches.
 *  Session-once and idempotent; safe to call from a decrypt-miss render path. A
 *  transient fetch failure resets to `idle` (retried on the next trigger); only a
 *  genuine 404 or an unrecoverable blob is terminal (`done`). */
export function tryRestoreKeyVault(): void {
  if (restoreState !== 'idle') return;
  restoreState = 'inflight';
  const myRun = ++restoreRun;
  void (async () => {
    try {
      // Wallet + switch generation are captured inside runRestore and
      // re-checked after every await, before the imports and before a
      // terminal result (lib/keyVaultCore.ts).
      const outcome = await runRestore({
        currentWallet: walletAddress,
        generation: getSwitchGeneration,
        ensureBackupKey,
        log: e2elog,
        fetchVault: () => getClient().getKeyVault(), // null only on a true 404
        open: openKeyVault,
        importKeys: (keyring) => ({
          conv: importConvKeysFromVault(keyring.conv),
          chan: importChannelKeysFromVault(keyring.chan),
        }),
      });
      // A superseded run (account changed / session cleared) leaves the
      // CURRENT account's restore state alone.
      if (myRun !== restoreRun) return;
      restoreState = outcome === 'done' ? 'done' : 'idle';
    } catch (e) {
      if (myRun === restoreRun) restoreState = 'idle';
      e2elog('keyvault: restore failed', { err: (e as Error)?.message });
    } finally {
      // If a key was cached while restore was in flight, publish now that the
      // remote keyring is merged (no longer at risk of clobbering it).
      if (myRun === restoreRun && restoreState === 'done' && pendingBackup) {
        pendingBackup = false;
        scheduleBackup();
      }
    }
  })();
}

// Register into the crypto caches at module load (imported for side effects).
setKeyringChangeListener(scheduleBackup);
setVaultRestoreRequester(tryRestoreKeyVault);

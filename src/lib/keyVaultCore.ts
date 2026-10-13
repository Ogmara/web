/**
 * Account-safe core of the E2E key-recovery vault flows (restore + backup),
 * with every side effect injected so the ownership rules are testable under
 * `node --test` (keyVaultCore.test.ts). keyVault.ts wires the real SDK,
 * API client and crypto caches into it.
 *
 * Why (web 0.82.0): a restore in flight across disconnect(A) / connect(B) used
 * to import A's DM/channel keys into the global key caches now serving B
 * (B's next backup then sealed them into B's node vault), or — if the decrypt
 * failed — mark restore `done` for B's session, suppressing B's own restore
 * so the next backup overwrote B's remote vault with a partial keyring.
 *
 * Rule: capture the account (wallet + switch generation) at the start and
 * re-check after EVERY await and before every write. A stale run never
 * imports, never publishes, and never reports a terminal result.
 */

/** Who the flow belongs to. */
export interface AccountStamp {
  wallet: string;
  generation: number;
}

/** A backup key together with the wallet it was derived for. */
export interface OwnedKey {
  key: Uint8Array;
  wallet: string;
}

export interface VaultCoreDeps<Resp, Keyring> {
  /** `walletAddress()` now. */
  currentWallet(): string | null;
  /** `getSwitchGeneration()` now. */
  generation(): number;
  /** Derive/return the backup key for the wallet active now (or null). */
  ensureBackupKey(): Promise<OwnedKey | null>;
  log(step: string, data?: Record<string, unknown>): void;
}

export interface RestoreDeps<Resp, Keyring> extends VaultCoreDeps<Resp, Keyring> {
  /** GET the remote vault; `null` only on a true 404; throws on transient errors. */
  fetchVault(): Promise<Resp | null>;
  /** Decrypt (throws on auth failure / corrupt blob). */
  open(key: Uint8Array, resp: Resp): Keyring;
  /** Merge into the in-memory key caches. */
  importKeys(keyring: Keyring): Record<string, unknown>;
}

export interface PublishDeps<Sealed, Keyring> extends VaultCoreDeps<unknown, Keyring> {
  /** Snapshot of the current keyring (taken synchronously at start). */
  snapshot(): Keyring;
  isEmpty(keyring: Keyring): boolean;
  seal(key: Uint8Array, keyring: Keyring): Sealed;
  publish(sealed: Sealed): Promise<void>;
}

/** Capture the active account, or null when signed out. */
export function stampAccount(deps: Pick<VaultCoreDeps<unknown, unknown>, 'currentWallet' | 'generation'>): AccountStamp | null {
  const wallet = deps.currentWallet();
  return wallet ? { wallet, generation: deps.generation() } : null;
}

/** Whether `stamp` still describes the active account. */
export function stampStillCurrent(
  deps: Pick<VaultCoreDeps<unknown, unknown>, 'currentWallet' | 'generation'>,
  stamp: AccountStamp,
): boolean {
  return deps.currentWallet() === stamp.wallet && deps.generation() === stamp.generation;
}

/**
 * Outcome of a restore attempt:
 *  - `done`  — terminal FOR `stamp`'s account (restored, 404, or a genuinely
 *              undecryptable blob under that account's own key)
 *  - `idle`  — retry on the next trigger (no key, declined, transient fetch)
 *  - `stale` — the account changed mid-flight; nothing was written, and the
 *              caller must not touch the (new account's) restore state
 */
export type RestoreOutcome = 'done' | 'idle' | 'stale';

export async function runRestore<Resp, Keyring>(deps: RestoreDeps<Resp, Keyring>): Promise<RestoreOutcome> {
  const stamp = stampAccount(deps);
  if (!stamp) return 'idle';
  const stale = () => !stampStillCurrent(deps, stamp);

  const owned = await deps.ensureBackupKey();
  if (stale()) return 'stale';
  if (!owned) return 'idle';
  if (owned.wallet !== stamp.wallet) return 'idle'; // key belongs to another wallet

  let resp: Resp | null;
  try {
    resp = await deps.fetchVault();
  } catch (e) {
    if (stale()) return 'stale';
    deps.log('keyvault: restore fetch failed (will retry)', { err: (e as Error)?.message });
    return 'idle';
  }
  if (stale()) return 'stale';

  if (resp) {
    let keyring: Keyring;
    try {
      keyring = deps.open(owned.key, resp);
    } catch (e) {
      // Re-check before treating it as terminal: a failure for a key/blob of
      // another account must not end the CURRENT account's restore.
      if (stale()) return 'stale';
      deps.log('keyvault: restore decrypt failed', { err: (e as Error)?.message });
      return 'done';
    }
    // No await between this check and the imports.
    if (stale()) return 'stale';
    const counts = deps.importKeys(keyring);
    deps.log('keyvault: restored', counts);
  }
  return 'done';
}

/** Outcome of a publish attempt. */
export type PublishOutcome = 'published' | 'skipped' | 'stale' | 'failed';

export async function runPublish<Sealed, Keyring>(deps: PublishDeps<Sealed, Keyring>): Promise<PublishOutcome> {
  const stamp = stampAccount(deps);
  if (!stamp) return 'skipped';
  const keyring = deps.snapshot();
  if (deps.isEmpty(keyring)) return 'skipped';
  const owned = await deps.ensureBackupKey();
  if (!stampStillCurrent(deps, stamp)) return 'stale';
  if (!owned || owned.wallet !== stamp.wallet) return 'skipped';
  // No await between this check and sealing; `publish` is handed the blob
  // synchronously, so it signs under the account checked here.
  const sealed = deps.seal(owned.key, keyring);
  try {
    await deps.publish(sealed);
    return 'published';
  } catch (e) {
    deps.log('keyvault: backup failed', { err: (e as Error)?.message });
    return 'failed';
  }
}

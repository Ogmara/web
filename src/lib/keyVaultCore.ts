/**
 * Account-safe core of the E2E key-recovery vault flows (restore + backup),
 * with every side effect injected so the rules are testable under
 * `node --test` (keyVaultCore.test.ts). keyVault.ts wires the real SDK,
 * API client, crypto caches, settings and timers into it.
 *
 * Why (web 0.82.0): a restore in flight across disconnect(A) / connect(B) used
 * to import A's DM/channel keys into the global key caches now serving B
 * (B's next backup then sealed them into B's node vault), or — if the decrypt
 * failed — mark restore `done` for B's session, suppressing B's own restore
 * so the next backup overwrote B's remote vault with a partial keyring.
 * Rule: capture the account (wallet + switch generation) at the start and
 * re-check after EVERY await and before every write. A stale run never
 * imports, never publishes, and never reports a terminal result.
 *
 * Why (web 0.84.0): the remote vault is one last-write-wins record per wallet,
 * so ANY publish replaces it everywhere. Rule: never overwrite the remote
 * vault unless THIS session, for THIS wallet and switch generation, either
 *  (1) opened the remote vault with a backup key verified to belong to this
 *      wallet (see {@link createBackupKeySource} / walletSigVerify.ts),
 *  (2) confirmed it verifiably empty — a real 404 AND no local
 *      `keyVaultSeen` marker for this wallet (a 404 from a node that never
 *      received the vault by gossip is otherwise indistinguishable), or
 *  (3) the user explicitly confirmed "Replace backup".
 * An `open` failure under our own verified key (wrong-key blob, corruption,
 * a future `format_version`) is `blocked: 'unreadable'`, not terminal `done`.
 * Remaining gap: a fresh device (no marker) on a node without a copy can't be
 * told apart from a brand-new user until the node backfills vaults.
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

/** The active account, as read now. */
export interface AccountDeps {
  /** `walletAddress()` now. */
  currentWallet(): string | null;
  /** `getSwitchGeneration()` now. */
  generation(): number;
}

export interface VaultCoreDeps extends AccountDeps {
  /** Derive/return the backup key for the wallet active now (or null). */
  ensureBackupKey(): Promise<OwnedKey | null>;
  log(step: string, data?: Record<string, unknown>): void;
}

export interface RestoreDeps<Resp, Keyring> extends VaultCoreDeps {
  /** GET the remote vault; `null` only on a true 404; throws on transient errors. */
  fetchVault(): Promise<Resp | null>;
  /** Decrypt (throws on auth failure / corrupt blob / unsupported format). */
  open(key: Uint8Array, resp: Resp): Keyring;
  /** Merge into the in-memory key caches. */
  importKeys(keyring: Keyring): Record<string, unknown>;
  /**
   * Whether this device has ever opened or published `wallet`'s vault
   * (`keyVaultSeen`). `null` = can't tell right now (storage not pointed at
   * `wallet`); the restore then stays retryable instead of guessing.
   */
  seenMarker(wallet: string): boolean | null;
  /** Record that `wallet`'s vault exists (after an open or a publish). */
  markSeen(wallet: string): void;
}

export interface PublishDeps<Sealed, Keyring> extends VaultCoreDeps {
  /** Snapshot of the current keyring (taken synchronously at start). */
  snapshot(): Keyring;
  isEmpty(keyring: Keyring): boolean;
  seal(key: Uint8Array, keyring: Keyring): Sealed;
  publish(sealed: Sealed): Promise<void>;
  /** Whether overwriting the remote vault is allowed NOW (restore `done` for this account). */
  canPublish(): boolean;
  /** Record that `wallet`'s vault exists (after a successful publish). */
  markSeen(wallet: string): void;
}

/**
 * Whether `owned` is a key for `wallet` that can still be used: non-empty and
 * not all-zero. A session clear zeroes the cached key in place, so a run that
 * fetched it before the clear holds zeros; opening with them would misreport a
 * readable vault as `unreadable`, and sealing with them would overwrite the
 * remote vault with a blob no device can open. Same check as desktop/mobile.
 */
export function usable(owned: OwnedKey | null, wallet: string): owned is OwnedKey {
  return !!owned && owned.wallet === wallet && owned.key.length > 0 && owned.key.some((b) => b !== 0);
}

/** Capture the active account, or null when signed out. */
export function stampAccount(deps: AccountDeps): AccountStamp | null {
  const wallet = deps.currentWallet();
  return wallet ? { wallet, generation: deps.generation() } : null;
}

/** Whether `stamp` still describes the active account. */
export function stampStillCurrent(deps: AccountDeps, stamp: AccountStamp): boolean {
  return deps.currentWallet() === stamp.wallet && deps.generation() === stamp.generation;
}

/**
 * Outcome of a restore attempt:
 *  - `done`       — terminal FOR `stamp`'s account: restored with a verified
 *                   own key, or verifiably empty (404 and no marker)
 *  - `unreadable` — the remote exists but our own key can't open it; never
 *                   overwrite it without the user's confirmation
 *  - `missing`    — 404, but this device has seen this wallet's vault before:
 *                   the node is missing a copy, it is not empty
 *  - `idle`       — retry on the next trigger (no key, declined, mismatch,
 *                   transient fetch, marker state unknown)
 *  - `stale`      — the account changed mid-flight; nothing was written, and
 *                   the caller must not touch the (new account's) state
 */
export type RestoreOutcome = 'done' | 'unreadable' | 'missing' | 'idle' | 'stale';

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

  if (!resp) {
    // A 404 is only "empty" if this device never saw a vault for the wallet:
    // vaults replicate by live gossip only, so a node that joined after the
    // last publish answers 404 for a vault that exists elsewhere.
    const seen = deps.seenMarker(stamp.wallet);
    if (seen === null) return 'idle';
    if (seen) {
      deps.log('keyvault: node has no copy of a vault this device has seen');
      return 'missing';
    }
    return 'done';
  }

  // After the last await: the key we hold may have been zeroed meanwhile.
  if (!usable(owned, stamp.wallet)) return 'idle';
  let keyring: Keyring;
  try {
    keyring = deps.open(owned.key, resp);
  } catch (e) {
    // Re-check before blocking: a failure for a key/blob of another account
    // must not decide anything for the CURRENT account.
    if (stale()) return 'stale';
    deps.log('keyvault: remote vault unreadable under own key', { err: (e as Error)?.message });
    return 'unreadable';
  }
  // No await between this check and the writes.
  if (stale()) return 'stale';
  const counts = deps.importKeys(keyring);
  deps.markSeen(stamp.wallet);
  deps.log('keyvault: restored', counts);
  return 'done';
}

/**
 * Outcome of a publish attempt:
 *  - `published`   — sealed and accepted by the node
 *  - `empty`       — nothing to back up
 *  - `unavailable` — signed out, or no backup key (declined / mismatch)
 *  - `blocked`     — publishing is not allowed now (`canPublish()` false)
 *  - `stale`       — the account changed mid-flight; nothing sent
 *  - `failed`      — the node / network refused it
 */
export type PublishOutcome = 'published' | 'empty' | 'unavailable' | 'blocked' | 'stale' | 'failed';

/**
 * The i18n key the key-vault banner shows after the user confirmed "Replace
 * backup", or `null` for nothing. Only `published` actually replaced the
 * node's vault; `empty` unblocked backups but sent nothing (no keys on this
 * device yet; the old vault stays on the node until the next key change), so
 * it must not claim the backup was replaced. `stale` (account changed while
 * the confirm was open), `blocked` and `unavailable` show nothing.
 */
export function replaceResultMessageKey(out: PublishOutcome): string | null {
  switch (out) {
    case 'published': return 'keyvault_replaced';
    case 'empty': return 'keyvault_replace_nothing';
    case 'failed': return 'keyvault_replace_failed';
    default: return null;
  }
}

export async function runPublish<Sealed, Keyring>(deps: PublishDeps<Sealed, Keyring>): Promise<PublishOutcome> {
  const stamp = stampAccount(deps);
  if (!stamp) return 'unavailable';
  const keyring = deps.snapshot();
  if (deps.isEmpty(keyring)) return 'empty';
  const owned = await deps.ensureBackupKey();
  if (!stampStillCurrent(deps, stamp)) return 'stale';
  // Also refuses a key zeroed by a session clear (see `usable`).
  if (!usable(owned, stamp.wallet)) return 'unavailable';
  // Gate AFTER the last await: the restore state may have changed while the
  // wallet was signing.
  if (!deps.canPublish()) return 'blocked';
  // No await between these checks and sealing; `publish` is handed the blob
  // synchronously, so it signs under the account checked here.
  const sealed = deps.seal(owned.key, keyring);
  try {
    await deps.publish(sealed);
  } catch (e) {
    deps.log('keyvault: backup failed', { err: (e as Error)?.message });
    return 'failed';
  }
  if (stampStillCurrent(deps, stamp)) deps.markSeen(stamp.wallet);
  return 'published';
}

// --- verified backup key ------------------------------------------------------

/** Result of checking a wallet signature against the expected wallet. */
export type SigCheck =
  | { ok: true; sig: Uint8Array }
  | { ok: false; reason: 'mismatch' | 'malformed' | 'bad-address' };

export interface BackupKeySourceDeps extends AccountDeps {
  /** Ask the wallet to sign the vault claim (a popup for external wallets). */
  sign(): Promise<string | Uint8Array>;
  /** Check `raw` is a signature of the claim by `wallet` (walletSigVerify.ts). */
  verify(wallet: string, raw: string | Uint8Array): Promise<SigCheck>;
  /** Backup key from the VERIFIED 64 signature bytes. */
  derive(sig: Uint8Array): Uint8Array;
  log(step: string, data?: Record<string, unknown>): void;
  /** Called when the mismatch latch is set or cleared. */
  onIssueChange?(): void;
}

export interface BackupKeySource {
  /** The verified backup key of the wallet active now (cached, joined in flight, or derived). */
  ensure(): Promise<OwnedKey | null>;
  /** Zero + forget the key, abandon any in-flight derivation, clear the latch. */
  clear(): void;
  /** User Retry: forget the mismatch latch so the next `ensure` asks the wallet again. */
  clearMismatch(): void;
  /** The account the wallet last signed as someone else for, if any. */
  mismatch(): AccountStamp | null;
  /** Introspection: the wallet the cached key belongs to. */
  cachedWallet(): string | null;
}

/**
 * Backup-key cache with a verified derivation: sign -> verify the signature
 * against the wallet captured at the start -> derive from the verified bytes.
 * Applied to every wallet source (built-in included; one verify per session).
 *
 * On a mismatch (the external wallet signed as another account) the key is
 * never derived, and a latch `{wallet, generation}` makes later `ensure`
 * calls for that account return null WITHOUT asking the wallet again — no
 * popup per decrypt-miss. The latch clears on {@link BackupKeySource.clear}
 * (session clear) or {@link BackupKeySource.clearMismatch} (user Retry).
 */
export function createBackupKeySource(deps: BackupKeySourceDeps): BackupKeySource {
  let cached: OwnedKey | null = null;
  let inflight: { stamp: AccountStamp; p: Promise<OwnedKey | null> } | null = null;
  let latch: AccountStamp | null = null;
  /** Bumped by `clear`, so a derivation started before it can't cache. */
  let epoch = 0;

  const isCurrent = (s: AccountStamp) => stampStillCurrent(deps, s);

  return {
    ensure() {
      const stamp = stampAccount(deps);
      if (!stamp) return Promise.resolve(null);
      if (cached && cached.wallet === stamp.wallet) return Promise.resolve(cached);
      if (latch && latch.wallet === stamp.wallet && latch.generation === stamp.generation) {
        return Promise.resolve(null);
      }
      // Join an in-flight derivation ONLY for the same wallet AND generation.
      if (inflight && inflight.stamp.wallet === stamp.wallet && inflight.stamp.generation === stamp.generation) {
        return inflight.p;
      }
      const myEpoch = epoch;
      const entry = { stamp, p: Promise.resolve<OwnedKey | null>(null) };
      entry.p = (async (): Promise<OwnedKey | null> => {
        try {
          const raw = await deps.sign();
          if (epoch !== myEpoch || !isCurrent(stamp)) return null;
          const check = await deps.verify(stamp.wallet, raw);
          // After the LAST await: the account may have changed while verifying.
          if (epoch !== myEpoch || !isCurrent(stamp)) return null;
          if (!check.ok) {
            deps.log('keyvault: wallet signature rejected', { reason: check.reason });
            if (check.reason === 'mismatch') {
              latch = { ...stamp };
              deps.onIssueChange?.();
            }
            return null;
          }
          const key = deps.derive(check.sig);
          check.sig.fill(0);
          if (!usable({ key, wallet: stamp.wallet }, stamp.wallet)) return null;
          if (cached && cached.wallet !== stamp.wallet) cached.key.fill(0);
          cached = { key, wallet: stamp.wallet };
          return cached;
        } catch (e) {
          deps.log('keyvault: backup-key derivation failed/declined', { err: (e as Error)?.message });
          return null;
        } finally {
          if (inflight === entry) inflight = null;
        }
      })();
      inflight = entry;
      return entry.p;
    },
    clear() {
      cached?.key.fill(0);
      cached = null;
      inflight = null;
      epoch++;
      if (latch) {
        latch = null;
        deps.onIssueChange?.();
      }
    },
    clearMismatch() {
      if (!latch) return;
      latch = null;
      deps.onIssueChange?.();
    },
    mismatch: () => (latch ? { ...latch } : null),
    cachedWallet: () => cached?.wallet ?? null,
  };
}

// --- controller ---------------------------------------------------------------

/** Restore state of the current session. `blocked` is per session, never persisted. */
export type RestoreState = 'idle' | 'inflight' | 'done' | 'blocked';
/** Why restore is `blocked`. */
export type BlockReason = 'unreadable' | 'missing';
/** {@link VaultController.ensureRestored} result. */
export type EnsureRestoredResult = 'done' | 'idle' | 'blocked' | 'stale';
/** {@link VaultController.backupNow} result (each maps to its own message). */
export type BackupNowResult =
  | 'published'
  | 'nothing'
  | 'restore-failed'
  | 'blocked'
  | 'stale'
  | 'failed'
  | 'unavailable';

/** Default debounce between a keyring change and its publish. */
export const BACKUP_DEBOUNCE_MS = 4_000;
/** Automatic retries after a failed publish: 60 s, 5 min, 15 min, then stop. */
export const FAIL_BACKOFF_MS: readonly number[] = [60_000, 300_000, 900_000];

export interface VaultControllerDeps<Resp, Sealed, Keyring>
  extends RestoreDeps<Resp, Keyring>,
    Omit<PublishDeps<Sealed, Keyring>, 'canPublish'> {
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  /** Called whenever the restore state / block reason changes. */
  onStateChange?(): void;
  debounceMs?: number;
  failBackoffMs?: readonly number[];
}

export interface VaultStatus {
  restore: RestoreState;
  blockReason: BlockReason | null;
  pendingBackup: boolean;
  publishing: boolean;
  failStreak: number;
}

export interface VaultController {
  /** A content key was cached: back it up (debounced) once that is allowed. */
  scheduleBackup(): void;
  /** Background restore trigger (decrypt-miss, keyring change). Coalesced. */
  tryRestore(): void;
  /** Join the in-flight restore or start one; resolves with its result. */
  ensureRestored(): Promise<EnsureRestoredResult>;
  /** Manual backup: restore first, then exactly one publish, honest result. */
  backupNow(): Promise<BackupNowResult>;
  /**
   * User-confirmed "Replace backup" while `blocked`: accept overwriting the
   * remote for the current account and publish now. Refused ('blocked') in any
   * other state, so it can never skip a restore that hasn't run. `forStamp` is
   * the account the user confirmed FOR (captured before the confirm opened):
   * if it is no longer the active account — checked now and again after every
   * await — the result is 'stale' and nothing is published.
   */
  replace(forStamp?: AccountStamp): Promise<PublishOutcome>;
  /** User Retry: leave `blocked` and run restore again. */
  retry(): void;
  /** Wallet disconnect / switch: forget everything about the session. */
  clearSession(): void;
  status(): VaultStatus;
}

/**
 * The key-vault state machine. Restore states `idle | inflight | done |
 * blocked`, each bound to the account stamp it was reached for (a state of
 * another wallet or generation reads as `idle`). Publishing requires `done`,
 * checked here AND inside {@link runPublish} after its last await.
 *
 * Re-arm: a publish requested while one is in flight sets `publishAgain` (for
 * the requesting account); when the flight ends, one follow-up is scheduled if
 * that account is still active. A `failed` publish retries with backoff
 * {@link FAIL_BACKOFF_MS}, at most that many times; success or a session
 * clear resets the streak.
 */
export function createVaultController<Resp, Sealed, Keyring>(
  deps: VaultControllerDeps<Resp, Sealed, Keyring>,
): VaultController {
  const debounceMs = deps.debounceMs ?? BACKUP_DEBOUNCE_MS;
  const backoff = deps.failBackoffMs ?? FAIL_BACKOFF_MS;

  let restoreState: RestoreState = 'idle';
  let blockReason: BlockReason | null = null;
  /** Account the current `restoreState` was reached for. */
  let stateStamp: AccountStamp | null = null;
  /** Bumped per restore run and by `clearSession`; only the latest run writes state. */
  let restoreRun = 0;
  let restorePromise: Promise<EnsureRestoredResult> | null = null;

  let pendingBackup = false;
  let backupTimer: unknown = null;
  let retryTimer: unknown = null;
  let publishing: Promise<PublishOutcome> | null = null;
  /** Account that asked for a publish while one was in flight. */
  let publishAgain: AccountStamp | null = null;
  let failStreak = 0;

  const changed = () => deps.onStateChange?.();

  const setState = (s: RestoreState, reason: BlockReason | null, stamp: AccountStamp | null) => {
    const differs = s !== restoreState || reason !== blockReason;
    restoreState = s;
    blockReason = reason;
    stateStamp = stamp;
    if (differs) changed();
  };

  /** The restore state as it applies to the account active NOW. */
  const effectiveState = (): RestoreState => {
    if (restoreState !== 'idle' && (!stateStamp || !stampStillCurrent(deps, stateStamp))) {
      // Reached for another account / generation: abandon it for this one.
      if (restoreState === 'inflight') restoreRun++;
      restorePromise = null;
      setState('idle', null, null);
    }
    return restoreState;
  };

  const canPublish = () => effectiveState() === 'done';

  const cancelBackupTimer = () => {
    if (backupTimer !== null) {
      deps.clearTimer(backupTimer);
      backupTimer = null;
    }
  };
  const cancelRetryTimer = () => {
    if (retryTimer !== null) {
      deps.clearTimer(retryTimer);
      retryTimer = null;
    }
  };

  function startRestore(): Promise<EnsureRestoredResult> {
    const stamp = stampAccount(deps);
    const myRun = ++restoreRun;
    setState('inflight', null, stamp);
    const p = (async (): Promise<EnsureRestoredResult> => {
      let outcome: RestoreOutcome;
      try {
        outcome = await runRestore(deps);
      } catch (e) {
        deps.log('keyvault: restore failed', { err: (e as Error)?.message });
        outcome = 'idle';
      }
      // Superseded (session cleared / another account took over): the
      // CURRENT account's state is not ours to write.
      if (myRun !== restoreRun) return 'stale';
      restorePromise = null;
      switch (outcome) {
        case 'done':
          setState('done', null, stamp);
          if (pendingBackup) {
            pendingBackup = false;
            scheduleBackup();
          }
          return 'done';
        case 'unreadable':
        case 'missing':
          // pendingBackup stays set: the intent survives until Replace.
          setState('blocked', outcome, stamp);
          return 'blocked';
        case 'stale':
          setState('idle', null, null);
          return 'stale';
        default:
          setState('idle', null, null);
          return 'idle';
      }
    })();
    restorePromise = p;
    return p;
  }

  function ensureRestored(): Promise<EnsureRestoredResult> {
    if (!stampAccount(deps)) return Promise.resolve('idle');
    const s = effectiveState();
    if (s === 'done') return Promise.resolve('done');
    if (s === 'blocked') return Promise.resolve('blocked');
    if (s === 'inflight' && restorePromise) return restorePromise;
    return startRestore();
  }

  function scheduleBackup(): void {
    const s = effectiveState();
    if (s !== 'done') {
      // Never publish before the remote was pulled + merged (or confirmed
      // empty) this session. Keep the intent; restore completion re-arms it.
      pendingBackup = true;
      // While blocked: no GET loops — wait for the user's Retry / Replace.
      if (s !== 'blocked') void ensureRestored();
      return;
    }
    cancelBackupTimer();
    backupTimer = deps.setTimer(() => {
      backupTimer = null;
      void publishFromTimer();
    }, debounceMs);
  }

  /** Run one publish (caller guarantees none is in flight) and do the bookkeeping. */
  function startPublish(): Promise<PublishOutcome> {
    const p = (async (): Promise<PublishOutcome> => {
      let outcome: PublishOutcome;
      try {
        outcome = await runPublish({ ...deps, canPublish });
      } catch (e) {
        deps.log('keyvault: backup failed', { err: (e as Error)?.message });
        outcome = 'failed';
      }
      return outcome;
    })();
    publishing = p;
    void p.then((outcome) => {
      if (publishing === p) publishing = null;
      afterPublish(outcome);
    });
    return p;
  }

  function afterPublish(outcome: PublishOutcome): void {
    if (outcome === 'published') {
      failStreak = 0;
      cancelRetryTimer();
    } else if (outcome === 'failed') {
      if (failStreak < backoff.length && retryTimer === null) {
        const delay = backoff[failStreak];
        failStreak++;
        retryTimer = deps.setTimer(() => {
          retryTimer = null;
          void publishFromTimer();
        }, delay);
      }
    } else if (outcome === 'blocked') {
      pendingBackup = true;
    }
    // One follow-up for a request that arrived during the flight — only for
    // the account that asked, and only while it is still active.
    const again = publishAgain;
    publishAgain = null;
    if (again && stampStillCurrent(deps, again)) scheduleBackup();
  }

  async function publishFromTimer(): Promise<void> {
    if (publishing) {
      publishAgain = stampAccount(deps);
      return;
    }
    if (!canPublish()) {
      pendingBackup = true;
      return;
    }
    await startPublish();
  }

  /** Wait for any in-flight publish, then run exactly one. */
  async function publishNow(forStamp?: AccountStamp): Promise<PublishOutcome> {
    const stamp = forStamp ?? stampAccount(deps);
    while (publishing) {
      await publishing.catch(() => undefined);
      // Let the finished flight's bookkeeping run first.
      await Promise.resolve();
    }
    if (!stamp || !stampStillCurrent(deps, stamp)) return 'stale';
    if (!canPublish()) return 'blocked';
    cancelBackupTimer();
    return startPublish();
  }

  async function backupNow(): Promise<BackupNowResult> {
    const r = await ensureRestored();
    if (r === 'idle') return 'restore-failed';
    if (r !== 'done') return r;
    const out = await publishNow();
    switch (out) {
      case 'published': return 'published';
      case 'empty': return 'nothing';
      default: return out;
    }
  }

  async function replace(forStamp?: AccountStamp): Promise<PublishOutcome> {
    const stamp = forStamp ?? stampAccount(deps);
    if (!stamp) return 'blocked';
    // The confirmation was given for `stamp`'s account; never act for another.
    if (!stampStillCurrent(deps, stamp)) return 'stale';
    if (effectiveState() !== 'blocked') return 'blocked';
    deps.log('keyvault: user confirmed replacing the remote vault', { reason: blockReason });
    setState('done', null, stamp);
    pendingBackup = false;
    // publishNow re-checks `stamp` after waiting for an in-flight publish.
    return publishNow(stamp);
  }

  function retry(): void {
    const s = effectiveState();
    if (s === 'blocked') setState('idle', null, null);
    if (s !== 'done') void ensureRestored();
  }

  function clearSession(): void {
    restoreRun++;
    restorePromise = null;
    pendingBackup = false;
    publishAgain = null;
    failStreak = 0;
    cancelBackupTimer();
    cancelRetryTimer();
    setState('idle', null, null);
  }

  return {
    scheduleBackup,
    tryRestore: () => void ensureRestored(),
    ensureRestored,
    backupNow,
    replace,
    retry,
    clearSession,
    status: () => ({
      restore: effectiveState(),
      blockReason,
      pendingBackup,
      publishing: publishing !== null,
      failStreak,
    }),
  };
}

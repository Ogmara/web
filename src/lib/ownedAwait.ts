/**
 * "Does this async result still belong to the account that started it?"
 *
 * An await can span a disconnect + connect of another wallet. Anything that
 * writes per-wallet state after such an await must first confirm that BOTH
 * signals still name the starting account: `walletAddress()` (what the UI
 * shows) and the wallet scope (where scoped writes actually land — it flips
 * at a different statement than the address during a connect).
 *
 * Import-free so it runs under `node --test`.
 */
export interface OwnerSnapshot {
  wallet: string | null;
  scope: string | null;
}

/** True only when `owner` is a real wallet and both signals still name it. */
export function isStillOwner(owner: string | null, now: OwnerSnapshot): boolean {
  return !!owner && now.wallet === owner && now.scope === owner;
}

/**
 * Run `work` and hand back its value only if `owner` is still the active
 * account (per `readNow`) once it settles. A rejection propagates unchanged.
 */
export async function awaitForOwner<T>(
  owner: string | null,
  readNow: () => OwnerSnapshot,
  work: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false }> {
  if (!isStillOwner(owner, readNow())) return { ok: false };
  const value = await work();
  if (!isStillOwner(owner, readNow())) return { ok: false };
  return { ok: true, value };
}

/**
 * Export an account-bound key for `owner` — captured by the caller BEFORE the
 * export, never inferred afterwards. Returns null unless `owner` is still the
 * active account once the export settles, and (when the caller can check it
 * cheaply) the key actually belongs to `owner`.
 */
export async function exportKeyForOwner(
  owner: string | null,
  readNow: () => OwnerSnapshot,
  exportKey: () => Promise<string | null>,
  keyBelongsToOwner: () => boolean = () => true,
): Promise<string | null> {
  const res = await awaitForOwner(owner, readNow, exportKey);
  if (!res.ok || !res.value) return null;
  if (!keyBelongsToOwner()) return null;
  return res.value;
}

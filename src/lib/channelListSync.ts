/**
 * Gate for reconciling the joined-channel set against the node's channel list.
 *
 * `syncJoinedWithApi` is ADD-ONLY and, on an account whose joined set was never
 * initialised, seeds every `channel_type === 2` (private) entry it is handed.
 * Feeding it a list that belongs to a DIFFERENT account therefore copies that
 * account's private channels into the new account's persisted joined set — the
 * cross-account leak this gate exists to close (web 0.82.0): after a
 * disconnect + connect of another wallet in the same page, the Sidebar's
 * channel resource still held account A's list until B's fetch resolved, and
 * the sync effect re-ran on that stale list under B.
 *
 * Kept as a pure predicate so the Sidebar and its wiring test evaluate the same
 * code.
 */
export interface JoinedSyncInputs {
  /** `authStatus() === 'ready'`. */
  authReady: boolean;
  /** The wallet the CURRENT list was live-fetched for (set only on live success). */
  liveListOwner: string | null;
  /** `walletAddress()` now. */
  wallet: string | null;
  /** `getWalletScope()` now — where `syncJoinedWithApi` will persist. */
  scope: string | null;
  /** `allChannels.loading` — a fetch is in flight, the value may be stale. */
  loading: boolean;
  /** Number of channels in the list about to be reconciled. */
  listLength: number;
}

export function shouldReconcileJoined(i: JoinedSyncInputs): boolean {
  if (!i.authReady) return false;
  if (!i.wallet) return false;
  if (i.loading) return false;
  if (i.listLength <= 0) return false;
  // The list must be a LIVE fetch for this exact wallet, and storage must be
  // pointed at that same wallet — during a connect the scope and the address
  // flip at different statements, and a reconcile in that gap would persist
  // into the wrong namespace.
  return i.liveListOwner === i.wallet && i.scope === i.wallet;
}

/**
 * "This account was just created on this device" marker.
 *
 * A brand-new wallet has never read anything, so the node reports the default
 * channel's entire history as unread and the sidebar opens with a large badge
 * the user did nothing to earn. The create-new path (`generateWallet`) sets
 * this per-wallet flag; the Sidebar consumes it once, after the first LIVE
 * channel list for that wallet, by marking the default channel read.
 *
 * Deliberately NOT set when importing an existing key or connecting an
 * extension wallet: those accounts may have real unread history.
 *
 * Stored through walletScope, so it is per account and removed by the
 * disconnect wipe.
 */
import { scopedGet, scopedSet, scopedRemove } from './walletScope.ts';

const KEY = 'ogmara.freshAccountBaseline';

/** Flag the ACTIVE wallet scope as freshly created. Call after setWalletScope. */
export function markFreshAccount(): void {
  scopedSet(KEY, '1');
}

/** Whether the active wallet still has an unconsumed fresh-account flag. */
export function isFreshAccount(): boolean {
  return scopedGet(KEY) === '1';
}

/** Consume the flag for the active wallet. */
export function clearFreshAccount(): void {
  scopedRemove(KEY);
}

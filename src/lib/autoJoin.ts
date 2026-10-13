/**
 * Once-per-account-per-channel auto-join for encrypted public channels.
 *
 * Reading or posting in an encrypted channel requires membership: the node
 * only wraps the channel epoch key to members. Opening such a channel
 * therefore joins it once. The bookkeeping used to be a component-local
 * `Set<channelId>` inside ChatView, which (a) was keyed by channel only, so
 * after a disconnect + connect of a different wallet in the same page the new
 * account was treated as already joined, and (b) was re-created on every
 * ChatView mount, so revisiting a channel re-sent the join.
 *
 * Keys are `${wallet}:${channelId}`; the set is cleared on every wallet-scope
 * change and an entry is removed again when the join fails so a later visit
 * retries.
 *
 * The caller decides WHETHER to join (see `shouldAutoJoinEncryptedChannel` in
 * channelEncryption.ts — positive evidence only) and supplies the join call,
 * which keeps this module free of the API client and testable under
 * `node --test`.
 */
import { registerWalletSwitchReset } from './walletScope.ts';

const attempted = new Set<string>();

/** Upper bound so a pathological session cannot grow the set without limit. */
const MAX_TRACKED = 2000;

/**
 * Join `channelId` as `wallet` unless that pair was already attempted this
 * session. Resolves `true` when a join was sent and succeeded, `false` when it
 * was skipped (already attempted / bad input) or failed.
 */
export async function ensureEncryptedChannelMembership(
  channelId: number,
  wallet: string,
  join: (channelId: number) => Promise<unknown>,
): Promise<boolean> {
  if (!wallet || !Number.isSafeInteger(channelId) || channelId <= 0) return false;
  const key = `${wallet}:${channelId}`;
  if (attempted.has(key)) return false;
  if (attempted.size >= MAX_TRACKED) attempted.clear();
  attempted.add(key);
  try {
    await join(channelId);
    return true;
  } catch {
    // Let a later visit retry. Only drop OUR key — a wallet switch may already
    // have cleared the set, and that must stay cleared.
    attempted.delete(key);
    return false;
  }
}

/** Test hook: whether a (wallet, channel) pair is currently recorded. */
export function hasAttemptedMembership(channelId: number, wallet: string): boolean {
  return attempted.has(`${wallet}:${channelId}`);
}

registerWalletSwitchReset(() => attempted.clear());

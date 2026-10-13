/**
 * Per-account detail routes must not survive into a DIFFERENT account.
 *
 * On web, switching accounts is disconnect + connect in the same page, so the
 * wallet goes A -> null -> B while the hash stays put. A route like
 * `#/chat/<id>` or `#/dm/<peer>` that A had open then renders for B: ChatView
 * would auto-join B to an encrypted public channel A was viewing and record it
 * as B's `lastChannel`; a DM view would open A's conversation partner under B.
 *
 * The decision is pure so it can be tested: it compares the incoming wallet to
 * the last NON-NULL wallet seen in this page. The first login in a page has no
 * previous wallet, so deep links (shared channel/DM links, invite links) keep
 * working.
 */

/** Minimal route shape (structurally compatible with router.ts `Route`). */
export interface AccountRouteLike {
  view: string;
  params: Record<string, string>;
}

/**
 * The neutral route to fall back to when `r` belongs to the previous account,
 * or `null` when `r` is not account-specific (public views, lists that refetch
 * for the new account on their own).
 */
export function neutralRouteForAccountDetail(r: AccountRouteLike): string | null {
  switch (r.view) {
    case 'chat':
      // `/chat` with no id resolves to the NEW account's own lastChannel.
      return r.params.channelId ? '/chat' : null;
    case 'channel-settings':
      return '/chat';
    // `channel-join` deliberately NOT here (parity with desktop
    // routeCarryover.ts): an invite link is often opened first and the right
    // account connected second, and joining is an explicit click — the join
    // view re-checks the wallet across its awaits.
    case 'dm-conversation':
      return '/dm';
    default:
      return null;
  }
}

/**
 * Where to send the user when the active wallet becomes `nextWallet`, given
 * the last non-null wallet seen in this page. `null` = stay.
 */
export function routeAfterAccountChange(
  current: AccountRouteLike,
  lastSeenWallet: string | null,
  nextWallet: string | null,
): string | null {
  if (!nextWallet) return null; // signing out: nothing to protect yet
  if (!lastSeenWallet) return null; // first login in this page: keep deep links
  if (lastSeenWallet === nextWallet) return null; // same account back
  return neutralRouteForAccountDetail(current);
}

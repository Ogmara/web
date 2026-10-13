/**
 * "Is this still the account that started the operation?" — for long-running
 * flows that await (on-chain confirmation, network round trips) and then sign
 * or write with the SHARED API client / account-scoped storage.
 *
 * Same rule and name as desktop's lib/accountGuard.ts: every current signal
 * must equal the captured value; any unknown (null/undefined) is "no".
 * Pure, so the rule is unit-testable (accountGuard.test.ts).
 */
export function stillSameAccount(
  captured: string | null | undefined,
  ...current: (string | null | undefined)[]
): boolean {
  if (!captured) return false;
  return current.every((c) => c === captured);
}

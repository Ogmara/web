/**
 * Bounded retry schedule for a channel-record fetch that resolved to `null`
 * (network error / 404). Same schedule as desktop's ChatView: at most 4 tries
 * per `wallet:channel`, spaced 3 s, 6 s, 9 s, 12 s; a new key re-arms it.
 * Pure so the schedule is testable under `node --test`.
 */
export const CHANNEL_INFO_RETRIES = 4;
export const CHANNEL_INFO_RETRY_STEP_MS = 3000;

export interface ChannelInfoRetryState {
  key: string | null;
  tries: number;
}

export function initialChannelInfoRetry(): ChannelInfoRetryState {
  return { key: null, tries: 0 };
}

/**
 * Record one more failed resolution for `key` and return the delay before the
 * next refetch, or `delayMs: null` once the budget for that key is spent.
 */
export function nextChannelInfoRetry(
  prev: ChannelInfoRetryState,
  key: string,
): { state: ChannelInfoRetryState; delayMs: number | null } {
  const base = prev.key === key ? prev : { key, tries: 0 };
  if (base.tries >= CHANNEL_INFO_RETRIES) return { state: base, delayMs: null };
  const tries = base.tries + 1;
  return { state: { key, tries }, delayMs: CHANNEL_INFO_RETRY_STEP_MS * tries };
}

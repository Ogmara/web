/**
 * Whether a channel's media/content must be treated as encrypted, extracted
 * as a pure function so this security-critical decision is independently
 * testable (see channelEncryption.test.mjs).
 *
 * FAILS CLOSED (2026-08-02): a confidentiality decision must never default to
 * "plaintext" just because the channel record hasn't resolved yet. The bug
 * this fixes — `isEncrypted()` reading `channelInfo()?.channel?.X` directly —
 * returned `false` (plaintext) while `channelInfo` was still loading (initial
 * mount, or a transient `createResource` refetch that briefly clears the
 * resolved value), so an image attached in that window uploaded to IPFS
 * unencrypted even in a private/encrypted channel. Unless the channel record
 * has SUCCESSFULLY resolved (`state === 'ready'`) to a definite plaintext
 * signal, this returns `true`.
 */
export type ChannelInfoState = 'unresolved' | 'pending' | 'ready' | 'refreshing' | 'errored';

export interface ChannelEncryptionFields {
  encryption_enabled?: boolean | null;
  channel_type?: number | null;
}

export function resolveIsEncrypted(
  state: ChannelInfoState,
  channel: ChannelEncryptionFields | null | undefined,
  privateChannelType: number,
): boolean {
  if (state !== 'ready') return true; // still loading / refreshing / errored -> fail closed
  if (!channel) return true; // resolved but no record (e.g. fetch returned null) -> fail closed
  return channel.encryption_enabled === true || channel.channel_type === privateChannelType;
}

/**
 * Whether the channel record is a DEFINITE, usable answer — resolved
 * successfully (`state === 'ready'`), non-null, carrying a numeric
 * `channel_type`, and (when the caller passes the response's `restricted`
 * flag) not the node's limited non-member summary of a private channel.
 *
 * Use this — never `resolveIsEncrypted()` — to gate SIDE EFFECTS (joining,
 * remembering the channel, marking it read, sending). `resolveIsEncrypted()`
 * deliberately returns `true` for "don't know yet", which is the right answer
 * for a confidentiality decision and the WRONG one for "should I act": a side
 * effect gated on it fires for every channel whose record hasn't loaded or
 * failed to load (2026-10 multi-account audit: an auto-join gated on
 * `isEncrypted()` joined arbitrary channels, including private ones, during
 * loading or after a 404).
 */
export function isChannelRecordUsable(
  state: ChannelInfoState,
  channel: ChannelEncryptionFields | null | undefined,
  restricted?: boolean | null,
): boolean {
  if (state !== 'ready') return false;
  if (!channel) return false;
  if (typeof channel.channel_type !== 'number') return false;
  if (restricted === true) return false;
  return true;
}

/**
 * Whether opening this channel should auto-join it so the node wraps its
 * epoch key to us. Requires POSITIVE evidence: a usable record (see
 * `isChannelRecordUsable`), a channel that is NOT private (private channels are
 * joined only through invite/join flows), and `encryption_enabled === true`.
 * Anything unknown — loading, refreshing, errored, null, restricted, missing
 * flag — returns `false`.
 */
export function shouldAutoJoinEncryptedChannel(
  state: ChannelInfoState,
  channel: ChannelEncryptionFields | null | undefined,
  privateChannelType: number,
  restricted?: boolean | null,
): boolean {
  if (!isChannelRecordUsable(state, channel, restricted)) return false;
  if (channel!.channel_type === privateChannelType) return false;
  return channel!.encryption_enabled === true;
}

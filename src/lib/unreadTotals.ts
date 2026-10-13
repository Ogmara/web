/**
 * Unread totals limited to the channels the user can actually see.
 *
 * The node's `/channels/unread` map can contain channels the sidebar does not
 * show (left channels, channels never joined in this client, entries that
 * belong to a list not yet loaded). Summing the raw map produced an aggregate
 * badge (the collapsed "Channels" header) that could never be cleared by
 * opening anything visible. The raw map stays untouched — per-row badges look
 * up their own id — only AGGREGATES go through here.
 */

/** Sum `map[id]` over the visible channel ids, ignoring non-finite/negative values. */
export function sumVisibleUnread(
  map: Record<string, number> | null | undefined,
  ids: Iterable<number>,
): number {
  if (!map) return 0;
  let total = 0;
  const seen = new Set<number>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const v = map[String(id)];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) total += v;
  }
  return total;
}

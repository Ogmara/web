/**
 * Shared profile resolution with caching and in-flight deduplication.
 *
 * Used by NewsView, NewsDetailView, BookmarksView, and any component
 * that needs to resolve a Klever address to a display name + avatar.
 */

import { getClient } from './api';

export interface CachedProfile {
  display_name?: string;
  avatar_cid?: string;
  verified?: boolean;
}

const profileCache = new Map<string, CachedProfile>();
const profileInflight = new Map<string, Promise<CachedProfile>>();

/**
 * Resolve a Klever address to a cached profile. Deduplicates in-flight
 * requests so multiple components requesting the same address only
 * trigger one API call.
 */
export async function resolveProfile(address: string): Promise<CachedProfile> {
  if (profileCache.has(address)) return profileCache.get(address)!;
  if (profileInflight.has(address)) return profileInflight.get(address)!;
  const promise = (async () => {
    try {
      const client = getClient();
      const resp = await client.getUserProfile(address);
      const pk = resp.user?.public_key;
      const profile: CachedProfile = {
        display_name: resp.user?.display_name,
        avatar_cid: resp.user?.avatar_cid,
        verified: !!(pk && pk.length > 0),
      };
      profileCache.set(address, profile);
      return profile;
    } catch {
      const empty: CachedProfile = {};
      profileCache.set(address, empty);
      return empty;
    } finally {
      profileInflight.delete(address);
    }
  })();
  profileInflight.set(address, promise);
  return promise;
}

/**
 * Media capability — reactive signal for whether the CURRENT node can host
 * files (IPFS configured AND the Kubo daemon reachable).
 *
 * A node can be configured-but-offline (a text-only deployment), so this is
 * a LIVE capability reported by the node's `/api/v1/health` (`media_uploads`,
 * l2-node 0.48.7+). When a node can't host media we disable the upload button
 * (with an explanation) and render a friendly "hosted on another node"
 * placeholder for images that fail to load.
 *
 * Node switches trigger a full reload (see `api.ts::switchNode`), so a single
 * boot-time fetch is enough.
 */

import { createSignal } from 'solid-js';
import { getClient } from './api';

// undefined = unknown (not fetched / older node / fetch failed) → assume
// available so we never wrongly block a capable node. Only an explicit
// `false` from the node gates the UI.
const [mediaUploads, setMediaUploads] = createSignal<boolean | undefined>(undefined);

export { mediaUploads };

/** True unless the current node EXPLICITLY reports media is unavailable. */
export const mediaUploadsAvailable = (): boolean => mediaUploads() !== false;

/** Fetch the current node's media capability from `/api/v1/health`. Failures
 *  leave the state at "unknown" (assume available). */
export async function refreshMediaCapability(): Promise<void> {
  try {
    const h = await getClient().health();
    setMediaUploads(h.media_uploads);
  } catch {
    setMediaUploads(undefined);
  }
}

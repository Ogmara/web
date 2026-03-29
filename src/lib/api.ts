/**
 * Ogmara SDK integration — shared client instance.
 */

import { OgmaraClient, type ClientConfig } from '@ogmara/sdk';
import { getSetting } from './settings';

let client: OgmaraClient | null = null;

/** Get or create the shared API client. */
export function getClient(): OgmaraClient {
  if (!client) {
    const nodeUrl = getSetting('nodeUrl') || 'http://localhost:41721';
    client = new OgmaraClient({ nodeUrl });
  }
  return client;
}

/** Reset the client (e.g., when node URL changes). */
export function resetClient(): void {
  client = null;
}

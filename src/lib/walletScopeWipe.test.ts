/**
 * Disconnect wipe covers the Sidebar's single-colon per-wallet caches
 * (`channelsCache:<node>:<addr>`, `dmConvsCache:<node>:<addr>`) — they hold a
 * private channel list and a DM peer list and used to survive a disconnect
 * because the wipe only matched the `::<addr>` suffix (web 0.82.0).
 * Run: node --conditions=browser --test src/lib/walletScopeWipe.test.ts
 */
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string): void { this.m.set(k, v); }
  removeItem(k: string): void { this.m.delete(k); }
  get length(): number { return this.m.size; }
  key(i: number): string | null { return [...this.m.keys()][i] ?? null; }
  keys(): string[] { return [...this.m.keys()]; }
}
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { wipeWalletScope } from './walletScope.ts';

const A = 'klv1' + 'a'.repeat(58);
const B = 'klv1' + 'b'.repeat(58);
let ls: MemStorage;

beforeEach(() => {
  ls = new MemStorage();
  (globalThis as unknown as { localStorage: Storage }).localStorage = ls as unknown as Storage;
});

test('wipe removes the account\'s scoped keys AND its single-colon channel/DM caches', () => {
  ls.setItem(`ogmara_joined_channels::${A}`, '[1,77]');
  ls.setItem(`channelsCache:https://node.example:443:${A}`, '[{"channel_id":77}]');
  ls.setItem(`dmConvsCache:https://node.example:443:${A}`, '[{"peer":"x"}]');
  ls.setItem(`channelsCache::${A}`, '[]'); // empty node URL
  wipeWalletScope(A);
  assert.deepEqual(ls.keys(), []);
});

test('wipe leaves other accounts, signed-out caches and unrelated keys alone', () => {
  const keep = [
    `ogmara_joined_channels::${B}`,
    `channelsCache:https://node.example:443:${B}`,
    `dmConvsCache:https://node.example:443:${B}`,
    'channelsCache:https://node.example:443:', // signed-out cache
    `someOtherStore:${A}`, // unrelated prefix ending in the address: not ours to delete
    'ogmara.theme',
  ];
  for (const k of keep) ls.setItem(k, '1');
  ls.setItem(`channelsCache:https://node.example:443:${A}`, '1');
  wipeWalletScope(A);
  assert.deepEqual(ls.keys().sort(), [...keep].sort());
});

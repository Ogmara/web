/**
 * Behavioral regression test for `deviceId` account-scoping. Run:
 * node --test src/lib/deviceIdScope.test.ts
 *
 * Mirrors desktop's `deviceIdScope.test.ts`. `deviceId` is a `PER_WALLET`
 * key in `settings.ts` — a shared `device_id` across accounts would
 * publicly link them (protocol §2.4, docs/specs/05-clients.md §5.5.1a).
 * This exercises the real modules end to end against a fake `localStorage`,
 * the way `deviceEnc.ts`'s `getOrCreateDeviceId()` actually would at
 * runtime, so a future regression that bypasses `settings.ts`'s scoping
 * (e.g. a raw `localStorage` read/write) fails a test instead of shipping.
 */
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string): void { this.m.set(k, v); }
  removeItem(k: string): void { this.m.delete(k); }
  get length(): number { return this.m.size; }
  key(i: number): string | null { return [...this.m.keys()][i] ?? null; }
}
// NOTE: static `import` declarations are hoisted and evaluated BEFORE any
// of this file's own top-level code, regardless of textual order — so this
// shim assignment does NOT run before `settings.ts`/`walletScope.ts` load,
// only before this file's own test bodies run. That's sufficient only
// because neither module touches `localStorage` at its own module top
// level (verified by reading both). Desktop's equivalent test needs a
// dynamic `import()` instead, because desktop's `settings.ts` DOES read a
// setting at top level (to seed a reactive signal) — if this file's
// `settings.ts` ever grows the same kind of top-level read, switch to the
// same dynamic-import pattern, or this shim arrives too late.
(globalThis as unknown as { localStorage: Storage }).localStorage = new MemStorage() as unknown as Storage;

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getSetting, setSetting } from './settings.ts';
import { setWalletScope } from './walletScope.ts';

const A = 'klv1' + 'a'.repeat(58);
const B = 'klv1' + 'b'.repeat(58);

beforeEach(() => {
  (globalThis as unknown as { localStorage: Storage }).localStorage = new MemStorage() as unknown as Storage;
  setWalletScope(null);
});

test('two accounts on one install get two different deviceId values', () => {
  setWalletScope(A);
  assert.equal(getSetting('deviceId'), '', 'a fresh account has no deviceId yet');
  setSetting('deviceId', 'device-for-a');

  setWalletScope(B);
  assert.equal(
    getSetting('deviceId'), '',
    'switching to a different account must NOT see the previous account\'s deviceId',
  );
  setSetting('deviceId', 'device-for-b');

  setWalletScope(A);
  assert.equal(
    getSetting('deviceId'), 'device-for-a',
    'switching back must restore this account\'s OWN deviceId, not the other one',
  );

  setWalletScope(B);
  assert.equal(getSetting('deviceId'), 'device-for-b');
});

test('deviceId is stored under distinct, address-suffixed keys', () => {
  setWalletScope(A);
  setSetting('deviceId', 'device-for-a');
  setWalletScope(B);
  setSetting('deviceId', 'device-for-b');

  const ls = localStorage as unknown as MemStorage;
  assert.equal(ls.getItem(`ogmara.deviceId::${A}`), '"device-for-a"');
  assert.equal(ls.getItem(`ogmara.deviceId::${B}`), '"device-for-b"');
  assert.equal(ls.getItem('ogmara.deviceId'), null);
});

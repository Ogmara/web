/**
 * Ownership re-check around an await (used by settings-sync's decrypt-then-
 * apply path, web 0.82.0). Run: node --conditions=browser --test src/lib/ownedAwait.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { awaitForOwner, isStillOwner, type OwnerSnapshot } from './ownedAwait.ts';

/** Mirrors decryptAndApplySettings: crypto await, then writes only if still owner. */
async function applyAfterCrypto(owner: string | null, now: OwnerSnapshot, flipDuringAwait?: Partial<OwnerSnapshot>) {
  const writes: string[] = [];
  const res = await awaitForOwner(owner, () => now, async () => {
    // Real WebCrypto work, like deriveKey + decrypt.
    await crypto.subtle.digest('SHA-256', new Uint8Array(32));
    if (flipDuringAwait) Object.assign(now, flipDuringAwait);
    await crypto.subtle.digest('SHA-256', new Uint8Array(32));
    return 'plaintext';
  });
  if (res.ok) writes.push(`${now.scope}:${res.value}`);
  return writes;
}

test('no flip: writes land for the owner', async () => {
  assert.deepEqual(await applyAfterCrypto('A', { wallet: 'A', scope: 'A' }), ['A:plaintext']);
});

test('scope flips to another wallet during the crypto await => no writes', async () => {
  assert.deepEqual(await applyAfterCrypto('A', { wallet: 'A', scope: 'A' }, { scope: 'B' }), []);
});

test('address flips during the await => no writes', async () => {
  assert.deepEqual(await applyAfterCrypto('A', { wallet: 'A', scope: 'A' }, { wallet: 'B' }), []);
});

test('disconnect during the await (both null) => no writes', async () => {
  assert.deepEqual(await applyAfterCrypto('A', { wallet: 'A', scope: 'A' }, { wallet: null, scope: null }), []);
});

test('negative control: an unguarded apply DOES write into the new scope', async () => {
  const now: OwnerSnapshot = { wallet: 'A', scope: 'A' };
  const writes: string[] = [];
  await crypto.subtle.digest('SHA-256', new Uint8Array(32));
  now.scope = 'B';
  writes.push(`${now.scope}:plaintext`); // what the pre-fix code did
  assert.deepEqual(writes, ['B:plaintext']);
});

test('isStillOwner: null owner or any mismatch is false', () => {
  assert.equal(isStillOwner(null, { wallet: null, scope: null }), false);
  assert.equal(isStillOwner('A', { wallet: 'A', scope: 'A' }), true);
  assert.equal(isStillOwner('A', { wallet: 'A', scope: null }), false);
  assert.equal(isStillOwner('A', { wallet: null, scope: 'A' }), false);
});

test('a rejection from the work propagates', async () => {
  await assert.rejects(awaitForOwner('A', () => ({ wallet: 'A', scope: 'A' }), async () => { throw new Error('bad tag'); }));
});

/** Mirrors the debounced upload timers + uploadSettings: owner captured before
 *  the key export, seal under awaitForOwner, upload only if still owner. */
async function timerUpload(now: OwnerSnapshot, flipDuringExport?: Partial<OwnerSnapshot>, flipDuringSeal?: Partial<OwnerSnapshot>) {
  const uploads: string[] = [];
  const owner = now.scope; // captured at timer fire, before any await
  await crypto.subtle.digest('SHA-256', new Uint8Array(8)); // key export
  if (flipDuringExport) Object.assign(now, flipDuringExport);
  const sealed = await awaitForOwner(owner, () => now, async () => {
    const blob = `${now.scope}-settings`; // encryptSettings reads synchronously
    await crypto.subtle.digest('SHA-256', new Uint8Array(8));
    if (flipDuringSeal) Object.assign(now, flipDuringSeal);
    return blob;
  });
  if (sealed.ok) uploads.push(`as ${now.wallet}: ${sealed.value}`);
  return uploads;
}

test('upload: no switch -> uploads the owner\'s settings as the owner', async () => {
  assert.deepEqual(await timerUpload({ wallet: 'A', scope: 'A' }), ['as A: A-settings']);
});

test('upload: account changes during the key export -> nothing is sealed or uploaded', async () => {
  assert.deepEqual(await timerUpload({ wallet: 'A', scope: 'A' }, { wallet: 'B', scope: 'B' }), []);
});

test('upload: account changes during encryption -> nothing is uploaded', async () => {
  assert.deepEqual(await timerUpload({ wallet: 'A', scope: 'A' }, undefined, { wallet: 'B', scope: 'B' }), []);
});

// --- key export after owner capture (settings sync, web 0.82.0) -------------
import { exportKeyForOwner } from './ownedAwait.ts';

test('exportKeyForOwner: control returns the owner\'s key', async () => {
  const now: OwnerSnapshot = { wallet: 'A', scope: 'A' };
  assert.equal(await exportKeyForOwner('A', () => now, async () => 'keyA'), 'keyA');
});

test('exportKeyForOwner: account changes during the export => no key', async () => {
  const now: OwnerSnapshot = { wallet: 'A', scope: 'A' };
  const key = await exportKeyForOwner('A', () => now, async () => {
    await crypto.subtle.digest('SHA-256', new Uint8Array(8));
    now.wallet = 'B'; now.scope = 'B';
    return 'keyA';
  });
  assert.equal(key, null);
});

test('exportKeyForOwner: a key that does not belong to the owner (built-in derive check) => no key', async () => {
  const now: OwnerSnapshot = { wallet: 'A', scope: 'A' };
  assert.equal(await exportKeyForOwner('A', () => now, async () => 'keyB', () => false), null);
});

test('exportKeyForOwner: owner already gone before export => export never runs', async () => {
  let ran = false;
  const key = await exportKeyForOwner('A', () => ({ wallet: 'B', scope: 'B' }), async () => { ran = true; return 'k'; });
  assert.equal(key, null);
  assert.equal(ran, false);
});

test('exportKeyForOwner: no key stored => null', async () => {
  assert.equal(await exportKeyForOwner('A', () => ({ wallet: 'A', scope: 'A' }), async () => null), null);
});

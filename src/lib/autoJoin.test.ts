/**
 * Once-per-account-per-channel auto-join bookkeeping (web 0.82.0).
 * Run: node --conditions=browser --test src/lib/autoJoin.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureEncryptedChannelMembership, hasAttemptedMembership } from './autoJoin.ts';
import { setWalletScope } from './walletScope.ts';

function recorder(fail = false) {
  const calls: number[] = [];
  const join = async (id: number) => {
    calls.push(id);
    if (fail) throw new Error('join failed');
  };
  return { calls, join };
}

test('joins once per wallet per channel', async () => {
  setWalletScope('klv1a');
  const r = recorder();
  assert.equal(await ensureEncryptedChannelMembership(5, 'klv1a', r.join), true);
  assert.equal(await ensureEncryptedChannelMembership(5, 'klv1a', r.join), false);
  assert.deepEqual(r.calls, [5]);
});

test('a different wallet is NOT treated as already joined', async () => {
  setWalletScope('klv1a');
  const r = recorder();
  await ensureEncryptedChannelMembership(6, 'klv1a', r.join);
  await ensureEncryptedChannelMembership(6, 'klv1b', r.join);
  assert.deepEqual(r.calls, [6, 6]);
});

test('a failed join is forgotten so a later visit retries', async () => {
  setWalletScope('klv1a');
  const bad = recorder(true);
  assert.equal(await ensureEncryptedChannelMembership(7, 'klv1a', bad.join), false);
  assert.equal(hasAttemptedMembership(7, 'klv1a'), false);
  const good = recorder();
  assert.equal(await ensureEncryptedChannelMembership(7, 'klv1a', good.join), true);
  assert.deepEqual(good.calls, [7]);
});

test('concurrent calls for the same pair send one join', async () => {
  setWalletScope('klv1a');
  const r = recorder();
  await Promise.all([
    ensureEncryptedChannelMembership(8, 'klv1a', r.join),
    ensureEncryptedChannelMembership(8, 'klv1a', r.join),
  ]);
  assert.deepEqual(r.calls, [8]);
});

test('a wallet-scope change clears the record', async () => {
  setWalletScope('klv1a');
  const r = recorder();
  await ensureEncryptedChannelMembership(9, 'klv1a', r.join);
  assert.equal(hasAttemptedMembership(9, 'klv1a'), true);
  setWalletScope('klv1b');
  assert.equal(hasAttemptedMembership(9, 'klv1a'), false);
});

test('rejects missing wallet and invalid channel ids without calling join', async () => {
  const r = recorder();
  assert.equal(await ensureEncryptedChannelMembership(10, '', r.join), false);
  assert.equal(await ensureEncryptedChannelMembership(0, 'klv1a', r.join), false);
  assert.equal(await ensureEncryptedChannelMembership(-1, 'klv1a', r.join), false);
  assert.equal(await ensureEncryptedChannelMembership(1.5, 'klv1a', r.join), false);
  assert.deepEqual(r.calls, []);
});

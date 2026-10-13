/**
 * Run: node --conditions=browser --test src/lib/accountGuard.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stillSameAccount } from './accountGuard.ts';

test('all signals equal the captured account -> same', () => {
  assert.equal(stillSameAccount('A', 'A', 'A'), true);
  assert.equal(stillSameAccount('ogd1dev', 'ogd1dev'), true);
});

test('any mismatch or unknown -> not the same', () => {
  assert.equal(stillSameAccount('A', 'A', 'B'), false);
  assert.equal(stillSameAccount('A', null, 'A'), false);
  assert.equal(stillSameAccount('A', 'A', undefined), false);
  assert.equal(stillSameAccount(null, null), false);
  assert.equal(stillSameAccount(undefined), false);
});

test('a reconnect re-attaching a different signer is detected even when the wallet reads the same', () => {
  // Wallet A reconnected through a fresh device key: address equal, signer not.
  const capturedSigner = 'klv1devOld';
  assert.equal(stillSameAccount('A', 'A') && stillSameAccount(capturedSigner, 'klv1devNew'), false);
});

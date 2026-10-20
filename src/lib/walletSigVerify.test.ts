/**
 * Wallet signature verification for the key-vault backup key (web 0.84.0, C1).
 * Real @noble crypto, fixed seeds; the SDK's `WalletSigner.signKleverMessage`
 * is the independent reference for the Klever signed-message format.
 * Run: node --conditions=browser --test src/lib/walletSigVerify.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ed from '@noble/ed25519';
import { keccak_256 } from '@noble/hashes/sha3';
import { WalletSigner, normalizeWalletSig, addressToPubkey } from '@ogmara/sdk';
import { kleverSignedBytes, verifyWalletSig, type WalletSigCrypto } from './walletSigVerify.ts';

const crypto: WalletSigCrypto = {
  keccak256: keccak_256,
  ed25519Verify: (sig, msg, pub) => ed.verifyAsync(sig, msg, pub),
  addressToPubkey,
  normalize: normalizeWalletSig,
};

const CLAIM = 'ogmara-keyvault-v1';
const seed = (b: number) => new Uint8Array(32).fill(b);
const signerA = await WalletSigner.fromPrivateKey(seed(0x11));
const signerB = await WalletSigner.fromPrivateKey(seed(0x22));
const A = signerA.address;
const enc = (s: string) => new TextEncoder().encode(s);
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const b64 = (s: string | Uint8Array) =>
  Buffer.from(typeof s === 'string' ? Buffer.from(s, 'ascii') : s).toString('base64');

const sigA = await signerA.signKleverMessage(enc(CLAIM));
const sigB = await signerB.signKleverMessage(enc(CLAIM));

test('kleverSignedBytes: literal 0x17 prefix, ascii byte length, message', () => {
  const out = kleverSignedBytes('abc');
  const expected = new Uint8Array([0x17, ...enc('Klever Signed Message:\n'), ...enc('3'), ...enc('abc')]);
  assert.deepEqual(out, expected);
  assert.equal(out[0], 0x17);
  assert.equal('Klever Signed Message:\n'.length, 0x17, 'the prefix byte is the prefix length');
});

test('kleverSignedBytes: the length is the UTF-8 BYTE length, not the string length', () => {
  const msg = 'äöü€'; // 4 chars, 9 bytes
  const out = kleverSignedBytes(msg);
  const lenStart = 1 + 23;
  assert.equal(new TextDecoder().decode(out.slice(lenStart, lenStart + 1)), '9');
  assert.equal(out.length, 1 + 23 + 1 + 9);
});

for (const [name, raw] of [
  ['raw 128-char hex (Extension)', hex(sigA)],
  ['base64 of the ASCII hex (K5)', b64(hex(sigA))],
  ['base64 of the raw 64 bytes', b64(sigA)],
  ['raw Uint8Array (built-in signer)', Uint8Array.from(sigA)],
] as const) {
  test(`A's signature verifies for A: ${name}`, async () => {
    const r = await verifyWalletSig(crypto, A, CLAIM, raw);
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.sig, sigA);
  });
}

test("B's signature checked against A -> mismatch (the C1 case: extension switched accounts)", async () => {
  for (const raw of [hex(sigB), b64(hex(sigB)), b64(sigB), Uint8Array.from(sigB)]) {
    assert.deepEqual(await verifyWalletSig(crypto, A, CLAIM, raw), { ok: false, reason: 'mismatch' });
  }
});

test('one flipped byte -> mismatch', async () => {
  for (const i of [0, 31, 32, 63]) {
    const bad = Uint8Array.from(sigA);
    bad[i] ^= 0x01;
    assert.deepEqual(await verifyWalletSig(crypto, A, CLAIM, hex(bad)), { ok: false, reason: 'mismatch' });
  }
});

test("A's signature over another message -> mismatch", async () => {
  assert.deepEqual(await verifyWalletSig(crypto, A, 'ogmara-keyvault-v2', hex(sigA)), { ok: false, reason: 'mismatch' });
});

test('garbage -> malformed', async () => {
  for (const raw of ['', 'not a signature', 'ab'.repeat(63), new Uint8Array(63), b64(new Uint8Array(10))]) {
    assert.deepEqual(await verifyWalletSig(crypto, A, CLAIM, raw), { ok: false, reason: 'malformed' });
  }
});

test('bad bech32 expected address -> bad-address', async () => {
  const typo = A.slice(0, -1) + (A.endsWith('q') ? 'p' : 'q');
  for (const addr of ['', 'klv1', 'hello', typo]) {
    assert.deepEqual(await verifyWalletSig(crypto, addr, CLAIM, hex(sigA)), { ok: false, reason: 'bad-address' });
  }
});

test('non-ASCII message: verifies only with the BYTE length (negative control: char length)', async () => {
  const msg = 'Schlüssel-тест-鍵';
  const sig = await signerA.signKleverMessage(enc(msg));
  assert.equal((await verifyWalletSig(crypto, A, msg, hex(sig))).ok, true);
  // A copy of the format that uses the JS string length must NOT verify.
  const charLen = new Uint8Array([0x17, ...enc('Klever Signed Message:\n'), ...enc(String(msg.length)), ...enc(msg)]);
  const ok = await ed.verifyAsync(sig, keccak_256(charLen), addressToPubkey(A));
  assert.equal(ok, false, 'string-length variant would mis-verify non-ASCII messages');
});

test('the returned signature is a copy: zeroing it does not touch the caller\'s bytes', async () => {
  const input = Uint8Array.from(sigA);
  const r = await verifyWalletSig(crypto, A, CLAIM, input);
  assert.ok(r.ok);
  if (r.ok) r.sig.fill(0);
  assert.deepEqual(input, sigA);
});

test('a throwing verifier is a mismatch, never ok', async () => {
  const throwing = { ...crypto, ed25519Verify: async () => { throw new Error('bad point'); } };
  assert.deepEqual(await verifyWalletSig(throwing, A, CLAIM, hex(sigA)), { ok: false, reason: 'mismatch' });
});

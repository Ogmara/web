/**
 * Regression test for the 2026-08-02 media-encryption fail-open bug: an image
 * attached to a private/encrypted channel while `channelInfo` was still
 * loading (or mid-refetch) uploaded to IPFS in the clear. Run with:
 *   node --test src/lib/channelEncryption.test.ts
 * (Node 24 strips simple TS type syntax natively — no build step needed.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveIsEncrypted } from './channelEncryption.ts';

const PRIVATE = 2;
const PUBLIC = 0;

test('unresolved channel state fails closed (encrypted) even with no channel data', () => {
  assert.equal(resolveIsEncrypted('unresolved', undefined, PRIVATE), true);
  assert.equal(resolveIsEncrypted('pending', undefined, PRIVATE), true);
  assert.equal(resolveIsEncrypted('refreshing', undefined, PRIVATE), true);
});

test('errored fetch fails closed (encrypted)', () => {
  assert.equal(resolveIsEncrypted('errored', undefined, PRIVATE), true);
  assert.equal(resolveIsEncrypted('errored', { channel_type: PUBLIC }, PRIVATE), true);
});

test('ready but null channel record fails closed (encrypted)', () => {
  assert.equal(resolveIsEncrypted('ready', null, PRIVATE), true);
});

test('the exact reported bug: attach mid-load on a private channel must stay encrypted', () => {
  // Before the fix this returned false because `channel` was undefined while
  // `state` was still 'pending' — the media upload picked plaintext.
  assert.equal(resolveIsEncrypted('pending', undefined, PRIVATE), true);
});

test('ready + private channel type -> encrypted, regardless of encryption_enabled', () => {
  assert.equal(resolveIsEncrypted('ready', { channel_type: PRIVATE }, PRIVATE), true);
  assert.equal(resolveIsEncrypted('ready', { channel_type: PRIVATE, encryption_enabled: false }, PRIVATE), true);
});

test('ready + public channel with encryption_enabled -> encrypted', () => {
  assert.equal(resolveIsEncrypted('ready', { channel_type: PUBLIC, encryption_enabled: true }, PRIVATE), true);
});

test('ready + public legacy channel (no flag) -> plaintext ONLY when definitively resolved', () => {
  assert.equal(resolveIsEncrypted('ready', { channel_type: PUBLIC, encryption_enabled: false }, PRIVATE), false);
  assert.equal(resolveIsEncrypted('ready', { channel_type: PUBLIC }, PRIVATE), false);
});

test('refreshing with a stale-but-plaintext-looking payload still fails closed', () => {
  // solid-js keeps the PREVIOUS channel's resolved value visible while a
  // createResource refetch is in flight (state 'refreshing') — never
  // `undefined`. A future refactor might be tempted to trust that non-null
  // data; `state !== 'ready'` must win regardless of how definitive the
  // stale payload looks.
  assert.equal(resolveIsEncrypted('refreshing', { channel_type: PUBLIC, encryption_enabled: false }, PRIVATE), true);
});

// ---------------------------------------------------------------------------
// Side-effect gates (web 0.82.0). `resolveIsEncrypted` answers "treat content
// as encrypted?" and fails CLOSED (true while unknown). These answer "may I
// act?" and must fail the other way: false unless positively known.
// ---------------------------------------------------------------------------
import { isChannelRecordUsable, shouldAutoJoinEncryptedChannel, type ChannelInfoState } from './channelEncryption.ts';

const STATES = ['unresolved', 'pending', 'ready', 'refreshing', 'errored'] as const;

test('isChannelRecordUsable: only a resolved, non-null, typed, unrestricted record', () => {
  for (const st of STATES) {
    const expectReady = st === 'ready';
    assert.equal(isChannelRecordUsable(st, { channel_type: PUBLIC }), expectReady, `state ${st}`);
    assert.equal(isChannelRecordUsable(st, null), false, `state ${st} null`);
    assert.equal(isChannelRecordUsable(st, undefined), false, `state ${st} undefined`);
  }
  assert.equal(isChannelRecordUsable('ready', {}), false, 'missing channel_type');
  assert.equal(isChannelRecordUsable('ready', { channel_type: null }), false, 'null channel_type');
  assert.equal(isChannelRecordUsable('ready', { channel_type: PRIVATE }, true), false, 'restricted summary');
  assert.equal(isChannelRecordUsable('ready', { channel_type: PRIVATE }, false), true);
  assert.equal(isChannelRecordUsable('ready', { channel_type: PRIVATE }, null), true);
});

test('shouldAutoJoinEncryptedChannel: explicit expected-value table', () => {
  // [state, channel, restricted, expected] — expected values written out by
  // hand, NOT derived from the predicate's own logic.
  const E = { channel_type: PUBLIC, encryption_enabled: true };
  const table: [ChannelInfoState, any, boolean | undefined, boolean][] = [
    // the only joins: usable, non-private, flag exactly true
    ['ready', E, undefined, true],
    ['ready', E, false, true],
    ['ready', { channel_type: 1, encryption_enabled: true }, undefined, true],
    // not resolved
    ['unresolved', E, undefined, false],
    ['pending', E, undefined, false],
    ['refreshing', E, undefined, false],
    ['errored', E, undefined, false],
    // no / malformed record
    ['ready', undefined, undefined, false],
    ['ready', null, undefined, false],
    ['ready', {}, undefined, false],
    ['ready', { encryption_enabled: true }, undefined, false],
    ['ready', { channel_type: null, encryption_enabled: true }, undefined, false],
    // restricted summary
    ['ready', E, true, false],
    // flag not exactly true
    ['ready', { channel_type: PUBLIC }, undefined, false],
    ['ready', { channel_type: PUBLIC, encryption_enabled: false }, undefined, false],
    ['ready', { channel_type: PUBLIC, encryption_enabled: null }, undefined, false],
    ['ready', { channel_type: PUBLIC, encryption_enabled: 'true' }, undefined, false],
    ['ready', { channel_type: PUBLIC, encryption_enabled: 1 }, undefined, false],
    // private, any flag
    ['ready', { channel_type: PRIVATE }, undefined, false],
    ['ready', { channel_type: PRIVATE, encryption_enabled: true }, undefined, false],
    ['ready', { channel_type: PRIVATE, encryption_enabled: true }, false, false],
    ['pending', { channel_type: PRIVATE, encryption_enabled: true }, undefined, false],
  ];
  for (const [st, ch, restricted, expected] of table) {
    assert.equal(
      shouldAutoJoinEncryptedChannel(st, ch, PRIVATE, restricted),
      expected,
      `state=${st} ch=${JSON.stringify(ch)} restricted=${restricted}`,
    );
  }
});

test('the reported bug: a private / not-yet-loaded / 404 channel is never auto-joined, though isEncrypted() says true', () => {
  // Loading: isEncrypted() fails closed to true and isPrivate() reads false —
  // the old `isEncrypted() && !isPrivate()` gate joined here.
  assert.equal(resolveIsEncrypted('pending', undefined, PRIVATE), true);
  assert.equal(shouldAutoJoinEncryptedChannel('pending', undefined, PRIVATE), false);
  // 404 / fetch error: the fetcher returns null -> state 'ready', no record.
  assert.equal(resolveIsEncrypted('ready', null, PRIVATE), true);
  assert.equal(shouldAutoJoinEncryptedChannel('ready', null, PRIVATE), false);
  // Resolved private channel.
  assert.equal(shouldAutoJoinEncryptedChannel('ready', { channel_type: PRIVATE, encryption_enabled: true }, PRIVATE), false);
});

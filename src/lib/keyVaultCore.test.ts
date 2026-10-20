/**
 * Key-recovery vault restore/backup never cross accounts (web 0.82.0), and an
 * unreadable remote vault is never treated as terminal `done` (web 0.84.0).
 * Controller-level tests (re-arm, backoff, marker, C1) live in
 * keyVaultController.test.ts.
 * Mutation-style: the same scenarios run against the real core and against a
 * copy of the pre-fix flow, which must reproduce the leak.
 * Run: node --conditions=browser --test src/lib/keyVaultCore.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  runRestore,
  runPublish,
  usable,
  replaceResultMessageKey,
  type OwnedKey,
  type PublishOutcome,
} from './keyVaultCore.ts';

type Keyring = { conv: Record<string, number>; chan: Record<string, number> };
type Phase = 'ensure' | 'fetch' | 'decrypt' | null;

/** A fake session: wallet + generation, with a switch A -> (null) -> B injectable at a phase. */
function harness(opts: { switchAt?: Phase; decryptFails?: boolean } = {}) {
  const s = { wallet: 'A' as string | null, gen: 1 };
  const imports: Keyring[] = [];
  const published: { as: string | null; keyring: Keyring }[] = [];
  const switchNow = () => {
    s.wallet = null; s.gen++; // disconnect A
    s.wallet = 'B'; s.gen++;  // connect B
  };
  const keyFor = (w: string): OwnedKey => ({ key: new Uint8Array([w.charCodeAt(0)]), wallet: w });
  const deps = {
    currentWallet: () => s.wallet,
    generation: () => s.gen,
    log: () => {},
    ensureBackupKey: async (): Promise<OwnedKey | null> => {
      const w = s.wallet;
      await Promise.resolve();
      if (opts.switchAt === 'ensure') switchNow();
      return w ? keyFor(w) : null;
    },
    fetchVault: async () => {
      const blobOf = s.wallet;
      await Promise.resolve();
      if (opts.switchAt === 'fetch') switchNow();
      return { of: blobOf };
    },
    open: (key: Uint8Array, resp: { of: string | null }): Keyring => {
      if (opts.switchAt === 'decrypt') switchNow();
      if (opts.decryptFails) throw new Error('aead tag mismatch');
      return { conv: { [`${resp.of}-dm`]: key[0] }, chan: {} };
    },
    importKeys: (kr: Keyring) => { imports.push(kr); return { conv: Object.keys(kr.conv).length }; },
    seenMarker: (_w: string): boolean | null => false,
    markSeen: (_w: string) => {},
    canPublish: () => true,
    snapshot: (): Keyring => ({ conv: { [`${s.wallet}-dm`]: 1 }, chan: {} }),
    isEmpty: (kr: Keyring) => Object.keys(kr.conv).length + Object.keys(kr.chan).length === 0,
    seal: (_k: Uint8Array, kr: Keyring) => kr,
    publish: async (kr: Keyring) => { published.push({ as: s.wallet, keyring: kr }); },
  };
  return { s, deps, imports, published };
}

/** The pre-fix restore (keyVault.ts before 0.82.0), for the negative control. */
async function legacyRestore(d: ReturnType<typeof harness>['deps']): Promise<'done' | 'idle'> {
  const owned = await d.ensureBackupKey();
  if (!owned) return 'idle';
  let resp;
  try { resp = await d.fetchVault(); } catch { return 'idle'; }
  if (resp) {
    try { d.importKeys(d.open(owned.key, resp)); } catch { /* terminal */ }
  }
  return 'done';
}

test('control: no switch -> restores and imports the account\'s own keys, terminal done', async () => {
  const h = harness();
  assert.equal(await runRestore(h.deps), 'done');
  assert.equal(h.imports.length, 1);
  assert.ok('A-dm' in h.imports[0].conv);
});

for (const phase of ['ensure', 'fetch', 'decrypt'] as const) {
  test(`switch during ${phase} -> no import, no 'done'`, async () => {
    const h = harness({ switchAt: phase });
    const out = await runRestore(h.deps);
    assert.equal(out, 'stale');
    assert.equal(h.imports.length, 0, 'A\'s keys must not reach B\'s session');
  });

  test(`negative control: pre-fix restore with a switch during ${phase} leaks or goes terminal for B`, async () => {
    const h = harness({ switchAt: phase });
    const out = await legacyRestore(h.deps);
    assert.equal(out, 'done', 'pre-fix flow reports done for the NEW account');
    assert.ok(h.imports.length > 0 || phase === 'decrypt', 'pre-fix flow imports another account\'s keys');
    if (phase !== 'decrypt') assert.equal(h.s.wallet, 'B');
  });
}

test('decrypt failure after a switch is NOT terminal for the new account', async () => {
  const h = harness({ switchAt: 'decrypt', decryptFails: true });
  assert.equal(await runRestore(h.deps), 'stale');
});

test('decrypt failure under the account\'s own key is BLOCKED (unreadable), not terminal done (web 0.84.0)', async () => {
  const h = harness({ decryptFails: true });
  assert.equal(await runRestore(h.deps), 'unreadable');
  assert.equal(h.imports.length, 0);
});

test('negative control: the pre-fix restore reports done for an unreadable vault (the next backup overwrote it)', async () => {
  const h = harness({ decryptFails: true });
  assert.equal(await legacyRestore(h.deps), 'done');
});

test('a backup key derived for another wallet is refused', async () => {
  const h = harness();
  h.deps.ensureBackupKey = async () => ({ key: new Uint8Array([9]), wallet: 'B' });
  assert.equal(await runRestore(h.deps), 'idle');
  assert.equal(h.imports.length, 0);
  assert.equal(await runPublish(h.deps), 'unavailable');
  assert.equal(h.published.length, 0);
});

test('publish: control publishes the owner\'s keyring as the owner', async () => {
  const h = harness();
  assert.equal(await runPublish(h.deps), 'published');
  assert.deepEqual(h.published, [{ as: 'A', keyring: { conv: { 'A-dm': 1 }, chan: {} } }]);
});

test('publish: switch during key derivation -> nothing sealed or published', async () => {
  const h = harness({ switchAt: 'ensure' });
  assert.equal(await runPublish(h.deps), 'stale');
  assert.equal(h.published.length, 0);
});

test('A -> B -> A round trip during the await is still stale (generation, not just address)', async () => {
  const h = harness();
  h.deps.ensureBackupKey = async () => {
    await Promise.resolve();
    h.s.wallet = 'B'; h.s.gen++;
    h.s.wallet = 'A'; h.s.gen++;
    return { key: new Uint8Array([1]), wallet: 'A' };
  };
  assert.equal(await runRestore(h.deps), 'stale');
  assert.equal(h.imports.length, 0);
});

test('signed out at start -> idle, nothing touched', async () => {
  const h = harness();
  h.s.wallet = null;
  assert.equal(await runRestore(h.deps), 'idle');
  assert.equal(await runPublish(h.deps), 'unavailable');
  assert.equal(h.imports.length + h.published.length, 0);
});

test('publish: canPublish() false -> blocked, nothing sealed', async () => {
  const h = harness();
  h.deps.canPublish = () => false;
  assert.equal(await runPublish(h.deps), 'blocked');
  assert.equal(h.published.length, 0);
});

test('restore 404: verifiably empty only without the marker; unknown marker stays idle', async () => {
  const mk = (seen: boolean | null) => {
    const h = harness();
    h.deps.fetchVault = async () => null;
    h.deps.seenMarker = () => seen;
    return h;
  };
  assert.equal(await runRestore(mk(false).deps), 'done');
  assert.equal(await runRestore(mk(true).deps), 'missing');
  assert.equal(await runRestore(mk(null).deps), 'idle');
});

test('a successful restore and a successful publish set the marker for the stamped wallet', async () => {
  const h = harness();
  const marked: string[] = [];
  h.deps.markSeen = (w: string) => { marked.push(w); };
  await runRestore(h.deps);
  await runPublish(h.deps);
  assert.deepEqual(marked, ['A', 'A']);
});

test('switch during a fetch that 404s -> stale; the marker is not consulted for the old account', async () => {
  const h = harness();
  let consulted = 0;
  h.deps.fetchVault = async () => { await Promise.resolve(); h.s.wallet = 'B'; h.s.gen++; return null; };
  h.deps.seenMarker = () => { consulted++; return false; };
  assert.equal(await runRestore(h.deps), 'stale');
  assert.equal(consulted, 0);
});

test('usable(): an all-zero or empty key, or another wallet\'s key, is not usable', () => {
  assert.equal(usable({ key: new Uint8Array(32), wallet: 'A' }, 'A'), false);
  assert.equal(usable({ key: new Uint8Array(0), wallet: 'A' }, 'A'), false);
  assert.equal(usable({ key: new Uint8Array([1]), wallet: 'B' }, 'A'), false);
  assert.equal(usable(null, 'A'), false);
  assert.equal(usable({ key: new Uint8Array([0, 1]), wallet: 'A' }, 'A'), true);
});

/** A key that a session clear zeroes in place while the run holds it. */
function zeroedDuring(h: ReturnType<typeof harness>, phase: 'fetch' | 'ensure') {
  const key = new Uint8Array(32).fill(7);
  let opened = 0;
  let sealed = 0;
  h.deps.ensureBackupKey = async () => {
    await Promise.resolve();
    if (phase === 'ensure') key.fill(0);
    return { key, wallet: 'A' };
  };
  const fetch = h.deps.fetchVault;
  h.deps.fetchVault = async () => { const r = await fetch(); if (phase === 'fetch') key.fill(0); return r; };
  const open = h.deps.open;
  h.deps.open = (k: Uint8Array, r: { of: string | null }) => { opened++; return open(k, r); };
  const seal = h.deps.seal;
  h.deps.seal = (k: Uint8Array, kr: Keyring) => { sealed++; return seal(k, kr); };
  return { opened: () => opened, sealed: () => sealed };
}

test('zeroed key: restore never opens with it (stays retryable), publish never seals with it', async () => {
  const h = harness();
  const z = zeroedDuring(h, 'fetch');
  assert.equal(await runRestore(h.deps), 'idle');
  assert.equal(z.opened(), 0);
  const h2 = harness();
  const z2 = zeroedDuring(h2, 'ensure');
  assert.equal(await runPublish(h2.deps), 'unavailable');
  assert.equal(z2.sealed(), 0);
  assert.equal(h2.published.length, 0);
});

test('negative control: without the usable() check the zeroed key is used to open and to seal', async () => {
  const h = harness();
  const z = zeroedDuring(h, 'fetch');
  await legacyRestore(h.deps);
  assert.equal(z.opened(), 1, 'pre-fix restore opens with an all-zero key');
  // Pre-fix publish: owner check only, then seal.
  const h2 = harness();
  const z2 = zeroedDuring(h2, 'ensure');
  const owned = await h2.deps.ensureBackupKey();
  if (owned && owned.wallet === 'A') await h2.deps.publish(h2.deps.seal(owned.key, h2.deps.snapshot()));
  assert.equal(z2.sealed(), 1, 'pre-fix publish seals with an all-zero key');
});

// --- Replace result message (audit N1) -------------------------------------
// 'empty' unblocks backups but publishes nothing; the banner must not say the
// backup was replaced. Negative control: the pre-fix mapping (published OR
// empty -> keyvault_replaced) must fail the same assertions.

const LOCALES = ['en', 'de', 'es', 'pt', 'ru', 'ja', 'zh'];
type MsgMap = (out: PublishOutcome) => string | null;

/** Pre-fix (shipped in the first 0.84.0 cut) banner mapping, kept as the control. */
const preFixMapping: MsgMap = (out) =>
  out === 'published' || out === 'empty' ? 'keyvault_replaced' : out === 'failed' ? 'keyvault_replace_failed' : null;

function checkMapping(map: MsgMap): void {
  assert.equal(map('published'), 'keyvault_replaced');
  assert.equal(map('empty'), 'keyvault_replace_nothing');
  assert.equal(map('failed'), 'keyvault_replace_failed');
  for (const quiet of ['stale', 'blocked', 'unavailable'] as const) assert.equal(map(quiet), null, quiet);
}

test('N1: Replace outcome -> banner message; empty never claims "replaced"', () => {
  checkMapping(replaceResultMessageKey);
  assert.throws(() => checkMapping(preFixMapping), 'pre-fix mapping must fail (negative control)');
});

test('N1: every message the Replace mapping can return exists in all 7 locales', () => {
  const outs: PublishOutcome[] = ['published', 'empty', 'unavailable', 'blocked', 'stale', 'failed'];
  const keys = new Set(outs.map(replaceResultMessageKey).filter((k): k is string => k !== null));
  assert.equal(keys.size, 3);
  for (const lang of LOCALES) {
    const dict = JSON.parse(readFileSync(new URL(`../i18n/locales/${lang}.json`, import.meta.url), 'utf8'));
    for (const k of keys) assert.ok(typeof dict[k] === 'string' && dict[k].length > 0, `${lang}: ${k}`);
    // A real translation: the 'nothing' copy differs from the 'replaced' copy.
    assert.notEqual(dict.keyvault_replace_nothing, dict.keyvault_replaced, lang);
  }
});

test('N1: the banner routes the Replace outcome through replaceResultMessageKey', () => {
  const src = readFileSync(new URL('../components/KeyVaultBanner.tsx', import.meta.url), 'utf8');
  assert.match(src, /const msgKey = replaceResultMessageKey\(out\);/);
  assert.doesNotMatch(src, /out === 'empty'/);
  assert.doesNotMatch(src, /t\('keyvault_replaced'\)/);
});

/**
 * Key-recovery vault restore/backup never cross accounts (web 0.82.0).
 * Mutation-style: the same scenarios run against the real core and against a
 * copy of the pre-fix flow, which must reproduce the leak.
 * Run: node --conditions=browser --test src/lib/keyVaultCore.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runRestore, runPublish, type OwnedKey } from './keyVaultCore.ts';

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

test('decrypt failure under the account\'s own key stays terminal (no re-popping the wallet)', async () => {
  const h = harness({ decryptFails: true });
  assert.equal(await runRestore(h.deps), 'done');
  assert.equal(h.imports.length, 0);
});

test('a backup key derived for another wallet is refused', async () => {
  const h = harness();
  h.deps.ensureBackupKey = async () => ({ key: new Uint8Array([9]), wallet: 'B' });
  assert.equal(await runRestore(h.deps), 'idle');
  assert.equal(h.imports.length, 0);
  assert.equal(await runPublish(h.deps), 'skipped');
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
  assert.equal(await runPublish(h.deps), 'skipped');
  assert.equal(h.imports.length + h.published.length, 0);
});

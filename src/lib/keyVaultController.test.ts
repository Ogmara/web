/**
 * Key-vault controller (web 0.84.0): never overwrite the remote vault unless
 * this session opened it with a VERIFIED own key, confirmed it verifiably
 * empty, or the user confirmed "Replace backup"; coalesced re-arm; bounded
 * failure backoff.
 *
 * Real crypto end to end: @noble signatures from fixed seeds, the real
 * signature check (walletSigVerify.ts) and the real SDK seal/open/derive.
 * Every rule has a negative control: the same scenario against a copy of the
 * pre-fix flow (keyVault.ts @ web 0.83.0) reproduces the bug.
 * Run: node --conditions=browser --test src/lib/keyVaultController.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ed from '@noble/ed25519';
import { keccak_256 } from '@noble/hashes/sha3';
import { sha512 } from '@noble/hashes/sha512';
import {
  WalletSigner,
  normalizeWalletSig,
  addressToPubkey,
  deriveVaultBackupKey,
  sealKeyVault,
  openKeyVault,
  type VaultKeyring,
  type KeyVaultSyncData,
} from '@ogmara/sdk';
import { verifyWalletSig } from './walletSigVerify.ts';
import {
  createBackupKeySource,
  createVaultController,
  runPublish,
  type OwnedKey,
  type PublishOutcome,
} from './keyVaultCore.ts';

// Synchronous sha512 so verification settles in microtasks (deterministic tests).
ed.etc.sha512Sync = (...m: Uint8Array[]) => sha512(ed.etc.concatBytes(...m));

const CLAIM = 'ogmara-keyvault-v1';
const enc = (s: string) => new TextEncoder().encode(s);
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const signerA = await WalletSigner.fromPrivateKey(new Uint8Array(32).fill(0x11));
const signerB = await WalletSigner.fromPrivateKey(new Uint8Array(32).fill(0x22));
const A = signerA.address;
const B = signerB.address;
/** What the Klever Extension returns for signMessage(CLAIM): 128-char hex. */
const SIG: Record<string, string> = {
  [A]: hex(await signerA.signKleverMessage(enc(CLAIM))),
  [B]: hex(await signerB.signKleverMessage(enc(CLAIM))),
};
const KEY: Record<string, Uint8Array> = {
  [A]: deriveVaultBackupKey(SIG[A]),
  [B]: deriveVaultBackupKey(SIG[B]),
};
const k = (n: number) => new Uint8Array(32).fill(n);

async function settle(): Promise<void> {
  for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
}

/** Injected fake clock: timers only fire on `advance`. */
class Clock {
  now = 0;
  private seq = 0;
  timers = new Map<number, { at: number; fn: () => void }>();
  set = (fn: () => void, ms: number) => {
    const id = ++this.seq;
    this.timers.set(id, { at: this.now + ms, fn });
    return id;
  };
  clear = (id: unknown) => { this.timers.delete(id as number); };
  async advance(ms: number): Promise<void> {
    const end = this.now + ms;
    for (;;) {
      const due = [...this.timers]
        .filter(([, t]) => t.at <= end)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.now = due[1].at;
      due[1].fn();
      await settle();
    }
    this.now = end;
    await settle();
  }
}

/** Which account opens a sealed blob (null = nobody we know). */
function sealedFor(blob: KeyVaultSyncData): string | null {
  for (const w of [A, B]) {
    try { openKeyVault(KEY[w], blob); return w; } catch { /* not this one */ }
  }
  return null;
}

interface Vault {
  scheduleBackup(): void;
  tryRestore(): void;
  clearSession(): void;
}

type Flavor = 'fixed' | 'legacy';

function world(flavor: Flavor = 'fixed') {
  const w = {
    wallet: A as string | null,
    gen: 1,
    /** The account the external wallet signs with (null = the connected one). */
    signsAs: null as string | null,
    remote: new Map<string, KeyVaultSyncData>(),
    marker: new Map<string, string>(),
    /** Storage scope ≠ wallet (marker unreadable right now). */
    scopeMismatch: false,
    fetchFails: false,
    publishFails: false,
    publishGate: null as Promise<void> | null,
    local: { conv: {}, chan: {} } as VaultKeyring,
    signCalls: 0,
    ensureCalls: 0,
    fetchCalls: 0,
    publishes: [] as { as: string; blob: KeyVaultSyncData; sealedFor: string | null; keys: string[] }[],
    sendAttempts: 0,
  };
  const clock = new Clock();
  const sign = async (): Promise<string> => {
    w.signCalls++;
    await Promise.resolve();
    const as = w.signsAs ?? w.wallet;
    if (!as) throw new Error('no wallet');
    return SIG[as];
  };
  const io = {
    currentWallet: () => w.wallet,
    generation: () => w.gen,
    log: () => {},
    fetchVault: async (): Promise<KeyVaultSyncData | null> => {
      w.fetchCalls++;
      const of = w.wallet!;
      await Promise.resolve();
      if (w.fetchFails) throw new Error('API error (502)');
      return w.remote.get(of) ?? null;
    },
    open: openKeyVault,
    importKeys: (kr: VaultKeyring) => {
      Object.assign(w.local.conv, kr.conv);
      Object.assign(w.local.chan, kr.chan);
      return { conv: Object.keys(kr.conv).length };
    },
    seenMarker: (wallet: string) => (w.scopeMismatch ? null : w.marker.get(wallet) === wallet),
    markSeen: (wallet: string) => { if (!w.scopeMismatch) w.marker.set(wallet, wallet); },
    snapshot: (): VaultKeyring => ({ conv: { ...w.local.conv }, chan: { ...w.local.chan } }),
    isEmpty: (kr: VaultKeyring) => Object.keys(kr.conv).length + Object.keys(kr.chan).length === 0,
    seal: sealKeyVault,
    publish: async (blob: KeyVaultSyncData) => {
      w.sendAttempts++;
      const as = w.wallet!; // the node attributes it to the signing account
      if (w.publishGate) await w.publishGate;
      await Promise.resolve();
      if (w.publishFails) throw new Error('API error (503)');
      w.remote.set(as, blob);
      const opened = sealedFor(blob);
      w.publishes.push({
        as, blob, sealedFor: opened,
        keys: opened ? Object.keys(openKeyVault(KEY[opened], blob).conv).sort() : [],
      });
    },
    setTimer: clock.set,
    clearTimer: clock.clear,
  };

  const keySource = createBackupKeySource({
    currentWallet: io.currentWallet,
    generation: io.generation,
    sign,
    verify: (wallet, raw) => verifyWalletSig({
      keccak256: keccak_256,
      ed25519Verify: async (s, m, p) => ed.verify(s, m, p),
      addressToPubkey,
      normalize: normalizeWalletSig,
    }, wallet, CLAIM, raw),
    derive: deriveVaultBackupKey,
    log: () => {},
  });
  const ensureBackupKey = (): Promise<OwnedKey | null> => {
    w.ensureCalls++;
    return flavor === 'fixed' ? keySource.ensure() : legacyKey.ensure();
  };
  const legacyKey = legacyBackupKey(io, sign);

  const ctl = createVaultController({ ...io, ensureBackupKey });
  const vault: Vault = flavor === 'fixed'
    ? ctl
    : createLegacyVault({ ...io, ensureBackupKey, clearKey: legacyKey.clear });

  const addKey = (name: string, n = 7) => {
    w.local.conv[name] = k(n);
    vault.scheduleBackup();
  };
  /** disconnect(current) -> connect(next), as auth.ts does it. */
  const switchTo = (next: string) => {
    w.gen++;
    w.wallet = null;
    w.local = { conv: {}, chan: {} }; // clearDmKeyCache / clearChannelKeyCache
    if (flavor === 'fixed') { keySource.clear(); ctl.clearSession(); } else vault.clearSession();
    w.wallet = next;
    w.gen++;
  };
  const seedRemote = (wallet: string, keys: Record<string, number>, sealWith = KEY[wallet]) => {
    const conv: Record<string, Uint8Array> = {};
    for (const [n, v] of Object.entries(keys)) conv[n] = k(v);
    w.remote.set(wallet, sealKeyVault(sealWith, { conv, chan: {} }));
  };
  return { w, clock, ctl, keySource, vault, addKey, switchTo, seedRemote };
}

// --- the pre-fix flow (keyVault.ts @ web 0.83.0), deps injected -------------------

function legacyBackupKey(io: { currentWallet(): string | null }, sign: () => Promise<string>) {
  let bk: Uint8Array | null = null;
  let bkWallet: string | null = null;
  return {
    async ensure(): Promise<OwnedKey | null> {
      const wallet = io.currentWallet();
      if (!wallet) return null;
      if (bk && bkWallet === wallet) return { key: bk, wallet };
      try {
        const derived = deriveVaultBackupKey(await sign()); // NO verification
        if (io.currentWallet() !== wallet) return null;
        bk = derived; bkWallet = wallet;
        return { key: derived, wallet };
      } catch { return null; }
    },
    clear() { bk = null; bkWallet = null; },
  };
}

interface LegacyDeps {
  currentWallet(): string | null;
  generation(): number;
  ensureBackupKey(): Promise<OwnedKey | null>;
  fetchVault(): Promise<KeyVaultSyncData | null>;
  open(key: Uint8Array, r: KeyVaultSyncData): VaultKeyring;
  importKeys(kr: VaultKeyring): unknown;
  snapshot(): VaultKeyring;
  isEmpty(kr: VaultKeyring): boolean;
  seal(key: Uint8Array, kr: VaultKeyring): KeyVaultSyncData;
  publish(b: KeyVaultSyncData): Promise<void>;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(h: unknown): void;
  clearKey(): void;
}

function createLegacyVault(d: LegacyDeps): Vault & { backupNowNoWait(): Promise<void> } {
  let restoreState: 'idle' | 'inflight' | 'done' = 'idle';
  let restoreRun = 0;
  let pendingBackup = false;
  let publishing = false;
  let timer: unknown = null;
  async function runRestore(): Promise<'done' | 'idle' | 'stale'> {
    const wallet = d.currentWallet(); const gen = d.generation();
    const stale = () => d.currentWallet() !== wallet || d.generation() !== gen;
    const owned = await d.ensureBackupKey();
    if (stale()) return 'stale';
    if (!owned || owned.wallet !== wallet) return 'idle';
    let resp;
    try { resp = await d.fetchVault(); } catch { return stale() ? 'stale' : 'idle'; }
    if (stale()) return 'stale';
    if (resp) {
      let kr;
      try { kr = d.open(owned.key, resp); } catch { return stale() ? 'stale' : 'done'; }
      if (stale()) return 'stale';
      d.importKeys(kr);
    }
    return 'done';
  }
  async function publishBackup() {
    if (publishing) return; // the dropped publish
    publishing = true;
    try {
      const wallet = d.currentWallet(); const gen = d.generation();
      if (!wallet) return;
      const kr = d.snapshot();
      if (d.isEmpty(kr)) return;
      const owned = await d.ensureBackupKey();
      if (d.currentWallet() !== wallet || d.generation() !== gen) return;
      if (!owned || owned.wallet !== wallet) return;
      try { await d.publish(d.seal(owned.key, kr)); } catch { /* nothing re-arms */ }
    } finally { publishing = false; }
  }
  function scheduleBackup() {
    if (restoreState !== 'done') { pendingBackup = true; tryRestore(); return; }
    if (timer !== null) d.clearTimer(timer);
    timer = d.setTimer(() => { timer = null; void publishBackup(); }, 4_000);
  }
  function tryRestore() {
    if (restoreState !== 'idle') return;
    restoreState = 'inflight';
    const my = ++restoreRun;
    void (async () => {
      const out = await runRestore();
      if (my !== restoreRun) return;
      restoreState = out === 'done' ? 'done' : 'idle';
      if (restoreState === 'done' && pendingBackup) { pendingBackup = false; scheduleBackup(); }
    })();
  }
  return {
    scheduleBackup,
    tryRestore,
    clearSession() {
      d.clearKey(); restoreRun++; restoreState = 'idle'; pendingBackup = false;
      if (timer !== null) { d.clearTimer(timer); timer = null; }
    },
    /** mobile's pre-fix backupNow shape (C2): restore fire-and-forget, publish at once. */
    async backupNowNoWait() { tryRestore(); await publishBackup(); },
  };
}

// --- (2) C1: the extension signs as another account ---------------------------------

test('C1: extension signs as B while the app is A -> no key, no publish, mismatch latched; 5 decrypt-misses = ONE popup', async () => {
  const h = world();
  h.w.signsAs = B;
  h.seedRemote(A, { 'old-dm': 1 });
  h.addKey('new-dm');
  await settle();
  for (let i = 0; i < 5; i++) { h.ctl.tryRestore(); await settle(); }
  await h.clock.advance(3_600_000);
  assert.equal(h.w.signCalls, 1, 'the latch stops the popup loop');
  assert.equal(h.w.publishes.length, 0);
  assert.equal(h.w.sendAttempts, 0);
  assert.deepEqual(h.keySource.mismatch(), { wallet: A, generation: h.w.gen });
  assert.equal(h.keySource.cachedWallet(), null);
  assert.equal(h.ctl.status().restore, 'idle', 'mismatch is retryable, not terminal');
  assert.equal(h.ctl.status().pendingBackup, true, 'the backup intent survives');
  assert.equal(sealedFor(h.w.remote.get(A)!), A, "A's vault untouched");
});

test('C1: Retry after switching the extension back -> restores, then publishes ONCE under A\'s key', async () => {
  const h = world();
  h.w.signsAs = B;
  h.seedRemote(A, { 'old-dm': 1 });
  h.addKey('new-dm');
  await settle();
  h.w.signsAs = A;
  h.keySource.clearMismatch();
  h.ctl.retry();
  await settle();
  assert.equal(h.ctl.status().restore, 'done');
  await h.clock.advance(4_000);
  assert.equal(h.w.signCalls, 2);
  assert.equal(h.w.publishes.length, 1);
  assert.equal(h.w.publishes[0].sealedFor, A);
  assert.deepEqual(h.w.publishes[0].keys, ['new-dm', 'old-dm']);
  assert.equal(h.keySource.mismatch(), null);
});

test('C1 with no remote vault (404, no marker): still no publish under B\'s key', async () => {
  const h = world();
  h.w.signsAs = B;
  h.addKey('new-dm');
  await settle();
  await h.clock.advance(3_600_000);
  assert.equal(h.w.publishes.length, 0);
  assert.equal(h.w.fetchCalls, 0, 'nothing is fetched without a verified key');
});

test('C1 negative control: the pre-fix flow seals the keyring under B\'s key into A\'s record', async () => {
  for (const withRemote of [true, false]) {
    const h = world('legacy');
    h.w.signsAs = B;
    if (withRemote) h.seedRemote(A, { 'old-dm': 1 });
    h.addKey('new-dm');
    await settle();
    await h.clock.advance(4_000);
    assert.equal(h.w.publishes.length, 1);
    assert.equal(h.w.publishes[0].as, A);
    assert.equal(h.w.publishes[0].sealedFor, B, 'A\'s vault now opens only with B\'s key');
  }
});

test('mismatch latch clears on session clear (a latch that never cleared would disable backups for good)', async () => {
  const h = world();
  h.w.signsAs = B;
  h.addKey('dm');
  await settle();
  assert.ok(h.keySource.mismatch());
  h.keySource.clear();
  h.ctl.clearSession();
  assert.equal(h.keySource.mismatch(), null);
  h.w.signsAs = null;
  h.addKey('dm2');
  await settle();
  assert.equal(h.w.signCalls, 2, 'asks again after the session clear');
  assert.equal(h.ctl.status().restore, 'done');
});

test('built-in wallet (signs as itself) verifies once and caches: one sign for restore + publishes', async () => {
  const h = world();
  h.addKey('a');
  await settle();
  await h.clock.advance(4_000);
  h.addKey('b');
  await h.clock.advance(4_000);
  assert.equal(h.w.signCalls, 1);
  assert.equal(h.w.publishes.length, 2);
  assert.ok(h.w.publishes.every((p) => p.sealedFor === A));
});

// --- (3) unreadable remote under our own verified key ---------------------------------

for (const kind of ['wrong-key blob', 'unsupported format_version'] as const) {
  test(`unreadable remote (${kind}) -> blocked:'unreadable'; pending backup never published; Replace publishes exactly once`, async () => {
    const h = world();
    if (kind === 'wrong-key blob') h.seedRemote(A, { 'x': 1 }, KEY[B]);
    else {
      h.seedRemote(A, { 'x': 1 });
      h.w.remote.set(A, { ...h.w.remote.get(A)!, format_version: 2 });
    }
    const before = h.w.remote.get(A);
    h.addKey('dm');
    await settle();
    assert.deepEqual(h.ctl.status(), { restore: 'blocked', blockReason: 'unreadable', pendingBackup: true, publishing: false, failStreak: 0 });
    for (let i = 0; i < 5; i++) h.addKey(`dm${i}`);
    h.ctl.tryRestore();
    await h.clock.advance(3_600_000);
    assert.equal(h.w.fetchCalls, 1, 'blocked: no GET loop');
    assert.equal(h.w.publishes.length, 0);
    assert.equal(h.w.remote.get(A), before, 'the unreadable vault is preserved');

    const out = await h.ctl.replace();
    assert.equal(out, 'published');
    await h.clock.advance(3_600_000);
    assert.equal(h.w.publishes.length, 1);
    assert.equal(h.w.publishes[0].sealedFor, A);
    assert.equal(h.ctl.status().restore, 'done');
    h.addKey('after');
    await h.clock.advance(4_000);
    assert.equal(h.w.publishes.length, 2, 'backups resume normally after Replace');
  });
}

test('unreadable negative control: the pre-fix flow treats it as done and overwrites the vault', async () => {
  const h = world('legacy');
  h.seedRemote(A, { 'x': 1 }, KEY[B]);
  h.addKey('dm');
  await settle();
  await h.clock.advance(4_000);
  assert.equal(h.w.publishes.length, 1);
  assert.deepEqual(h.w.publishes[0].keys, ['dm'], 'the old vault is replaced by a partial keyring');
});

test('Replace is refused unless blocked (it can never skip a restore that has not run)', async () => {
  const h = world();
  h.w.local.conv['dm'] = k(1);
  assert.equal(await h.ctl.replace(), 'blocked'); // idle
  h.w.fetchFails = true;
  h.ctl.tryRestore();
  assert.equal(await h.ctl.replace(), 'blocked'); // inflight
  await settle();
  assert.equal(h.ctl.status().restore, 'idle');
  assert.equal(await h.ctl.replace(), 'blocked');
  assert.equal(h.w.sendAttempts, 0);
});

test('Retry from blocked re-reads the remote (e.g. after switching node)', async () => {
  const h = world();
  h.seedRemote(A, { 'x': 1 }, KEY[B]);
  h.addKey('dm');
  await settle();
  assert.equal(h.ctl.status().restore, 'blocked');
  h.seedRemote(A, { 'x': 1 }); // the readable copy
  h.ctl.retry();
  await settle();
  assert.equal(h.ctl.status().restore, 'done');
  await h.clock.advance(4_000);
  assert.deepEqual(h.w.publishes.map((p) => p.keys), [['dm', 'x']]);
});

// --- (4) 404 is "empty" only without the marker ------------------------------------------

test("404 + keyVaultSeen marker -> blocked:'missing', nothing published", async () => {
  const h = world();
  h.w.marker.set(A, A);
  h.addKey('dm');
  await settle();
  await h.clock.advance(3_600_000);
  assert.equal(h.ctl.status().restore, 'blocked');
  assert.equal(h.ctl.status().blockReason, 'missing');
  assert.equal(h.w.publishes.length, 0);
});

test('404 without the marker -> done, publishes, and sets the marker', async () => {
  const h = world();
  h.addKey('dm');
  await settle();
  assert.equal(h.ctl.status().restore, 'done');
  await h.clock.advance(4_000);
  assert.equal(h.w.publishes.length, 1);
  assert.equal(h.w.marker.get(A), A);
});

test('a marker for ANOTHER wallet does not count; a successful open sets the marker', async () => {
  const h = world();
  h.w.marker.set(A, B);
  h.seedRemote(A, { 'x': 1 });
  h.ctl.tryRestore();
  await settle();
  assert.equal(h.ctl.status().restore, 'done');
  assert.equal(h.w.marker.get(A), A);
});

test('marker unreadable right now (storage scope != wallet) -> stays retryable, never "empty"', async () => {
  const h = world();
  h.w.scopeMismatch = true;
  h.addKey('dm');
  await settle();
  await h.clock.advance(3_600_000);
  assert.equal(h.ctl.status().restore, 'idle');
  assert.equal(h.w.publishes.length, 0);
});

test('404 + marker negative control: the pre-fix flow overwrites the real vault from a node without a copy', async () => {
  const h = world('legacy');
  h.w.marker.set(A, A);
  h.addKey('dm');
  await settle();
  await h.clock.advance(4_000);
  assert.equal(h.w.publishes.length, 1);
});

// --- (5) coalesced re-arm ----------------------------------------------------------------

test('ten key changes during one in-flight publish -> exactly ONE follow-up, containing the newest key', async () => {
  const h = world();
  h.addKey('k0');
  await settle();
  let release!: () => void;
  h.w.publishGate = new Promise<void>((r) => { release = r; });
  await h.clock.advance(4_000);
  assert.equal(h.ctl.status().publishing, true);
  for (let i = 1; i <= 10; i++) {
    h.addKey(`k${i}`);
    await h.clock.advance(4_000);
  }
  assert.equal(h.w.sendAttempts, 1);
  h.w.publishGate = null;
  release();
  await settle();
  await h.clock.advance(3_600_000);
  assert.equal(h.w.publishes.length, 2);
  assert.ok(h.w.publishes[1].keys.includes('k10'));
  assert.equal(h.w.publishes[1].keys.length, 11);
});

test('re-arm negative control: the pre-fix flow drops every change made during the flight', async () => {
  const h = world('legacy');
  h.addKey('k0');
  await settle();
  let release!: () => void;
  h.w.publishGate = new Promise<void>((r) => { release = r; });
  await h.clock.advance(4_000);
  for (let i = 1; i <= 10; i++) {
    h.addKey(`k${i}`);
    await h.clock.advance(4_000);
  }
  h.w.publishGate = null;
  release();
  await settle();
  await h.clock.advance(3_600_000);
  assert.equal(h.w.publishes.length, 1, 'zero follow-ups: k1..k10 exist only in memory');
});

// --- (6) coalescing restore + manual backup ---------------------------------------------

test('double restore trigger -> ONE fetch; ensureRestored joins the flight', async () => {
  const h = world();
  h.seedRemote(A, { 'x': 1 });
  h.ctl.tryRestore();
  h.ctl.tryRestore();
  const [a, b] = await Promise.all([h.ctl.ensureRestored(), h.ctl.ensureRestored()]);
  assert.deepEqual([a, b], ['done', 'done']);
  assert.equal(h.w.fetchCalls, 1);
  assert.equal(h.w.signCalls, 1);
});

test('a publish requested during restore waits for it, then ONE publish with the merged keyring', async () => {
  const h = world();
  h.seedRemote(A, { 'x': 1, 'y': 2 });
  h.addKey('new');
  h.addKey('new2');
  await settle();
  await h.clock.advance(3_600_000);
  assert.equal(h.w.fetchCalls, 1);
  assert.equal(h.w.publishes.length, 1);
  assert.deepEqual(h.w.publishes[0].keys, ['new', 'new2', 'x', 'y']);
});

test('backupNow during an in-flight restore: one fetch, published keyring is a superset of the remote', async () => {
  const h = world();
  h.seedRemote(A, { 'x': 1, 'y': 2 });
  h.w.local.conv['new'] = k(3);
  h.ctl.tryRestore();
  assert.equal(await h.ctl.backupNow(), 'published');
  assert.equal(h.w.fetchCalls, 1);
  assert.deepEqual(h.w.publishes.map((p) => p.keys), [['new', 'x', 'y']]);
});

test('backupNow reports honestly: restore-failed / blocked / nothing / failed — and never sends unless done', async () => {
  let h = world();
  h.seedRemote(A, { 'x': 1 });
  h.w.local.conv['new'] = k(3);
  h.w.fetchFails = true;
  assert.equal(await h.ctl.backupNow(), 'restore-failed');
  assert.equal(h.w.sendAttempts, 0);

  h = world();
  h.seedRemote(A, { 'x': 1 }, KEY[B]);
  h.w.local.conv['new'] = k(3);
  assert.equal(await h.ctl.backupNow(), 'blocked');
  assert.equal(h.w.sendAttempts, 0);

  h = world();
  assert.equal(await h.ctl.backupNow(), 'nothing');

  h = world();
  h.w.local.conv['new'] = k(3);
  h.w.publishFails = true;
  assert.equal(await h.ctl.backupNow(), 'failed');
});

test('backupNow negative control: the pre-fix (mobile C2) shape publishes before the restore merged', async () => {
  const h = world('legacy');
  h.seedRemote(A, { 'x': 1, 'y': 2 });
  h.w.local.conv['new'] = k(3);
  // A restore that has not finished yet: the fetch is slow.
  const legacy = h.vault as ReturnType<typeof createLegacyVault>;
  // Old mobile publishBackup ignored restoreState entirely.
  await legacy.backupNowNoWait();
  await settle();
  assert.ok(h.w.publishes.length >= 1);
  assert.deepEqual(h.w.publishes[0].keys, ['new'], 'partial keyring overwrote x and y');
});

// --- (7) account switches -----------------------------------------------------------------

test('A -> B mid-publish: A\'s keyring never reaches B; a B request during A\'s flight -> B-only publish', async () => {
  const h = world();
  h.addKey('a-dm');
  await settle();
  let release!: () => void;
  h.w.publishGate = new Promise<void>((r) => { release = r; });
  await h.clock.advance(4_000); // A's publish is now in flight (sealed for A)
  h.switchTo(B);
  h.addKey('b-dm');
  await settle(); // B's restore (404, no marker) -> done -> debounce
  await h.clock.advance(4_000); // B's publish requested while A's is in flight
  h.w.publishGate = null;
  release();
  await settle();
  await h.clock.advance(3_600_000);
  const toB = h.w.publishes.filter((p) => p.as === B);
  assert.equal(toB.length, 1);
  assert.equal(toB[0].sealedFor, B);
  assert.deepEqual(toB[0].keys, ['b-dm']);
  assert.ok(h.w.publishes.every((p) => p.as === p.sealedFor), 'every blob is sealed for its own account');
});

test('A -> B -> A without a session clear: generation change voids the "done" state (re-restore before publishing)', async () => {
  const h = world();
  h.addKey('dm');
  await settle();
  await h.clock.advance(4_000);
  assert.equal(h.w.fetchCalls, 1);
  h.w.wallet = B; h.w.gen++;
  h.w.wallet = A; h.w.gen++;
  assert.equal(h.ctl.status().restore, 'idle');
  h.addKey('dm2');
  await settle();
  assert.equal(h.w.fetchCalls, 2, 'restored again for the new generation');
});

test('a debounce armed for A that fires after the account changed asks nobody to sign and sends nothing', async () => {
  const h = world();
  h.addKey('dm');
  await settle();
  // Account flips (no session clear reached the vault yet) before the debounce fires.
  h.w.wallet = B; h.w.gen++;
  const signsBefore = h.w.signCalls;
  const ensureBefore = h.w.ensureCalls;
  await h.clock.advance(4_000);
  assert.equal(h.w.signCalls, signsBefore, 'no wallet popup for B');
  assert.equal(h.w.ensureCalls, ensureBefore, 'controller gate: runPublish is not even started');
  assert.equal(h.w.sendAttempts, 0);
});

// --- (8) failure backoff -----------------------------------------------------------------

test('failed publish retries at 60 s / 5 min / 15 min, at most 3 times; success or session clear resets', async () => {
  const h = world();
  h.w.publishFails = true;
  h.addKey('dm');
  await settle();
  await h.clock.advance(4_000);
  assert.equal(h.w.sendAttempts, 1);
  await h.clock.advance(59_000);
  assert.equal(h.w.sendAttempts, 1);
  await h.clock.advance(1_000);
  assert.equal(h.w.sendAttempts, 2);
  await h.clock.advance(300_000);
  assert.equal(h.w.sendAttempts, 3);
  await h.clock.advance(900_000);
  assert.equal(h.w.sendAttempts, 4);
  await h.clock.advance(24 * 3_600_000);
  assert.equal(h.w.sendAttempts, 4, 'capped at 3 automatic retries');
  assert.equal(h.ctl.status().failStreak, 3);
  h.ctl.clearSession();
  assert.equal(h.ctl.status().failStreak, 0);
  assert.equal(h.clock.timers.size, 0);
});

test('a success resets the failure streak', async () => {
  const h = world();
  h.w.publishFails = true;
  h.addKey('dm');
  await settle();
  await h.clock.advance(4_000);
  h.w.publishFails = false;
  await h.clock.advance(60_000);
  assert.equal(h.w.publishes.length, 1);
  assert.equal(h.ctl.status().failStreak, 0);
  assert.equal(h.clock.timers.size, 0);
});

test('backoff negative control: the pre-fix flow never retries a failed publish', async () => {
  const h = world('legacy');
  h.w.publishFails = true;
  h.addKey('dm');
  await settle();
  await h.clock.advance(4_000);
  h.w.publishFails = false;
  await h.clock.advance(24 * 3_600_000);
  assert.equal(h.w.sendAttempts, 1);
  assert.equal(h.w.publishes.length, 0);
});

test('session clear cancels a pending backoff retry (no retry under the next account)', async () => {
  const h = world();
  h.w.publishFails = true;
  h.addKey('dm');
  await settle();
  await h.clock.advance(4_000);
  h.switchTo(B);
  h.w.publishFails = false;
  await h.clock.advance(3_600_000);
  assert.equal(h.w.sendAttempts, 1);
});

// --- runPublish's own gate ----------------------------------------------------------------

test('runPublish re-checks canPublish AFTER the key derivation (state changed while signing)', async () => {
  let allowed = true;
  let sealed = 0;
  const out: PublishOutcome = await runPublish({
    currentWallet: () => A,
    generation: () => 1,
    log: () => {},
    ensureBackupKey: async () => { await Promise.resolve(); allowed = false; return { key: KEY[A], wallet: A }; },
    snapshot: () => ({ conv: { x: k(1) }, chan: {} }),
    isEmpty: () => false,
    seal: (key, kr) => { sealed++; return sealKeyVault(key, kr); },
    publish: async () => {},
    canPublish: () => allowed,
    markSeen: () => {},
  });
  assert.equal(out, 'blocked');
  assert.equal(sealed, 0);
});

// --- backup-key source: account checks around the sign and verify awaits --------------

function keySourceHarness() {
  const s = { wallet: A as string | null, gen: 1, signs: 0, verifies: 0 };
  let onSign: (() => void) | null = null;
  let onVerify: (() => void) | null = null;
  const src = createBackupKeySource({
    currentWallet: () => s.wallet,
    generation: () => s.gen,
    sign: async () => { s.signs++; await Promise.resolve(); onSign?.(); return SIG[A]; },
    verify: async (wallet, raw) => {
      s.verifies++;
      const r = await verifyWalletSig({
        keccak256: keccak_256,
        ed25519Verify: async (sg, m, p) => ed.verify(sg, m, p),
        addressToPubkey,
        normalize: normalizeWalletSig,
      }, wallet, CLAIM, raw);
      onVerify?.();
      return r;
    },
    derive: deriveVaultBackupKey,
    log: () => {},
  });
  return { s, src, setOnSign: (f: () => void) => { onSign = f; }, setOnVerify: (f: () => void) => { onVerify = f; } };
}

test('key source: account switch while the wallet signs -> null, nothing cached', async () => {
  const h = keySourceHarness();
  h.setOnSign(() => { h.s.wallet = B; h.s.gen++; });
  assert.equal(await h.src.ensure(), null);
  assert.equal(h.src.cachedWallet(), null);
  assert.equal(h.s.verifies, 0, 'a stale signature is not even verified');
});

test('key source: account switch while verifying (A -> B -> A) -> null, nothing cached', async () => {
  const h = keySourceHarness();
  h.setOnVerify(() => { h.s.wallet = B; h.s.gen++; h.s.wallet = A; h.s.gen++; });
  assert.equal(await h.src.ensure(), null);
  assert.equal(h.src.cachedWallet(), null);
});

test('key source: clear() during the derivation drops its result', async () => {
  const h = keySourceHarness();
  h.setOnSign(() => h.src.clear());
  assert.equal(await h.src.ensure(), null);
  assert.equal(h.src.cachedWallet(), null);
});

test('key source: concurrent callers of the same account share ONE signature; another generation does not join', async () => {
  const h = keySourceHarness();
  const [a, b] = await Promise.all([h.src.ensure(), h.src.ensure()]);
  assert.equal(h.s.signs, 1);
  assert.ok(a && b && a.wallet === A && a.key === b.key);
  assert.deepEqual(a!.key, KEY[A], 'derived from the verified signature bytes');

  const h2 = keySourceHarness();
  const first = h2.src.ensure();
  h2.s.gen++;
  const second = h2.src.ensure();
  await Promise.all([first, second]);
  assert.equal(h2.s.signs, 2);
});

// --- Replace is bound to the account the user confirmed for -----------------------------

test('Replace: account switch while the confirm is open (to another BLOCKED account) -> stale, nothing published', async () => {
  const h = world();
  h.seedRemote(A, { 'a-old': 1 }, KEY[B]); // A's vault unreadable
  h.addKey('a-dm');
  await settle();
  assert.equal(h.ctl.status().restore, 'blocked');
  // Banner: the account is captured BEFORE the confirm opens ...
  const confirmedFor = { wallet: A, generation: h.w.gen };
  // ... and while it is open the user switches to B, whose vault is unreadable too.
  h.switchTo(B);
  h.seedRemote(B, { 'b-old': 2 }, KEY[A]);
  const bBefore = h.w.remote.get(B);
  h.addKey('b-dm');
  await settle();
  assert.equal(h.ctl.status().restore, 'blocked');
  assert.equal(await h.ctl.replace(confirmedFor), 'stale');
  await h.clock.advance(3_600_000);
  assert.equal(h.w.sendAttempts, 0);
  assert.equal(h.w.remote.get(B), bBefore, "B's vault untouched");
  assert.equal(h.ctl.status().restore, 'blocked', 'B still needs its OWN confirmation');
});

test('Replace negative control: an unbound replace (the pre-fix banner call) overwrites the OTHER account\'s vault', async () => {
  const h = world();
  h.seedRemote(A, { 'a-old': 1 }, KEY[B]);
  h.addKey('a-dm');
  await settle();
  h.switchTo(B);
  h.seedRemote(B, { 'b-old': 2 }, KEY[A]);
  const bBefore = h.w.remote.get(B);
  h.addKey('b-dm');
  await settle();
  assert.equal(await h.ctl.replace(), 'published'); // confirmed for A, acts for B
  assert.notEqual(h.w.remote.get(B), bBefore, "B's unreadable vault was replaced without B's confirmation");
});

test('Replace: A -> B -> A while the confirm is open is still stale (generation, not just address)', async () => {
  const h = world();
  h.seedRemote(A, { 'a-old': 1 }, KEY[B]);
  h.addKey('a-dm');
  await settle();
  const confirmedFor = { wallet: A, generation: h.w.gen };
  h.w.wallet = B; h.w.gen++;
  h.w.wallet = A; h.w.gen++;
  assert.equal(await h.ctl.replace(confirmedFor), 'stale');
  assert.equal(h.w.sendAttempts, 0);
});

test('Replace for the still-current account publishes once', async () => {
  const h = world();
  h.seedRemote(A, { 'a-old': 1 }, KEY[B]);
  h.addKey('a-dm');
  await settle();
  assert.equal(await h.ctl.replace({ wallet: A, generation: h.w.gen }), 'published');
  assert.equal(h.w.publishes.length, 1);
  assert.equal(h.w.publishes[0].sealedFor, A);
});

test('key source: an all-zero derived key is never cached or handed out', async () => {
  const src = createBackupKeySource({
    currentWallet: () => A,
    generation: () => 1,
    sign: async () => SIG[A],
    verify: async (_w, raw) => ({ ok: true, sig: normalizeWalletSig(raw).slice() }),
    derive: () => new Uint8Array(32),
    log: () => {},
  });
  assert.equal(await src.ensure(), null);
  assert.equal(src.cachedWallet(), null);
});

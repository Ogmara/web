/**
 * Regression test for the cross-account private-channel seeding bug (web
 * 0.82.0): after a disconnect + connect of a different wallet in the same
 * page, the Sidebar's `allChannels` resource still held account A's list
 * (A's private channels) while B's fetch was in flight, and the joined-set
 * reconcile effect ran `syncJoinedWithApi` on it under B — permanently adding
 * A's private channels to B's persisted joined set.
 *
 * Mirrors the Sidebar wiring (resource source `[version, wallet]`, live-only
 * `liveListOwner`, wallet-change `mutate`, reconcile effect) and evaluates
 * the SAME predicate the Sidebar uses (`shouldReconcileJoined`). The negative
 * control swaps in the pre-0.82.0 gate and must reproduce the leak.
 *
 * Run: node --conditions=browser --test src/components/joinedSyncWiring.test.ts
 * (`browser` condition: the default solid-js server build never runs effects.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRoot, createSignal, createResource, createEffect, on, untrack } from 'solid-js';
import { shouldReconcileJoined, type JoinedSyncInputs } from '../lib/channelListSync.ts';

type Ch = { channel_id: number; channel_type: number; slug: string };
const A_LIST: Ch[] = [
  { channel_id: 1, channel_type: 0, slug: 'ogmara' },
  { channel_id: 77, channel_type: 2, slug: 'a-secret' },
];

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Gate used before 0.82.0: `hasLoadedOnce && authReady && list non-empty`. */
const legacyGate = (i: JoinedSyncInputs & { hasLoadedOnce: boolean }) =>
  i.hasLoadedOnce && i.authReady && i.listLength > 0;

function makeSidebar(opts: {
  gate: (i: JoinedSyncInputs & { hasLoadedOnce: boolean }) => boolean;
  mutateOnWalletChange: boolean;
  /** Sidebar clears ownership at fetcher start (the fix); false = pre-fix. */
  clearOwnerAtStart?: boolean;
}) {
  const clearOwnerAtStart = opts.clearOwnerAtStart ?? true;
  const [version, setVersion] = createSignal(0);
  let failNext = false;
  const [wallet, setWallet] = createSignal<string | null>('A');
  const [auth, setAuth] = createSignal<'ready' | 'none'>('ready');
  let scope: string | null = 'A';
  const caches: Record<string, Ch[]> = {};
  const cacheFor = (w: string | null) => caches[w ?? ''] ?? [];
  const [liveListOwner, setLiveListOwner] = createSignal<string | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = createSignal(false);
  const syncCalls: { wallet: string | null; scope: string | null; ids: number[] }[] = [];

  const [all, { mutate }] = createResource(
    () => [version(), wallet()] as const,
    async ([, w]) => {
      if (clearOwnerAtStart) setLiveListOwner(null);
      try {
        if (failNext) {
          failNext = false;
          await wait(5);
          throw new Error('simulated listChannels failure');
        }
        // B's list is HELD (never resolves) — the window the bug lived in.
        const list: Ch[] = w === 'B' ? await new Promise<Ch[]>(() => {}) : A_LIST;
        if (wallet() !== w) return cacheFor(wallet());
        caches[w ?? ''] = list;
        setLiveListOwner(w);
        return list;
      } catch {
        // Real Sidebar: fall back to the cache, never claim ownership.
        return cacheFor(wallet());
      } finally {
        setHasLoadedOnce(true);
      }
    },
    { initialValue: [] as Ch[] },
  );

  if (opts.mutateOnWalletChange) {
    createEffect(on(wallet, () => {
      setLiveListOwner(null);
      mutate(cacheFor(wallet()));
    }, { defer: true }));
  }

  createEffect(() => {
    const list = all();
    const ok = opts.gate({
      authReady: auth() === 'ready',
      liveListOwner: liveListOwner(),
      wallet: wallet(),
      scope,
      loading: all.loading,
      listLength: list?.length ?? 0,
      hasLoadedOnce: hasLoadedOnce(),
    });
    if (ok && list) {
      untrack(() => syncCalls.push({ wallet: wallet(), scope, ids: list.map((c) => c.channel_id) }));
    }
  });

  /** The web switch: disconnect (address null, auth none, scope null), then connect B scope-first. */
  const switchToB = () => {
    setWallet(null);
    setAuth('none');
    scope = null;
    scope = 'B';
    setWallet('B');
    setAuth('ready');
  };
  /** A poll refetch for the SAME wallet that fails and falls back to the cache. */
  const failingRefetch = () => {
    failNext = true;
    setVersion((v) => v + 1);
  };
  return { syncCalls, switchToB, all, failingRefetch };
}

const leakedIntoB = (calls: { wallet: string | null; scope: string | null; ids: number[] }[]) =>
  calls.some((c) => (c.wallet === 'B' || c.scope === 'B') && c.ids.includes(77));

test('positive control: account A reconciles its own live list', async () => {
  await createRoot(async (dispose) => {
    const sb = makeSidebar({ gate: shouldReconcileJoined, mutateOnWalletChange: true });
    await wait(20);
    assert.ok(sb.syncCalls.some((c) => c.wallet === 'A' && c.ids.includes(77)), 'A must still sync its own private channel');
    dispose();
  });
});

test('A -> B with A\'s list still held: syncJoinedWithApi is never called for B (full wiring)', async () => {
  await createRoot(async (dispose) => {
    const sb = makeSidebar({ gate: shouldReconcileJoined, mutateOnWalletChange: true });
    await wait(20);
    sb.switchToB();
    await wait(50);
    assert.equal(leakedIntoB(sb.syncCalls), false, `leaked: ${JSON.stringify(sb.syncCalls)}`);
    assert.equal(sb.syncCalls.filter((c) => c.wallet === 'B').length, 0);
    dispose();
  });
});

// Without the mutate, the resource keeps rendering A's list while B's fetch is
// in flight. Two guards independently block that window — `loading` and the
// live-owner check — so removing EITHER alone keeps this green (defense in
// depth, pinned individually by the predicate test below); removing both
// (verified while writing this test) turns it red, as does the legacy gate.
test('the gate alone holds even without the wallet-change mutate (resource still shows A\'s list)', async () => {
  await createRoot(async (dispose) => {
    const sb = makeSidebar({ gate: shouldReconcileJoined, mutateOnWalletChange: false });
    await wait(20);
    sb.switchToB();
    await wait(50);
    // Sanity: the held value really is A's list — this is the stale state.
    assert.ok((sb.all() ?? []).some((c) => c.channel_id === 77), 'harness must actually hold A\'s list');
    assert.equal(leakedIntoB(sb.syncCalls), false, `leaked: ${JSON.stringify(sb.syncCalls)}`);
    dispose();
  });
});

test('negative control: the pre-0.82.0 gate reproduces the leak — proves this harness detects it', async () => {
  await createRoot(async (dispose) => {
    const sb = makeSidebar({ gate: legacyGate, mutateOnWalletChange: false });
    await wait(20);
    sb.switchToB();
    await wait(50);
    assert.equal(leakedIntoB(sb.syncCalls), true, 'removing the guard must let A\'s private channel reach B\'s sync');
    dispose();
  });
});

test('shouldReconcileJoined: every guard is load-bearing', () => {
  const ok: JoinedSyncInputs = {
    authReady: true, liveListOwner: 'A', wallet: 'A', scope: 'A', loading: false, listLength: 2,
  };
  assert.equal(shouldReconcileJoined(ok), true);
  assert.equal(shouldReconcileJoined({ ...ok, authReady: false }), false);
  assert.equal(shouldReconcileJoined({ ...ok, wallet: null, liveListOwner: null, scope: null }), false);
  assert.equal(shouldReconcileJoined({ ...ok, liveListOwner: null }), false, 'cache seed / failed fetch');
  assert.equal(shouldReconcileJoined({ ...ok, liveListOwner: 'B' }), false, 'list owned by another wallet');
  assert.equal(shouldReconcileJoined({ ...ok, scope: 'B' }), false, 'storage already flipped to another wallet');
  assert.equal(shouldReconcileJoined({ ...ok, loading: true }), false, 'fetch in flight');
  assert.equal(shouldReconcileJoined({ ...ok, listLength: 0 }), false);
});

// A failed refetch for the SAME wallet falls back to the cached list. If the
// user left a private channel in the meantime, the cache still has it, and the
// add-only reconcile would re-pin it — unless ownership is re-earned per fetch.
test('a failed refetch (cache fallback) for the same wallet does NOT reconcile', async () => {
  await createRoot(async (dispose) => {
    const sb = makeSidebar({ gate: shouldReconcileJoined, mutateOnWalletChange: true });
    await wait(20);
    const before = sb.syncCalls.length;
    assert.ok(before > 0, 'positive control: the live list reconciled');
    sb.failingRefetch();
    await wait(40);
    assert.equal(sb.syncCalls.length, before, `reconciled on a cache fallback: ${JSON.stringify(sb.syncCalls.slice(before))}`);
    dispose();
  });
});

test('negative control: without clearing ownership at fetch start, the cache fallback reconciles', async () => {
  await createRoot(async (dispose) => {
    const sb = makeSidebar({ gate: shouldReconcileJoined, mutateOnWalletChange: true, clearOwnerAtStart: false });
    await wait(20);
    const before = sb.syncCalls.length;
    sb.failingRefetch();
    await wait(40);
    assert.ok(sb.syncCalls.length > before, 'pre-fix wiring must reconcile the fallback — else this harness cannot detect the bug');
    dispose();
  });
});

/**
 * Direct Message E2E orchestration (P1, protocol §8.2) — **per-sender keys**.
 *
 * Each participant has their OWN sending key (`conv_key`) for a conversation,
 * wrapped (ECIES) to every device of both participants via `ChannelKeyEnvelope`
 * (0x61), keyed on the node by the author. To decrypt a message from author X, the
 * recipient fetches X's key (`getKeyEnvelope(..., author=X)`). This avoids the
 * shared-key agreement problem entirely: cross-node, both sides independently
 * publish their own key and each can decrypt the other's messages (no "split-brain"
 * where two epoch-1 keys collide under first-write-wins).
 *
 * Caching is in-memory (per session), keyed by (conversation, epoch, author).
 * Cross-device/restart recovery is P3 (the wallet-encrypted key vault).
 */
import {
  computeConversationId,
  randomConvKey,
  wrapConvKey,
  unwrapConvKey,
  buildChannelKeyEnvelope,
  buildEncryptedDirectMessage,
  decryptDmContent,
  encPublicKeyHex,
  KeyScopeKind,
  type WrappedKey,
} from '@ogmara/sdk';
import { decode } from '@msgpack/msgpack';
import { getClient } from './api';
import { getSigner, walletAddress } from './auth';
import { getOrCreateEncKeypair, currentDeviceId } from './deviceEnc';
import { e2elog, withRetry } from './e2eDebug';

const toHex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

function fromHex(h: string): Uint8Array {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** In-memory key cache: `${conversationIdHex}:${epoch}:${author}` → 32-byte key. */
const convKeys = new Map<string, Uint8Array>();
const cacheKey = (convIdHex: string, epoch: number, author: string) =>
  `${convIdHex}:${epoch}:${author}`;

/** Highest cached epoch of `author`'s key for a conversation, or null. */
function cachedLatest(convIdHex: string, author: string): { key: Uint8Array; epoch: number } | null {
  const suffix = `:${author}`;
  let best: { key: Uint8Array; epoch: number } | null = null;
  for (const [k, v] of convKeys) {
    if (k.startsWith(`${convIdHex}:`) && k.endsWith(suffix)) {
      const epoch = Number(k.slice(convIdHex.length + 1, k.length - suffix.length));
      if (!best || epoch > best.epoch) best = { key: v, epoch };
    }
  }
  return best;
}

/** Per-conversation in-flight establishment, so a double-send doesn't fork my key. */
const establishing = new Map<string, Promise<{ key: Uint8Array; epoch: number }>>();

/** Clear cached keys (e.g. on logout / wallet switch). */
export function clearDmKeyCache(): void {
  convKeys.clear();
  establishing.clear();
  wrappedToDevices.clear();
  coveredThisSession.clear();
}

interface DeviceCtx {
  signer: ReturnType<typeof getSigner>;
  encPriv: Uint8Array;
  deviceId: string; // hex of the device Ed25519 signing pubkey
  wallet: string;
}

async function deviceCtx(): Promise<DeviceCtx | null> {
  const signer = getSigner();
  const wallet = walletAddress();
  if (!signer || !wallet) return null;
  // device_id: external wallets use their delegated device signing key; built-in
  // wallets use a stable random per-install id (mirrors desktop, §2.4).
  const deviceId = currentDeviceId();
  if (!deviceId) return null; // external wallet with no device signer yet
  const kp = await getOrCreateEncKeypair();
  return { signer, encPriv: kp.privateKey, deviceId, wallet };
}

interface Target { target: string; deviceId: string; encPub: string; createdAt: number }

/** Which `(target, deviceId)` we've already wrapped MY key to, per `${convIdHex}:${epoch}`.
 *  A follow-up send only wraps to NEW devices (late joiners), not the whole set. */
const wrappedToDevices = new Map<string, Set<string>>();
const wrappedSetKey = (convIdHex: string, epoch: number) => `${convIdHex}:${epoch}`;
const targetKey = (t: Target) => `${t.target}:${(t.deviceId ?? '').toLowerCase()}`;

/**
 * Fetch the CURRENT device set of both participants and dedup to one wrap per
 * `(target, device_id)` keeping the newest enc_pub. The node keys `channel_keys`
 * by device_id (first-write-wins), so wrapping to several enc_pubs of one device
 * yields colliding envelopes where a stale wrapping can win — undecryptable.
 */
async function getConvTargets(ctx: DeviceCtx, recipient: string): Promise<Target[]> {
  const client = getClient();
  const empty = () => ({ keys: [] as { device_id: string; enc_pub: string; created_at: number }[] });
  const [recipKeys, myKeys] = await Promise.all([
    client.getEncKeys(recipient).catch(empty),
    client.getEncKeys(ctx.wallet).catch(empty),
  ]);
  const raw: Target[] = [
    ...recipKeys.keys.map((k) => ({ target: recipient, deviceId: k.device_id, encPub: k.enc_pub, createdAt: k.created_at ?? 0 })),
    ...myKeys.keys.map((k) => ({ target: ctx.wallet, deviceId: k.device_id, encPub: k.enc_pub, createdAt: k.created_at ?? 0 })),
  ];
  const byDevice = new Map<string, Target>();
  for (const t of raw) {
    const prev = byDevice.get(targetKey(t));
    if (!prev || t.createdAt > prev.createdAt) byDevice.set(targetKey(t), t);
  }
  return [...byDevice.values()];
}

/** Wrap MY `convKey` to each `target` and publish (0x61). Records coverage so we
 *  don't re-wrap a device that already has it. 429-resilient. */
async function wrapMyKeyToTargets(
  ctx: DeviceCtx, conversationId: Uint8Array, convIdHex: string,
  recipient: string, convKey: Uint8Array, epoch: number, targets: Target[],
): Promise<void> {
  const client = getClient();
  const covered = wrappedToDevices.get(wrappedSetKey(convIdHex, epoch)) ?? new Set<string>();
  for (const tg of targets) {
    const wrapped: WrappedKey = wrapConvKey(convKey, fromHex(tg.encPub), conversationId);
    const envelope = await buildChannelKeyEnvelope(ctx.signer!, {
      keyScope: conversationId, scopeKind: KeyScopeKind.DM, epoch,
      target: tg.target, deviceId: tg.deviceId, peer: recipient, wrapped,
    });
    await withRetry(() => client.publishKeyEnvelope(envelope), 'publish key envelope');
    covered.add(targetKey(tg));
  }
  wrappedToDevices.set(wrappedSetKey(convIdHex, epoch), covered);
}

const bytesEq = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Establish MY sending key for this conversation at `epoch`: generate a random
 * `conv_key`, wrap it to every current device of BOTH participants, publish one
 * `ChannelKeyEnvelope` (0x61) per device (authored by me).
 *
 * CRITICAL FWW read-back: the node keys envelopes by `(author, target-device,
 * epoch)` first-write-wins, and the publish endpoint returns 200 even when the
 * write is silently dropped (a key already existed for that device+epoch). If we
 * just used our locally-generated key, we'd ENCRYPT with a key the node never
 * stored → recipients (and we, on reload) fetch the surviving key → "invalid
 * tag". So after publishing we re-fetch our own key and ADOPT whatever the node
 * actually serves — guaranteeing we encrypt with the key everyone will fetch.
 * (A truly fresh epoch has no prior envelopes, so our key wins all devices.)
 */
async function establishMyKey(
  ctx: DeviceCtx,
  conversationId: Uint8Array,
  convIdHex: string,
  recipient: string,
  epoch = 1,
): Promise<{ key: Uint8Array; epoch: number }> {
  const targets = await getConvTargets(ctx, recipient);
  e2elog('establish: targets', {
    convIdHex, recipient, epoch,
    targets: targets.map((t) => `${t.target.slice(0, 10)}…/${t.deviceId.slice(0, 8)}`),
  });
  if (targets.length === 0) {
    throw new Error('no device encryption keys found for either participant');
  }
  const convKey = randomConvKey();
  await wrapMyKeyToTargets(ctx, conversationId, convIdHex, recipient, convKey, epoch, targets);
  convKeys.set(cacheKey(convIdHex, epoch, ctx.wallet), convKey);
  // FWW read-back: adopt the node's stored key if ours lost the race.
  const confirmed = await fetchConvKey(ctx, conversationId, convIdHex, ctx.wallet, epoch);
  if (typeof confirmed !== 'string' && !bytesEq(confirmed.key, convKey)) {
    e2elog('establish: adopted node FWW key (local lost the race)', { convIdHex, epoch });
    return { key: confirmed.key, epoch }; // fetchConvKey already cached the node's key
  }
  e2elog('establish: published', { convIdHex, epoch, deviceCount: targets.length });
  return { key: convKey, epoch };
}

/** Highest epoch the node has for `author`'s key in this conversation (0 = none). */
async function latestEpochFor(
  ctx: DeviceCtx, conversationId: Uint8Array, convIdHex: string, author: string,
): Promise<number> {
  const r = await fetchConvKey(ctx, conversationId, convIdHex, author); // no epoch → latest
  return typeof r === 'string' ? 0 : r.epoch;
}

/**
 * Re-key the conversation with a clean epoch bump. Establishes a fresh `conv_key`
 * at `max(myLatest, peerLatest) + 1` — a fresh epoch has no prior envelopes, so
 * the single establish wins FWW on EVERY device → one consistent key (escapes a
 * corrupted epoch where repeated establishes left different keys per device).
 * BOTH participants must re-key to stop sending under the corrupted epoch.
 * Returns the new epoch. Old-epoch messages remain undecryptable.
 */
export async function reKeyConversation(
  recipient: string,
): Promise<{ epoch: number } | null> {
  const ctx = await deviceCtx();
  if (!ctx) return null;
  const conversationId = computeConversationId(ctx.wallet, recipient);
  const convIdHex = toHex(conversationId);
  const [mine, theirs] = await Promise.all([
    latestEpochFor(ctx, conversationId, convIdHex, ctx.wallet),
    latestEpochFor(ctx, conversationId, convIdHex, recipient),
  ]);
  const epoch = Math.max(mine, theirs, 0) + 1;
  coveredThisSession.delete(wrappedSetKey(convIdHex, epoch));
  const res = await establishMyKey(ctx, conversationId, convIdHex, recipient, epoch);
  e2elog('reKey: bumped epoch', { convIdHex, from: Math.max(mine, theirs, 0), to: res.epoch });
  return { epoch: res.epoch };
}

/** Conversations whose current device set we've already reconciled this session. */
const coveredThisSession = new Set<string>();

/**
 * Cover late/newly-registered devices: wrap MY existing `convKey` to any CURRENT
 * device of either participant we haven't wrapped to yet for this epoch. Closes
 * the "device registered AFTER key establishment → waits forever" gap. Runs once
 * per conversation+epoch per session (bounded; FWW makes re-wraps to existing
 * devices no-ops anyway).
 */
async function coverDevices(
  ctx: DeviceCtx, conversationId: Uint8Array, convIdHex: string,
  recipient: string, convKey: Uint8Array, epoch: number,
): Promise<void> {
  const sessKey = wrappedSetKey(convIdHex, epoch);
  if (coveredThisSession.has(sessKey)) return;
  coveredThisSession.add(sessKey);
  try {
    const targets = await getConvTargets(ctx, recipient);
    const done = wrappedToDevices.get(sessKey) ?? new Set<string>();
    const missing = targets.filter((t) => !done.has(targetKey(t)));
    if (missing.length > 0) {
      await wrapMyKeyToTargets(ctx, conversationId, convIdHex, recipient, convKey, epoch, missing);
      e2elog('covered late devices', { convIdHex, epoch, count: missing.length });
    }
  } catch (e) {
    coveredThisSession.delete(sessKey); // allow a retry on the next send
    e2elog('coverDevices skipped', { err: (e as Error)?.message });
  }
}

/** `missing` = not delivered yet (retry); `corrupt` = present but unwrap failed (error). */
type FetchResult = { key: Uint8Array; epoch: number } | 'missing' | 'corrupt';

/** Fetch + unwrap author `author`'s `conv_key` for a scope/epoch, addressed to my device. */
async function fetchConvKey(
  ctx: DeviceCtx,
  conversationId: Uint8Array,
  convIdHex: string,
  author: string,
  epoch?: number,
): Promise<FetchResult> {
  let resp;
  try {
    resp = await withRetry(() => getClient().getKeyEnvelope(convIdHex, ctx.deviceId, author, epoch), 'fetch key envelope');
  } catch (e) {
    e2elog('fetchConvKey: network error → missing', { author, epoch, deviceId: ctx.deviceId, err: (e as Error)?.message });
    return 'missing'; // network/transient — retry later
  }
  if (!resp.envelope) {
    e2elog('fetchConvKey: no envelope → waiting', { author, epoch, deviceId: ctx.deviceId });
    return 'missing';
  }
  try {
    const env = resp.envelope;
    const wrapped: WrappedKey = {
      ephPub: fromHex(env.eph_pub),
      nonce: fromHex(env.nonce),
      wrapped: fromHex(env.wrapped),
    };
    const key = unwrapConvKey(wrapped, ctx.encPriv, conversationId);
    const ep = resp.epoch ?? env.epoch;
    convKeys.set(cacheKey(convIdHex, ep, author), key);
    e2elog('fetchConvKey: unwrapped OK', { author, epoch: ep, deviceId: ctx.deviceId });
    return { key, epoch: ep };
  } catch (e) {
    // Envelope present but unwrap failed = the wrap targeted a different enc_pub
    // than our local enc-priv (binding divergence) → "can't decrypt".
    e2elog('fetchConvKey: unwrap FAILED → corrupt', { author, epoch, deviceId: ctx.deviceId, err: (e as Error)?.message });
    return 'corrupt';
  }
}

/**
 * Ensure MY sending key for `recipient` (establishing it if this is my first
 * message). Always returns my own key — never the peer's.
 */
export async function ensureConvKeyForSend(
  recipient: string,
): Promise<{ convKey: Uint8Array; epoch: number; conversationId: Uint8Array } | null> {
  const ctx = await deviceCtx();
  if (!ctx) return null;
  const conversationId = computeConversationId(ctx.wallet, recipient);
  const convIdHex = toHex(conversationId);

  // 1) My key cached?
  const cached = cachedLatest(convIdHex, ctx.wallet);
  if (cached) {
    // Cover any device that registered after we first established (late joiner).
    void coverDevices(ctx, conversationId, convIdHex, recipient, cached.key, cached.epoch);
    return { convKey: cached.key, epoch: cached.epoch, conversationId };
  }

  // 2) My key already on the node (e.g. established on another of my devices)?
  const fetched = await fetchConvKey(ctx, conversationId, convIdHex, ctx.wallet);
  if (typeof fetched !== 'string') {
    void coverDevices(ctx, conversationId, convIdHex, recipient, fetched.key, fetched.epoch);
    return { convKey: fetched.key, epoch: fetched.epoch, conversationId };
  }

  // 3) Establish my key (deduped against a concurrent send).
  let inflight = establishing.get(convIdHex);
  if (!inflight) {
    inflight = establishMyKey(ctx, conversationId, convIdHex, recipient).finally(() =>
      establishing.delete(convIdHex),
    );
    establishing.set(convIdHex, inflight);
  }
  const res = await inflight;
  return { convKey: res.key, epoch: res.epoch, conversationId };
}

/** Build a signed, encrypted DirectMessage envelope for `recipient`. */
export async function buildEncryptedDm(
  recipient: string,
  text: string,
  replyTo?: string,
): Promise<Uint8Array> {
  const established = await ensureConvKeyForSend(recipient);
  if (!established) throw new Error('device not ready for encrypted DMs');
  const signer = getSigner();
  if (!signer) throw new Error('no signer');
  return buildEncryptedDirectMessage(signer, {
    recipient,
    convKey: established.convKey,
    epoch: established.epoch,
    text,
    replyTo,
  });
}

interface RawDmPayload {
  conversation_id?: Uint8Array;
  content?: Uint8Array | string;
  nonce?: Uint8Array;
  key_epoch?: number;
}

function toBytes(payload: number[] | Uint8Array | string): Uint8Array | null {
  if (typeof payload === 'string') {
    try {
      const bin = atob(payload);
      const b = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
      return b;
    } catch {
      return null;
    }
  }
  return payload instanceof Uint8Array ? payload : new Uint8Array(payload);
}

/** Display outcome for a DM message. */
export type DmDisplay =
  | { kind: 'text'; text: string }
  | { kind: 'plain'; text: string } // legacy/optimistic plaintext
  | { kind: 'waiting' }
  | { kind: 'error' };

/**
 * Decrypt a DM message for rendering. `author` is the message sender (resolved
 * wallet) — we fetch THAT author's key to decrypt. Plaintext (optimistic local /
 * legacy `key_epoch 0`) is returned as-is.
 */
export async function decryptDmMessage(
  payload: number[] | Uint8Array | string,
  author?: string,
): Promise<DmDisplay> {
  const bytes = toBytes(payload);
  if (!bytes) {
    e2elog('decode: toBytes failed', { payloadType: Array.isArray(payload) ? 'array' : typeof payload });
    return { kind: 'error' };
  }
  let decoded: RawDmPayload;
  try {
    decoded = decode(bytes) as RawDmPayload;
  } catch (e) {
    e2elog('decode: msgpack failed', { byteLen: bytes.length, err: (e as Error)?.message });
    return { kind: 'error' };
  }
  if (typeof decoded.content === 'string') return { kind: 'plain', text: decoded.content };
  // Legacy/MVP plaintext DMs use key_epoch 0 with UTF-8 bytes in `content`.
  if ((decoded.key_epoch ?? 0) === 0) {
    if (decoded.content instanceof Uint8Array) {
      try {
        return { kind: 'plain', text: new TextDecoder().decode(decoded.content) };
      } catch {
        return { kind: 'error' };
      }
    }
    e2elog('decode: legacy epoch0 but content not bytes', { contentType: typeof decoded.content });
    return { kind: 'error' };
  }
  if (!(decoded.content instanceof Uint8Array) || !(decoded.nonce instanceof Uint8Array)) {
    e2elog('decode: content/nonce not bytes', {
      keyEpoch: decoded.key_epoch ?? null,
      contentType: decoded.content instanceof Uint8Array ? 'bytes' : typeof decoded.content,
      nonceType: decoded.nonce instanceof Uint8Array ? 'bytes' : typeof decoded.nonce,
    });
    return { kind: 'error' };
  }
  const conversationId = decoded.conversation_id;
  if (!(conversationId instanceof Uint8Array)) {
    e2elog('decode: conversation_id not bytes', { convIdType: typeof decoded.conversation_id });
    return { kind: 'error' };
  }
  const epoch = decoded.key_epoch ?? 1;
  const convIdHex = toHex(conversationId);

  const ctx = await deviceCtx();
  if (!ctx) return { kind: 'waiting' };
  // The sender's key. Default to my own wallet for an own-message echo when the
  // caller didn't pass the author.
  const keyAuthor = author ?? ctx.wallet;

  let key = convKeys.get(cacheKey(convIdHex, epoch, keyAuthor));
  if (!key) {
    const fetched = await fetchConvKey(ctx, conversationId, convIdHex, keyAuthor, epoch);
    if (fetched === 'missing') return { kind: 'waiting' };
    if (fetched === 'corrupt') return { kind: 'error' };
    key = fetched.key;
  }
  try {
    const pt = decryptDmContent(key, conversationId, epoch, decoded.content, decoded.nonce);
    return { kind: 'text', text: pt.text };
  } catch (e) {
    e2elog('decrypt: AEAD failed', { author: keyAuthor, epoch, err: (e as Error)?.message });
    return { kind: 'error' };
  }
}

/**
 * One-shot E2E self-check for support/debugging. Prints a clear verdict instead
 * of guessing from node dumps. Run in the browser console:
 *   await window.__ogmaraE2E()                  // my binding only
 *   await window.__ogmaraE2E('klv1…peer')       // + this conversation
 * Reads/derives public material only — no secrets are printed.
 */
export async function e2eSelfCheck(peer?: string): Promise<Record<string, unknown>> {
  const report: Record<string, unknown> = {};
  const ctx = await deviceCtx();
  if (!ctx) {
    report.error = 'device not ready (no signer/wallet/device_id) — not logged in?';
    // eslint-disable-next-line no-console
    console.warn('[e2e] self-check:', report);
    return report;
  }
  const localEncPub = encPublicKeyHex(ctx.encPriv);
  report.wallet = ctx.wallet;
  report.deviceId = ctx.deviceId;
  report.localEncPub = localEncPub;

  // My binding in the registry.
  try {
    const { keys } = await getClient().getEncKeys(ctx.wallet);
    const mine = keys.find((k) => (k.device_id ?? '').toLowerCase() === ctx.deviceId.toLowerCase());
    report.registryEntries = keys.map((k) => ({
      device_id: k.device_id, enc_pub: k.enc_pub,
      thisDevice: (k.device_id ?? '').toLowerCase() === ctx.deviceId.toLowerCase(),
    }));
    report.bindingVerdict = !mine
      ? '❌ MY device_id is NOT in the registry — binding never landed (peers can\'t wrap to me)'
      : (mine.enc_pub ?? '').toLowerCase() === localEncPub.toLowerCase()
        ? '✓ binding OK (registry enc_pub matches local)'
        : `❌ DIVERGENCE: registry enc_pub=${mine.enc_pub} ≠ local=${localEncPub} → "can't decrypt"; re-login to self-heal`;
  } catch (e) {
    report.bindingVerdict = `⚠️ couldn't read registry: ${(e as Error)?.message}`;
  }

  if (peer) {
    const conversationId = computeConversationId(ctx.wallet, peer);
    const convIdHex = toHex(conversationId);
    report.peer = peer;
    report.conversationId = convIdHex;
    try {
      const { keys } = await getClient().getEncKeys(peer);
      report.peerDevices = keys.map((k) => `${k.device_id}/${k.enc_pub}`);
    } catch (e) {
      report.peerDevices = `⚠️ ${(e as Error)?.message}`;
    }
    // Can I fetch+unwrap MY own sending key? And the PEER's (to read their msgs)?
    const mineFetch = await fetchConvKey(ctx, conversationId, convIdHex, ctx.wallet);
    const peerFetch = await fetchConvKey(ctx, conversationId, convIdHex, peer);
    const verdict = (r: typeof mineFetch) =>
      r === 'missing' ? '❌ MISSING (no envelope for my device → "waiting for key")'
        : r === 'corrupt' ? '❌ CORRUPT (envelope found but unwrap failed → "can\'t decrypt")'
          : `✓ OK (epoch ${r.epoch})`;
    report.myKey = verdict(mineFetch);
    report.peerKey = verdict(peerFetch);

    // Probe the ACTUAL stored messages: payload shape + decode + decrypt outcome.
    // Catches failures BEFORE any key fetch (msgpack/shape) — which is why
    // "can't decrypt" can appear with no [e2e] crypto logs.
    try {
      const resp = await getClient().getDmMessages(peer);
      const msgs = ((resp as { messages?: unknown[] }).messages || []).slice(-3);
      report.recentMessages = [];
      for (const m of msgs as Array<{ payload: unknown; author?: string }>) {
        const entry: Record<string, unknown> = {
          author: m.author,
          payloadType: Array.isArray(m.payload) ? 'array' : typeof m.payload,
        };
        const bytes = toBytes(m.payload as never);
        if (!bytes) {
          entry.decode = '❌ toBytes failed';
        } else {
          entry.byteLen = bytes.length;
          try {
            const d = decode(bytes) as RawDmPayload;
            entry.keyEpoch = d.key_epoch ?? null;
            entry.contentType = d.content instanceof Uint8Array ? 'bytes' : typeof d.content;
            entry.hasNonce = d.nonce instanceof Uint8Array;
            entry.hasConvId = d.conversation_id instanceof Uint8Array;
          } catch (e) {
            entry.decode = `❌ decode error: ${(e as Error)?.message}`;
          }
        }
        entry.decryptResult = (await decryptDmMessage(m.payload as never, m.author)).kind;
        (report.recentMessages as unknown[]).push(entry);
      }
    } catch (e) {
      report.recentMessages = `⚠️ ${(e as Error)?.message}`;
    }
  }

  // eslint-disable-next-line no-console
  console.info('[e2e] self-check', report);
  return report;
}

if (typeof window !== 'undefined') {
  const w = window as unknown as {
    __ogmaraE2E?: typeof e2eSelfCheck;
    __ogmaraE2EReKey?: typeof reKeyConversation;
  };
  w.__ogmaraE2E = e2eSelfCheck;
  w.__ogmaraE2EReKey = reKeyConversation; // __ogmaraE2EReKey('<peer>') — clean epoch bump
}

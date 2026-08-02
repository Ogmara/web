/**
 * Encrypted media (P5, spec 04 §9) — web client wiring.
 *
 * In an encrypted context (any DM, a private channel, or a public *encrypted*
 * channel) file BYTES must never reach IPFS in the clear. The flow is:
 *
 *   pick → encryptFile(bytes) → uploadMedia(cipher, { encrypted: true })
 *        → MediaDescriptor { cid, key, nonce, mime, name, size }
 *
 * The descriptor (per-file key + real mime/filename) rides INSIDE the message's
 * encrypted content via the `media` param on the encrypted builders; only a
 * stripped `{ cid, size, mime: application/octet-stream }` attachment reaches the
 * wire. On render we do the inverse: fetch the opaque ciphertext, `decryptMedia`,
 * and hand the plaintext back as a `blob:` object URL.
 *
 * Object-URL lifecycle: decrypted blobs are cached by CID so re-renders don't
 * refetch/redecrypt, and the cache is revoked on logout / view teardown to avoid
 * leaking memory. Composer-preview URLs (local, of the ORIGINAL file) are owned by
 * the composer and revoked there.
 */
import { encryptFile, decryptMedia, type MediaDescriptor } from '@ogmara/sdk';
import { getClient } from './api';

/**
 * Encrypt a picked file and upload the ciphertext as an opaque blob. Returns the
 * {@link MediaDescriptor} to seal inside the message content. The plaintext bytes
 * never leave the device unencrypted.
 */
export async function uploadEncryptedFile(file: File): Promise<MediaDescriptor> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { cipher, key, nonce } = encryptFile(bytes);
  const result = await getClient().uploadMedia(new Blob([cipher as BlobPart]), undefined, { encrypted: true });
  return {
    cid: result.cid,
    size: bytes.length,
    mime: file.type || 'application/octet-stream',
    name: file.name,
    key,
    nonce,
  };
}

// --- decrypted-media object-URL cache --------------------------------------
// Keyed by CID **plus a key/nonce fingerprint**, NOT by CID alone: a CID is an
// attacker-chooseable, content-addressed pointer, so two messages can reference
// the same CID with different descriptor keys. Keying by CID alone would let a
// message in one context surface another context's already-decrypted plaintext
// (a confused-deputy / display-integrity bug). The fingerprint binds the cached
// blob to the exact (key, nonce) that produced it. Bounded LRU so a long session
// can't accumulate unbounded plaintext blobs (audit P5 WARNING-1/2).
const MAX_MEDIA_CACHE = 64;
const urlCache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

function bytesToHex(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s;
}

/** Cache key: `cid:keyHex:nonceHex` — distinct keys for one CID never collide. */
function cacheKey(m: MediaDescriptor): string {
  return `${m.cid}:${bytesToHex(m.key)}:${bytesToHex(m.nonce)}`;
}

/** Evict the least-recently-used entries (Map keeps insertion order). */
function evictIfNeeded(): void {
  while (urlCache.size > MAX_MEDIA_CACHE) {
    const oldest = urlCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    const url = urlCache.get(oldest);
    if (url) URL.revokeObjectURL(url);
    urlCache.delete(oldest);
  }
}

// A freshly-uploaded cross-node CID can 404 for a few seconds while it
// propagates over IPFS bitswap to the node the receiving client is talking to.
// Retry a 404/network error on a flat poll (mirrors the channel-key-arrival
// poll in ChatView) instead of failing permanently on the first attempt.
//
// Budget sized against the NODE's own worst case, not just typical bitswap
// latency: l2-node's cross-node media fallback (spec 03-l2-node §3.3.1) dials
// up to `peer_fallback_fanout` (default 3) candidates at 5s connect / 30s
// total each — up to ~90s server-side before it even reports a miss. A 45s
// client budget (2026-08) could give up before the node's own fallback had a
// realistic chance to land, forcing a manual reload/remount to try again
// (was reported live: an image failed here, then decoded fine after
// switching channels and back — same CID, same key, just needed more time).
const MEDIA_FETCH_RETRY_MS = 5000;
const MEDIA_FETCH_MAX_WAIT_MS = 180000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fetch the ciphertext for `cid`, retrying a 404 or network error until it
 *  resolves or `MEDIA_FETCH_MAX_WAIT_MS` elapses. Other error statuses fail
 *  immediately (not transient). */
async function fetchCipherWithRetry(cid: string): Promise<Uint8Array> {
  const start = Date.now();
  for (;;) {
    let resp: Response;
    try {
      resp = await fetch(getClient().getMediaUrl(cid));
    } catch (err) {
      if (Date.now() - start >= MEDIA_FETCH_MAX_WAIT_MS) throw err;
      await sleep(MEDIA_FETCH_RETRY_MS);
      continue;
    }
    if (resp.ok) return new Uint8Array(await resp.arrayBuffer());
    if (resp.status !== 404 || Date.now() - start >= MEDIA_FETCH_MAX_WAIT_MS) {
      throw new Error(`media fetch ${resp.status}`);
    }
    await sleep(MEDIA_FETCH_RETRY_MS);
  }
}

/**
 * Fetch + decrypt an encrypted-media descriptor and return a `blob:` object URL
 * for the PLAINTEXT (typed with the real mime so `<img>`/`<video>` render it).
 * Cached by CID + key fingerprint; concurrent calls for the same descriptor share
 * one fetch/decrypt. A 404/network error is retried for up to
 * `MEDIA_FETCH_MAX_WAIT_MS` (the caller's existing "decrypting…" placeholder
 * covers the wait); throws on final failure so callers can show the
 * locked-attachment fallback.
 */
export async function decryptedMediaUrl(m: MediaDescriptor): Promise<string> {
  const ck = cacheKey(m);
  const cached = urlCache.get(ck);
  if (cached) {
    // Mark as recently used (re-insert to move to the end of the LRU order).
    urlCache.delete(ck);
    urlCache.set(ck, cached);
    return cached;
  }
  const existing = inflight.get(ck);
  if (existing) return existing;

  const p = (async () => {
    const cipher = await fetchCipherWithRetry(m.cid);
    const plain = decryptMedia(cipher, m.key, m.nonce);
    const url = URL.createObjectURL(new Blob([plain as BlobPart], { type: m.mime || 'application/octet-stream' }));
    urlCache.set(ck, url);
    evictIfNeeded();
    return url;
  })().finally(() => inflight.delete(ck));

  inflight.set(ck, p);
  return p;
}

/** Revoke + drop every cached object URL for a CID (any key fingerprint). */
export function revokeMediaUrl(cid: string): void {
  for (const ck of [...urlCache.keys()]) {
    if (ck === cid || ck.startsWith(`${cid}:`)) {
      const url = urlCache.get(ck);
      if (url) URL.revokeObjectURL(url);
      urlCache.delete(ck);
    }
  }
}

/** Revoke ALL cached decrypted-media object URLs (logout / wallet switch). */
export function clearMediaUrlCache(): void {
  for (const url of urlCache.values()) URL.revokeObjectURL(url);
  urlCache.clear();
}

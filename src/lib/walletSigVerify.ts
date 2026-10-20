/**
 * Verify that a wallet `signMessage` return really was produced by the wallet
 * the app believes is active, before anything is derived from it.
 *
 * Why (web 0.84.0, key-vault C1): the key-vault backup key is
 * `HKDF(signMessage("ogmara-keyvault-v1"))`. The Klever Extension / K5 sign
 * with whatever account is active INSIDE the wallet, which can differ from the
 * account the app restored from settings (the user switched accounts in the
 * extension, then reloaded). The derived key was still tagged with the app's
 * wallet, so a restore with the wrong key failed, was treated as terminal, and
 * the next backup sealed the keyring under the OTHER account's key into this
 * account's vault — unreadable on every other device.
 *
 * An Ed25519 signature cannot say which account produced it; it can only be
 * checked against an expected public key. So this proves "signed by
 * `expectedAddress`" or reports a mismatch — never "signed by X".
 *
 * Pure: every primitive is injected, so it runs under `node --test` with the
 * real @noble libraries (walletSigVerify.test.ts).
 */

/** Primitives the check needs (keyVault.ts binds the real ones). */
export interface WalletSigCrypto {
  /** Keccak-256 (NOT SHA3-256). */
  keccak256(data: Uint8Array): Uint8Array;
  /** Ed25519 verify of `sig` over `msg` under `pub`. May throw on bad input. */
  ed25519Verify(sig: Uint8Array, msg: Uint8Array, pub: Uint8Array): Promise<boolean>;
  /** bech32 `klv1…` -> 32-byte Ed25519 public key; throws on a bad address. */
  addressToPubkey(address: string): Uint8Array;
  /** Wallet return (hex / base64-of-hex / base64(raw) / raw bytes) -> 64 bytes; throws if uninterpretable. */
  normalize(raw: string | Uint8Array): Uint8Array;
}

/** Result of {@link verifyWalletSig}. `sig` is the canonical 64-byte signature. */
export type WalletSigCheck =
  | { ok: true; sig: Uint8Array }
  | { ok: false; reason: 'mismatch' | 'malformed' | 'bad-address' };

const PREFIX = new TextEncoder().encode('Klever Signed Message:\n');

/**
 * The exact bytes a Klever wallet hashes for `signMessage(message)`:
 * `0x17 || "Klever Signed Message:\n" || ascii(byteLength(message)) || message`.
 *
 * The length is the UTF-8 BYTE length, not the JS string length (they differ
 * for any non-ASCII message). Matches the SDK's `WalletSigner.signKleverMessage`
 * and kos-rs.
 */
export function kleverSignedBytes(message: string | Uint8Array): Uint8Array {
  const msg = typeof message === 'string' ? new TextEncoder().encode(message) : message;
  const len = new TextEncoder().encode(String(msg.length));
  const out = new Uint8Array(1 + PREFIX.length + len.length + msg.length);
  out[0] = 0x17;
  out.set(PREFIX, 1);
  out.set(len, 1 + PREFIX.length);
  out.set(msg, 1 + PREFIX.length + len.length);
  return out;
}

/**
 * Check that `raw` (a wallet `signMessage(message)` return in any of the four
 * known encodings) is a valid signature by `expectedAddress`.
 *
 * - `malformed`   — the return can't be interpreted as a 64-byte signature
 * - `bad-address` — `expectedAddress` is not a valid bech32 address
 * - `mismatch`    — well-formed, but not a signature by `expectedAddress` over
 *                   `message` (another account signed, or it was altered)
 */
export async function verifyWalletSig(
  c: WalletSigCrypto,
  expectedAddress: string,
  message: string | Uint8Array,
  raw: string | Uint8Array,
): Promise<WalletSigCheck> {
  let sig: Uint8Array;
  try {
    sig = c.normalize(raw);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (sig.length !== 64) return { ok: false, reason: 'malformed' };
  // Own copy: the caller derives from it, and a Uint8Array input is returned
  // by reference by the normalizer.
  sig = Uint8Array.from(sig);
  let pub: Uint8Array;
  try {
    pub = c.addressToPubkey(expectedAddress);
  } catch {
    return { ok: false, reason: 'bad-address' };
  }
  let valid = false;
  try {
    valid = await c.ed25519Verify(sig, c.keccak256(kleverSignedBytes(message)), pub);
  } catch {
    valid = false;
  }
  return valid ? { ok: true, sig } : { ok: false, reason: 'mismatch' };
}

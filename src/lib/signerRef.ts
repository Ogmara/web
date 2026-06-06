import type { WalletSigner } from '@ogmara/sdk';

/**
 * The currently-active L2 signer — either a built-in wallet key or the
 * extension/K5 DEVICE key, depending on the connected wallet source.
 *
 * Kept in a tiny standalone module so non-auth modules (`api.ts`, `ws`, the
 * boot path in `index.tsx`) can read the active signer WITHOUT importing
 * `auth.ts` — which imports `api.ts` and would create an import cycle.
 * `auth.ts` is the sole writer, via `setActiveSigner()` (called wherever it
 * attaches a signer to the client, and cleared on disconnect).
 */
let active: WalletSigner | null = null;

export function setActiveSigner(s: WalletSigner | null): void {
  active = s;
}

export function getActiveSigner(): WalletSigner | null {
  return active;
}

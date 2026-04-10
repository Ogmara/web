/**
 * Klever Extension bridge — detection, connection, and smart contract
 * transaction building for on-chain operations.
 *
 * Supports both Klever Browser Extension (desktop) and handles
 * the TypeScript interface for window.klever injection.
 *
 * On-chain operations: user registration, channel creation, tipping,
 * device delegation, governance voting.
 */

import { createSignal } from 'solid-js';

// --- TypeScript declarations for Klever Extension ---

interface KleverProvider {
  api: string;
  node: string;
}

interface KleverWeb {
  /** Get the connected wallet address. */
  getWalletAddress(): Promise<string>;
  /** Sign a Klever transaction object. */
  signTransaction(tx: unknown): Promise<unknown>;
  /** Broadcast signed transactions to the network. */
  broadcastTransactions(txs: unknown[]): Promise<{ data?: { txsHashes?: string[] } }>;
  /** Broadcast a single signed transaction (older extension versions). */
  broadcastTransaction?(tx: unknown): Promise<{ txHash: string }>;
  /** Build a transaction from contract specs. */
  buildTransaction(contracts: unknown[], txData?: unknown[]): Promise<unknown>;
  /** Sign an arbitrary message. */
  signMessage(message: string): Promise<string>;
  /** Initialize the extension. */
  initialize(): Promise<void>;
  /** Network provider (must be set before initialize). */
  provider?: KleverProvider;
}

/** Klever wallet provider (injected by extension and K5 browser). */
interface KleverWallet {
  /** Sign an arbitrary message. Returns hex-encoded signature. */
  signMessage(message: string): Promise<string>;
  /** Validate a signed message. */
  validateSignature?(message: string, signature: string, address: string): Promise<boolean>;
}

declare global {
  interface Window {
    kleverWeb?: KleverWeb;
    klever?: KleverWallet;
  }
}

/**
 * Klever network provider URLs.
 * Set from L2 node stats (testnet or mainnet). Defaults to mainnet.
 */
let kleverProvider: KleverProvider = {
  api: 'https://api.klever.org',
  node: 'https://node.klever.org',
};
let currentNetwork = 'mainnet';

/** Get the Kleverscan explorer base URL for the current network. */
export function getExplorerUrl(): string {
  return currentNetwork === 'testnet'
    ? 'https://testnet.kleverscan.org'
    : 'https://kleverscan.org';
}

/**
 * Resolves once the network has been detected from the L2 node's
 * networkStats() at startup. Anything that needs the correct provider
 * URLs (e.g. connectExtension) should `await networkReady`.
 */
let resolveNetworkReady!: () => void;
export const networkReady: Promise<void> = new Promise((resolve) => {
  resolveNetworkReady = resolve;
});

/** Set the Klever network provider URLs (called after fetching node stats). */
export function setKleverNetwork(network: string): void {
  currentNetwork = network;
  if (network === 'testnet') {
    kleverProvider = {
      api: 'https://api.testnet.klever.org',
      node: 'https://node.testnet.klever.org',
    };
  } else {
    kleverProvider = {
      api: 'https://api.klever.org',
      node: 'https://node.klever.org',
    };
  }
  resolveNetworkReady();
}

// --- Signals ---

const [kleverAvailable, setKleverAvailable] = createSignal(false);
const [kleverAddress, setKleverAddress] = createSignal<string | null>(null);
const [kleverConnecting, setKleverConnecting] = createSignal(false);

export { kleverAvailable, kleverAddress, kleverConnecting };

// --- Detection ---

/** Detect the Klever Extension or K5 wallet browser. Polls for up to 3 seconds. */
export function detectKleverExtension(): void {
  if (window.kleverWeb || window.klever) {
    setKleverAvailable(true);
    return;
  }
  // Extension may inject after DOMContentLoaded — poll briefly
  let attempts = 0;
  const interval = setInterval(() => {
    if (window.kleverWeb || window.klever) {
      setKleverAvailable(true);
      clearInterval(interval);
    } else if (++attempts >= 6) {
      clearInterval(interval);
    }
  }, 500);
}

// --- Connection ---

/** Connect to the Klever Extension. Returns the wallet address. */
export async function connectExtension(): Promise<string> {
  if (!window.kleverWeb) {
    throw new Error('Klever Extension not available');
  }
  setKleverConnecting(true);
  try {
    // Wait for the L2 node's network detection to complete before talking to
    // the extension. Otherwise we race against the startup networkStats()
    // call and may initialize the extension with mainnet provider URLs while
    // the L2 node is on testnet — the resulting wallet signatures are then
    // rejected by the L2 node and device registration fails with 500.
    await Promise.race([
      networkReady,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Network detection timed out — L2 node may be unreachable')), 10_000),
      ),
    ]);
    window.kleverWeb.provider = kleverProvider;
    await window.kleverWeb.initialize();
    const address = await window.kleverWeb.getWalletAddress();
    setKleverAddress(address);
    return address;
  } finally {
    setKleverConnecting(false);
  }
}

/** Disconnect from the Klever Extension. */
export function disconnectExtension(): void {
  setKleverAddress(null);
}

// --- Smart Contract Transactions ---

/**
 * Ogmara KApp smart contract address.
 * Fetched from L2 node stats, falls back to env var.
 */
let scAddress = (import.meta as any).env?.VITE_OGMARA_CONTRACT_ADDRESS || '';

/** Set the smart contract address (called after fetching node stats). */
export function setContractAddress(address: string): void {
  if (address) scAddress = address;
}

/** Broadcast a signed TX — handles both extension API versions. */
async function broadcast(signedTx: unknown): Promise<string> {
  const kw = window.kleverWeb!;
  if (kw.broadcastTransactions) {
    const result = await kw.broadcastTransactions([signedTx]);
    return result?.data?.txsHashes?.[0] ?? '';
  }
  if (kw.broadcastTransaction) {
    const result = await kw.broadcastTransaction(signedTx);
    return result.txHash;
  }
  throw new Error('No broadcast method available on Klever Extension');
}

interface ScInvokeParams {
  functionName: string;
  args: string[];
  /** KLV amount to send in atomic units (1 KLV = 1_000_000). */
  value?: number;
}

/**
 * Build, sign, and broadcast a smart contract invocation via Klever Extension.
 * Returns the transaction hash.
 */
async function invokeContract(params: ScInvokeParams): Promise<string> {
  if (!window.kleverWeb) {
    throw new Error('Klever Extension not available');
  }
  if (!scAddress) {
    throw new Error('Smart contract address not configured');
  }
  // Set network provider and initialize before building TXs
  window.kleverWeb.provider = kleverProvider;
  await window.kleverWeb.initialize();

  // Encode function call: "functionName@hexArg1@hexArg2..." then base64
  const callData = [params.functionName, ...params.args].join('@');

  const payload: Record<string, unknown> = {
    scType: 0, // InvokeContract
    address: scAddress,
    callValue: params.value ? { KLV: params.value.toString() } : {},
  };

  try {
    const unsignedTx = await window.kleverWeb.buildTransaction([{
      type: 63, // SmartContract
      payload,
    }], [btoa(callData)]);
    const signedTx = await window.kleverWeb.signTransaction(unsignedTx);
    return await broadcast(signedTx);
  } catch (err: any) {
    const detail = err?.data?.error || err?.message || String(err);
    console.error('[Klever SC]', { scAddress, callData, payload, error: detail });
    throw new Error(detail);
  }
}

/** Decode a bech32 address (klv1... or ogd1...) to its 32-byte public key as hex. */
export function addressToPubkeyHex(address: string): string {
  // bech32 addresses: HRP prefix + '1' separator + data + 6-char checksum
  // Accepts both klv1... (wallet) and ogd1... (device) addresses
  const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  const hrpEnd = address.lastIndexOf('1');
  const dataPart = address.slice(hrpEnd + 1, -6); // exclude 6-char checksum
  const values: number[] = [];
  for (const c of dataPart) {
    const v = CHARSET.indexOf(c);
    if (v === -1) throw new Error('Invalid bech32 character');
    values.push(v);
  }
  // Convert 5-bit values to 8-bit bytes
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const v of values) {
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 0xff);
    }
  }
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function stringToHex(str: string): string {
  return Array.from(new TextEncoder().encode(str))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function numberToHex(n: number): string {
  if (n === 0) return '00';
  const hex = n.toString(16);
  return hex.length % 2 === 0 ? hex : '0' + hex;
}

// --- On-Chain Operations ---

/**
 * Register user on the Ogmara smart contract.
 * Cost: ~4.4 KLV (registration fee ~2 KLV + bandwidth).
 * @param publicKeyHex - 64-char hex Ed25519 public key
 */
export async function registerUser(publicKeyHex: string): Promise<string> {
  // The SC expects a ManagedBuffer containing the 64-char hex string.
  // The VM's @ encoding decodes hex to raw bytes, so we hex-encode the
  // ASCII string so it arrives as 64 bytes (the hex chars themselves).
  return invokeContract({
    functionName: 'register',
    args: [stringToHex(publicKeyHex)],
  });
}

/**
 * Create a channel on the Ogmara smart contract.
 * Cost: ~4.8 KLV.
 * @param slug - Channel slug (lowercase alphanumeric + hyphens)
 * @param channelType - 0 = Public, 1 = ReadPublic
 */
export async function createChannelOnChain(slug: string, channelType: number): Promise<string> {
  return invokeContract({
    functionName: 'createChannel',
    args: [stringToHex(slug), numberToHex(channelType)],
  });
}

/**
 * Wait for a createChannel TX to confirm, then query the SC view function
 * `getChannelBySlug` to retrieve the assigned channel_id.
 *
 * Klever SC events are not easily accessible from the API, so we poll
 * the TX status and then query the SC storage directly.
 */
export async function getChannelIdFromTx(txHash: string, slug: string): Promise<number> {
  const apiBase = kleverProvider.api;
  const nodeBase = kleverProvider.node;
  const maxAttempts = 20;
  const delay = 2000;

  // Step 1: Wait for TX to succeed
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const resp = await fetch(`${apiBase}/v1.0/transaction/${txHash}`);
      if (!resp.ok) { await sleep(delay); continue; }
      const data = await resp.json();
      const tx = data?.data?.transaction;

      if (!tx || !tx.status) { await sleep(delay); continue; }
      if (tx.status === 'fail') {
        throw new Error(tx.resultCode || 'Transaction failed');
      }
      if (tx.status === 'success') break;
      await sleep(delay);
    } catch (e: any) {
      if (e.message?.includes('failed')) throw e;
      await sleep(delay);
    }
  }

  // Step 2: Query SC view function to get channel_id by slug
  const slugHex = Array.from(new TextEncoder().encode(slug))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  const vmResp = await fetch(`${nodeBase}/vm/hex`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      scAddress: scAddress,
      funcName: 'getChannelBySlug',
      args: [slugHex],
    }),
  });

  if (!vmResp.ok) {
    throw new Error('Failed to query SC for channel ID');
  }

  const vmData = await vmResp.json();
  const hexResult = vmData?.data?.data;

  if (!hexResult) {
    throw new Error('Channel not found in SC after creation');
  }

  // Result is a hex-encoded integer (e.g., "03" = 3)
  return parseInt(hexResult, 16);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Send a KLV tip as a direct transfer to the recipient.
 * Uses type 0 (Transfer) — no smart contract needed.
 * When the SC is deployed, this can be upgraded to an SC call for on-chain attribution.
 * @param recipient - klv1... address of the recipient
 * @param _msgIdHex - unused for now (will be used for SC-based tip attribution)
 * @param _channelId - unused for now
 * @param note - Optional note (encoded as memo)
 * @param amountKlv - Tip amount in KLV
 */
export async function sendTip(
  recipient: string,
  _msgIdHex: string,
  _channelId: number,
  note: string,
  amountKlv: number,
): Promise<string> {
  if (!window.kleverWeb) {
    throw new Error('Klever Extension not available');
  }
  window.kleverWeb.provider = kleverProvider;
  await window.kleverWeb.initialize();

  const amountAtomic = Math.floor(amountKlv * 1_000_000); // KLV has 6 decimal places

  // Build a direct KLV transfer (type 0)
  const txData = note ? [btoa(note.slice(0, 128))] : undefined;
  try {
    const unsignedTx = await window.kleverWeb.buildTransaction([{
      type: 0, // Transfer
      payload: {
        receiver: recipient,
        amount: amountAtomic,
        kda: 'KLV',
      },
    }], txData);
    const signedTx = await window.kleverWeb.signTransaction(unsignedTx);
    return await broadcast(signedTx);
  } catch (err: any) {
    const detail = err?.data?.error || err?.message || String(err);
    console.error('[Klever Tip]', { recipient, amountAtomic, error: detail });
    throw new Error(detail);
  }
}

/**
 * Delegate a device key for signing on behalf of the user.
 * Cost: ~4.5 KLV.
 * @param devicePubKeyHex - 64-char hex Ed25519 public key of the device
 * @param permissions - Bitmask: 0x01=messages, 0x02=channels, 0x04=profile
 * @param expiresAt - Unix timestamp (0 = permanent)
 */
export async function delegateDevice(
  devicePubKeyHex: string,
  permissions: number,
  expiresAt: number,
): Promise<string> {
  return invokeContract({
    functionName: 'delegateDevice',
    args: [devicePubKeyHex, numberToHex(permissions), numberToHex(expiresAt)],
  });
}

/**
 * Revoke a device delegation.
 * @param devicePubKeyHex - 64-char hex Ed25519 public key to revoke
 */
export async function revokeDevice(devicePubKeyHex: string): Promise<string> {
  return invokeContract({
    functionName: 'revokeDevice',
    args: [devicePubKeyHex],
  });
}

/**
 * Vote on a governance proposal.
 * @param proposalId - Proposal ID
 * @param support - true = vote for, false = vote against
 */
export async function voteOnProposal(proposalId: number, support: boolean): Promise<string> {
  return invokeContract({
    functionName: 'vote',
    args: [numberToHex(proposalId), support ? '01' : '00'],
  });
}

/**
 * Update the user's public key on-chain (key rotation).
 * @param newPublicKeyHex - 64-char hex of the new public key
 */
export async function updatePublicKey(newPublicKeyHex: string): Promise<string> {
  return invokeContract({
    functionName: 'updatePublicKey',
    args: [newPublicKeyHex],
  });
}

/**
 * Sign an arbitrary message via the Klever Extension.
 * Used for verifying ownership of the extension wallet.
 */
export async function signMessage(message: string): Promise<string> {
  // Try window.klever first (wallet provider API — works in K5 mobile browser)
  if (window.klever?.signMessage) {
    return window.klever.signMessage(message);
  }
  // Fall back to window.kleverWeb (desktop extension may expose it here)
  if (window.kleverWeb?.signMessage) {
    return window.kleverWeb.signMessage(message);
  }
  throw new Error('Klever signMessage not available');
}

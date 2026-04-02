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

declare global {
  interface Window {
    kleverWeb?: KleverWeb;
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
}

// --- Signals ---

const [kleverAvailable, setKleverAvailable] = createSignal(false);
const [kleverAddress, setKleverAddress] = createSignal<string | null>(null);
const [kleverConnecting, setKleverConnecting] = createSignal(false);

export { kleverAvailable, kleverAddress, kleverConnecting };

// --- Detection ---

/** Detect the Klever Extension. Polls for up to 3 seconds after page load. */
export function detectKleverExtension(): void {
  if (window.kleverWeb) {
    setKleverAvailable(true);
    return;
  }
  // Extension may inject after DOMContentLoaded — poll briefly
  let attempts = 0;
  const interval = setInterval(() => {
    if (window.kleverWeb) {
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
    // Set network provider before initializing (testnet or mainnet)
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

/** Decode a klv1... bech32 address to its 32-byte public key as hex. */
export function addressToPubkeyHex(address: string): string {
  // Klever bech32 addresses: "klv" prefix + 1 separator + data
  // bech32 data is 5-bit groups → convert to 8-bit bytes
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
 * Poll Klever API for a transaction result and extract the channel_id
 * from the channelCreated event.
 *
 * Klever API returns events in `receipts` array. The channelCreated event
 * has the channel_id as the first indexed topic (u64).
 */
export async function getChannelIdFromTx(txHash: string): Promise<number> {
  const apiBase = kleverProvider.api;
  const maxAttempts = 15;
  const delay = 2000;

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const resp = await fetch(`${apiBase}/v1.0/transaction/${txHash}`);
      if (!resp.ok) { await sleep(delay); continue; }
      const data = await resp.json();
      const tx = data?.data?.transaction;

      // Check if TX is processed
      if (!tx || tx.status !== 'success') {
        if (tx?.status === 'fail') {
          throw new Error(tx.resultMessage || 'Transaction failed');
        }
        await sleep(delay);
        continue;
      }

      // Find channelCreated event in receipts
      const receipts = tx.receipts || [];
      for (const receipt of receipts) {
        if (receipt.type === 'channelCreated' || receipt.typeStr === 'channelCreated') {
          // channel_id is in the first indexed topic
          const channelId = receipt.topics?.[0];
          if (channelId !== undefined) {
            return typeof channelId === 'number' ? channelId : parseInt(channelId, 10);
          }
        }
      }

      // Fallback: check contract output for SC events
      const events = tx.contract?.[0]?.parameter?.events || tx.events || [];
      for (const event of events) {
        if (event.identifier === 'channelCreated') {
          const topics = event.topics || [];
          if (topics.length > 0) {
            // Topics are base64-encoded, first is channel_id (u64 big-endian)
            const bytes = Uint8Array.from(atob(topics[0]), c => c.charCodeAt(0));
            const view = new DataView(bytes.buffer);
            return bytes.length === 8
              ? Number(view.getBigUint64(0))
              : parseInt(topics[0], 10);
          }
        }
      }

      // TX succeeded but no event found — the SC may encode differently
      throw new Error('channelCreated event not found in transaction');
    } catch (e: any) {
      if (e.message?.includes('event not found') || e.message?.includes('failed')) throw e;
      await sleep(delay);
    }
  }
  throw new Error('Timeout waiting for transaction confirmation');
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
  if (!window.kleverWeb) {
    throw new Error('Klever Extension not available');
  }
  return window.kleverWeb.signMessage(message);
}

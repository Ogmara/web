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
  /** Broadcast a signed transaction to the network. */
  broadcastTransaction(tx: unknown): Promise<{ txHash: string }>;
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

/** Set the Klever network provider URLs (called after fetching node stats). */
export function setKleverNetwork(network: string): void {
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

  // Encode function call: "functionName@hexArg1@hexArg2..."
  const data = [params.functionName, ...params.args].join('@');

  const payload: Record<string, unknown> = {
    address: scAddress,
    scType: 0, // InvokeContract
    data: [data],
  };
  if (params.value) {
    payload.callValue = { KLV: params.value.toString() };
  }

  const unsignedTx = await window.kleverWeb.buildTransaction([{
    type: 63, // SmartContract
    payload,
  }]);
  const signedTx = await window.kleverWeb.signTransaction(unsignedTx);
  const result = await window.kleverWeb.broadcastTransaction(signedTx);
  return result.txHash;
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
  return invokeContract({
    functionName: 'register',
    args: [publicKeyHex],
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
 * Send a KLV tip to a message author.
 * Cost: ~3.5 KLV + tip amount.
 * @param recipient - klv1... address of the recipient
 * @param msgIdHex - 64-char hex message ID
 * @param channelId - Channel ID (0 for news posts)
 * @param note - Optional note (max 128 bytes)
 * @param amountKlv - Tip amount in KLV (will be converted to atomic units)
 */
export async function sendTip(
  recipient: string,
  msgIdHex: string,
  channelId: number,
  note: string,
  amountKlv: number,
): Promise<string> {
  const amountAtomic = Math.floor(amountKlv * 1_000_000); // KLV has 6 decimal places
  return invokeContract({
    functionName: 'tip',
    args: [
      // Recipient is a klv1... bech32 address — hex-encode the string for SC input
      stringToHex(recipient),
      msgIdHex, // Already hex
      numberToHex(channelId),
      stringToHex(note.slice(0, 128)),
    ],
    value: amountAtomic,
  });
  // Note: The SC decodes the recipient from the hex-encoded bech32 string.
  // If the SC expects raw public key bytes instead, this needs to be changed
  // to bech32-decode the address and pass the raw 32-byte pubkey hex.
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

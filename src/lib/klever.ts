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
import { getSetting, setSetting } from './settings';
import { getClient } from './api';
import { vaultGetSigner } from './vault';

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
// Initialize from the last-known network (persisted) so cold-load SC node
// discovery targets the right registry BEFORE we've reached any node to read
// its networkStats. Defaults to mainnet (the production registry).
let currentNetwork = getSetting('kleverNetwork') === 'testnet' ? 'testnet' : 'mainnet';
let kleverProvider: KleverProvider = currentNetwork === 'testnet'
  ? { api: 'https://api.testnet.klever.org', node: 'https://node.testnet.klever.org' }
  : { api: 'https://api.mainnet.klever.org', node: 'https://node.mainnet.klever.org' };

/**
 * Resolves once the network has been detected from the L2 node's
 * networkStats() at startup. Anything that needs the correct provider
 * URLs (e.g. connectExtension) should `await networkReady`.
 */
let resolveNetworkReady!: () => void;
export const networkReady: Promise<void> = new Promise((resolve) => {
  resolveNetworkReady = resolve;
});

/** Resolve networkReady with mainnet defaults when the L2 node is unreachable. */
export function resolveNetworkReadyFallback(): void {
  resolveNetworkReady();
}

/** Set the Klever network provider URLs (called after fetching node stats). */
export function setKleverNetwork(network: string): void {
  currentNetwork = network;
  // Persist so the NEXT cold load's SC node discovery targets this network
  // before any node has been reached.
  setSetting('kleverNetwork', network === 'testnet' ? 'testnet' : 'mainnet');
  if (network === 'testnet') {
    kleverProvider = {
      api: 'https://api.testnet.klever.org',
      node: 'https://node.testnet.klever.org',
    };
  } else {
    kleverProvider = {
      api: 'https://api.mainnet.klever.org',
      node: 'https://node.mainnet.klever.org',
    };
  }
  // Re-pin the contract for the new network. This runs AFTER
  // `setContractAddress` at startup (index.tsx sets the address first, then
  // the network), so without it the client would hold the pin for whatever
  // network it defaulted to rather than the one the node is actually on.
  repinContractForNetwork();
  resolveNetworkReady();
}

// --- Signals ---

const [kleverAvailable, setKleverAvailable] = createSignal(false);
const [kleverAddress, setKleverAddress] = createSignal<string | null>(null);
const [kleverConnecting, setKleverConnecting] = createSignal(false);

export { kleverAvailable, kleverAddress, kleverConnecting };

/**
 * Set by auth.ts whenever the active wallet source changes. When true, all
 * on-chain SC calls below sign directly with the vault's WalletSigner via
 * the Klever node's public REST API (same approach as desktop/mobile) rather
 * than routing through window.kleverWeb — a built-in wallet is its own
 * signer and must never depend on the browser extension being installed.
 */
let builtinWalletActive = false;
export function setBuiltinWalletActive(active: boolean): void {
  builtinWalletActive = active;
}

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
    let timeoutId: ReturnType<typeof setTimeout>;
    await Promise.race([
      networkReady,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Network detection timed out — L2 node may be unreachable')), 10_000);
      }),
    ]).finally(() => clearTimeout(timeoutId!));
    window.kleverWeb.provider = kleverProvider;
    await window.kleverWeb.initialize();
    const address = await window.kleverWeb.getWalletAddress();
    setKleverAddress(address);
    return address;
  } finally {
    setKleverConnecting(false);
  }
}

// --- Smart Contract Transactions ---

/**
 * The canonical Ogmara KApp address per network, PINNED in the client.
 *
 * These must never be taken on the connected node's word. The node is chosen
 * by the user and anyone may run one, so trusting it to name the contract lets
 * a hostile operator point `register` at a contract they control — and since
 * that call now carries a real KLV payment, the fee would go to them with no
 * refund. Before the fee existed the worst case was a failed zero-value call,
 * which is why the node's value was accepted unconditionally until now.
 */
const PINNED_CONTRACTS: Record<string, string> = {
  testnet: 'klv1qqqqqqqqqqqqqpgq0ja2j7xwz843ryfsk9vlz6xzsaak590h6pgq7nwr02',
  mainnet: 'klv1qqqqqqqqqqqqqpgq8c9yag9vuc2pe64fwvqsq9e8ul8w5zuglf5qfgh7z3',
};

/**
 * Ogmara KApp smart contract address. An explicit env override wins (for
 * local/dev contracts); otherwise the pin for the current network.
 */
let scAddress =
  (import.meta as any).env?.VITE_OGMARA_CONTRACT_ADDRESS ||
  PINNED_CONTRACTS[currentNetwork] ||
  '';

/** True when `scAddress` is a client-pinned address rather than node-supplied. */
let scAddressPinned = Boolean(scAddress);

/**
 * Record the contract address the connected node reports.
 *
 * ADVISORY ONLY when a pin exists: a mismatch is refused and the pin is kept,
 * because the node does not get to choose where the user's money goes. The
 * node's value is adopted only when no pin and no env override apply at all
 * (an unknown/dev network), and in that case payable calls are blocked
 * outright — see `invokeContract`.
 */
export function setContractAddress(address: string): void {
  if (!address) return;
  const pin = (import.meta as any).env?.VITE_OGMARA_CONTRACT_ADDRESS || PINNED_CONTRACTS[currentNetwork];
  if (pin) {
    if (address !== pin) {
      console.warn(
        '[Klever SC] node reported a different contract address than the pinned one; ignoring it.',
        { reported: address, pinned: pin },
      );
    }
    scAddress = pin;
    scAddressPinned = true;
    return;
  }
  scAddress = address;
  scAddressPinned = false;
}

/** Whether the active contract address is client-pinned. */
export function isContractAddressPinned(): boolean {
  return scAddressPinned;
}

/**
 * Re-resolve the pinned contract after the network changes. An explicit env
 * override always wins; otherwise the pin for the now-current network.
 */
function repinContractForNetwork(): void {
  const pin =
    (import.meta as any).env?.VITE_OGMARA_CONTRACT_ADDRESS || PINNED_CONTRACTS[currentNetwork];
  if (pin) {
    scAddress = pin;
    scAddressPinned = true;
  }
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

// --- Vault-based transaction building (built-in wallet, no extension) ---

function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

/** Minimum 2 seconds between TX submissions. */
let lastTxTime = 0;
function checkTxRateLimit(): void {
  const now = Date.now();
  if (now - lastTxTime < 2000) {
    throw new Error('Please wait a moment before sending another transaction');
  }
  lastTxTime = now;
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('Invalid hex string');
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/** Parse Klever node error responses into user-friendly messages. */
function parseKleverError(rawText: string, status: number): string {
  const lower = rawText.toLowerCase();
  if (lower.includes('insufficient') || lower.includes('balance') || lower.includes('not enough')) {
    return 'Insufficient KLV balance for this transaction';
  }
  if (
    lower.includes('nil address')
    || lower.includes('getexistingaccount')
    || lower.includes('account not found')
    || lower.includes('account was not found')
    || status === 404
  ) {
    return 'Account not found on-chain. Send KLV to this address first.';
  }
  if (lower.includes('nonce')) {
    return 'Nonce mismatch — try again in a few seconds';
  }
  if (lower.includes('signature')) {
    return 'Signature verification failed';
  }
  try {
    const parsed = JSON.parse(rawText);
    const msg = parsed?.error || parsed?.data?.error || parsed?.message;
    if (msg) return String(msg).slice(0, 200);
  } catch { /* not JSON */ }
  return rawText.slice(0, 200) || `Transaction failed (HTTP ${status})`;
}

/** Locally-tracked nonces so consecutive TXs in the same session don't collide
 *  with the API's ~4s indexing lag. */
const nonceCache: Record<string, { nonce: number; ts: number }> = {};

async function getAccountNonce(address: string): Promise<number> {
  const resp = await fetchWithTimeout(`${kleverProvider.api}/v1.0/address/${address}`);
  if (resp.status === 404) return 0;
  if (!resp.ok) throw new Error(`Failed to fetch account nonce (HTTP ${resp.status})`);
  const rawBody = await resp.text();
  let data: any;
  try { data = JSON.parse(rawBody); } catch { data = null; }
  const apiNonce: number = data?.data?.account?.nonce ?? data?.data?.account?.Nonce ?? 0;

  const cached = nonceCache[address];
  if (cached && cached.ts > Date.now() - 30_000) {
    return Math.max(apiNonce, cached.nonce + 1);
  }
  return apiNonce;
}

function recordUsedNonce(address: string, nonce: number): void {
  nonceCache[address] = { nonce, ts: Date.now() };
}

function requireVaultSigner() {
  const signer = vaultGetSigner();
  if (!signer) throw new Error('Wallet not available — unlock your vault first');
  return signer;
}

/**
 * Build, sign, and broadcast a transaction directly via the Klever node's
 * public REST API, signed with the built-in vault's Ed25519 key. Mirrors
 * desktop/mobile's standalone signer — no browser extension involved.
 *
 * Flow: POST /transaction/send (unsigned TX) -> /transaction/decode (hash)
 * -> Ed25519-sign the hash -> POST /transaction/broadcast.
 */
async function buildSignBroadcastViaVault(
  contracts: Array<{ type: number; payload: Record<string, unknown> }>,
  data?: string[],
): Promise<string> {
  checkTxRateLimit();
  const signer = requireVaultSigner();
  const nodeBase = kleverProvider.node;

  const kleverContracts = contracts.map((c) => ({
    ...c.payload,
    contractType: c.type,
  }));
  const senderAddr = signer.walletAddress || signer.address;
  const usedNonce = await getAccountNonce(senderAddr);
  const sendBody: Record<string, unknown> = {
    type: contracts[0].type,
    sender: senderAddr,
    nonce: usedNonce,
    contracts: kleverContracts,
  };
  if (data && data.length > 0) {
    sendBody.data = data;
  }

  const sendResp = await fetchWithTimeout(`${nodeBase}/transaction/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sendBody),
  });
  const sendText = await sendResp.text().catch(() => '');
  let sendData: any;
  try { sendData = JSON.parse(sendText); } catch { sendData = null; }

  const rawTx = sendData?.data?.result;
  if (!rawTx?.RawData && !rawTx?.rawData) {
    if (!sendResp.ok || sendData?.error) {
      throw new Error(parseKleverError(sendText, sendResp.status));
    }
    throw new Error('Node did not return a transaction to sign');
  }

  let txHash = sendData?.data?.txHash || '';
  if (!txHash) {
    const decodeResp = await fetchWithTimeout(`${nodeBase}/transaction/decode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rawTx),
    });
    if (decodeResp.ok) {
      const decodeData = await decodeResp.json();
      txHash = decodeData?.data?.tx?.hash || '';
    }
  }
  if (!txHash) {
    throw new Error('Could not obtain TX hash for signing');
  }

  const hashRawBytes = hexToBytes(txHash);
  const sigBytes = await signer.signRawHash(hashRawBytes);
  const sigBase64 = btoa(String.fromCharCode(...sigBytes));

  rawTx.Signature = [sigBase64];
  const broadcastResp = await fetchWithTimeout(`${nodeBase}/transaction/broadcast`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tx: rawTx }),
  });
  const broadcastText = await broadcastResp.text().catch(() => '');
  let broadcastData: any;
  try { broadcastData = JSON.parse(broadcastText); } catch { broadcastData = {}; }

  if (!broadcastResp.ok || broadcastData?.error) {
    throw new Error(parseKleverError(broadcastText, broadcastResp.status));
  }
  const broadcastHash = broadcastData?.data?.txsHashes?.[0]
    || broadcastData?.data?.txHash
    || txHash;

  recordUsedNonce(senderAddr, usedNonce);
  return broadcastHash;
}

async function invokeContractViaVault(params: ScInvokeParams): Promise<string> {
  if (!scAddress) {
    throw new Error('Smart contract address not configured');
  }
  const callData = [params.functionName, ...params.args].join('@');
  const payload: Record<string, unknown> = {
    scType: 0, // InvokeContract
    address: scAddress,
    // MUST be a JSON number. The Klever node refuses a string at JSON decode
    // ("cannot unmarshal string into Go struct field
    // SmartContractRequest.callValue of type int64") — verified against live
    // testnet on BOTH the extension and direct-RPC signing paths. An empty
    // `{}` is correct when no value is attached, which is why this went
    // unnoticed: no payable SC call had ever shipped (`sendTip` builds a
    // type-0 transfer, not an invoke), so `value` was never set.
    callValue: params.value ? { KLV: params.value } : {},
  };
  return buildSignBroadcastViaVault([{ type: 63, payload }], [btoa(callData)]);
}

/**
 * Build, sign, and broadcast a smart contract invocation via Klever Extension.
 * Returns the transaction hash.
 */
async function invokeContractViaExtension(params: ScInvokeParams): Promise<string> {
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
    // MUST be a JSON number. The Klever node refuses a string at JSON decode
    // ("cannot unmarshal string into Go struct field
    // SmartContractRequest.callValue of type int64") — verified against live
    // testnet on BOTH the extension and direct-RPC signing paths. An empty
    // `{}` is correct when no value is attached, which is why this went
    // unnoticed: no payable SC call had ever shipped (`sendTip` builds a
    // type-0 transfer, not an invoke), so `value` was never set.
    callValue: params.value ? { KLV: params.value } : {},
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

/**
 * Build, sign, and broadcast a smart contract invocation.
 * Routes to the vault's own signer for built-in wallets (no extension
 * required), or the Klever Extension when that's the active wallet source.
 */
async function invokeContract(params: ScInvokeParams): Promise<string> {
  // Never send money to a contract address the client did not pin. Reaching
  // here with an unpinned address means the node named the contract, and a
  // hostile node would simply name its own.
  if (params.value && !scAddressPinned) {
    throw new Error(
      'Refusing to send a payment to a contract address supplied by the node. ' +
        'No pinned Ogmara contract is configured for this network.',
    );
  }
  return builtinWalletActive
    ? invokeContractViaVault(params)
    : invokeContractViaExtension(params);
}

/** Decode a bech32 address (klv1... or ogd1...) to its 32-byte public key as hex. */
export function addressToPubkeyHex(address: string): string {
  // Verifies the bech32 CHECKSUM and the 32-byte length, not just the charset.
  // This decodes a node-supplied `operator_address` straight into calldata, so
  // a malformed value would otherwise be appended as a wrong-length argument
  // and revert the invoke on-chain — burning the user's network fee on every
  // attempt with nothing pointing at the node as the cause.
  const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  const lower = address.toLowerCase();
  const sep = lower.lastIndexOf('1');
  if (sep < 1) throw new Error('Invalid address: no separator');
  const hrp = lower.slice(0, sep);
  const dataPart = lower.slice(sep + 1);
  const values: number[] = [];
  for (const ch of dataPart) {
    const v = CHARSET.indexOf(ch);
    if (v === -1) throw new Error('Invalid address: bad character');
    values.push(v);
  }
  // polymod over hrp-expansion + data (checksum included)
  const expanded: number[] = [];
  for (const c of hrp) expanded.push(c.charCodeAt(0) >> 5);
  expanded.push(0);
  for (const c of hrp) expanded.push(c.charCodeAt(0) & 31);
  let chk = 1;
  for (const v of expanded.concat(values)) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >> i) & 1) chk ^= GEN[i];
  }
  if (chk !== 1) throw new Error('Invalid address: bad checksum');

  // Drop the 6-symbol checksum, then regroup 5-bit values into bytes.
  const payload = values.slice(0, -6);
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  for (const v of payload) {
    acc = (acc << 5) | v;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  if (out.length !== 32) throw new Error('Invalid address: expected 32 bytes');
  return out.map((b) => b.toString(16).padStart(2, '0')).join('');
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

/** Options for {@link registerUser}. */
export interface RegisterOptions {
  /**
   * The on-chain registration fee in atomic units, as read live from
   * `GET /api/v1/registration/info`. Omit or pass 0 when registration is free.
   *
   * Never hard-code this: the fee is node-governance controlled and changes
   * with no client release.
   */
  feeAtomic?: number;
  /**
   * The node operator's wallet (`operator_address` from the same response).
   * That operator is credited a share of the fee for onboarding this user.
   *
   * Omit when the node reports `null` — the contract then routes the whole
   * fee to the protocol treasury. An ineligible address is NOT an error
   * on-chain either; it simply falls back to the treasury.
   */
  viaNode?: string;
}

/**
 * Register ("verify") a wallet on the Ogmara smart contract.
 *
 * Costs the Klever network fee (~4.4 KLV in kAppFee + bandwidth) PLUS the
 * on-chain registration fee, if governance has set one. Read the latter from
 * the connected node rather than assuming a value.
 *
 * @param publicKeyHex - 64-char hex Ed25519 public key
 */
export async function registerUser(
  publicKeyHex: string,
  opts: RegisterOptions = {},
): Promise<string> {
  // The SC expects a ManagedBuffer containing the 64-char hex string.
  // The VM's @ encoding decodes hex to raw bytes, so we hex-encode the
  // ASCII string so it arrives as 64 bytes (the hex chars themselves).
  const args = [stringToHex(publicKeyHex)];
  // `via_node` is an OptionalValue tail argument, encoded by PRESENCE: append
  // it to credit a node, omit it entirely for the treasury. Sending an empty
  // argument would be a different value, not an absent one.
  if (opts.viaNode) args.push(addressToPubkeyHex(opts.viaNode));
  return invokeContract({
    functionName: 'register',
    args,
    // `|| undefined` so a 0 fee sends no callValue at all.
    value: opts.feeAtomic || undefined,
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
 * Resolve a freshly-created channel's SC-assigned `channel_id` by polling the
 * connected Ogmara NODE for the channel by slug.
 *
 * The browser cannot query Klever's RPC directly (CORS-blocked), so we don't
 * poll the TX status or the SC view here. Instead the node's chain scanner
 * records the channel (slug + channel_id) once it sees the on-chain creation —
 * so a successful by-slug lookup BOTH confirms the TX landed AND yields the id,
 * with no browser→Klever call. `txHash` is unused now (kept for call-site
 * compatibility).
 */
export async function getChannelIdFromTx(_txHash: string, slug: string): Promise<number> {
  const maxAttempts = 30;
  const delay = 2000;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const ch = await getClient().getChannelBySlug(slug);
      if (ch && typeof ch.channel_id === 'number') return ch.channel_id;
    } catch {
      // Node not reachable yet, or still catching up on chain scan — retry.
    }
    await sleep(delay);
  }
  throw new Error(
    'Channel not found on the node yet — it may still be scanning the chain. Try again shortly.',
  );
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
  const amountAtomic = Math.floor(amountKlv * 1_000_000); // KLV has 6 decimal places
  const txData = note ? [btoa(note.slice(0, 128))] : undefined;

  if (builtinWalletActive) {
    return buildSignBroadcastViaVault(
      [{ type: 0, payload: { receiver: recipient, amount: amountAtomic, kda: 'KLV' } }],
      txData,
    );
  }

  if (!window.kleverWeb) {
    throw new Error('Klever Extension not available');
  }
  window.kleverWeb.provider = kleverProvider;
  await window.kleverWeb.initialize();

  // Build a direct KLV transfer (type 0)
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

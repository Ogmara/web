/**
 * WalletView — full wallet management with on-chain features.
 *
 * Supports:
 * - Built-in wallet (create/import/export)
 * - Klever Extension connection + on-chain registration
 * - K5 mobile wallet delegation
 * - Tipping, device delegation, channel creation
 */

import { Component, createSignal, Show } from 'solid-js';
import { t } from '../i18n/init';
import {
  authStatus,
  walletAddress,
  walletSource,
  isRegistered,
  generateWallet,
  connectWithKey,
  disconnectWallet,
  connectKleverExtension,
  setRegistrationStatus,
  getSigner,
} from '../lib/auth';
import { vaultExportKey } from '../lib/vault';
import {
  kleverAvailable,
  kleverAddress,
  kleverConnecting,
  connectExtension,
  registerUser,
  delegateDevice,
  revokeDevice,
} from '../lib/klever';
import {
  k5Available,
  k5Connecting,
  k5DelegationPending,
  initiateK5Connection,
} from '../lib/k5';
import { navigate } from '../lib/router';

export const WalletView: Component = () => {
  const [importKey, setImportKey] = createSignal('');
  const [showExport, setShowExport] = createSignal(false);
  const [exportedKey, setExportedKey] = createSignal('');
  const [error, setError] = createSignal('');
  const [txPending, setTxPending] = createSignal(false);
  const [txResult, setTxResult] = createSignal<string | null>(null);
  const [showDelegation, setShowDelegation] = createSignal(false);
  const [delegateKeyInput, setDelegateKeyInput] = createSignal('');
  const [delegatePermissions, setDelegatePermissions] = createSignal(0x07); // all permissions
  const [revokeKeyInput, setRevokeKeyInput] = createSignal('');

  const handleGenerate = async () => {
    setError('');
    try {
      await generateWallet();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleImport = async () => {
    setError('');
    const key = importKey().trim();
    if (key.length !== 64) {
      setError('Private key must be 64 hex characters');
      return;
    }
    try {
      await connectWithKey(key);
      setImportKey('');
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleDisconnect = async () => {
    await disconnectWallet();
    setShowExport(false);
    setExportedKey('');
  };

  const handleKleverConnect = async () => {
    setError('');
    try {
      const address = await connectExtension();
      await connectKleverExtension(address);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleK5Connect = async () => {
    setError('');
    try {
      await initiateK5Connection();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleRegister = async () => {
    setError('');
    setTxPending(true);
    setTxResult(null);
    try {
      const signer = getSigner();
      if (!signer) throw new Error('No signer available');
      const txHash = await registerUser(signer.publicKeyHex);
      setTxResult(txHash);
      setRegistrationStatus(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setTxPending(false);
    }
  };

  const handleDelegate = async () => {
    setError('');
    setTxPending(true);
    try {
      const txHash = await delegateDevice(
        delegateKeyInput().trim(),
        delegatePermissions(),
        0, // permanent
      );
      setTxResult(txHash);
      setDelegateKeyInput('');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setTxPending(false);
    }
  };

  const handleRevoke = async () => {
    setError('');
    setTxPending(true);
    try {
      const txHash = await revokeDevice(revokeKeyInput().trim());
      setTxResult(txHash);
      setRevokeKeyInput('');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setTxPending(false);
    }
  };

  const copyAddress = () => {
    const addr = walletAddress();
    if (addr) navigator.clipboard.writeText(addr);
  };

  return (
    <div class="wallet-view">
      <h2>{t('settings_wallet')}</h2>

      <Show when={error()}>
        <div class="wallet-error">{error()}</div>
      </Show>

      <Show when={txResult()}>
        <div class="wallet-success">
          {t('onchain_tx_confirmed')}: <code>{txResult()!.slice(0, 16)}...</code>
        </div>
      </Show>

      <Show when={txPending()}>
        <div class="wallet-pending">{t('onchain_tx_pending')}</div>
      </Show>

      {/* No wallet connected */}
      <Show when={authStatus() === 'none'}>
        <section class="wallet-section">
          <h3>{t('wallet_create')}</h3>
          <p class="wallet-desc">Generate a new Ed25519 keypair for signing messages.</p>
          <button class="wallet-btn primary" onClick={handleGenerate}>
            {t('wallet_create')}
          </button>
        </section>

        <section class="wallet-section">
          <h3>{t('wallet_import')}</h3>
          <input
            type="password"
            class="wallet-input"
            placeholder="64-character hex private key"
            value={importKey()}
            onInput={(e) => setImportKey(e.currentTarget.value)}
          />
          <button class="wallet-btn" onClick={handleImport}>
            {t('wallet_import')}
          </button>
        </section>

        {/* Klever Extension */}
        <section class="wallet-section">
          <h3>{t('wallet_klever_extension')}</h3>
          <Show
            when={kleverAvailable()}
            fallback={
              <p class="wallet-desc muted">{t('wallet_klever_not_installed')}</p>
            }
          >
            <button
              class="wallet-btn klever"
              onClick={handleKleverConnect}
              disabled={kleverConnecting()}
            >
              {kleverConnecting() ? t('loading') : t('wallet_klever_connect')}
            </button>
          </Show>
        </section>

        {/* K5 Mobile Wallet */}
        <Show when={k5Available()}>
          <section class="wallet-section">
            <h3>K5 Wallet</h3>
            <p class="wallet-desc">{t('wallet_k5_description')}</p>
            <button
              class="wallet-btn k5"
              onClick={handleK5Connect}
              disabled={k5Connecting()}
            >
              {k5Connecting() ? t('loading') : t('wallet_k5_connect')}
            </button>
            <Show when={k5DelegationPending()}>
              <p class="wallet-desc muted">Waiting for K5 delegation confirmation...</p>
            </Show>
          </section>
        </Show>
      </Show>

      {/* Wallet connected */}
      <Show when={authStatus() === 'ready'}>
        <section class="wallet-section">
          <h3>{t('wallet_address')}</h3>
          <div class="wallet-address-row">
            <code class="wallet-address">{walletAddress()}</code>
            <button class="wallet-btn-sm" onClick={copyAddress} title="Copy">
              📋
            </button>
          </div>
          <p class="wallet-source">
            {walletSource() === 'klever-extension' ? 'Klever Extension' :
             walletSource() === 'k5-delegation' ? 'K5 Delegation' : 'Built-in Wallet'}
          </p>
        </section>

        {/* On-chain registration */}
        <section class="wallet-section">
          <h3>{t('onchain_register')}</h3>
          <Show
            when={!isRegistered()}
            fallback={
              <div class="wallet-registered">
                <span class="check-icon">✓</span> {t('wallet_registered')}
              </div>
            }
          >
            <p class="wallet-desc">{t('wallet_register_description')}</p>
            <Show
              when={kleverAvailable() || walletSource() === 'klever-extension'}
              fallback={
                <p class="wallet-desc muted">{t('wallet_klever_not_installed')}</p>
              }
            >
              <button
                class="wallet-btn primary"
                onClick={handleRegister}
                disabled={txPending()}
              >
                {t('wallet_register')}
              </button>
            </Show>
          </Show>
        </section>

        {/* Device Delegation */}
        <section class="wallet-section">
          <h3>{t('wallet_delegation')}</h3>
          <button
            class="wallet-btn"
            onClick={() => setShowDelegation(!showDelegation())}
          >
            {showDelegation() ? t('done') : t('wallet_delegate_device')}
          </button>

          <Show when={showDelegation()}>
            <div class="delegation-form">
              <h4>{t('wallet_delegate_device')}</h4>
              <input
                type="text"
                class="wallet-input"
                placeholder="Device public key (64 hex chars)"
                value={delegateKeyInput()}
                onInput={(e) => setDelegateKeyInput(e.currentTarget.value)}
              />
              <div class="permission-checkboxes">
                <label>
                  <input
                    type="checkbox"
                    checked={(delegatePermissions() & 0x01) !== 0}
                    onChange={(e) => {
                      const p = delegatePermissions();
                      setDelegatePermissions(e.currentTarget.checked ? p | 0x01 : p & ~0x01);
                    }}
                  />
                  Messages
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={(delegatePermissions() & 0x02) !== 0}
                    onChange={(e) => {
                      const p = delegatePermissions();
                      setDelegatePermissions(e.currentTarget.checked ? p | 0x02 : p & ~0x02);
                    }}
                  />
                  Channels
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={(delegatePermissions() & 0x04) !== 0}
                    onChange={(e) => {
                      const p = delegatePermissions();
                      setDelegatePermissions(e.currentTarget.checked ? p | 0x04 : p & ~0x04);
                    }}
                  />
                  Profile
                </label>
              </div>
              <button
                class="wallet-btn primary"
                onClick={handleDelegate}
                disabled={txPending() || delegateKeyInput().trim().length !== 64}
              >
                {t('wallet_delegate_device')}
              </button>

              <h4 style="margin-top: var(--spacing-md)">{t('wallet_revoke_device')}</h4>
              <input
                type="text"
                class="wallet-input"
                placeholder="Device public key to revoke"
                value={revokeKeyInput()}
                onInput={(e) => setRevokeKeyInput(e.currentTarget.value)}
              />
              <button
                class="wallet-btn danger"
                onClick={handleRevoke}
                disabled={txPending() || revokeKeyInput().trim().length !== 64}
              >
                {t('wallet_revoke_device')}
              </button>
            </div>
          </Show>
        </section>

        {/* Export / Disconnect */}
        <section class="wallet-section">
          <Show when={walletSource() === 'builtin'}>
            <button
              class="wallet-btn warning"
              onClick={async () => {
                if (showExport()) {
                  setShowExport(false);
                  setExportedKey('');
                } else {
                  const key = await vaultExportKey();
                  setExportedKey(key ?? '');
                  setShowExport(true);
                }
              }}
            >
              {t('wallet_reveal_key')}
            </button>
            <Show when={showExport()}>
              <div class="wallet-export-warning">
                <p>{t('wallet_reveal_warning')}</p>
                <code class="wallet-key">{exportedKey() || t('wallet_passphrase_hint')}</code>
              </div>
            </Show>
          </Show>
          <button class="wallet-btn danger" onClick={handleDisconnect}>
            {t('wallet_disconnect')}
          </button>
        </section>
      </Show>

      <style>{`
        .wallet-view {
          padding: var(--spacing-lg);
          overflow-y: auto;
          height: 100%;
          max-width: 600px;
        }
        .wallet-view h2 {
          font-size: var(--font-size-xl);
          margin-bottom: var(--spacing-lg);
        }
        .wallet-section {
          margin-bottom: var(--spacing-lg);
          padding-bottom: var(--spacing-lg);
          border-bottom: 1px solid var(--color-border);
        }
        .wallet-section h3 {
          font-size: var(--font-size-sm);
          color: var(--color-text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-bottom: var(--spacing-sm);
        }
        .wallet-desc {
          font-size: var(--font-size-sm);
          color: var(--color-text-secondary);
          margin-bottom: var(--spacing-sm);
        }
        .wallet-desc.muted { opacity: 0.7; font-style: italic; }
        .wallet-input {
          width: 100%;
          padding: var(--spacing-sm) var(--spacing-md);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-md);
          background: var(--color-bg-tertiary);
          color: var(--color-text-primary);
          font-family: monospace;
          font-size: var(--font-size-sm);
          margin-bottom: var(--spacing-sm);
        }
        .wallet-btn {
          padding: var(--spacing-sm) var(--spacing-lg);
          border-radius: var(--radius-md);
          font-weight: 600;
          font-size: var(--font-size-sm);
          background: var(--color-bg-tertiary);
          color: var(--color-text-primary);
          margin-right: var(--spacing-sm);
          margin-bottom: var(--spacing-sm);
        }
        .wallet-btn:hover { opacity: 0.85; }
        .wallet-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .wallet-btn.primary { background: var(--color-accent-primary); color: var(--color-text-inverse); }
        .wallet-btn.klever { background: #6c5ce7; color: white; }
        .wallet-btn.k5 { background: #e17055; color: white; }
        .wallet-btn.warning { background: var(--color-warning); color: #1a1a1a; }
        .wallet-btn.danger { background: var(--color-error); color: white; }
        .wallet-btn-sm {
          padding: var(--spacing-xs);
          border-radius: var(--radius-sm);
          font-size: var(--font-size-sm);
        }
        .wallet-btn-sm:hover { background: var(--color-bg-tertiary); }
        .wallet-address-row {
          display: flex;
          align-items: center;
          gap: var(--spacing-sm);
          margin-bottom: var(--spacing-xs);
        }
        .wallet-address {
          font-size: var(--font-size-sm);
          word-break: keep-all;
          overflow-wrap: anywhere;
          color: var(--color-accent-primary);
        }
        .wallet-source {
          font-size: var(--font-size-xs);
          color: var(--color-text-secondary);
        }
        .wallet-registered {
          display: flex;
          align-items: center;
          gap: var(--spacing-xs);
          color: var(--color-success);
          font-weight: 600;
          font-size: var(--font-size-sm);
        }
        .check-icon { font-size: var(--font-size-lg); }
        .wallet-error {
          padding: var(--spacing-sm) var(--spacing-md);
          background: var(--color-error);
          color: white;
          border-radius: var(--radius-md);
          font-size: var(--font-size-sm);
          margin-bottom: var(--spacing-md);
        }
        .wallet-success {
          padding: var(--spacing-sm) var(--spacing-md);
          background: var(--color-success);
          color: white;
          border-radius: var(--radius-md);
          font-size: var(--font-size-sm);
          margin-bottom: var(--spacing-md);
        }
        .wallet-pending {
          padding: var(--spacing-sm) var(--spacing-md);
          background: var(--color-warning);
          color: #1a1a1a;
          border-radius: var(--radius-md);
          font-size: var(--font-size-sm);
          margin-bottom: var(--spacing-md);
        }
        .wallet-export-warning {
          margin-top: var(--spacing-sm);
          padding: var(--spacing-md);
          background: var(--color-bg-tertiary);
          border: 1px solid var(--color-warning);
          border-radius: var(--radius-md);
        }
        .wallet-export-warning p {
          font-size: var(--font-size-sm);
          color: var(--color-warning);
          margin-bottom: var(--spacing-sm);
        }
        .wallet-key {
          font-size: var(--font-size-sm);
          word-break: break-all;
          display: block;
        }
        .delegation-form {
          margin-top: var(--spacing-md);
          padding: var(--spacing-md);
          background: var(--color-bg-tertiary);
          border-radius: var(--radius-md);
        }
        .delegation-form h4 {
          font-size: var(--font-size-sm);
          margin-bottom: var(--spacing-sm);
        }
        .permission-checkboxes {
          display: flex;
          gap: var(--spacing-md);
          margin-bottom: var(--spacing-sm);
          font-size: var(--font-size-sm);
        }
        .permission-checkboxes label {
          display: flex;
          align-items: center;
          gap: var(--spacing-xs);
          cursor: pointer;
        }
      `}</style>
    </div>
  );
};

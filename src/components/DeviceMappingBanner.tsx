/**
 * Device-mapping banner — surfaces when the L2 node has no live device→wallet
 * mapping for the connected Klever Extension session.
 *
 * Without that mapping the user is silently downgraded to an anonymous
 * device-keyed identity: private channels disappear, DMs go to the wrong
 * address, channel-admin actions fail with "on-chain registration required".
 * Detection runs in `verifyDeviceMapping()` after each auth-ready transition.
 */

import { Component, Show, createSignal } from 'solid-js';
import { t } from '../i18n/init';
import {
  authStatus,
  walletSource,
  deviceMappingFailed,
  deviceMappingError,
  relinkDevice,
} from '../lib/auth';
import { navigate } from '../lib/router';

export const DeviceMappingBanner: Component = () => {
  const [retrying, setRetrying] = createSignal(false);
  const [resultMsg, setResultMsg] = createSignal('');

  const visible = () =>
    authStatus() === 'ready'
    && walletSource() === 'klever-extension'
    && deviceMappingFailed();

  const handleRelink = async () => {
    setRetrying(true);
    setResultMsg('');
    try {
      const ok = await relinkDevice();
      if (!ok) setResultMsg(t('device_link_failed'));
    } finally {
      setRetrying(false);
    }
  };

  return (
    <Show when={visible()}>
      <div class="device-banner" role="status">
        <div class="device-banner-text">
          <strong>{t('device_link_title')}</strong>
          <span>{t('device_link_body')}</span>
          <Show when={deviceMappingError()}>
            <span class="device-banner-detail">{deviceMappingError()}</span>
          </Show>
          <Show when={resultMsg()}>
            <span class="device-banner-detail">{resultMsg()}</span>
          </Show>
        </div>
        <div class="device-banner-actions">
          <button class="device-banner-btn" onClick={handleRelink} disabled={retrying()}>
            {retrying() ? t('device_link_retrying') : t('device_link_action')}
          </button>
          <button class="device-banner-btn-secondary" onClick={() => navigate('/wallet')}>
            {t('device_link_open_wallet')}
          </button>
        </div>
      </div>
      <style>{`
        .device-banner {
          display: flex; flex-wrap: wrap; gap: var(--spacing-md);
          align-items: center; justify-content: space-between;
          padding: var(--spacing-sm) var(--spacing-md);
          background: color-mix(in srgb, var(--color-warning) 14%, var(--color-bg-secondary));
          border-bottom: 1px solid var(--color-warning);
          color: var(--color-text-primary);
          font-size: var(--font-size-sm);
        }
        .device-banner-text {
          display: flex; flex-direction: column; gap: 2px;
          flex: 1; min-width: 240px;
        }
        .device-banner-text strong { font-weight: 600; }
        .device-banner-detail {
          color: var(--color-text-secondary); font-size: var(--font-size-xs);
          word-break: break-word;
        }
        .device-banner-actions { display: flex; gap: var(--spacing-xs); flex-shrink: 0; }
        .device-banner-btn {
          background: var(--color-warning); color: var(--color-text-inverse);
          border: none; padding: 6px 14px; border-radius: var(--radius-sm);
          font-weight: 600; cursor: pointer; font-size: var(--font-size-sm);
        }
        .device-banner-btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .device-banner-btn-secondary {
          background: transparent; color: var(--color-text-primary);
          border: 1px solid var(--color-border-strong);
          padding: 6px 14px; border-radius: var(--radius-sm);
          cursor: pointer; font-size: var(--font-size-sm);
        }
      `}</style>
    </Show>
  );
};

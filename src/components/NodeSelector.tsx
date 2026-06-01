/**
 * NodeSelector — dropdown for choosing L2 node with ping display.
 *
 * Discovers available nodes, measures latency, and lets the user
 * pick which node to connect to. Remembers selection in settings.
 */

import { Component, createResource, createSignal, For, Show } from 'solid-js';
import { t } from '../i18n/init';
import {
  getCurrentNodeUrl,
  getAvailableNodes,
  switchNode,
  removeKnownNode,
  getKnownNodes,
  getDefaultNodeUrl,
  setDefaultNodeUrl,
  getLastBootstrapResult,
} from '../lib/api';
import type { NodeWithPing } from '@ogmara/sdk';
import { validateNodeUrl, DEFAULT_NODE_URL } from '@ogmara/sdk';
import { AnchorBadge } from './AnchorBadge';

export const NodeSelector: Component = () => {
  const [open, setOpen] = createSignal(false);
  const [currentUrl, setCurrentUrl] = createSignal(getCurrentNodeUrl());
  const [manualUrl, setManualUrl] = createSignal('');
  const [addError, setAddError] = createSignal('');
  const [adding, setAdding] = createSignal(false);
  const [defaultUrl, setDefaultUrl] = createSignal(getDefaultNodeUrl());

  // One-time notice when boot couldn't reach the pinned default and
  // fell back to best-ping. Cleared after the user opens the dropdown
  // (the picker UI is the place to fix the issue anyway).
  const bootResult = getLastBootstrapResult();
  const [bootNotice, setBootNotice] = createSignal(
    bootResult && bootResult.reason === 'default-unreachable-fallback'
      ? bootResult.chosen
      : '',
  );

  const togglePin = (url: string) => {
    const current = defaultUrl();
    const next = current === url ? '' : url;
    setDefaultNodeUrl(next || null);
    setDefaultUrl(next);
  };

  const [nodes, { refetch }] = createResource(async () => {
    return getAvailableNodes();
  });

  const handleSelect = (url: string) => {
    switchNode(url);
    setCurrentUrl(url);
    setOpen(false);
  };

  const handleRefresh = () => {
    refetch();
  };

  /** Try to add a manually-entered URL with full error reporting.
   *  Web does NOT pass `allowPrivateHosts` — SSRF guard stays on
   *  because a hosted web page making requests to private IPs is a
   *  real attack surface (DNS rebinding). If you need a LAN node,
   *  use the desktop app where the trust boundary is the Tauri
   *  shell, not the URL filter. */
  const tryAddManual = async () => {
    const raw = manualUrl().trim();
    if (!raw) return;
    setAddError('');
    setAdding(true);
    try {
      let url = raw.replace(/\/$/, '');
      if (!/^https?:\/\//i.test(url)) {
        url = `https://${url}`;
      }
      if (!validateNodeUrl(url)) {
        setAddError(
          t('node_add_failed_invalid_url') ||
            'Invalid URL. Must be http(s), under 256 chars, and a public host.',
        );
        return;
      }
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      let resp: Response;
      try {
        resp = await fetch(`${url}/api/v1/health`, { signal: controller.signal });
      } catch (e: any) {
        clearTimeout(timeoutId);
        const msg = e?.message || String(e);
        let hint = '';
        if (/CORS|Access-Control/i.test(msg)) {
          hint = ' The node may need to add this origin to its CORS allow-list.';
        } else if (/mixed content|insecure/i.test(msg)) {
          hint = ' Browser blocks HTTP from HTTPS pages — use https:// for the node URL.';
        }
        setAddError(`Fetch failed: ${msg}.${hint}`);
        return;
      }
      clearTimeout(timeoutId);
      if (!resp.ok) {
        setAddError(`Node returned HTTP ${resp.status} for /api/v1/health.`);
        return;
      }
      let body: any;
      try { body = await resp.json(); }
      catch { setAddError(`Response wasn't JSON — that URL doesn't look like an L2 node.`); return; }
      if (!body || typeof body.version !== 'string') {
        setAddError(`Response had no \`version\` field — that URL doesn't look like an L2 node.`);
        return;
      }
      handleSelect(url);
      setManualUrl('');
    } catch (e: any) {
      setAddError(`Unexpected error: ${e?.message || String(e)}`);
    } finally {
      setAdding(false);
    }
  };

  const pingLabel = (ping: number) => {
    if (ping < 100) return 'fast';
    if (ping < 300) return 'ok';
    return 'slow';
  };

  const pingColor = (ping: number) => {
    if (ping < 100) return 'var(--color-success, #22c55e)';
    if (ping < 300) return 'var(--color-warning, #eab308)';
    return 'var(--color-error, #ef4444)';
  };

  return (
    <div class="node-selector">
      <button class="node-current" onClick={() => {
        // Refresh on OPEN so a manually-added node shows up the first
        // time. The previous expression actually refreshed on CLOSE
        // (setOpen had already flipped the signal by then), which is
        // why new entries only appeared on the second open.
        const willOpen = !open();
        setOpen(willOpen);
        if (willOpen) handleRefresh();
      }}>
        <span class="node-dot" />
        <span class="node-url">{currentUrl().replace(/^https?:\/\//, '')}</span>
        <span class="node-arrow">{open() ? '▲' : '▼'}</span>
      </button>

      <Show when={open()}>
        <div class="node-dropdown">
          <div class="node-dropdown-header">
            <span>{t('settings_node_url')}</span>
            <button class="node-refresh" onClick={handleRefresh}>↻</button>
          </div>
          <Show when={bootNotice()}>
            <div class="node-boot-notice">
              {t('node_default_unreachable_notice') ||
                'Pinned default node unreachable — using best-ping fallback'}
              <button
                class="node-boot-dismiss"
                onClick={() => setBootNotice('')}
                title="Dismiss"
              >
                ✕
              </button>
            </div>
          </Show>
          <Show when={defaultUrl()}>
            <div class="node-default-summary">
              <span class="node-star-active">★</span>{' '}
              {t('node_default_pinned') || 'Default'}:{' '}
              <span class="node-default-url">
                {defaultUrl().replace(/^https?:\/\//, '')}
              </span>
            </div>
          </Show>
          <Show when={!nodes.loading} fallback={<div class="node-loading">{t('loading')}</div>}>
            <For each={nodes()}>
              {(node: NodeWithPing) => {
                // ✕ button only on entries the user manually added.
                // Default and current entries can't usefully be removed
                // (the default re-appears from `getAvailableNodes`;
                // the current is what's actually in use).
                const isUserAdded = () =>
                  getKnownNodes().includes(node.url) &&
                  node.url !== DEFAULT_NODE_URL &&
                  node.url !== currentUrl();
                const isPinned = () => defaultUrl() === node.url;
                return (
                  <div
                    class={`node-option-row ${node.url === currentUrl() ? 'active' : ''} ${
                      isPinned() ? 'pinned' : ''
                    }`}
                  >
                    <button
                      class={`node-option-pin ${isPinned() ? 'pinned' : ''}`}
                      title={
                        isPinned()
                          ? t('node_unpin_default') || 'Clear pinned default'
                          : t('node_pin_default') ||
                            'Pin as default — always connect here first'
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        togglePin(node.url);
                      }}
                    >
                      {isPinned() ? '★' : '☆'}
                    </button>
                    <button
                      class="node-option"
                      onClick={() => handleSelect(node.url)}
                    >
                      <span class="node-option-left">
                        <span class="node-option-url">{node.url.replace(/^https?:\/\//, '')}</span>
                        <Show when={node.anchorStatus && node.anchorStatus.level !== 'none'}>
                          <AnchorBadge level={node.anchorStatus!.level} showLabel={false} />
                        </Show>
                      </span>
                      <span class="node-ping" style={{ color: pingColor(node.ping) }}>
                        {node.ping === Infinity ? '∞' : node.ping}ms ({pingLabel(node.ping)})
                      </span>
                    </button>
                    <Show when={isUserAdded()}>
                      <button
                        class="node-option-remove"
                        title={t('node_remove_known') || 'Remove from list'}
                        onClick={(e) => {
                          e.stopPropagation();
                          removeKnownNode(node.url);
                          handleRefresh();
                        }}
                      >
                        ✕
                      </button>
                    </Show>
                  </div>
                );
              }}
            </For>
          </Show>
          <div class="node-manual">
            <input
              type="text"
              placeholder="https://custom-node.example.com"
              value={manualUrl()}
              onInput={(e) => { setManualUrl(e.currentTarget.value); setAddError(''); }}
              onKeyPress={(e) => {
                if (e.key === 'Enter' && !adding()) tryAddManual();
              }}
              class="node-manual-input"
              disabled={adding()}
            />
            <button
              class="node-manual-btn"
              onClick={tryAddManual}
              disabled={adding() || !manualUrl().trim()}
            >
              {adding() ? '…' : '+'}
            </button>
          </div>
          <Show when={addError()}>
            <div class="node-manual-error">{addError()}</div>
          </Show>
        </div>
      </Show>

      <style>{`
        .node-selector { position: relative; }
        .node-current {
          display: flex;
          align-items: center;
          gap: var(--spacing-xs);
          padding: var(--spacing-xs) var(--spacing-sm);
          border-radius: var(--radius-sm);
          font-size: var(--font-size-xs);
          cursor: pointer;
          color: var(--color-text-secondary);
        }
        .node-current:hover { color: var(--color-text-primary); }
        .node-dot {
          width: 6px; height: 6px;
          border-radius: 50%;
          background: var(--color-success, #22c55e);
        }
        .node-arrow { font-size: 8px; }
        .node-dropdown {
          position: absolute;
          bottom: 100%;
          left: 0;
          min-width: 300px;
          background: var(--color-bg-secondary);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-md);
          box-shadow: 0 -4px 12px rgba(0,0,0,0.15);
          z-index: 100;
          margin-bottom: var(--spacing-xs);
        }
        .node-dropdown-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: var(--spacing-sm);
          font-size: var(--font-size-xs);
          font-weight: 600;
          color: var(--color-text-secondary);
          border-bottom: 1px solid var(--color-border);
        }
        .node-refresh {
          cursor: pointer;
          font-size: var(--font-size-md);
          color: var(--color-text-secondary);
        }
        .node-refresh:hover { color: var(--color-accent-primary); }
        .node-option-row {
          display: flex;
          align-items: stretch;
          width: 100%;
        }
        .node-option-row.active { background: var(--color-bg-tertiary); font-weight: 600; }
        .node-option-row:hover { background: var(--color-bg-tertiary); }
        .node-option-row.pinned { box-shadow: inset 3px 0 0 var(--color-warning, #eab308); }
        .node-option-pin {
          display: flex;
          align-items: center;
          padding: 0 8px;
          background: transparent;
          color: var(--color-text-secondary);
          font-size: 14px;
          cursor: pointer;
          opacity: 0.45;
          transition: opacity 120ms, color 120ms;
        }
        .node-option-pin:hover { opacity: 1; color: var(--color-warning, #eab308); }
        .node-option-pin.pinned { opacity: 1; color: var(--color-warning, #eab308); }
        .node-default-summary {
          padding: var(--spacing-xs) var(--spacing-sm);
          font-size: var(--font-size-xs);
          color: var(--color-text-secondary);
          background: var(--color-bg-tertiary);
          border-bottom: 1px solid var(--color-border);
        }
        .node-star-active { color: var(--color-warning, #eab308); }
        .node-default-url { color: var(--color-text-primary); font-weight: 600; }
        .node-boot-notice {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: var(--spacing-xs);
          padding: var(--spacing-xs) var(--spacing-sm);
          font-size: var(--font-size-xs);
          color: var(--color-warning, #eab308);
          background: rgba(234, 179, 8, 0.08);
          border-bottom: 1px solid var(--color-border);
        }
        .node-boot-dismiss {
          background: transparent;
          color: inherit;
          padding: 0 4px;
          cursor: pointer;
          opacity: 0.7;
        }
        .node-boot-dismiss:hover { opacity: 1; }
        .node-option {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex: 1;
          padding: var(--spacing-sm);
          text-align: left;
          font-size: var(--font-size-sm);
          cursor: pointer;
          background: transparent;
        }
        .node-option:hover { background: var(--color-bg-tertiary); }
        .node-option.active { background: var(--color-bg-tertiary); font-weight: 600; }
        .node-option-remove {
          padding: 0 10px;
          background: transparent;
          color: var(--color-text-secondary);
          font-size: 12px;
          cursor: pointer;
          opacity: 0.6;
        }
        .node-option-remove:hover { opacity: 1; color: var(--color-error); }
        .node-option-left {
          display: flex;
          align-items: center;
          gap: var(--spacing-xs);
        }
        .node-option-url { color: var(--color-text-primary); }
        .node-ping { font-size: var(--font-size-xs); font-weight: 600; }
        .node-loading {
          padding: var(--spacing-md);
          text-align: center;
          font-size: var(--font-size-sm);
          color: var(--color-text-secondary);
        }
        .node-manual {
          display: flex;
          gap: var(--spacing-xs);
          padding: var(--spacing-sm);
          border-top: 1px solid var(--color-border);
        }
        .node-manual-input {
          flex: 1;
          padding: var(--spacing-xs) var(--spacing-sm);
          border: 1px solid var(--color-border);
          border-radius: var(--radius-sm);
          font-size: var(--font-size-xs);
          background: var(--color-bg-tertiary);
          color: var(--color-text-primary);
        }
        .node-manual-input:focus { outline: none; border-color: var(--color-accent-primary); }
        .node-manual-btn {
          padding: var(--spacing-xs) var(--spacing-sm);
          background: var(--color-accent-primary);
          color: var(--color-text-inverse);
          border-radius: var(--radius-sm);
          font-weight: 700;
          cursor: pointer;
        }
        .node-manual-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .node-manual-input:disabled { opacity: 0.6; cursor: not-allowed; }
        .node-manual-error {
          padding: var(--spacing-xs) var(--spacing-sm);
          font-size: var(--font-size-xs);
          color: var(--color-error);
          border-top: 1px solid var(--color-border);
          line-height: 1.4;
        }
      `}</style>
    </div>
  );
};

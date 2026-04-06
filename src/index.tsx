/* @refresh reload */
import { render } from 'solid-js/web';
import { App } from './App';
import { initI18n } from './i18n/init';
import { initTheme } from './lib/theme';
import { initAuth } from './lib/auth';
import { initWs } from './lib/ws';
import { detectKleverExtension, setContractAddress, setKleverNetwork } from './lib/klever';
import { detectK5, checkK5Callback } from './lib/k5';
import { vaultGetSigner } from './lib/vault';
import { getClient } from './lib/api';
import './styles/global.css';
import './styles/design-styles.css';

// Initialize i18n before rendering
initI18n();

// Apply theme before first paint (prevents flash)
initTheme();

// Apply compact layout class if saved
import { getSetting } from './lib/settings';
if (getSetting('compactLayout')) {
  document.documentElement.classList.add('compact');
}

// Detect wallet integrations
detectKleverExtension();
detectK5();

// Initialize auth (loads vault, attaches signer), then start WebSocket
initAuth().then(() => {
  const signer = vaultGetSigner();
  initWs(signer ?? undefined);

  // Check for K5 callback return flow
  if (checkK5Callback()) {
    // K5 callback handling is done by the router + WalletView
  }
});

// Fetch node config for on-chain operations (contract address + network)
getClient().networkStats().then((stats: any) => {
  if (stats?.contract_address) setContractAddress(stats.contract_address);
  if (stats?.network) setKleverNetwork(stats.network);
}).catch(() => { /* node may be unreachable at startup */ });

// Disable native browser context menu globally so only in-app right-click menus appear.
// Allow native context menu on text inputs/textareas for paste/spellcheck.
document.addEventListener('contextmenu', (e) => {
  const target = e.target as HTMLElement;
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
  e.preventDefault();
});

const root = document.getElementById('root');
if (root) {
  render(() => <App />, root);
}

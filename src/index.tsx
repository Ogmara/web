/* @refresh reload */
import { render } from 'solid-js/web';
import { App } from './App';
import { initI18n } from './i18n/init';
import { initTheme } from './lib/theme';
import { initAuth } from './lib/auth';
import { initWs } from './lib/ws';
import { detectKleverExtension, setContractAddress } from './lib/klever';
import { detectK5, checkK5Callback } from './lib/k5';
import { vaultGetSigner } from './lib/vault';
import { getClient } from './lib/api';
import './styles/global.css';

// Initialize i18n before rendering
initI18n();

// Apply theme before first paint (prevents flash)
initTheme();

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

// Fetch contract address from node stats for on-chain operations
getClient().networkStats().then((stats: any) => {
  if (stats?.contract_address) {
    setContractAddress(stats.contract_address);
  }
}).catch(() => { /* node may be unreachable at startup */ });

const root = document.getElementById('root');
if (root) {
  render(() => <App />, root);
}

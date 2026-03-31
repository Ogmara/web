/* @refresh reload */
import { render } from 'solid-js/web';
import { App } from './App';
import { initI18n } from './i18n/init';
import { initTheme } from './lib/theme';
import { initAuth } from './lib/auth';
import { initWs } from './lib/ws';
import { detectKleverExtension } from './lib/klever';
import { detectK5, checkK5Callback } from './lib/k5';
import { vaultGetSigner } from './lib/vault';
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

const root = document.getElementById('root');
if (root) {
  render(() => <App />, root);
}

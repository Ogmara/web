/* @refresh reload */
import { render } from 'solid-js/web';
import { App } from './App';
import { initI18n } from './i18n/init';
import { initTheme } from './lib/theme';
import { initAuth } from './lib/auth';
import { initWs } from './lib/ws';
import { detectKleverExtension, setContractAddress, setKleverNetwork, resolveNetworkReadyFallback } from './lib/klever';
import { detectK5, checkK5Callback } from './lib/k5';
import { vaultGetSigner } from './lib/vault';
import { getClient, bootstrapNodeSelection } from './lib/api';
import { installNetworkActivityTracker } from './lib/network-activity';
import './styles/global.css';
import './styles/design-styles.css';
import './styles/chat-view.css';

installNetworkActivityTracker();

// Initialize i18n before rendering
initI18n();

// Apply theme before first paint (prevents flash)
initTheme();

// Apply compact layout class if saved
import { getSetting } from './lib/settings';
if (getSetting('compactLayout')) {
  document.documentElement.classList.add('compact');
}

// Apply user's default landing view if no specific route is in the URL
const initialHash = window.location.hash;
if (!initialHash || initialHash === '#' || initialHash === '#/') {
  const defaultView = getSetting('defaultLandingView');
  window.location.hash = defaultView === 'chat' ? '/chat' : '/news';
}

// Detect wallet integrations
detectKleverExtension();
detectK5();

// Bootstrap node selection (v0.36.0+ / spec 5 §1.1): land on the
// pinned default if set and reachable, otherwise pick the lowest-
// ping candidate. Runs BEFORE auth / networkStats so those fetches
// hit the chosen node — no reload needed mid-boot.
bootstrapNodeSelection()
  .catch(() => { /* leave nodeUrl as-is; downstream catches will handle */ })
  .finally(() => {
    initAuth().then(() => {
      const signer = vaultGetSigner();
      initWs(signer ?? undefined);
      if (checkK5Callback()) {
        // K5 callback handling is done by the router + WalletView
      }
    });

    // Fetch node config for on-chain operations (contract address + network)
    getClient().networkStats().then((stats: any) => {
      if (stats?.contract_address) setContractAddress(stats.contract_address);
      if (stats?.network) setKleverNetwork(stats.network);
    }).catch(() => {
      // Node unreachable — resolve networkReady so connectExtension() doesn't
      // hang forever. It will use mainnet provider URLs as a fallback.
      resolveNetworkReadyFallback();
    });

    // Probe whether this node can host media (IPFS up). Gates the attach
    // button + image placeholders. Fire-and-forget — defaults to "available"
    // until this resolves with an explicit false.
    import('./lib/media').then(({ refreshMediaCapability }) => {
      refreshMediaCapability();
    }).catch(() => { /* non-critical */ });
  });

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

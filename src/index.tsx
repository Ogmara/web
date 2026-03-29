/* @refresh reload */
import { render } from 'solid-js/web';
import { App } from './App';
import { initI18n } from './i18n/init';
import { initTheme } from './lib/theme';
import './styles/global.css';

// Initialize i18n before rendering
initI18n();

// Apply theme before first paint (prevents flash)
initTheme();

const root = document.getElementById('root');
if (root) {
  render(() => <App />, root);
}

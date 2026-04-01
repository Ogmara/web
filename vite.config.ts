import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import path from 'path';

export default defineConfig({
  plugins: [solidPlugin()],
  base: '/app/',
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version || '0.1.0'),
  },
  resolve: {
    alias: {
      // Force the local v2.3.0 instead of global v1.7.5 in ~/node_modules
      '@noble/ed25519': path.resolve(__dirname, 'node_modules/@noble/ed25519'),
      '@noble/hashes': path.resolve(__dirname, 'node_modules/@noble/hashes'),
    },
  },
  build: {
    target: 'esnext',
  },
});

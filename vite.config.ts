import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solidPlugin()],
  base: '/app/',
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version || '0.1.0'),
  },
  build: {
    target: 'esnext',
  },
});

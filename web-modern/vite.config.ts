import { defineConfig, type Plugin } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import path from 'path';

/**
 * Upstream L2 node used by the dev proxy. Override with `OGMARA_DEV_NODE`
 * env var to point at a different node (e.g., a local one):
 *   OGMARA_DEV_NODE=http://localhost:41721 npm run dev
 */
const DEV_UPSTREAM_NODE = process.env.OGMARA_DEV_NODE || 'https://ogmara.org';

/**
 * Custom reverse-proxy middleware for /api/v1/* using Node's native `fetch`.
 *
 * Vite's built-in `server.proxy` is backed by http-proxy, which reliably
 * mangles authenticated POST bodies when forwarding to a remote HTTPS
 * upstream (observed during Ogmara device registration — identical requests
 * succeed via Node.js direct-fetch but fail through http-proxy with the
 * upstream reporting `signature verification failed`, meaning the body the
 * upstream parses is NOT the body the browser sent).
 *
 * This middleware uses Node 18+'s native fetch to reconstruct and forward
 * the request byte-for-byte, which preserves the body integrity the L2 node
 * needs to verify Ed25519 signatures over the JSON payload.
 */
function ogmaraDevProxy(upstream: string): Plugin {
  return {
    name: 'ogmara-dev-proxy',
    configureServer(server) {
      server.middlewares.use('/api/v1', async (req, res) => {
        const url = new URL(req.url || '/', upstream);
        // Vite strips the matched prefix — reinstate it.
        const upstreamUrl = `${upstream}/api/v1${req.url}`;

        // Copy incoming headers, strip hop-by-hop and mutate Host/Origin
        // to match the upstream. Keep x-ogmara-* auth headers intact.
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) {
          if (!value) continue;
          const lower = key.toLowerCase();
          if (lower === 'host' || lower === 'connection' || lower === 'content-length') continue;
          if (Array.isArray(value)) headers.set(key, value.join(', '));
          else headers.set(key, String(value));
        }
        const upstreamHost = new URL(upstream).host;
        headers.set('host', upstreamHost);
        headers.set('origin', upstream);
        headers.set('referer', upstream + '/');

        // Buffer the full request body so we can forward it as a single
        // atomic Buffer — avoids any streaming/chunking issues.
        let body: Buffer | undefined;
        if (req.method && req.method !== 'GET' && req.method !== 'HEAD') {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          body = Buffer.concat(chunks);
        }

        console.log(`[proxy →] ${req.method} ${req.url}${body ? ` (${body.length}B)` : ''}`);

        try {
          const upstreamResp = await fetch(upstreamUrl, {
            method: req.method,
            headers,
            body,
            redirect: 'manual',
          });
          const respBody = Buffer.from(await upstreamResp.arrayBuffer());
          res.statusCode = upstreamResp.status;
          upstreamResp.headers.forEach((value, key) => {
            // Skip hop-by-hop and encoding headers that confuse Vite
            const lk = key.toLowerCase();
            if (lk === 'content-length' || lk === 'content-encoding' || lk === 'transfer-encoding') return;
            res.setHeader(key, value);
          });
          res.end(respBody);
          if (upstreamResp.status >= 400) {
            console.log(`[proxy ←] ✗ ${upstreamResp.status} ${req.method} ${req.url}: ${respBody.toString('utf8').slice(0, 200)}`);
          } else {
            console.log(`[proxy ←] ✓ ${upstreamResp.status} ${req.method} ${req.url}`);
          }
        } catch (e: any) {
          console.error(`[proxy !] ${req.method} ${req.url}: ${e.message}`);
          res.statusCode = 502;
          res.end('bad gateway');
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [solidPlugin(), ogmaraDevProxy(DEV_UPSTREAM_NODE)],
  // Relative base — generated asset URLs are relative to index.html, so the
  // same dist/ build works no matter which subdirectory it's deployed to
  // (/app/, /testnet/ogmara/, root, …).
  base: './',
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
  // NOTE: we no longer use server.proxy — see ogmaraDevProxy() plugin above
  // for why (http-proxy mangles POST bodies to HTTPS upstreams).
});

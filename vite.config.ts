import { defineConfig, type Plugin } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import path from 'path';

/**
 * Custom dev proxy that forwards /api/v1/* requests to the upstream L2 node
 * using Node's native fetch. Vite's built-in http-proxy mangles POST bodies
 * when forwarding to HTTPS upstreams, which breaks Ed25519 signature
 * verification on the L2 node.
 */
function ogmaraDevProxy(): Plugin {
  const upstream = process.env.DEV_UPSTREAM_NODE || 'https://node.ogmara.org';
  return {
    name: 'ogmara-dev-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/v1/')) return next();
        try {
          // Buffer request body for POST/PUT/DELETE
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(chunk as Buffer);
          const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;

          // Forward headers, stripping hop-by-hop
          const headers: Record<string, string> = {};
          const hopByHop = new Set(['host', 'connection', 'keep-alive', 'transfer-encoding']);
          for (const [key, val] of Object.entries(req.headers)) {
            if (!hopByHop.has(key) && typeof val === 'string') {
              headers[key] = val;
            }
          }

          const upstreamUrl = `${upstream}${req.url}`;
          const resp = await fetch(upstreamUrl, {
            method: req.method || 'GET',
            headers,
            body,
          });

          res.writeHead(resp.status, Object.fromEntries(resp.headers.entries()));
          const respBody = await resp.arrayBuffer();
          res.end(Buffer.from(respBody));
        } catch (e: any) {
          res.writeHead(502, { 'Content-Type': 'text/plain' });
          res.end(`Dev proxy error: ${e.message}`);
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    solidPlugin(),
    ...(mode === 'development' ? [ogmaraDevProxy()] : []),
  ],
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
}));

# Building the Ogmara Web Frontend

## Prerequisites

- **Node.js** 22+ (via [nodesource](https://github.com/nodesource/distributions))
- The `@ogmara/sdk` package (JS/TS SDK) — linked as `file:../sdk-js`

## Build

```bash
git clone https://github.com/Ogmara/web.git
git clone https://github.com/Ogmara/sdk-js.git  # SDK dependency

cd sdk-js
npm install
npm run build

cd ../web
npm install
npm run build
```

Output in `dist/` (~76 KB gzipped):
- `index.html`
- `assets/index-*.js`
- `assets/index-*.css`

## Development

```bash
npm run dev
```

Opens at `http://localhost:5173`. Hot-reloads on file changes.

## Deployment

The web app is a static SPA. Copy `dist/` to any web server.

### Subdirectory deployment

If serving under a subpath (e.g., `ogmara.org/app/`), set the base path
in `vite.config.ts`:

```typescript
export default defineConfig({
  base: '/app/',
  // ...
});
```

### Apache example

```apache
DocumentRoot /var/www/ogmara/web

<Directory /var/www/ogmara/web>
    RewriteEngine On
    RewriteBase /
    RewriteRule ^index\.html$ - [L]
    RewriteCond %{REQUEST_FILENAME} !-f
    RewriteCond %{REQUEST_FILENAME} !-d
    RewriteCond %{REQUEST_URI} !^/api/
    RewriteRule . /app/index.html [L]
</Directory>
```

### Deploy steps

```bash
cd web
npm run build
sudo rm -rf /var/www/ogmara/website/app/*
sudo cp -r dist/* /var/www/ogmara/website/app/
```

## Configuration

The web app auto-configures via Settings (stored in localStorage):

- **Node URL**: defaults to `https://ogmara.org` (from SDK `DEFAULT_NODE_URL`)
- **Push Gateway URL**: auto-derived as `{nodeUrl origin}/push`
- **Theme**: Light/Dark/System
- **Language**: EN, DE, ES, PT, JA, ZH, RU

## SDK rebuild note

When updating the SDK, you must rebuild it before rebuilding the web app:

```bash
cd sdk-js && npm run build
cd ../web && npm run build
```

The `file:../sdk-js` dependency links to the SDK's built `dist/` output.
A `npm install` alone won't pick up SDK source changes.

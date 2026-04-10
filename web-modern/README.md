# Ogmara web-modern

An alternative, opt-in frontend for Ogmara with a modernized UI inspired by
desktop messenger apps. Lives next to the original `@ogmara/web` build and
does not touch it.

Maintained by [@CTJaeger](https://github.com/CTJaeger).

## What's different from the original `web/`

- **Sidebar with chat-list previews + tab bar** (Chats / Feed / DMs) instead
  of the classic left-rail navigation.
- **Bubble-style chat layout** with avatars outside the bubble, own messages
  right-aligned with a tinted background, hover highlight.
- **Burger menu** that consolidates settings, profile, wallet, theme toggle,
  and channel/group creation.
- **Mobile single-pane navigation** — sidebar and content swap full-screen
  below 768 px viewport, with a back button in content headers. Resize
  switches between desktop and mobile layout reactively.
- **Color scheme dropdown** in Settings (default Ogmara blue + amber, teal,
  violet, coral, neutral-gray).
- **Global network-activity bar** under the toolbar — animates while any L2
  request is in flight, switches to a "connecting…" warning after 1.5 s.
- **Channel avatar** upload + display via `logo_cid`.
- **Channel member list** with profile name + verified-badge resolution.
- **Context menu viewport clamping** so right-click menus near the bottom of
  the screen don't disappear under the browser chrome.

## Build

`web-modern` is a fully standalone Vite project. It does not import anything
from the original `../src/`.

```bash
cd web-modern
npm install
npm run build
```

The output lives in `web-modern/dist/`. Upload its contents to any web
directory — the Vite `base` is set to `./` so all asset paths are relative
and the build runs from any subpath (`/`, `/app/`, `/anywhere/else/`).

## Develop

```bash
cd web-modern
npm run dev
```

The dev server includes a custom proxy plugin that forwards `/api/v1/*` to
`https://ogmara.org` (override with the `OGMARA_DEV_NODE` env var). Unlike
Vite's built-in proxy, this one uses Node's native `fetch` to forward POST
bodies byte-for-byte, which is required so the L2 node can verify Ed25519
signatures over the JSON payload.

## Relationship to the original `web/`

- **Independent build artifact.** Original `web/` builds and deploys exactly
  as before — `web-modern/` adds nothing to its dependency graph.
- **Independent codebase.** `web-modern/src/` is a copy that has diverged
  for the redesign — no symlinks, no relative imports out of the folder.
  This means bug fixes have to be ported manually if they are relevant to
  both. Acceptable trade-off for the cleaner separation.
- **Same SDK.** Both use `@ogmara/sdk` from the local `../../sdk-js`.
- **Same backend.** Talks to the same Klever L2 node API as the original.

## Status

Early opt-in alternative. Not feature-equivalent with the classic UI yet —
notable gaps and known issues are tracked in the project issues.

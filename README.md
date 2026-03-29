# Ogmara Web

Progressive Web Application for the [Ogmara](https://ogmara.org) decentralized chat and news platform on [Klever](https://klever.org) blockchain.

## Features

- Three-panel layout: sidebar (channels/DMs), main content, toolbar
- Dark/light/system theme with CSS design tokens (no flash on load)
- 6 languages at launch: EN, DE, ES, PT, JA, ZH (auto-detected)
- Chat view with message list and input
- News feed with card-based layout
- Settings: language, theme, notifications, node URL
- Responsive: sidebar collapses on mobile, detail panel hides on tablet
- WCAG 2.1 AA accessible (focus indicators, ARIA labels, reduced motion)
- Connects to any L2 node via @ogmara/sdk

## Quick Start

```bash
npm install
npm run dev     # development server
npm run build   # production build
```

## Tech Stack

- **Framework**: SolidJS (reactive, <30KB gzipped)
- **Build**: Vite
- **i18n**: i18next
- **API**: @ogmara/sdk (shared with all Ogmara clients)
- **Styling**: CSS custom properties (design tokens)

## Project Structure

```
src/
  App.tsx              — root component with view routing
  index.tsx            — entry point (i18n + theme init)
  components/          — reusable UI components
    Toolbar.tsx        — top navigation bar
    Sidebar.tsx        — channel and DM list
    StatusBar.tsx      — connection status + version
  pages/               — view components
    ChatView.tsx       — channel message view
    NewsView.tsx       — news feed
    SettingsView.tsx   — user settings
  lib/                 — utilities
    api.ts             — Ogmara SDK client instance
    theme.ts           — theme management
    settings.ts        — localStorage settings
  i18n/                — internationalization
    init.ts            — i18next setup
    locales/           — 6 language JSON files
  styles/
    global.css         — design tokens + reset + layout
```

## Build Size

| Output | Size | Gzipped |
|--------|------|---------|
| JS bundle | 88 KB | 29 KB |
| CSS | 2.3 KB | 0.9 KB |
| HTML | 0.6 KB | 0.4 KB |

## License

MIT

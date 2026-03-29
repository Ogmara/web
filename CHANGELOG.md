# Changelog

All notable changes to the Ogmara web application will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-03-29

### Added
- SolidJS PWA with Vite build system
- Three-panel layout: sidebar (channels/DMs), main content, toolbar + status bar
- Responsive design: sidebar collapses < 768px, detail panel hides < 1024px
- Dark/light/system theme with CSS custom properties (design tokens per spec)
  - Theme applied before first paint (no flash)
  - Listens to OS theme changes in system mode
- Internationalization with i18next (6 languages at launch)
  - English, German, Spanish, Portuguese, Japanese, Chinese (Simplified)
  - Auto-detection from browser locale with fallback chain
  - 65+ translation keys per language
- Chat view with message list and input (Ogmara SDK integration)
- News feed view with card-based layout
- Settings view: language, theme, notifications, compact layout, node URL
- Sidebar: channel list from API, DM section placeholder
- Status bar with connection indicator and app version
- Local settings persistence via localStorage (per spec 06-frontend.md 4.1)
- Ogmara SDK client integration (shared instance via lib/api.ts)
- WCAG 2.1 AA focus indicators, reduced motion support
- Keyboard accessible UI elements with ARIA labels

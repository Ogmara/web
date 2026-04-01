# Changelog

All notable changes to the Ogmara web application will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.1] - 2026-04-01

### Added
- **On-chain verified badge** — purple checkmark shown next to usernames on
  profiles and news posts when the user has registered on the Klever blockchain
  (public_key present in user record from chain scanner)
- **Verify On-Chain button** — own profile shows "Verify On-Chain" button when
  Klever Extension is available and user isn't registered yet. Calls registerUser
  SC endpoint (requires deployed smart contract).
- **Clickable bio URLs** — URLs in profile bios are now rendered as links that
  open in a new tab
- **Chat auto-scroll** — chat view auto-scrolls to the latest message when
  messages load or new messages arrive

## [0.7.0] - 2026-04-01

### Added
- **PWA Support** — manifest.json, service worker (cache-first for app shell,
  network-first for API), apple-mobile-web-app meta tags. App can now be
  installed as a standalone web app on mobile and desktop.
- **Concept-3 logo** — official Ogmara monogram used as favicon (SVG) and
  PWA icon (512px PNG)
- **Profile Editing** — connected users can edit their display name, bio, and
  upload a profile image from their own profile page
- **My Profile navigation** — clicking the wallet button in the toolbar now
  navigates to your own profile page (instead of wallet settings)

### Fixed
- **Search auto-execute** — navigating to search with a query param (e.g. from
  clicking a hashtag) now automatically runs the search
- **Search filtering** — all searches now filter client-side on post content,
  title, author, and tags. Hashtag searches match against decoded payload tags
  and content. Previously the L2 node ignored the tag param and returned all posts.

## [0.6.3] - 2026-04-01

### Changed
- **Tipping uses direct KLV transfer** — tip now sends KLV directly from the
  user's wallet to the recipient (type 0 Transfer) instead of going through
  the smart contract. Note is sent as a base64-encoded memo. Can be upgraded
  to SC-based tip with on-chain attribution when the contract is deployed.

## [0.6.2] - 2026-04-01

### Fixed
- **Klever Extension TX format** — smart contract invocations now use the
  correct `{ type: 63, payload: { address, scType, data, callValue } }` format
  matching the actual Klever Extension API. Was using a wrong proto-based format
  that caused 400 Bad Request on transaction send.
- `broadcastTransaction` (singular) instead of `broadcastTransactions` (plural)
- `callValue.KLV` now passed as string (extension expects string, not number)

## [0.6.1] - 2026-04-01

### Added
- **Smart contract address from node** — fetches `contract_address` from
  `/api/v1/network/stats` on startup, eliminating the need for env vars.
  Tipping, registration, and other on-chain operations now work automatically
  when the L2 node has `klever.contract_address` configured.

### Fixed
- Reply quote blocks now resolve from MessagePack payload `reply_to` field
  (Uint8Array handling was broken — `Array.isArray` returns false for typed arrays)
- Reply previews show even when original message is not in loaded batch
- Chat input auto-focuses on channel switch, after send, and on reply click
- Wallet address no longer wraps to two lines
- DM conversations 405 error eliminated (endpoint call disabled until L2 node
  implements it)

## [0.6.0] - 2026-04-01

### Added

- **User Profiles in News Feed** — news posts now show username + small avatar
  instead of raw wallet address; fetched from L2 node with in-memory cache
- **Clickable Hashtags** — hashtags in message content and news posts are now
  clickable, navigating to search results filtered by that tag
- **News Post Tags** — decoded tags from payload shown as clickable badges
  below post content
- **Date Separators in Chat** — messages grouped by day with "Today",
  "Yesterday", or full date labels between message groups
- **Chat Auto-Refresh** — 15-second polling fallback alongside WebSocket for
  reliable message delivery
- **Testnet/Mainnet Indicator** — status bar shows network badge (yellow for
  testnet, green for mainnet) from node stats API; also shown in node info dialog
- **Action Error Feedback** — bookmark, repost, and reaction failures now show
  inline error messages instead of failing silently

### Changed

- **Default View** — app now opens to News feed instead of Chat on first load
- **Responsive Layout** — on screens wider than 1440px, app caps at 80% width
  and centers; minimum width of 360px prevents layout breakage on small screens
- **Text Formatting** — newlines in news posts and chat messages now render as
  line breaks (were previously collapsed to single line)
- **Timestamps** — all timestamps (news, chat, search) now use the user's local
  timezone; chat shows time only, news shows date + time for older posts
- **Search** — now does client-side text filtering on post content, title, and
  author; hashtag queries (#tag) use server-side tag filtering for efficiency
- **Chat Message Ordering** — messages sorted chronologically (oldest first)
  with deduplication
- **Reactions** — now initialize from server-provided reaction_counts and show
  active state when count > 0

### Fixed

- Search returning all posts regardless of query (was passing free text to
  tag-only API parameter)
- News post content displayed as single line (newlines not rendered)
- Chat messages not in chronological order

## [0.5.0] - 2026-03-31

### Added

- **Wallet Management** — full browser wallet with IndexedDB + SubtleCrypto vault
  - Create new wallet (Ed25519 keypair generation)
  - Import wallet from hex private key
  - AES-256-GCM encrypted key storage with PBKDF2 passphrase derivation
  - Private key reveal with security warning
  - Wallet disconnect and wipe
- **Klever Extension Integration** — on-chain features via browser extension
  - Auto-detection with polling on page load
  - User registration on Ogmara smart contract (~4.4 KLV)
  - On-chain channel creation (~4.8 KLV)
  - KLV tipping to message/post authors
  - Device delegation and revocation
  - Governance voting
  - Smart contract TX builder (type 63 InvokeContract)
- **K5 Mobile Wallet** — deep link flow for mobile browser delegation
  - Device keypair generation + klever:// deep link
  - Delegation callback handling
  - Mobile browser detection
- **Authentication System** — reactive Solid.js auth state
  - Module-level signals for global auth state
  - Automatic signer attachment to API client
  - Auth guards on all write operations (chat, news, reactions, DMs)
  - Three wallet sources: built-in, Klever Extension, K5 delegation
- **Hash-Based URL Router** — proper URL routing replaces state-based nav
  - All views are now linkable (#/chat, #/news, #/dm, #/user, etc.)
  - Route parameters for channels, users, conversations
  - Query parameter support for search
  - Browser back/forward navigation
- **WebSocket Real-Time Updates** — live message delivery
  - Channel message subscription with auto-reconnect
  - DM real-time updates
  - Event handler registration with cleanup
- **Chat Messaging** — fully functional message sending
  - Send messages with auth (signed envelopes via SDK)
  - Reply-to support with preview
  - Real-time message append via WebSocket
  - Auth prompt for unauthenticated users
- **News Posting** — create and publish news posts
  - ComposeView with title, content, tags
  - Auth-gated publishing
  - Redirect to feed after posting
- **Direct Messages** — full DM system
  - DmListView with conversation list and unread badges
  - DmConversationView with real-time messaging
  - New conversation by entering klv1 address
  - Own/peer message styling (left/right bubbles)
- **User Profiles** — view any user's profile
  - Avatar, display name, bio, address display
  - Post listing (filtered from news feed)
  - Follower/following counts
  - Follow/unfollow with auth guard
  - DM and tip action buttons
- **Search** — multi-type search
  - Search posts by tag via API
  - Search channels by name/slug (client-side filter)
  - Navigate to user profile by entering klv1 address
  - Mixed results display (channels + posts)
- **Toolbar Updates** — route-based navigation with active indicators
  - Chat, News, Messages tabs with active state highlighting
  - WalletButton component shows connection status
  - Search and bookmarks quick-access buttons
- **Sidebar Updates** — DM conversations + channel creation
  - DM conversation list with unread badges
  - Channel creation shortcut
  - Connect wallet prompt for unauthenticated users
- **Russian Language** — 7th language added to all apps
  - Full translation of all 130+ keys for web and mobile
  - Language selector updated with Русский option
- **Tip Button** — KLV tipping on news posts (via Klever Extension)
- **Clickable Authors** — all author addresses link to user profiles

### Changed

- App.tsx rewritten with Switch/Match routing (replaces Show-based view switching)
- Toolbar uses route-based navigation instead of callback props
- Sidebar uses route-based navigation, shows DM conversations when authenticated
- ChatView wired to SDK sendMessage with auth guard and real-time updates
- NewsView reactions/bookmarks/reposts now require auth (redirect to wallet if not connected)
- index.tsx initializes auth, WebSocket, Klever detection, and K5 detection on startup

## [0.4.0] - 2026-03-30

### Added

- **Node Anchor Verification Badges** — green checkmark SVG badge for nodes
  that anchor L2 state on-chain
- `AnchorBadge` component — reusable inline badge with tooltip, renders
  checkmark for `active`/`verified` levels, nothing for `none`
- Anchor badges shown in NodeSelector dropdown next to each node
- Anchor badge shown in StatusBar connection indicator
- **Node Info Dialog** — click the connection indicator in the status bar to
  view detailed node information (status, verification level, anchoring since,
  last anchor age, peers, version)
- 17 new i18n keys across all 6 languages for anchor and node info labels

## [0.3.0] - 2026-03-30

### Added
- **Message Rendering**
  - FormattedText component — renders **bold**, *italic*, __underline__, `code`, ~~strikethrough~~
  - Auto-detected URLs rendered as clickable links (open in new tab)
  - Inline image display for IPFS attachments (png, jpg, gif, webp, svg)
  - Non-image attachments shown as downloadable file links
- **Node Selector**
  - NodeSelector dropdown in status bar with discovered nodes and ping times
  - Manual "Add custom node" input for when auto-discovery is unavailable
  - Auto-sorts by latency, persists user selection
- **Default Node**
  - Changed from localhost:41721 to node.ogmara.org

## [0.2.0] - 2026-03-30

### Added
- **News Engagement UI**
  - Reaction buttons on news cards (👍 👎 ❤️ 🔥 😂) with live counts
  - Repost button with visual feedback
  - Bookmark/save button with toggle state
  - NewsCard component extracted for reusability
- **Bookmarks View**
  - New BookmarksView page with saved post list
  - Added 'bookmarks' to app navigation
- **Chat Enhancements**
  - Reply preview in message list (reply_to_preview rendering)
  - Reply-to indicator above input with cancel button
  - Per-message reply button (appears on hover)
  - Pinned messages bar at top of channel
- **i18n**
  - Added 15+ new translation keys for engagement and channel admin features

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

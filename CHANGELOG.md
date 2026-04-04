# Changelog

All notable changes to the Ogmara web application will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.22.8] - 2026-04-04

### Changed

- **Message actions redesigned** — reply, edit, delete moved to right-click context menu; inline action buttons removed from message headers
- **Floating emoji bar** — appears on message hover (top-right), replaces the click-to-open reaction picker
- Continuation messages no longer have a hidden time/action row — zero extra vertical space
- Context menu now shows message actions (reply, edit, delete) at the top, followed by user/moderation actions

## [0.22.7] - 2026-04-04

### Changed

- Continuation messages stack tighter — removed border gap, reduced padding to 2px
- Own message bubble color darkened (accent mix reduced from 35% to 15%) for subtler contrast with other users' bubbles
- Own message border color softened to blend better with the darker background

## [0.22.6] - 2026-04-04

### Changed

- **Message grouping** — consecutive messages from the same author within 2 minutes are visually combined: continuation messages hide the avatar/name header, show only the timestamp on hover, and stack tightly with reduced spacing. Grouping breaks on date separators, replies, or deleted messages.

## [0.22.5] - 2026-04-04

### Added

- **DM unread badge** on Messages sidebar item — shows total unread DM count, polled every 30s alongside channel unreads

### Fixed

- Private channel member list now sorted: owners first, then moderators, then named users, then wallet addresses — alphabetically within each group
- Member list re-sorts as profiles resolve (display names load asynchronously)

## [0.22.4] - 2026-04-04

### Fixed

- Internal app links in messages/DMs now navigate within the same window instead of opening a new tab — detects same-origin and `ogmara.org/app/#/` URLs and uses in-app routing

## [0.22.3] - 2026-04-04

### Fixed

- Join page now works for private channels — shows channel name, description, member count, and join button instead of "Loading..." forever
- Join page shows "Channel not found" with navigation button when channel doesn't exist (instead of infinite loading)
- Private channels display lock icon on join page

## [0.22.2] - 2026-04-04

### Added

- **Member context menu** in sidebar — right-click any member in a private channel's member list for moderation actions
- Kick and ban actions for moderators and owners (with confirmation prompts)
- Promote/demote moderator actions for channel owners
- Member list auto-refreshes after moderation actions
- Permission gating: cannot kick/ban/demote the channel owner, cannot act on yourself

## [0.22.1] - 2026-04-04

### Added

- **Private channel member list** in sidebar — collapsible "Members" submenu under each private channel (🔒), lazy-loads on expand, shows display names with role indicators (green dot = owner, purple dot = moderator)
- Private channels now show 🔒 icon instead of # in sidebar

## [0.22.0] - 2026-04-04

### Added
- **Web Push notification support** — full integration with the push gateway
- Push notification toggle in Settings (under Notifications section), with
  browser permission handling and error feedback
- New `src/lib/push.ts` module: VAPID key fetch, PushManager subscription,
  gateway registration/unregistration lifecycle
- Service worker push event handler (`sw.js`) — decrypts and displays OS
  notifications with app icon and deduplication by message ID
- Notification click handler — navigates to the relevant channel or DM
- `pushGatewayUrl` and `pushEnabled` settings with auto-derivation from node URL
- i18n strings for push errors (denied/unsupported/error) in all 7 locales

## [0.21.0] - 2026-04-04

### Added

- Followers/Following list page (`#/user/:address/followers`, `#/user/:address/following`) with profile resolution, follow/unfollow buttons, and tab switching
- Clickable follower/following counts on user profiles navigate to list pages

### Fixed

- Following count now displays correctly using `follower_count`/`following_count` from L2 node v0.11.6 profile response
- Follow/Unfollow button state now persists across page loads by checking current user's following list on profile view
- Follow/unfollow actions refresh follower counts immediately

## [0.20.9] - 2026-04-04

### Fixed

- Chat toolbar link now navigates to the last opened channel instead of showing an empty page
- Compact layout setting now actually applies — overrides spacing and font-size design tokens via `html.compact` CSS class
- Compact layout moved from Notifications section to Theme section in settings where it belongs

## [0.20.8] - 2026-04-04

### Fixed

- Invite link now includes `/app/` path prefix (`ogmara.org/app/#/join/...` instead of `ogmara.org/#/join/...`)

## [0.20.7] - 2026-04-04

### Fixed

- Cursor focus now returns to chat input after sending a message (was failing because textarea was still disabled during focus)
- Active channel marked as read on every incoming WS message, preventing unread badges while viewing the channel
- Settings download updated to use new response format from L2 node v0.11.4

## [0.20.6] - 2026-04-04

### Fixed

- Settings sync encryption now uses correct field names (`encrypted_settings`/`nonce`/`key_epoch`) matching L2 node's `SettingsSyncPayload`

## [0.20.5] - 2026-04-04

### Fixed

- Message delete, edit, and reactions now work correctly — optimistic updates take priority in dedup so changes appear immediately
- Reactions show instant feedback with optimistic count increment instead of waiting for next poll
- Pin message restricted to channel owner and moderators only
- Message context menu (pin, report) now triggers on right-clicking the message bubble instead of the author name
- Silent error swallowing replaced with console warnings for delete, edit, and react failures

### Changed

- Native browser right-click menu disabled globally (except on text inputs) so only in-app context menus appear

## [0.20.4] - 2026-04-02

### Fixed

- Device registration now auto-re-registers on session restore when the `deviceRegistered` cache key is missing (fixes "wallet identity required" errors after clearing localStorage)
- Leave channel error no longer silently swallowed — shows alert with error message

## [0.20.3] - 2026-04-02

### Fixed

- Private channels now auto-added to sidebar when L2 API returns them (the API only returns private channels the user is a member of)
- Joined channel tracking is now a reactive SolidJS signal — leave/join immediately updates the sidebar without needing a full refetch
- Search results no longer show private channels (filtered by channel_type)

## [0.20.2] - 2026-04-02

### Fixed

- Existing users lost all sidebar channels after v0.20.1 upgrade because `ogmara_joined_channels` key didn't exist yet — now auto-seeds from current channel list on first authenticated load

## [0.20.1] - 2026-04-02

### Fixed

- Sidebar now only shows joined channels + default "ogmara" channel (was showing all public channels)
- Channel join/create/leave/delete properly tracks membership in localStorage
- ChannelSettingsView now displays channel details (name, description, owner, member count) for all users
- Renamed "Channel Settings" to "Channel Details" for non-admin/non-moderator users
- Hardcoded "Delete channel" text now uses i18n key

### Added

- `channel_details` and `channel_delete` i18n keys in all 7 locales
- Exported `addJoinedChannel` / `removeJoinedChannel` helpers from Sidebar for cross-component use

## [0.20.0] - 2026-04-02

### Added

- **Message rendering**: deleted (placeholder), edited (indicator with tooltip), muted (dimmed, click-to-expand) message states in chat, DMs, and news
- **Chat actions**: edit (pencil, 30 min window), delete (trash, confirm), reactions (inline emoji picker with 7 emojis) on channel messages
- **DM actions**: edit, delete, reactions on direct messages with same patterns as chat
- **News edit/delete**: edit button (own posts, 30 min, registered users), delete with confirmation, ComposeView edit mode via `?edit=<msgId>` route parameter
- **Notifications page**: new `/notifications` route with type icons (mention, reply, follow, DM), 30s polling, click-to-navigate
- **Moderation**: report button in chat context menu and news detail, trust score display on user profiles
- **Settings sync**: encrypted upload/download of user preferences (theme, lang, sounds, compact, fontSize) using HKDF + AES-256-GCM
- **Data export**: download account data as JSON file from settings
- **i18n**: 38 new translation keys across all 7 locales (EN, DE, ES, PT, JA, ZH, RU)
- WebSocket handling for ChatEdit and ChatDelete events with optimistic local updates
- Reaction badges display below messages showing emoji + count

### Changed

- Chat messages now show hover action buttons (reply, react, edit, delete) instead of just reply
- Sidebar now includes Notifications nav item for authenticated users
- ComposeView supports edit mode with pre-filled fields from existing post

## [0.19.13] - 2026-04-02

### Removed
- **Debug diagnostics from Settings** — removed L2 device address display,
  device mapping failure warning, and error detail text that were added during
  K5 device mapping debugging. Cleaned up unused imports and CSS classes.

## [0.19.9] - 2026-04-02

### Fixed
- **Admin dashboard hidden for channel owner** — `isOwner()` relied on finding the
  user in the members list with role `"creator"`, but channels created via chain
  scanner never added the creator as a member. Now uses `channel.creator` field
  from channel detail response instead.
- **Missing `nav_back` i18n key** — added "Back" translation across all 7 locales.

## [0.19.12] - 2026-04-02

### Fixed
- **K5 device registration: device-signed fallback** — when `signMessage`
  fails (K5 mobile browser doesn't support it), the device key now signs the
  claim itself. The L2 node accepts device-signed claims if the wallet is a
  registered on-chain user. Combined with the server-side fallback in v0.9.6,
  this enables full cross-device sync on K5 mobile.

## [0.19.11] - 2026-04-02

### Fixed
- **K5 mobile wallet device registration failing** — `signMessage` was called
  on `window.kleverWeb` but the Klever wallet provider API exposes it on
  `window.klever` instead. K5's browser injects `window.klever` for wallet
  operations. Now tries `window.klever.signMessage()` first, falls back to
  `window.kleverWeb.signMessage()`. This fixes device→wallet registration,
  which fixes private channel sync, DM sync, and bookmark sync on K5 mobile.
- Extension detection now checks both `window.kleverWeb` and `window.klever`.
- Added device mapping status and L2 address display in Settings for debugging.

## [0.19.8] - 2026-04-02

### Fixed
- **Sidebar flickering on auto-refresh** — channel list no longer flashes a loading
  state during background polling. Loading fallback only shows on initial load.
- **Channel delete confirm not i18n'd** — replaced hardcoded English string with
  `channel_delete_confirm` translation key across all 7 locales.

## [0.18.1] - 2026-04-02

### Changed
- **Compact reaction picker** — reactions no longer show all 4 buttons by default.
  Shows a single greyed-out thumbs-up; clicking opens a popup to select a reaction.
  Only reactions with counts > 0 are displayed. Saves row space on news posts.
  Extracted shared `ReactionPicker` component used in both feed and detail views.

## [0.18.0] - 2026-04-01

### Fixed
- **DM send handler** — now uses `buildDirectMessage` to create a proper signed
  envelope instead of passing raw text to `sendDm`. Messages are correctly
  serialized as DirectMessage envelopes with conversation_id.
- **DM conversation list** — field names aligned with SDK types (`conv.peer`
  instead of `conv.peer_address`). Typed with `DmConversation` instead of `any`.
- **Mark-as-read on conversation open** — calls `client.markDmRead()` when
  entering a DM conversation to clear unread badges.

## [0.17.0] - 2026-04-01

### Added
- **Unread message badges** on sidebar channels. Polls server every 30s
  for per-channel unread counts. Total unread shown on collapsed channels
  heading. Channels marked as read when entering the chat view.
  Synced across devices via L2 node read-state storage.

## [0.16.0] - 2026-04-01

### Added
- **Chat improvements:**
  - 3-line textarea instead of single-line input (Enter sends, Shift+Enter newline)
  - Cursor focus returns to input after sending
  - Emoji picker (😊 button) with categorized standard emojis, inserts at cursor position
  - Messages show author avatar + display name + verified badge instead of wallet address
  - Optimistic local message display — sent messages appear instantly before server confirmation
- `media_hint` i18n key showing allowed file types and max size below attach button.

## [0.15.0] - 2026-04-01

### Added
- **Media attachment rendering** — images display inline in news posts,
  thread view, and comments. Non-image attachments show as download links.
  Thumbnails used when available. Images clickable to open full size.
- Payload decoder now extracts `attachments` array from MessagePack payloads.

### Fixed
- Payload decoding optimized — single decode per post/comment instead of
  5 separate decodes for title/content/tags/attachments.

## [0.14.0] - 2026-04-01

### Changed
- **Sidebar reorganized** — now contains: News, Channels (collapsible,
  default collapsed), Messages, Bookmarks, Search, Settings. Active view
  is highlighted.
- **Toolbar simplified** — removed search/bookmarks/settings icons. Profile
  shows avatar + display name + verified badge instead of wallet address.
- **Channels collapsible** — click the arrow to expand/collapse the channel
  list. Default collapsed to save space.

## [0.13.1] - 2026-04-01

### Added
- **Mobile responsive** — sidebar auto-collapses on screens ≤768px, opens as
  overlay below toolbar with shadow, auto-closes after navigation. Toolbar
  hides brand and shrinks nav/buttons on mobile. News action buttons wrap to
  second line. Profile address uses `overflow-wrap: anywhere`.

## [0.13.0] - 2026-04-01

### Changed
- **Dark theme is now the default** — `:root` uses dark colors, preventing
  flash of light theme in browsers that don't report `prefers-color-scheme`.
- **Profile cache with TTL** — populated profiles expire after 5 min, empty
  (not-found) profiles after 30 sec. Prevents stale profile data display.
- **Removed K5 wallet connect** — only Klever Extension connect remains,
  renamed to generic "Connect Wallet".

## [0.12.2] - 2026-04-01

### Fixed
- **Reverted toolbar/sidebar redesign** that broke desktop and mobile layouts.
  Restored v0.11.0 toolbar (nav tabs + wallet button) and sidebar (channels +
  DMs). Kept dark theme as default and profile cache TTL fix.

## [0.12.1] - 2026-04-01

### Fixed
- Mobile layout: removed `min-width: 360px` that caused horizontal overflow,
  added `overflow-x: hidden` and proper padding for all page views on narrow
  screens. Main content area now has `min-width: 0` to prevent flex overflow.

## [0.12.0] - 2026-04-01

### Changed
- **Toolbar redesign** — stripped down to hamburger menu + app name + profile
  avatar/name/checkmark. All navigation moved to sidebar.
- **Sidebar restructured** — now contains: News, Channels (collapsible),
  Messages, Bookmarks, Search, Settings. Channels section can be collapsed
  to save space when there are many.
- **Dark theme is now the default** — `:root` defaults to dark instead of
  light, preventing flash of light theme in browsers that don't report
  `prefers-color-scheme` (e.g., in-app wallet browsers).
- **Removed K5 wallet connect** — only Klever Extension connect remains,
  renamed to generic "Connect Wallet".
- **Profile cache with TTL** — cached profiles now expire (5 min for
  populated, 30 sec for not-found) to prevent stale data after profile
  updates.

## [0.11.0] - 2026-04-01

### Added
- **Mobile responsive design** — sidebar auto-collapses on screens ≤768px,
  opens as overlay with shadow. Toolbar hides brand text and shrinks on
  mobile. News action buttons wrap instead of overflowing. Profile address
  wraps correctly instead of breaking character-by-character.
- Sidebar auto-closes after navigation on mobile.

## [0.10.2] - 2026-04-01

### Changed
- Profile page simplified — all data fetched by wallet address (L2 node
  resolves identity server-side). Removed dual device-key/wallet-address
  profile fetching logic.

## [0.10.1] - 2026-04-01

### Fixed
- Profile posts now match both wallet address and L2 device key, so posts
  show up correctly for Klever Extension users.

## [0.10.0] - 2026-04-01

### Added
- **Media attachments** — new `MediaUpload` component enables file uploads
  (images, video, audio, documents up to 10 MB) for both news posts and
  thread comments. Files are uploaded to IPFS via the L2 node and attached
  as `Attachment` objects in the envelope payload.
- Client-side self-repost prevention with clear error message ("You cannot
  repost your own post") instead of relying on the server-side rejection.

### Changed
- Action error messages (reactions, reposts, bookmarks) are now displayed
  as a visible banner with a left border accent instead of tiny text.

## [0.9.1] - 2026-04-01

### Changed
- Comments button on news cards is now visually muted when a post has no
  comments, highlighted when it does.
- Removed 😂 (Funny) reaction from the predefined reaction set.

## [0.9.0] - 2026-04-01

### Added
- **News thread view** — new `NewsDetailView` page at `#/news/:msgId` showing
  the full post with all comments in a threaded layout. Authenticated users can
  post comments and reply to specific comments with a reply-to indicator.
- **Comment count on news feed** — each news card now shows a comment count
  button that links directly to the thread view. Post titles are also clickable.
- **Bookmarks show full content** — bookmarks page now decodes and displays
  actual post title, content, and author profile instead of placeholder text.
  Cards are clickable and navigate to the post's thread view. Added remove
  bookmark button.
- Shared utility modules (`lib/profile.ts`, `lib/news-utils.ts`) for profile
  caching with in-flight deduplication and common news helpers, eliminating
  code duplication across views.
- i18n keys for thread/comment UI across all 7 languages (en, de, es, pt,
  ja, zh, ru).

### Fixed
- Bookmarks and comment posting now use SolidJS `refetch()` instead of
  `window.location.reload()`, preserving client-side state.
- Profile signal type in `NewsCard` now includes `verified` field.

## [0.8.0] - 2026-04-01

### Added
- **Device-to-wallet identity mapping** — when connecting via Klever Extension,
  the web app now registers the local device key on the L2 node under the
  wallet address. All messages/data from this device are indexed under the
  wallet identity. Uses wallet-signed claim via `window.kleverWeb.signMessage()`.
  Registration is cached in localStorage to avoid re-registration on page reload.
  Falls back gracefully if the node is unreachable.
- `signer.walletAddress` is restored on app startup for extension/K5 sessions.

## [0.7.5] - 2026-04-01

### Added
- **Wallet section in Settings** — shows connected wallet address and source,
  with links to "My Profile" and "Wallet Settings" (where disconnect lives).
  Shows "Connect Wallet" button when not connected.

## [0.7.7] - 2026-04-01

### Fixed
- **On-chain registration used wrong public key** — was passing the device
  key's public key to the SC register endpoint instead of the Klever Extension
  wallet's public key. Now decodes the bech32 wallet address to extract the
  actual 32-byte Ed25519 public key for registration.

## [0.7.6] - 2026-04-01

### Fixed
- **Wallet source not restored on reload** — `walletSource` was missing from
  the Settings interface, causing `getSetting('walletSource')` to always return
  undefined. Added to settings schema.
- **CSS selector injection** — `scrollToMessage` now uses `CSS.escape()` to
  sanitize msg_id before interpolating into querySelector
- **Chat auto-scroll** — only scrolls to bottom when user is near the bottom
  or on first load, no longer interrupts reading history
- **WalletButton race** — null-safe address check prevents navigate to `/user/null`
- **Performance** — `allMessages` and `msgById` wrapped in `createMemo` to avoid
  redundant dedup/sort/map-building on every render access

## [0.7.5] - 2026-04-01

### Fixed
- **CRITICAL: Auth signatures broken** — Vite was resolving `@noble/ed25519`
  v1.7.5 from `~/node_modules/` instead of v2.3.0 that the SDK was built with.
  v1.x produces incompatible signatures, causing all authenticated API calls
  (messages, profile, bookmarks, reactions) to fail with 401. Fixed by adding
  `@noble/ed25519` v2.3.0 as a direct dependency and aliasing in vite.config.ts.
- Wallet disconnect now redirects to news, prevents null address crash
- Settings page shows wallet section with profile/wallet links

## [0.7.4] - 2026-04-01

### Fixed
- **Profile data mismatch with Klever Extension** — profile updates were stored
  under the device key address but the profile page fetched from the extension
  address. Added `l2Address` signal tracking the device signing key. Profile
  page now fetches L2 data from the device key address when using the extension.
  Shows "L2 signing key" hint when addresses differ.

## [0.7.3] - 2026-04-01

### Fixed
- Avatar upload error now shows the actual API error detail instead of a
  generic "not available" message, for better debugging

## [0.7.2] - 2026-04-01

### Fixed
- **Wallet address persistence** — Klever Extension address was lost on page
  reload (initAuth restored the built-in device key address instead). Now
  persists walletSource and walletAddress to localStorage and restores them
  on startup. Fixes wrong address on profile, missing verified badge, and
  verify button still showing after successful registration.
- **SC register call format** — base64-encoded txData, hex-encoded public key
  string for the ManagedBuffer(64) check in the smart contract

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

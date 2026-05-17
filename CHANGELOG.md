# Changelog

All notable changes to the Ogmara web application will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.34.0] - 2026-05-17

Brings the Global / Following feed picker from desktop v1.21.0 to web
so the two clients stay feature-parity. Wires the long-existing
`client.getFeed()` SDK method (auth-required, returns posts from
followed users) to a UI for the first time on the PWA.

### Added
- **Global / Following pills in the sidebar's Feed tab.**
  [src/components/Sidebar.tsx](src/components/Sidebar.tsx) replaces
  the placeholder card with two click-targets. The active pill follows
  the live URL query (`#/news?feed=global` vs `#/news?feed=following`)
  so opening a post detail and coming back keeps the right pill lit.
  Tab switches preserve the feed mode via `lastFeedRoute`.
- **`defaultFeed: 'global' | 'following'` setting.**
  [src/lib/settings.ts](src/lib/settings.ts) persists the user's last
  chosen mode in localStorage. NewsView writes it via a
  `createEffect` whenever the resolved mode changes, so a power user
  who always wants Following on launch gets that automatically — no
  settings UI required.
- **NewsView reads the feed mode reactively.**
  [src/pages/NewsView.tsx](src/pages/NewsView.tsx) computes
  `feedMode` from `queryParam('feed')` falling back to the saved
  default, then keys a `createResource` off it so switching pills
  triggers an immediate refetch. The header title swaps between
  **News Feed** and **Following** accordingly.
- **Anon value-prop card when an unauthenticated user clicks
  Following.** Instead of hiding the option (which removes a teaching
  moment for new visitors) or silently returning an empty list, we
  show a centered card with three bullets explaining why a wallet
  matters on Ogmara (own your identity, curate your feed, portable
  across web/desktop/mobile) plus a single **Connect wallet** CTA
  routing to `/wallet`. The Following pill itself is rendered with
  reduced opacity + a 🔒 affix so the gating is obvious before the
  click.
- **12 new i18n keys × 7 languages.** `news_feed_global`,
  `news_feed_global_desc`, `news_feed_following`,
  `news_feed_following_desc`, `news_feed_following_locked_hint`,
  `news_feed_following_empty`, plus the five
  `news_following_anon_*` strings for the value-prop card. All seven
  supported locales (en, de, es, pt, ja, zh, ru) carry hand-localized
  copy — no machine-translated strings.

## [0.33.0] - 2026-05-15

### Fixed
- **Videos on news posts + comments now play inline.** Both `NewsView`
  (feed cards) and `NewsDetailView` (detail page + comments) previously
  rendered every non-image attachment as a download link, so video
  uploads showed up as a paperclip even though the browser would have
  played them fine. Added an explicit `video/*` branch that emits an
  `<video controls preload="metadata">` element with the same sizing
  treatment as inline images. Browsers ship native H.264/AAC, so this
  works without any of the GStreamer codec dance the desktop build has
  to deal with.
- **News edit no longer loses title, tags, or attachments.** The compose
  page now preloads `title`, `content`, `tags`, **and `attachments`**
  from the existing post when entering edit mode, keeps the MediaUpload
  widget visible (previously hidden in edit mode), and forwards the
  attachment list to `editNews`. Pairs with the L2 v0.37 projection
  fix that no longer flattens edited posts to a content string.
- **Emoji picker is now available on the news compose page.** Mirrors
  the picker already present on chat + DMs — opens via a 😊 button
  next to the content textarea and inserts at the current caret
  position.
- **Save button stays disabled when the post-to-edit fails to load.**
  Previously, hitting Save after a failed fetch would overwrite the
  original post with empty title/tags/content. The form now keeps
  Save disabled until the existing post loads cleanly, and surfaces
  a visible error if the fetch fails.
- **Optimistic chat/DM messages with attachments render immediately.**
  Both `ChatView.handleSend` and `DmConversationView.handleSend`
  previously dropped the attached image/video into the bubble as a
  plain-string payload, which made `getPayloadAttachments` return `[]`
  and the file vanish until the WebSocket echo arrived. They now
  encode a real msgpack payload via `buildOptimisticChatPayload` so
  the bubble looks identical before and after the server roundtrip.
- **Optimistic chat-edit preserves attachments + mentions visually.**
  `ChatView.handleEdit` now uses `rewriteContentInPayload` to swap
  just the `content` field inside the existing msgpack payload, so
  attachments, mentions, and `reply_to` survive the local update
  until the server echo lands. Pre-fix the entire payload was
  replaced with the new content string, which made attached media
  disappear from the bubble at the moment of save.

### Added
- **`src/lib/sanitize.ts`.** Centralizes `stripBidi()` for untrusted
  text reaching JSX (chiefly attachment filenames). Future audits can
  grep for the import to confirm every boundary is gated.
- **`safeAttachmentName(att)`, `buildOptimisticChatPayload(...)`, and
  `rewriteContentInPayload(...)` in `src/lib/payload.ts`.** Mirrors the
  desktop helpers — keeps the two apps' rendering and optimistic-update
  paths consistent.

### Security
- All attachment filenames now flow through `safeAttachmentName()`
  before reaching JSX or the browser's `download=` attribute. A
  hostile uploader can no longer slip a U+202E into a filename to
  visually swap the extension shown in the message bubble.

## [0.32.2] - 2026-05-13

### Fixed
- **Empty sidebar after fresh browser / cleared cookies + cache.** The
  joined-channel filter is stored in localStorage as
  `ogmara_joined_channels` and gates which channels appear in the
  sidebar list. The first-time migration only seeded the default
  `ogmara` channel — networks without that channel ended up with a
  permanently empty sidebar even though the API returned a full
  catalog of channels the user could access. Direct navigation
  (`/chat/<id>`) still worked because routing isn't gated by the
  filter; that mismatch is what made the bug obvious. Fix: on the
  very first migration after install / storage clear, seed the
  joined set with every channel the API returns (private ones are
  already pre-filtered to members; public ones form the visible
  catalog). Subsequent syncs continue to only auto-add private
  channels, and the user can still explicitly leave channels.

## [0.32.1] - 2026-05-12

### Changed
- **More visible mention highlight.** v0.32.0's mention bubble tint was
  too close to the regular bubble background to read at a glance. Bumped
  the Modern bubble's accent mix from 14% → 28%, added a thicker accent
  border (65% mix vs 40%), a 3-px left stripe via `::before`, and a soft
  outer glow shadow so the bubble pops without overwhelming the chat
  flow. Classic mode's stripe was kept (just slightly stronger tint).
- **Inline `@username` mentions colorized.** `FormattedText` now matches
  `@klv1<bech32>` and `@<DisplayName>` tokens in message content
  alongside hashtags, rendering each as an accent-tinted pill. `@klv1…`
  pills are clickable and navigate to the user profile; display-name
  pills are visual-only because the resolved address isn't available
  from the text alone (it's stored separately in `payload.mentions[]`).
  Picks up automatically inside chat messages, news posts, and
  comments — anywhere `FormattedText` is used.

## [0.32.0] - 2026-05-12

### Added
- **Highlighted message bubbles for @-mentions.** Chat messages whose
  payload `mentions[]` contains the viewer's wallet address now render
  with an accent-tinted background and an accent left-border in
  Classic style, plus an outlined accent fill in Modern. A hover
  tooltip (`You were mentioned`) labels the highlight for clarity.
  Skips own messages, deleted/muted messages, and unauthenticated
  views. Works in both light and dark themes via `color-mix()` over
  existing CSS theme tokens.
- **Sidebar `@` indicator on channels with unread mentions.** The
  channel list (both Classic and Modern) now shows a small amber
  `@` badge next to the existing unread count for any channel that
  contains at least one unread message in which the viewer was
  @-mentioned. Surfaces *where* you were pinged without opening each
  channel. Counts come from `getUnreadCounts().mentions` (l2-node
  ≥ v0.33.0); older nodes simply show no indicator.
- **Share links for news posts and chat messages.**
  - News post **Share button** in the detail-view action bar (next
    to Bookmark/Tip) and a small 🔗 share icon on each news feed
    card. Copies `https://ogmara.org/app/#/news/<msg_id>` to clipboard.
  - Chat message **"Copy link to message"** entry in the right-click
    / long-press context menu. Copies
    `https://ogmara.org/app/#/chat/<channel_id>?msg=<msg_id>`.
  - **Deep-link consumer in `ChatView`.** When a chat URL carries
    `?msg=<hex>`, the view scrolls to and momentarily highlights the
    target message after load. If the message is older than the
    initial page, the view auto-paginates older history up to 3
    times before falling back to a "Message not found" toast.
  - Share base is hardcoded to `https://ogmara.org/app` so recipients
    always land on a working URL regardless of where the sharer runs
    the client (web / desktop / self-hosted).
  - Clipboard helper has a `document.execCommand('copy')` fallback
    for insecure-context / older-browser scenarios.

### Changed
- `lib/payload.ts` exposes a new `getPayloadMentions(payload)` helper
  shared by ChatView's mention-highlight check.
- `i18n` keys added to all 7 locales (EN / DE / ES / PT / JA / ZH / RU):
  `share`, `share_news_link`, `share_message_link`, `share_link_copied`,
  `share_link_failed`, `share_link_unavailable`, `chat_mention_you`,
  `sidebar_mentioned_here`.

## [0.31.2] - 2026-05-11

### Fixed
- **Regression from v0.31.1: opening a sidebar context menu in Modern
  broke the main window layout.** When v0.31.1 moved the menus out of
  the classic-fallback `<aside>` into a shared helper, it didn't move
  the `.channel-context-menu` / `.context-menu-item` CSS rules — those
  still lived inside the classic aside's `<style>` block, which never
  renders in Modern. With no `position: fixed` and no `display: block`
  on items, the menu became a flex child of `.app-body`, consumed
  layout space, and pushed the main content into a narrow column on
  the right with the menu items strung horizontally across the top.
  Co-located the needed CSS rules inside `sharedContextMenus()` via
  an inline `<style>` so they always apply, regardless of which style
  is active.

## [0.31.1] - 2026-05-11

### Fixed
- **Modern sidebar: right-click context menu missing.** The two `<Show>`
  blocks rendering the channel menu (mark-read / settings / leave /
  delete) and the member menu (profile / kick / ban / promote / demote)
  lived inside the *classic* fallback `<aside>` in `Sidebar.tsx`, so the
  Modern style wired up the `onContextMenu` handler but no menu UI ever
  mounted — leaving Modern users with no way to leave or delete a
  channel, or to moderate members. Extracted both `<Show>` blocks into a
  `sharedContextMenus()` helper rendered at the top level of the
  component, so both styles get them. Functions and signals it closes
  over (`contextMenu`, `memberMenu`, `handleMemberAction`,
  `handleMarkRead`, `isModOrOwner`, `isOwner`, `walletAddress`) are all
  in the component scope, unchanged.
- **Optimistic messages render as empty bubbles in public channels.**
  `tryDecodeBase64Payload` in `payload.ts` ran `atob()` on plain text;
  any string using only base64-valid characters (e.g. `"Hello"`)
  succeeds with garbage bytes, the subsequent msgpack decode then fails
  into `{ content: '' }`, and the caller's `?.content ?? payload`
  returned the empty string (because `??` only triggers on
  null/undefined). Users saw a bubble with only a timestamp until they
  left and re-entered the channel and the API refetch delivered the
  real binary payload. **Fixed** by returning `null` from
  `tryDecodeBase64Payload` when the decode yields no recognizable
  payload fields (no content/title/media_cid/attachments), so callers
  fall back to treating the string as the literal content. Confirmed
  no impact on legitimate payloads (every chat message has `content`
  per `sdk-js/src/envelope.ts:chatMessagePayload`).
- **Edit message via right-click silently failed.** A side effect of
  the empty-bubble bug above: `startEdit` prefilled the composer with
  `getPayloadContent(payload)` which returned `''`; clicking Send hit
  `handleEdit`'s `if (!newContent) return` and bailed without any
  user-facing signal. The payload fix above resolves the root cause.
  As a defense-in-depth measure, `handleEdit`'s `catch` now writes to
  the existing `sendError` banner (and `console.error`) instead of just
  `console.warn`, matching the `handleSend` error pattern so future
  edit failures aren't invisible.

## [0.31.0] - 2026-05-07

### Changed
- **Dynamic, unread-aware message loading** — channels no longer fetch
  a fixed 200 messages on every switch. Initial fetch is `clamp(50,
  unreadCount + 20, 200)`, so a channel with 120 unread messages
  loads 140 (all unread plus 20 lines of context above the divider),
  while a quiet channel loads only 50. Older history is fetched on
  scroll-to-top in 50-message pages, with viewport position
  preserved across the prepend so the user stays anchored. Eliminates
  the multi-second freeze on rapid channel switching, especially in
  high-traffic channels.

### Performance
- **Cancel in-flight fetches on channel switch** — the messages
  resource now wires an `AbortController` so requests for a previous
  channel are aborted when the user clicks a new one. Prevents
  out-of-order state updates and reduces wasted network/CPU.
- **Cache per-channel role lookup** — `getChannelMembers({limit:200})`
  was firing on every channel open just to determine the viewer's
  role for permission gating. Now cached in-memory for 30 s keyed by
  `channelId+walletAddress`. Removes one full-fan-out request per
  switch on cache hit.
- **Break the profile-resolver feedback loop** — the effect that
  resolves author profiles read `profiles().has(addr)` and also
  called `setProfiles()` from inside its own `.then()` handler,
  causing the effect to re-run on every individual resolution
  — O(N²) on author count per channel switch. The read is now
  wrapped in `untrack()` so the effect only re-runs when
  `allMessages()` changes.
- **Defer `markChannelRead` to a microtask** — the read marker no
  longer shares a frame with the channel-switch click handler.
- Incremental poll fetch trimmed from 200 → 50 messages.

## [0.30.2] - 2026-05-07

### Fixed
- **Search results omitted users** — `SearchView` only queried
  `listNews()` and `listChannels()`. Even though `client.searchUsers()`
  was added in v0.30.1, the search page never adopted it, so typing a
  display-name prefix returned posts and channels but never users.
  Now fetches users in parallel via `client.searchUsers(query, 20)`
  (skipped for `#hashtag` queries — display-name prefix isn't
  meaningful there). Renders a new "Users" results section above
  channels with avatar, display name, verified checkmark, and
  truncated address; clicking navigates to the user profile page.
  Pairs with `l2-node` v0.32.0+; older nodes return 404 and the
  user section silently stays empty.

## [0.30.1] - 2026-05-07

### Fixed
- **`@`-mention popover never opened** — the v0.30.0 `MentionPopover`
  used `textareaRef: HTMLTextAreaElement | undefined` and was passed
  a plain `let inputRef` from the composer. SolidJS refs are assigned
  to plain locals AFTER mount, but plain `let` variables aren't
  reactive — so the popover's `createEffect` saw `undefined` on first
  run and never re-bound when the textarea actually mounted. Result:
  the input/keydown listeners were never attached, popover stayed
  silent on `@` typed.

  Fix: converted `textareaRef` to a SolidJS accessor
  (`() => HTMLTextAreaElement | undefined`). `ChatView` and
  `NewsDetailView` now use `const [inputRef, setInputRef] =
  createSignal<HTMLTextAreaElement>()` with `ref={(el) => setInputRef(el)}`,
  and pass the accessor (`textareaRef={inputRef}`) so the popover's
  effect subscribes to the signal and re-binds once the element
  mounts. All other call sites updated to invoke as `inputRef()`.
- **Sidebar minimum width** bumped 280 → 360. 320 was an interim value
  that still left the bell button flush against the right divider —
  and because the 1px border between sidebar and right pane is barely
  visible against the similar dark-blue backgrounds, users perceived
  the bell as overlapping into the main pane even when it structurally
  wasn't. 360px gives the bell ~28px of clear space from the divider
  and reads as proper visual separation. Also added 4px extra
  right-padding on `.sidebar-header` so the bell sits inset rather
  than flush.

## [0.30.0] - 2026-05-06

### Added
- **`@`-mention autocomplete popover** — Telegram-style picker that
  opens when the cursor enters a fresh `@<prefix>` token in any wired
  composer. Pairs with `l2-node` v0.32.0+ and `@ogmara/sdk` v0.15.0+.
  Component: `src/components/MentionPopover.tsx`.
  - Trigger: `@` at start of input or after whitespace; closes when
    the prefix contains whitespace or another `@`.
  - Debounced 150ms server search via `client.searchUsers(prefix, 20)`.
  - In-memory 30s cache per prefix so re-typing is instant.
  - Keyboard nav: ↑/↓ to move, Enter or Tab to select, Esc to close.
  - On select: replaces `@<prefix>` with `@<DisplayName>` (or short
    address if no name) and pushes the resolved `klv1...` into the
    composer's `pendingMentions` set.
  - Renders verified checkmark for on-chain registered users.
- **Wired into `ChatView` chat composer** (Modern + Legacy textareas
  share the same `inputRef`, so a single popover serves both).
  `pendingMentions` is merged with raw `@klv1...` tokens still parsed
  from the message text — power users who paste full addresses keep
  working alongside autocomplete users.
- **Wired into `NewsDetailView` comment composer** with the same
  pattern. Merged mentions are passed to `client.postComment(...,
  { mentions })`.
- **3 new i18n keys** in all 7 locales (en, de, es, pt, ja, zh, ru):
  `mention_no_results`, `mention_popover_label`, `user_verified`.

### Fixed
- **Sidebar minimum width** bumped from 200px → 280px in
  `components/Sidebar.tsx`. At 200px the Modern header (`burger +
  search input + bell`) was so cramped that the right pane appeared
  to overlap the sidebar's search bar. 280px matches Telegram
  desktop's minimum and keeps every header control fully visible.
  Existing users with `ogmara.sidebarWidth=200` saved auto-bump to
  280 on next load via the existing `Math.max(SIDEBAR_MIN_W, …)`
  guard — no migration needed.

### Notes
- DM and `ComposeView` (news posts) composers are NOT yet wired —
  `DirectMessage` payloads are end-to-end encrypted and don't carry
  a plaintext mentions field, and `NewsPostPayload` doesn't have a
  `mentions` field at all per protocol spec §3.5. Those would
  require a wire-format extension first; deferred to a future
  release.
- The popover positions itself anchored to the textarea's top-left,
  rendering above the input via CSS transform (no per-character caret
  tracking — the typical Telegram/Discord pattern that works well
  enough without a hidden mirror element).

## [0.29.0] - 2026-05-05

### Added
- **Read-only / broadcast channel UI (paired with `l2-node` v0.31.0 and
  `@ogmara/sdk` v0.14.0).** When a channel's runtime `channel_type` is
  `ReadPublic` (1), `ChatView` now hides the entire composer stack
  (input, attachments, edit/reply indicators) for non-creator/non-mod
  viewers and replaces it with a `📢` broadcast banner explaining that
  only moderators can post here. Reactions remain enabled per-message.
  Creators and moderators see the normal composer.
- **Posting-mode toggle** in `ChannelSettingsView` (creator + mods with
  `can_edit_info`, never visible for Private channels). Flips the channel
  between `Public` (open chat) and `ReadPublic` (broadcast) at runtime by
  publishing a `ChannelUpdate` envelope with the new `channelType` field.
  Local change propagates via the existing `ogmara:channels-changed`
  event so the sidebar and other open views refresh immediately.
- **Broadcast indicator in `Sidebar`.** `ReadPublic` channels now show a
  📢 icon in both the joined-channel list and the search-result rows,
  alongside the existing 🔒 indicator for Private channels. The
  description fallback line uses a new `sidebar_broadcast_channel` label
  when the channel has no description set.
- **9 new i18n keys** in all 7 locales (en, de, es, pt, ja, zh, ru) —
  `chat_broadcast_only`, `channel_posting_mode_label`,
  `channel_posting_mode_public_desc`,
  `channel_posting_mode_readonly_desc`,
  `channel_posting_mode_make_public`,
  `channel_posting_mode_make_readonly`,
  `channel_posting_mode_saved`, `channel_posting_mode_failed`,
  `sidebar_broadcast_channel`.

### Notes
- Posting policy is enforced server-side at the L2 node — the UI gate is
  a UX affordance only. A non-mod that bypasses the local UI hits 403
  (`broadcast_channel_post_denied`) from the API.
- Bumped `@ogmara/sdk` peer to v0.14.0 (file: dependency, no lock change
  needed).

## [0.28.1] - 2026-05-02

### Security
- **Bumped `postcss` to ≥ 8.5.10 via overrides** — addresses CVE-2026-41305
  (Dependabot alert #3, medium severity: XSS via unescaped `</style>` in CSS
  stringify output). PostCSS is a transitive build-time dep via Vite; the
  vulnerable code path requires parsing user-submitted CSS, which Ogmara
  doesn't do. Bumped anyway so the security tab is clean.

## [0.28.0] - 2026-05-01

### Added
- **"Modern" design style** — opt-in 5th style selectable in Settings. Features:
  - Tabbed sidebar (Chat / News / Messages) with pill-button tabs
  - Burger menu in sidebar header (profile, wallet, settings, theme, create, disconnect)
  - Bubble-style chat with avatars outside, own messages right-aligned with accent tint
  - Inline timestamps (float right inside message text)
  - Right-click context menu with expandable emoji reaction row
  - Channel header with logo, name, member count, search + settings buttons
  - DM conversation list in sidebar with avatar, name, preview, unread badge
  - Mobile single-pane navigation with reactive viewport switching
  - Back arrow on mobile detail views
  - Uniform dark background across all areas
  - Dedicated `chat-view.css` with bubble/reply/reaction/scroll-FAB/unread-divider
    styling — scoped under `[data-style="modern"]` via CSS native nesting so it
    has zero effect on Classic / Glassmorphism / Elevated / Minimal.
- **Color scheme selector** — accent color dropdown in Settings
  (Ogmara Blue, Amber, Teal, Violet, Coral, Neutral Gray). Works with all styles.
  Synced across devices via the existing settings-sync flow.
- **Network activity bar** — animated 2px bar under toolbar, shows loading state
  for L2 node requests. Warning label after 1.5s slow threshold.
- **Mobile navigation** — reactive viewport signal, single-pane layout below 768px,
  automatic switch between list/detail views on resize.
- **Resizable sidebar** — drag handle on right edge (200–600px), width persisted
  in localStorage.
- **Floating date header** — appears on scroll showing current date, auto-hides
  after 2 seconds.
- **Scroll-to-bottom FAB** — floating button with unread message badge counter.
- **Channel avatar upload** — upload, change, remove channel logo in settings.
- **Channel member list** — full member list with avatars, display names,
  verified badges, and role indicators.
- **Timestamp normalization** — handles ISO strings, numeric strings, and unix
  seconds/milliseconds transparently across all views.
- **Bare `/chat` route restores the last visited channel** — opening `#/chat`
  with no channel ID falls back to `lastChannel` from settings if available.
- **Context-menu second-pass viewport clamp** — the right-click menu re-measures
  its actual size after mount and nudges back into the viewport if the static
  pre-clamp underestimated (e.g. all moderator actions visible on a small window).
- **Device-mapping verification + banner** — after each Klever-extension auth
  success we now query `GET /api/v1/devices` and confirm the L2 node has a live
  device → wallet mapping for the current session. If the resolver returns the
  wrong wallet or our device isn't in the list, a warning banner appears across
  the top of the app explaining that private channels, DMs, notifications and
  channel-admin actions won't work, with a one-click "Link this device" button
  that re-runs the on-node device registration through the extension. Closes a
  silent-degradation failure mode where a session looked authenticated but every
  request resolved to an orphan `ogd1...` identity.

### Changed
- **Modern is the new default design style for new users.** Existing users keep
  whatever style they had selected — only fresh installs (no `ogmara.designStyle`
  in localStorage) pick up the new default. Settings list reordered so Modern
  appears first.
- **All user-facing strings now go through i18n** — replaced hardcoded German
  fallbacks in `theme.ts`, `ChannelSettingsView.tsx`, and `SettingsView.tsx`
  with `t()` calls. Adds `color_scheme_*`, `channel_logo_*`, `channel_no_members`,
  `channel_moderator`, `channel_verified` keys to all 7 locales.
- **`chat_member_count` translation** — added to es, ja, pt, ru, zh
  (was previously only in en/de).
- **Settings-style grid uses `auto-fit`** — replaces fixed `repeat(4, 1fr)`
  so the new 5-style grid no longer wraps with an orphan tile.
- **Settings sync now covers `theme`, `designStyle`, and `colorScheme`** as
  raw-string keys, fixing a pre-existing JSON round-trip bug for `theme`.

### Fixed
- **News tab landed on a previously-open detail post**, not the feed. The
  modern sidebar tracked the last route per tab and stickied the URL even
  when it was a `news-detail` or `compose` view. Now the tracker only
  sticks on the bare `/news` list — clicking the News tab always returns
  to the feed.
- **"Back to feed" from a news post** went to the last visited chat, not
  the feed, because `goBack()` falls through to browser history. Replaced
  with an explicit `navigate('/news')` so the label matches the action.
- **Selected channel row in modern sidebar** used the fully-saturated accent
  color, making the channel description (rendered in `--color-text-secondary`)
  almost unreadable. Replaced with a new `--color-chat-active-bg` token —
  `color-mix(in srgb, var(--color-accent-primary) 38%, var(--color-bg-secondary))`
  — so the selection remains visually prominent but text contrast holds across
  all 6 color schemes.
- **`package.json` version** now matches the CHANGELOG entry (was 0.27.2).
- **Modern style no longer overrides `--font-size-*` tokens** — only colors,
  radii and shadows differ between styles per project convention.
- **Modern style preview thumbnail** added to Settings (was empty).
- Authenticated channel list fetch so private channels appear when logged in.
- Auto-scroll waits for images to load before final scroll position.
- DM conversation auto-scroll on new messages and after sending.

### Removed
- **"Minimal" and "Elevated" design styles** — visually similar to the others
  and not worth the maintenance cost. Existing users on those styles fall
  through to the default (Modern) automatically because `getDesignStyle()`
  validates against `DESIGN_STYLES` before returning. CSS dropped ~380 lines
  (~7 kB minified). Surviving styles: Modern (default), Glassmorphism,
  Classic.
- Dead imports (`showMobileList`, `isModernStyle`) in `ChannelJoinView.tsx`
  and `NewsView.tsx`.

### Added (this iteration)
- **Default landing view setting** in Settings: choose Chat or News as the
  initial screen when opening the app with no specific URL hash. Defaults
  to Chat. Translated for all 7 locales.
- **Stale nodeUrl migration** — clients that still have the pre-SDK-0.13.1
  default `https://ogmara.org` (the marketing site, not a node) saved in
  localStorage now get auto-reset to the current default on next launch.
  Symptom was the StatusBar showing `ogmara.org` instead of `node.ogmara.org`
  in dev sessions seeded from old settings.

## [0.27.2] - 2026-04-11

### Fixed
- **All auth signatures rejected (401) on mainnet** — the SDK symlink caused
  Vite to resolve `@noble/ed25519` from `~/node_modules/` (stale v1.7.5)
  instead of the project-local v2.3.0. Noble v1.x produces incompatible
  Ed25519 signatures. Added `preserveSymlinks: true` to Vite config so the
  SDK's imports resolve from the symlink location (web/node_modules/) not
  the target (sdk-js/ → ~/node_modules/).

## [0.27.1] - 2026-04-11

### Fixed
- **Wallet registration fails on mainnet** — two issues:
  1. Service Worker was intercepting cross-origin requests from the Klever
     Extension, causing "Failed to fetch". SW now skips all cross-origin
     requests. Cache bumped to `ogmara-v2`.
  2. Klever mainnet provider URLs were wrong (`api.klever.org` and
     `node.klever.org` don't exist). Fixed to `api.mainnet.klever.org` and
     `node.mainnet.klever.org`, matching the testnet pattern.

## [0.27.0] - 2026-04-11

### Added
- **Dev proxy for local development** — custom Vite plugin (`ogmaraDevProxy`)
  forwards `/api/v1/*` requests to the upstream L2 node using Node's native
  fetch, bypassing CORS and preserving Ed25519 signatures. Configurable via
  `DEV_UPSTREAM_NODE` env var, defaults to `https://ogmara.org`.
- **Localhost API routing** — SDK client now uses `window.location.origin` on
  localhost so requests hit the dev proxy instead of the upstream directly.

### Fixed
- **Service Worker breaks dev server** — SW registration is now skipped on
  localhost. Any previously registered SW is automatically unregistered to
  prevent stale cache from intercepting HMR and module requests.

## [0.26.2] - 2026-04-11

### Security
- **Update Vite to 6.4.2** — fixes CVE-2026-39363 (high: arbitrary file read
  via dev server WebSocket) and CVE-2026-39365 (medium: path traversal in
  optimized deps `.map` handling). Both affect dev server only, not production
  builds, but patching regardless.

## [0.26.1] - 2026-04-10

### Fixed
- Fix unhandled promise rejection leak in wallet connect timeout — timer is
  now cleared via `.finally()` when `networkReady` resolves first.
- Resolve `networkReady` with mainnet fallback when L2 node is unreachable at
  startup, preventing infinite hang on wallet connect.
- Gate `window.__ogmaraRepair` DevTools helper behind `import.meta.env.DEV` —
  no longer exposed in production builds.
- Revert `last_anchor_age_seconds` interpretation to duration (seconds since
  last anchor), matching the L2 node implementation. The PR #2 change
  incorrectly treated it as a Unix timestamp.
- Fix double signal evaluation in `isConnected()` — use `!= null` (single call).
- Clamp anchor age display to `Math.max(0, ...)` to handle clock skew gracefully.
- Remove dead `.status-indicator.disconnected` CSS rule (class never applied).

## [0.26.0] - 2026-04-06

### Added
- **Design style system** — four selectable visual themes: Glassmorphism (default),
  Elevated Cards, Clean Minimal, and Classic (original). Each style changes the
  visual language (border-radius, shadows, effects, depth) independently from
  the light/dark color theme.
- **Glassmorphism style** — frosted glass panels with `backdrop-filter: blur()`,
  animated gradient background blobs, glow accents on buttons and badges.
- **Elevated Cards style** — layered drop shadows for depth hierarchy, bold
  gradient buttons, cards lift on hover, accent left-border on active sidebar items.
- **Clean Minimal style** — pill-shaped navigation and badges, asymmetric message
  bubble corners (Signal/Telegram-inspired), date separators as centered pills,
  round send button, thinner scrollbars.
- **Classic style** — preserves the original flat design for users who prefer it.
- Design style picker in Settings with visual preview thumbnails for each style.
- Light theme adjustments for all design styles.
- i18n translations for design style names in all 7 languages.

## [0.25.1] - 2026-04-06

### Fixed
- New users no longer see all public channels on first load — only the default
  "ogmara" channel is shown. Other channels appear after joining via Search.
- Anonymous users can now join and view public channels without connecting a
  wallet. Only private channels require authentication.

## [0.25.0] - 2026-04-05

### Changed
- **Device address prefix (`ogd1...`)** — delegated device keys now use the
  `ogd` bech32 prefix in auth headers and identity resolution, distinguishing
  them from wallet addresses (`klv1...`). Built-in wallet mode is unchanged.
- `addressToPubkeyHex()` now accepts both `klv1...` and `ogd1...` addresses
- Session restore uses `signer.deviceAddress` (ogd1) for extension/K5 flows
- Device registration cache keys updated to use ogd1 format

## [0.24.2] - 2026-04-05

### Fixed
- **Message deduplication** — three related bugs causing duplicate messages
  and stale polling:
  1. Optimistic messages were not removed when the WebSocket delivered the
     real message (only checked against initial API load, not local messages).
     Now the WS handler removes matching optimistic messages on arrival.
  2. Poll `after` cursor could use an optimistic `local-*` msg_id, which the
     server doesn't recognize, causing all subsequent polls to return nothing.
     Now skips optimistic messages when selecting the cursor.
  3. Poll results were appended to localMessages without dedup, causing
     duplicate entries when WS and poll delivered the same message.

## [0.24.1] - 2026-04-05

### Fixed
- **Send error feedback** — ChatView and DmConversationView now display a
  visible error banner when message sending fails instead of silently swallowing
  errors. Banner auto-clears after 6 seconds or on tap/click.

## [0.24.0] - 2026-04-05

### Added
- **Tiered access for unverified wallets** — users with vault-created wallets
  (no on-chain registration) can now chat, post news, react, and use basic
  features. Advanced features (editing, deleting, channel creation) show a
  verification-required prompt directing users to the wallet page for on-chain
  registration.
- `checkRegistrationStatus()` in auth module — queries the L2 node user profile
  on auth init to determine if the wallet is on-chain verified (`registered_at > 0`)
- `isRegistered` gate on edit/delete actions in ChatView, DmConversationView,
  NewsDetailView, ComposeView (edit mode), and ChannelCreateView
- New i18n keys `verification_required` and `verification_go_to_wallet` in all
  7 locales (EN/DE/ES/PT/JA/ZH/RU)

## [0.23.5] - 2026-04-05

### Added
- **Unread messages divider** — when opening a channel with unread messages,
  a "New messages" divider line appears before the first unread message and the
  view scrolls to it instead of jumping to the bottom. Styled with accent color
  and translated in all 7 locales (EN/DE/ES/PT/JA/ZH/RU).

## [0.23.4] - 2026-04-05

### Changed
- **Incremental channel message polling** — poll now fetches only new messages
  since the latest known msg_id using the `after` parameter instead of
  re-fetching the entire channel history every 15 seconds. Preserves scroll
  position when reading older messages.
- Initial channel message load increased from 50 to 200 messages

### Fixed
- Emoji hover bar on own messages no longer gets clipped behind the sidebar —
  bar now positions to the left on right-aligned messages
- Messages with reactions now have a minimum width to prevent badge overflow
- Scroll position no longer resets to bottom on poll refetch — auto-scroll only
  triggers when the user is already near the bottom of the chat

## [0.23.3] - 2026-04-04

### Added
- Notification unread badge on sidebar — polls for unseen notifications every
  30 seconds, shows count badge next to 🔔, clears when navigating to the
  Notifications page (same pattern as DM unread badge)

## [0.23.2] - 2026-04-04

### Fixed
- Chat messages now include `mentions` array when sending — extracts `@klv1...`
  addresses from message text and passes them to the SDK. Without this, the L2
  node's notification engine had no mentions to match against, so no notifications
  were ever stored or pushed for chat mentions.

## [0.23.1] - 2026-04-04

### Fixed
- Push toggle no longer crashes after async permission request — uses signal
  to revert checkbox state instead of `e.currentTarget` (null after `await`)
- Removed nonexistent `getClient().baseUrl` in push URL derivation

## [0.23.0] - 2026-04-04

### Added

- **File and media attachments** in channel chats and DMs — upload images, videos, audio, PDFs, and text files (max 10 MB) via the attach button below the input area
- **Inline video rendering** — MP4, WebM, OGG videos play directly in message bubbles with native controls
- **Media autoload setting** — choose between "Show images and videos inline" (default) or "Show as download links only" under Settings > Theme > Media
- **Blocked file types** — executable files (.exe, .bat, .sh, .apk, etc.) are blocked from upload for security

### Changed

- Channel messages and DMs now extract and display attachments from received messages
- DM send handler updated to pass attachments through SDK's `buildDirectMessage`

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

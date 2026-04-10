/**
 * App — root component with hash-based routing and auth context.
 */

import { Component, Switch, Match, Show } from 'solid-js';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { mobileListOpen, showMobileList, showMobileDetail, isMobileViewport } from './lib/mobile-nav';
import { isLoading, slowLoading } from './lib/network-activity';
import { t } from './i18n/init';
import { ChatView } from './pages/ChatView';
import { NewsView } from './pages/NewsView';
import { BookmarksView } from './pages/BookmarksView';
import { SettingsView } from './pages/SettingsView';
import { WalletView } from './pages/WalletView';
import { ComposeView } from './pages/ComposeView';
import { DmListView } from './pages/DmListView';
import { DmConversationView } from './pages/DmConversationView';
import { UserProfileView } from './pages/UserProfileView';
import { SearchView } from './pages/SearchView';
import { NewsDetailView } from './pages/NewsDetailView';
import { ChannelCreateView } from './pages/ChannelCreateView';
import { ChannelSettingsView } from './pages/ChannelSettingsView';
import { ChannelJoinView } from './pages/ChannelJoinView';
import { NotificationsView } from './pages/NotificationsView';
import { FollowListView } from './pages/FollowListView';
import { StatusBar } from './components/StatusBar';
import { route } from './lib/router';

export const App: Component = () => {
  const channelId = () => {
    const r = route();
    if (r.view === 'chat' && r.params.channelId) {
      return parseInt(r.params.channelId, 10);
    }
    return null;
  };

  /**
   * Mobile-only body class — added to `.app-body` when the user is in
   * the chat-list view, so CSS can show the sidebar full-width and hide
   * the main content. Removed when in detail view.
   */
  const bodyClass = () => {
    if (!isMobileViewport()) return 'app-body';
    return mobileListOpen() ? 'app-body mobile-list-open' : 'app-body mobile-detail-open';
  };

  return (
    <div class="app-layout">
      <Toolbar
        onToggleSidebar={() => {
          // On mobile, toggle between list and detail. On desktop it's a no-op
          // because both are always visible.
          if (isMobileViewport()) {
            if (mobileListOpen()) showMobileDetail(); else showMobileList();
          }
        }}
      />
      {/* Global network-activity bar — always rendered (2px track) so it
          doesn't cause layout shifts when requests start/stop. The fill
          animation only runs while a request is in flight, and the
          "connecting…" label only appears when the request is slow. */}
      <div
        class={`net-bar ${isLoading() ? 'active' : ''} ${slowLoading() ? 'slow' : ''}`}
        role="status"
        aria-live="polite"
      >
        <div class="net-bar-track">
          <div class="net-bar-fill" />
        </div>
        <Show when={slowLoading()}>
          <span class="net-bar-label">{t('status_connecting') || 'Verbinde mit Knoten…'}</span>
        </Show>
      </div>
      <div class={bodyClass()}>
        <Sidebar onNavigate={() => { if (isMobileViewport()) showMobileDetail(); }} />
        <main class="main-content">
          <Switch>
            <Match when={route().view === 'chat'}>
              <ChatView channelId={channelId()} />
            </Match>
            <Match when={route().view === 'news'}>
              <NewsView />
            </Match>
            <Match when={route().view === 'news-detail'}>
              <NewsDetailView />
            </Match>
            <Match when={route().view === 'compose'}>
              <ComposeView />
            </Match>
            <Match when={route().view === 'bookmarks'}>
              <BookmarksView />
            </Match>
            <Match when={route().view === 'settings'}>
              <SettingsView />
            </Match>
            <Match when={route().view === 'wallet'}>
              <WalletView />
            </Match>
            <Match when={route().view === 'dm'}>
              <DmListView />
            </Match>
            <Match when={route().view === 'dm-conversation'}>
              <DmConversationView peerAddress={route().params.address} />
            </Match>
            <Match when={route().view === 'user'}>
              <UserProfileView address={route().params.address} />
            </Match>
            <Match when={route().view === 'follow-list'}>
              <FollowListView address={route().params.address} tab={route().params.tab as 'followers' | 'following'} />
            </Match>
            <Match when={route().view === 'search'}>
              <SearchView />
            </Match>
            <Match when={route().view === 'channel-create'}>
              <ChannelCreateView />
            </Match>
            <Match when={route().view === 'channel-settings'}>
              <ChannelSettingsView channelId={route().params.channelId} />
            </Match>
            <Match when={route().view === 'channel-join'}>
              <ChannelJoinView channelId={route().params.channelId} />
            </Match>
            <Match when={route().view === 'notifications'}>
              <NotificationsView />
            </Match>
          </Switch>
        </main>
      </div>
      <StatusBar />
    </div>
  );
};

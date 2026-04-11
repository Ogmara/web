/**
 * App — root component with hash-based routing and auth context.
 */

import { Component, Show, Switch, Match } from 'solid-js';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { mobileListOpen, showMobileList, showMobileDetail, isMobileViewport } from './lib/mobile-nav';
import { isLoading, slowLoading } from './lib/network-activity';
import { isModernStyle } from './lib/theme';
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

  const bodyClass = () => {
    if (!isMobileViewport()) return 'app-body';
    return mobileListOpen() ? 'app-body mobile-list-open' : 'app-body mobile-detail-open';
  };

  return (
    <div class="app-layout">
      <Show when={!isModernStyle()}>
        <Toolbar
          onToggleSidebar={() => {
            if (isMobileViewport()) {
              if (mobileListOpen()) showMobileDetail(); else showMobileList();
            }
          }}
        />
      </Show>
      <div
        class={`net-bar ${isLoading() ? 'active' : ''} ${slowLoading() ? 'slow' : ''}`}
        role="status"
        aria-live="polite"
      >
        <div class="net-bar-track">
          <div class="net-bar-fill" />
        </div>
        <Show when={slowLoading()}>
          <span class="net-bar-label">{t('status_connecting') || 'Connecting to node…'}</span>
        </Show>
      </div>
      <div class={bodyClass()}>
        <Sidebar onNavigate={() => { if (isMobileViewport()) showMobileDetail(); }} />
        <main class="main-content">
          {/* Global mobile back button — visible in Modern style on mobile detail view,
              but NOT on views that have their own back button (chat, dm-conversation) */}
          {/* Global mobile back — only for views without their own header/back button */}
          <Show when={isModernStyle() && isMobileViewport() && !mobileListOpen()
            && ['news', 'bookmarks', 'search', 'settings', 'wallet', 'notifications', 'compose', 'user', 'follow-list'].includes(route().view)}>
            <div style="display:flex; align-items:center; padding:8px 12px; background:var(--color-bg-secondary); border-bottom:1px solid var(--color-border)">
              <button style="width:38px; height:38px; border-radius:50%; color:var(--color-text-secondary); display:flex; align-items:center; justify-content:center; cursor:pointer"
                onClick={() => showMobileList()}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><polyline points="12 19 5 12 12 5"/></svg>
              </button>
            </div>
          </Show>
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

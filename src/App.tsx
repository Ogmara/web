/**
 * App — root component with hash-based routing and auth context.
 */

import { Component, createSignal, Show, Switch, Match } from 'solid-js';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
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

const isMobile = () => window.innerWidth <= 768;

export const App: Component = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = createSignal(isMobile());

  const channelId = () => {
    const r = route();
    if (r.view === 'chat' && r.params.channelId) {
      return parseInt(r.params.channelId, 10);
    }
    return null;
  };

  return (
    <div class="app-layout">
      <Toolbar
        onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed())}
      />
      <div class="app-body">
        <Show when={!sidebarCollapsed()}>
          <Sidebar onNavigate={() => { if (isMobile()) setSidebarCollapsed(true); }} />
        </Show>
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

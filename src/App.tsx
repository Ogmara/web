import { Component, createSignal, Show } from 'solid-js';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { ChatView } from './pages/ChatView';
import { NewsView } from './pages/NewsView';
import { BookmarksView } from './pages/BookmarksView';
import { SettingsView } from './pages/SettingsView';
import { StatusBar } from './components/StatusBar';

export type View = 'chat' | 'news' | 'bookmarks' | 'settings';

export const App: Component = () => {
  const [currentView, setCurrentView] = createSignal<View>('chat');
  const [currentChannel, setCurrentChannel] = createSignal<number | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = createSignal(false);

  return (
    <div class="app-layout">
      <Toolbar
        onToggleSidebar={() => setSidebarCollapsed(!sidebarCollapsed())}
        onNavigate={setCurrentView}
      />
      <div class="app-body">
        <Show when={!sidebarCollapsed()}>
          <Sidebar
            currentChannel={currentChannel()}
            onSelectChannel={(id) => {
              setCurrentChannel(id);
              setCurrentView('chat');
            }}
            onNavigate={setCurrentView}
          />
        </Show>
        <main class="main-content">
          <Show when={currentView() === 'chat'}>
            <ChatView channelId={currentChannel()} />
          </Show>
          <Show when={currentView() === 'news'}>
            <NewsView />
          </Show>
          <Show when={currentView() === 'bookmarks'}>
            <BookmarksView />
          </Show>
          <Show when={currentView() === 'settings'}>
            <SettingsView />
          </Show>
        </main>
      </div>
      <StatusBar />
    </div>
  );
};

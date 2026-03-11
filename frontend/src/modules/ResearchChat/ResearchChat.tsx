import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { config } from '@/config';
import { ChatSidebar } from './ChatSidebar.tsx';
import { ChatView } from './ChatView.tsx';
import type {
  ResearchChatState,
  ResearchChatThread,
  ResearchChatThreadSummary,
  ResearchFileInfo,
} from './types.ts';

function createEmptyDraft(): ResearchChatState {
  return {
    messages: [],
    selectedFiles: [],
  };
}

function sortChats(chats: ResearchChatThreadSummary[]): ResearchChatThreadSummary[] {
  return [...chats].sort((a, b) => {
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

type TouchState = {
  x: number;
  y: number;
};

export function ResearchChat() {
  const [files, setFiles] = useState<ResearchFileInfo[]>([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const [chatStreaming, setChatStreaming] = useState(false);
  const [chats, setChats] = useState<ResearchChatThreadSummary[]>([]);
  const [draft, setDraft] = useState<ResearchChatState>(() => createEmptyDraft());
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [activeChat, setActiveChat] = useState<ResearchChatThread | null>(null);
  const [activeChatLoading, setActiveChatLoading] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const touchStartRef = useRef<TouchState | null>(null);

  const upsertChatSummary = useCallback((summary: ResearchChatThreadSummary) => {
    setChats((prev) => {
      const next = prev.filter((chat) => chat.id !== summary.id);
      next.push(summary);
      return sortChats(next);
    });
  }, []);

  const syncChat = useCallback(async (chatId: string) => {
    try {
      const response = await fetch(`${config.apiBaseUrl}/api/research/chats/${chatId}`);
      const json = await response.json();
      if (!response.ok || !json.success) {
        return;
      }

      const thread = json.data as ResearchChatThread;
      setActiveChat((current) => current?.id === chatId ? thread : current);
      upsertChatSummary(thread);
    } catch {
      // Keep the optimistic stream state if the sync request fails.
    }
  }, [upsertChatSummary]);

  useEffect(() => {
    let cancelled = false;

    async function loadFiles() {
      try {
        const response = await fetch(`${config.apiBaseUrl}/api/research/files`);
        const json = await response.json();
        if (!cancelled && response.ok && json.success) {
          setFiles(json.data);
        }
      } catch {
        if (!cancelled) {
          setFiles([]);
        }
      } finally {
        if (!cancelled) {
          setFilesLoading(false);
        }
      }
    }

    async function loadChats() {
      try {
        const response = await fetch(`${config.apiBaseUrl}/api/research/chats`);
        const json = await response.json();
        if (!cancelled && response.ok && json.success) {
          setChats(sortChats(json.data));
        }
      } catch {
        if (!cancelled) {
          setChats([]);
        }
      }
    }

    void loadFiles();
    void loadChats();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeChatId) {
      setActiveChatLoading(false);
      setActiveChat(null);
      return;
    }

    if (activeChat?.id === activeChatId) {
      return;
    }

    let cancelled = false;
    setActiveChatLoading(true);

    void (async () => {
      try {
        const response = await fetch(`${config.apiBaseUrl}/api/research/chats/${activeChatId}`);
        const json = await response.json();
        if (!cancelled && response.ok && json.success) {
          setActiveChat(json.data);
        }
      } catch {
        if (!cancelled) {
          setActiveChat(null);
        }
      } finally {
        if (!cancelled) {
          setActiveChatLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeChat?.id, activeChatId]);

  const currentChatState = useMemo(() => {
    if (!activeChatId) {
      return draft;
    }

    if (activeChat?.id === activeChatId) {
      return activeChat;
    }

    return {
      messages: [],
      selectedFiles: [],
    } satisfies ResearchChatState;
  }, [activeChat, activeChatId, draft]);

  const currentChatTitle = activeChatId
    ? activeChat?.title ?? chats.find((chat) => chat.id === activeChatId)?.title ?? 'Research chat'
    : 'New chat';

  const handleSelectFiles = useCallback((selectedFiles: string[]) => {
    if (!activeChatId || !activeChat || activeChat.id !== activeChatId) {
      setDraft((prev) => ({ ...prev, selectedFiles }));
      return;
    }

    setActiveChat((prev) => prev ? { ...prev, selectedFiles } : prev);

    void (async () => {
      try {
        const response = await fetch(`${config.apiBaseUrl}/api/research/chats/${activeChatId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ selectedFiles }),
        });
        const json = await response.json();
        if (response.ok && json.success) {
          setActiveChat((current) => current?.id === activeChatId ? json.data : current);
          upsertChatSummary(json.data);
        }
      } catch {
        // The next message send still persists the active selection.
      }
    })();
  }, [activeChat, activeChatId, upsertChatSummary]);

  const handleCreateChat = useCallback((thread: ResearchChatThread) => {
    setActiveChatId(thread.id);
    setActiveChat(thread);
    setDraft(createEmptyDraft());
    upsertChatSummary(thread);
    setMobileSidebarOpen(false);
  }, [upsertChatSummary]);

  const handleUpdateCurrentChat = useCallback((chatId: string | null, updates: Partial<ResearchChatState>) => {
    if (!chatId) {
      setDraft((prev) => ({ ...prev, ...updates }));
      return;
    }

    setActiveChat((prev) => {
      if (!prev || prev.id !== chatId) {
        return prev;
      }

      const next = { ...prev, ...updates };
      upsertChatSummary({
        ...prev,
        ...next,
        updatedAt: new Date().toISOString(),
        messageCount: next.messages.length,
      });
      return next;
    });
  }, [upsertChatSummary]);

  const handleNewChat = useCallback(() => {
    setActiveChatId(null);
    setActiveChat(null);
    setDraft(createEmptyDraft());
    setMobileSidebarOpen(false);
  }, []);

  const handleSelectChat = useCallback((chatId: string) => {
    setActiveChatId(chatId);
    setMobileSidebarOpen(false);
  }, []);

  const handleTouchStart = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    if (window.innerWidth >= 768) {
      return;
    }

    const touch = event.touches[0];
    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
    };
  }, []);

  const handleTouchEnd = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    if (window.innerWidth >= 768) {
      touchStartRef.current = null;
      return;
    }

    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) {
      return;
    }

    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;

    if (Math.abs(deltaX) < 64 || Math.abs(deltaX) < Math.abs(deltaY)) {
      return;
    }

    if (!mobileSidebarOpen && start.x <= 24 && deltaX > 0) {
      setMobileSidebarOpen(true);
    }

    if (mobileSidebarOpen && start.x <= 320 && deltaX < 0) {
      setMobileSidebarOpen(false);
    }
  }, [mobileSidebarOpen]);

  return (
    <div
      className="flex-1 min-h-0 overflow-hidden"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div className="flex h-full min-h-0 flex-col overflow-hidden md:flex-row">
        <ChatSidebar
          chats={chats}
          activeChatId={activeChatId}
          disabled={chatStreaming}
          mobileOpen={mobileSidebarOpen}
          onCloseMobile={() => setMobileSidebarOpen(false)}
          onNewChat={handleNewChat}
          onSelectChat={handleSelectChat}
        />

        <div className="flex-1 min-h-0 overflow-hidden">
          <ChatView
            chatId={activeChatId}
            chatTitle={currentChatTitle}
            loading={activeChatLoading}
            files={files}
            messages={currentChatState.messages}
            selectedFiles={currentChatState.selectedFiles}
            onSelectFiles={handleSelectFiles}
            filesLoading={filesLoading}
            onCreateChat={handleCreateChat}
            onUpdateChat={handleUpdateCurrentChat}
            onSyncChat={syncChat}
            onStreamingChange={setChatStreaming}
            onOpenSidebar={() => setMobileSidebarOpen(true)}
          />
        </div>
      </div>
    </div>
  );
}

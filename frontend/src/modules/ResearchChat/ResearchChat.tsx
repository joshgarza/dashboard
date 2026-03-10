import { useCallback, useEffect, useMemo, useState } from 'react';
import { config } from '@/config';
import { ChatSidebar } from './ChatSidebar.tsx';
import { ChatView } from './ChatView.tsx';
import type { ResearchChatState, ResearchChatThread, ResearchFileInfo } from './types.ts';

const RESEARCH_CHATS_STORAGE_KEY = 'research-chats-v2';
const LEGACY_MESSAGES_STORAGE_KEY = 'research-messages';
const LEGACY_SESSION_STORAGE_KEY = 'research-session-id';

function createEmptyDraft(): ResearchChatState {
  return {
    messages: [],
    sessionId: null,
    selectedFiles: [],
  };
}

function generateChatId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function sortChats(chats: ResearchChatThread[]): ResearchChatThread[] {
  return [...chats].sort((a, b) => {
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

function getChatTitle(messages: ResearchChatState['messages']): string {
  const firstUserMessage = messages.find(message => message.role === 'user' && message.content.trim());

  if (!firstUserMessage) {
    return 'Untitled chat';
  }

  const normalized = firstUserMessage.content.replace(/\s+/g, ' ').trim();
  return normalized.length > 48 ? `${normalized.slice(0, 48).trimEnd()}...` : normalized;
}

function isChatMessageArray(value: unknown): value is ResearchChatState['messages'] {
  return Array.isArray(value) && value.every((entry) => (
    entry &&
    typeof entry === 'object' &&
    (entry as { role?: unknown }).role &&
    ((entry as { role?: unknown }).role === 'user' || (entry as { role?: unknown }).role === 'assistant') &&
    typeof (entry as { content?: unknown }).content === 'string'
  ));
}

function parseStoredChats(): ResearchChatThread[] {
  const stored = localStorage.getItem(RESEARCH_CHATS_STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        return sortChats(parsed.filter((entry): entry is ResearchChatThread => {
          return (
            entry &&
            typeof entry === 'object' &&
            typeof entry.id === 'string' &&
            typeof entry.title === 'string' &&
            typeof entry.createdAt === 'string' &&
            typeof entry.updatedAt === 'string' &&
            isChatMessageArray(entry.messages) &&
            (typeof entry.sessionId === 'string' || entry.sessionId === null) &&
            Array.isArray(entry.selectedFiles) &&
            entry.selectedFiles.every((item: unknown) => typeof item === 'string')
          );
        }));
      }
    } catch {
      localStorage.removeItem(RESEARCH_CHATS_STORAGE_KEY);
    }
  }

  const legacyMessages = localStorage.getItem(LEGACY_MESSAGES_STORAGE_KEY);
  if (!legacyMessages) {
    return [];
  }

  try {
    const parsedMessages = JSON.parse(legacyMessages);
    if (!isChatMessageArray(parsedMessages) || parsedMessages.length === 0) {
      return [];
    }

    const timestamp = new Date().toISOString();
    const migratedChat: ResearchChatThread = {
      id: generateChatId(),
      title: getChatTitle(parsedMessages),
      createdAt: timestamp,
      updatedAt: timestamp,
      messages: parsedMessages,
      sessionId: localStorage.getItem(LEGACY_SESSION_STORAGE_KEY),
      selectedFiles: [],
    };

    return [migratedChat];
  } catch {
    return [];
  } finally {
    localStorage.removeItem(LEGACY_MESSAGES_STORAGE_KEY);
    localStorage.removeItem(LEGACY_SESSION_STORAGE_KEY);
  }
}

export function ResearchChat() {
  const [files, setFiles] = useState<ResearchFileInfo[]>([]);
  const [selectedFilesLoading, setSelectedFilesLoading] = useState(true);
  const [chatStreaming, setChatStreaming] = useState(false);
  const [chats, setChats] = useState<ResearchChatThread[]>(() => parseStoredChats());
  const [draft, setDraft] = useState<ResearchChatState>(() => createEmptyDraft());
  const [activeChatId, setActiveChatId] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${config.apiBaseUrl}/api/research/files`)
      .then(res => res.json())
      .then(json => {
        if (json.success) {
          setFiles(json.data);
        }
        setSelectedFilesLoading(false);
      })
      .catch(() => {
        setSelectedFilesLoading(false);
      });
  }, []);

  useEffect(() => {
    localStorage.setItem(RESEARCH_CHATS_STORAGE_KEY, JSON.stringify(chats));
  }, [chats]);

  const activeChat = useMemo(() => {
    if (!activeChatId) {
      return null;
    }

    return chats.find(chat => chat.id === activeChatId) ?? null;
  }, [activeChatId, chats]);

  const currentChatState = activeChat ?? draft;

  const updateStoredChat = useCallback((chatId: string, updates: Partial<ResearchChatState>) => {
    setChats(prev => sortChats(prev.map(chat => {
      if (chat.id !== chatId) {
        return chat;
      }

      return {
        ...chat,
        ...updates,
        updatedAt: new Date().toISOString(),
      };
    })));
  }, []);

  const handlePersistChat = useCallback((state: ResearchChatState) => {
    if (activeChatId) {
      updateStoredChat(activeChatId, state);
      return activeChatId;
    }

    const timestamp = new Date().toISOString();
    const nextChatId = generateChatId();
    const nextChat: ResearchChatThread = {
      id: nextChatId,
      title: getChatTitle(state.messages),
      createdAt: timestamp,
      updatedAt: timestamp,
      ...state,
    };

    setChats(prev => sortChats([nextChat, ...prev]));
    setActiveChatId(nextChatId);
    setDraft(createEmptyDraft());
    return nextChatId;
  }, [activeChatId, updateStoredChat]);

  const handleUpdateChat = useCallback((chatId: string, updates: Partial<ResearchChatState>) => {
    updateStoredChat(chatId, updates);
  }, [updateStoredChat]);

  const handleSelectFiles = useCallback((selectedFiles: string[]) => {
    if (activeChatId) {
      updateStoredChat(activeChatId, { selectedFiles });
      return;
    }

    setDraft(prev => ({ ...prev, selectedFiles }));
  }, [activeChatId, updateStoredChat]);

  const handleNewChat = useCallback(() => {
    setActiveChatId(null);
    setDraft(createEmptyDraft());
  }, []);

  return (
    <div className="flex-1 min-h-0 overflow-hidden">
      <div className="flex h-full min-h-0 flex-col overflow-hidden md:flex-row">
        <ChatSidebar
          chats={chats}
          activeChatId={activeChatId}
          disabled={chatStreaming}
          onNewChat={handleNewChat}
          onSelectChat={setActiveChatId}
        />

        <div className="flex-1 min-h-0 overflow-hidden">
          <ChatView
            chatId={activeChatId}
            files={files}
            messages={currentChatState.messages}
            selectedFiles={currentChatState.selectedFiles}
            sessionId={currentChatState.sessionId}
            onSelectFiles={handleSelectFiles}
            filesLoading={selectedFilesLoading}
            onPersistChat={handlePersistChat}
            onUpdateChat={handleUpdateChat}
            onStreamingChange={setChatStreaming}
          />
        </div>
      </div>
    </div>
  );
}

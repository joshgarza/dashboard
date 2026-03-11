import { useEffect, useRef, useState, useCallback } from 'react';
import { config } from '@/config';
import { ContextFilesPopover } from './ContextFilesPopover.tsx';
import { MarkdownMessage } from './MarkdownMessage.tsx';
import type {
  ChatMessage,
  ResearchChatState,
  ResearchChatThread,
  ResearchChatThreadSummary,
  ResearchFileInfo,
} from './types.ts';

type StreamPhase = 'thinking' | 'working' | 'writing' | null;

interface ChatViewProps {
  chatId: string | null;
  chatTitle: string;
  loading: boolean;
  files: ResearchFileInfo[];
  messages: ChatMessage[];
  selectedFiles: string[];
  onSelectFiles: (files: string[]) => void;
  filesLoading: boolean;
  onCreateChat: (chat: ResearchChatThread) => void;
  onUpdateChat: (chatId: string | null, updates: Partial<ResearchChatState>) => void;
  onSyncChat: (chatId: string) => Promise<void>;
  onStreamingChange: (streaming: boolean) => void;
  onOpenSidebar: () => void;
}

export function ChatView({
  chatId,
  chatTitle,
  loading,
  files,
  messages,
  selectedFiles,
  onSelectFiles,
  filesLoading,
  onCreateChat,
  onUpdateChat,
  onSyncChat,
  onStreamingChange,
  onOpenSidebar,
}: ChatViewProps) {
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamPhase, setStreamPhase] = useState<StreamPhase>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const workingTimerRef = useRef<number | null>(null);
  const messagesRef = useRef(messages);
  const selectedFilesRef = useRef(selectedFiles);
  const chatIdRef = useRef(chatId);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    selectedFilesRef.current = selectedFiles;
  }, [selectedFiles]);

  useEffect(() => {
    chatIdRef.current = chatId;
  }, [chatId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const clearWorkingTimer = useCallback(() => {
    if (workingTimerRef.current !== null) {
      window.clearTimeout(workingTimerRef.current);
      workingTimerRef.current = null;
    }
  }, []);

  const beginStreamPhases = useCallback(() => {
    clearWorkingTimer();
    setStreamPhase('thinking');
    workingTimerRef.current = window.setTimeout(() => {
      setStreamPhase((current) => current === 'thinking' ? 'working' : current);
    }, 1500);
  }, [clearWorkingTimer]);

  useEffect(() => {
    return () => {
      clearWorkingTimer();
    };
  }, [clearWorkingTimer]);

  useEffect(() => {
    setInput('');
  }, [chatId]);

  useEffect(() => {
    onStreamingChange(streaming);
  }, [onStreamingChange, streaming]);

  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const maxHeight = 6 * 24;
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [input, resizeTextarea]);

  function applyMessageUpdate(nextMessages: ChatMessage[], activeChatId: string | null) {
    messagesRef.current = nextMessages;
    onUpdateChat(activeChatId, { messages: nextMessages });
  }

  async function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || streaming || loading) return;

    const userMessage: ChatMessage = { role: 'user', content: trimmed };
    const assistantMessage: ChatMessage = { role: 'assistant', content: '' };
    const currentSelectedFiles = selectedFilesRef.current;
    let resolvedChatId = chatIdRef.current;

    applyMessageUpdate([...messagesRef.current, userMessage, assistantMessage], resolvedChatId);
    setInput('');
    setStreaming(true);
    beginStreamPhases();

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch(`${config.apiBaseUrl}/api/research/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId: resolvedChatId,
          message: trimmed,
          files: currentSelectedFiles,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const failedMessages = [...messagesRef.current];
        failedMessages[failedMessages.length - 1] = { role: 'assistant', content: 'Error: Failed to get response' };
        applyMessageUpdate(failedMessages, resolvedChatId);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;

          const payload = line.slice(6);
          if (payload === '[DONE]') continue;

          try {
            const parsed = JSON.parse(payload) as {
              type?: string;
              text?: string;
              chat?: ResearchChatThreadSummary;
            };

            if (parsed.type === 'chat_created' && parsed.chat) {
              resolvedChatId = parsed.chat.id;
              chatIdRef.current = parsed.chat.id;
              onCreateChat({
                ...parsed.chat,
                messages: messagesRef.current,
                selectedFiles: currentSelectedFiles,
              });
              continue;
            }

            if (parsed.type === 'content_block_delta' && parsed.text) {
              clearWorkingTimer();
              setStreamPhase('writing');
              const streamedMessages = [...messagesRef.current];
              const last = streamedMessages[streamedMessages.length - 1];
              streamedMessages[streamedMessages.length - 1] = {
                ...last,
                content: last.content + parsed.text,
              };
              applyMessageUpdate(streamedMessages, resolvedChatId);
            }
          } catch {
            // Skip malformed lines.
          }
        }
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        const failedMessages = [...messagesRef.current];
        const last = failedMessages[failedMessages.length - 1];
        if (last.role === 'assistant' && !last.content) {
          failedMessages[failedMessages.length - 1] = { role: 'assistant', content: 'Error: Connection failed' };
          applyMessageUpdate(failedMessages, resolvedChatId);
        }
      }
    } finally {
      abortRef.current = null;
      clearWorkingTimer();
      setStreamPhase(null);
      setStreaming(false);
      if (resolvedChatId) {
        await onSyncChat(resolvedChatId);
      }
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  }

  function removeFile(key: string) {
    onSelectFiles(selectedFiles.filter((selectedKey) => selectedKey !== key));
  }

  const selectedFileInfos = selectedFiles
    .map((key) => files.find((file) => file.key === key))
    .filter(Boolean) as ResearchFileInfo[];
  const activeAssistantIndex = streaming ? messages.length - 1 : -1;
  const streamStatus = streamPhase === 'working'
    ? 'Working...'
    : streamPhase === 'writing'
      ? 'Writing...'
      : 'Thinking...';

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="border-b border-border/70 bg-background/95 backdrop-blur md:hidden">
        <div className="mx-auto flex w-full max-w-[52rem] items-center gap-3 px-4 py-3">
          <button
            type="button"
            onClick={onOpenSidebar}
            aria-label="Open chats"
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18" />
              <path d="M3 12h18" />
              <path d="M3 18h18" />
            </svg>
          </button>

          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">{chatId ? chatTitle : 'New chat'}</div>
            <div className="text-xs text-muted-foreground">{chatId ? 'Saved conversation' : 'Draft'}</div>
          </div>
        </div>
      </div>

      <div className="app-scrollbar flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto w-full max-w-[52rem] px-4 py-4 sm:px-6 lg:px-8">
          {loading ? (
            <div className="flex min-h-[40vh] items-center justify-center">
              <div className="rounded-2xl border border-border bg-background/80 px-4 py-3 text-sm text-muted-foreground">
                Loading chat...
              </div>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex min-h-[50vh] items-center justify-center">
              <div className="space-y-2 text-center">
                <p className="text-lg text-muted-foreground">Start a new research chat</p>
                <p className="text-sm text-muted-foreground/60">
                  Ask a question, attach context files, or reopen a saved conversation from the sidebar.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4 py-4">
              {messages.map((message, index) => (
                <div key={index} className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                  <div
                    className={
                      message.role === 'user'
                        ? 'max-w-[85%] rounded-2xl bg-primary px-4 py-2.5 text-sm text-primary-foreground'
                        : 'max-w-[85%] text-foreground'
                    }
                  >
                    {message.role === 'assistant' && index === activeAssistantIndex && (
                      <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium tracking-[0.08em] text-muted-foreground">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
                        <span>{streamStatus}</span>
                      </div>
                    )}
                    {message.role === 'assistant' ? (
                      <MarkdownMessage content={message.content} />
                    ) : (
                      <div className="whitespace-pre-wrap">{message.content}</div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </div>

      <div className="bg-background pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto w-full max-w-[52rem] px-4 pt-2 pb-4 sm:px-6 lg:px-8">
          {selectedFileInfos.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5 px-1">
              {selectedFileInfos.map((file) => (
                <span
                  key={file.key}
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground"
                >
                  {file.topic}
                  <button
                    type="button"
                    onClick={() => removeFile(file.key)}
                    className="ml-0.5 hover:text-foreground"
                  >
                    &times;
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="rounded-2xl border border-input bg-muted/30 ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your research..."
              disabled={streaming || loading}
              rows={1}
              className="w-full resize-none overflow-y-auto bg-transparent px-4 pt-3 pb-1 text-base placeholder:text-muted-foreground focus:outline-none disabled:opacity-50 sm:text-sm"
              style={{ maxHeight: '144px' }}
            />

            <div className="flex items-center justify-between px-2 pb-2">
              <ContextFilesPopover
                files={files}
                selectedFiles={selectedFiles}
                onSelectFiles={onSelectFiles}
                filesLoading={filesLoading}
              />

              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={streaming || loading || !input.trim()}
                aria-label={streaming ? streamStatus : 'Send message'}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-30"
              >
                {streaming ? (
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                ) : (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M5 12h14" />
                    <path d="m12 5 7 7-7 7" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

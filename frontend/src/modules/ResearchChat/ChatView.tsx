import { useEffect, useRef, useState, useCallback } from 'react';
import { config } from '@/config';
import { ContextFilesPopover } from './ContextFilesPopover.tsx';
import { MarkdownMessage } from './MarkdownMessage.tsx';
import type { ChatMessage, ResearchChatState, ResearchFileInfo } from './types.ts';

type StreamPhase = 'thinking' | 'working' | 'writing' | null;

interface ChatViewProps {
  chatId: string | null;
  files: ResearchFileInfo[];
  messages: ChatMessage[];
  selectedFiles: string[];
  sessionId: string | null;
  onSelectFiles: (files: string[]) => void;
  filesLoading: boolean;
  onPersistChat: (chat: ResearchChatState) => string;
  onUpdateChat: (chatId: string, updates: Partial<ResearchChatState>) => void;
  onStreamingChange: (streaming: boolean) => void;
}

export function ChatView({
  chatId,
  files,
  messages,
  selectedFiles,
  sessionId,
  onSelectFiles,
  filesLoading,
  onPersistChat,
  onUpdateChat,
  onStreamingChange,
}: ChatViewProps) {
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamPhase, setStreamPhase] = useState<StreamPhase>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const workingTimerRef = useRef<number | null>(null);
  const messagesRef = useRef(messages);
  const sessionIdRef = useRef(sessionId);
  const selectedFilesRef = useRef(selectedFiles);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    selectedFilesRef.current = selectedFiles;
  }, [selectedFiles]);

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
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const maxHeight = 6 * 24;
    ta.style.height = `${Math.min(ta.scrollHeight, maxHeight)}px`;
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [input, resizeTextarea]);

  async function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || streaming) return;

    const userMessage: ChatMessage = { role: 'user', content: trimmed };
    const updatedMessages = [...messagesRef.current, userMessage];
    const currentSelectedFiles = selectedFilesRef.current;
    const currentSessionId = sessionIdRef.current;

    const persistedChatId = onPersistChat({
      messages: updatedMessages,
      sessionId: currentSessionId,
      selectedFiles: currentSelectedFiles,
    });

    const assistantMessage: ChatMessage = { role: 'assistant', content: '' };
    const nextMessages = [...updatedMessages, assistantMessage];
    messagesRef.current = nextMessages;
    onUpdateChat(persistedChatId, { messages: nextMessages });

    setInput('');
    setStreaming(true);
    beginStreamPhases();

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`${config.apiBaseUrl}/api/research/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          messages: updatedMessages.slice(0, -1),
          files: currentSelectedFiles,
          sessionId: currentSessionId,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const erroredMessages = [...messagesRef.current];
        erroredMessages[erroredMessages.length - 1] = { role: 'assistant', content: 'Error: Failed to get response' };
        messagesRef.current = erroredMessages;
        onUpdateChat(persistedChatId, { messages: erroredMessages });
        return;
      }

      const reader = res.body.getReader();
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
            const parsed = JSON.parse(payload);
            if (parsed.type === 'session_id' && typeof parsed.sessionId === 'string') {
              sessionIdRef.current = parsed.sessionId;
              onUpdateChat(persistedChatId, { sessionId: parsed.sessionId });
            } else if (parsed.type === 'content_block_delta' && parsed.text) {
              clearWorkingTimer();
              setStreamPhase('writing');
              const streamedMessages = [...messagesRef.current];
              const last = streamedMessages[streamedMessages.length - 1];
              streamedMessages[streamedMessages.length - 1] = {
                ...last,
                content: last.content + parsed.text,
              };
              messagesRef.current = streamedMessages;
              onUpdateChat(persistedChatId, { messages: streamedMessages });
            }
          } catch {
            // Skip malformed lines.
          }
        }
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        const failedMessages = [...messagesRef.current];
        const last = failedMessages[failedMessages.length - 1];
        if (last.role === 'assistant' && !last.content) {
          failedMessages[failedMessages.length - 1] = { role: 'assistant', content: 'Error: Connection failed' };
          messagesRef.current = failedMessages;
          onUpdateChat(persistedChatId, { messages: failedMessages });
        }
      }
    } finally {
      abortRef.current = null;
      clearWorkingTimer();
      setStreamPhase(null);
      setStreaming(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function removeFile(key: string) {
    onSelectFiles(selectedFiles.filter(selectedKey => selectedKey !== key));
  }

  const selectedFileInfos = selectedFiles
    .map(key => files.find(file => file.key === key))
    .filter(Boolean) as ResearchFileInfo[];
  const activeAssistantIndex = streaming ? messages.length - 1 : -1;
  const streamStatus = streamPhase === 'working'
    ? 'Working...'
    : streamPhase === 'writing'
      ? 'Writing...'
      : 'Thinking...';

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="app-scrollbar flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto w-full max-w-[52rem] px-4 py-4 sm:px-6 lg:px-8">
          {messages.length === 0 ? (
            <div className="flex min-h-[50vh] items-center justify-center">
              <div className="space-y-2 text-center">
                <p className="text-lg text-muted-foreground">Start a new research chat</p>
                <p className="text-sm text-muted-foreground/60">
                  Ask a question, attach context files, or revisit a saved conversation from the sidebar.
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
              {selectedFileInfos.map(file => (
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
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your research..."
              disabled={streaming}
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
                onClick={handleSend}
                disabled={streaming || !input.trim()}
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

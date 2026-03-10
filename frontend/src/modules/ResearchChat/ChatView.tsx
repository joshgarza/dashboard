import { useState, useEffect, useRef, useCallback } from 'react';
import { config } from '@/config';
import { ContextFilesPopover } from './ContextFilesPopover.tsx';
import type { ChatMessage, ResearchFileInfo } from './types.ts';

type StreamPhase = 'thinking' | 'working' | 'writing' | null;

interface ChatViewProps {
  files: ResearchFileInfo[];
  selectedFiles: string[];
  onSelectFiles: (files: string[]) => void;
  filesLoading: boolean;
  onNewChat: () => void;
}

export function ChatView({ files, selectedFiles, onSelectFiles, filesLoading, onNewChat }: ChatViewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const stored = localStorage.getItem('research-messages');
    if (stored) {
      try { return JSON.parse(stored); } catch { return []; }
    }
    return [];
  });
  const [sessionId, setSessionId] = useState<string | null>(() => localStorage.getItem('research-session-id'));
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamPhase, setStreamPhase] = useState<StreamPhase>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const workingTimerRef = useRef<number | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    localStorage.setItem('research-messages', JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    if (sessionId) {
      localStorage.setItem('research-session-id', sessionId);
      return;
    }

    localStorage.removeItem('research-session-id');
  }, [sessionId]);

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

  const resizeTextarea = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const maxHeight = 6 * 24; // ~6 rows
    ta.style.height = Math.min(ta.scrollHeight, maxHeight) + 'px';
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [input, resizeTextarea]);

  async function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || streaming) return;

    const userMessage: ChatMessage = { role: 'user', content: trimmed };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput('');
    setStreaming(true);
    beginStreamPhases();

    const assistantMessage: ChatMessage = { role: 'assistant', content: '' };
    setMessages([...updatedMessages, assistantMessage]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`${config.apiBaseUrl}/api/research/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          messages,
          files: selectedFiles,
          sessionId,
        }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        setMessages(prev => {
          const copy = [...prev];
          copy[copy.length - 1] = { role: 'assistant', content: 'Error: Failed to get response' };
          return copy;
        });
        setStreaming(false);
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
              setSessionId(parsed.sessionId);
            } else if (parsed.type === 'content_block_delta' && parsed.text) {
              clearWorkingTimer();
              setStreamPhase('writing');
              setMessages(prev => {
                const copy = [...prev];
                const last = copy[copy.length - 1];
                copy[copy.length - 1] = { ...last, content: last.content + parsed.text };
                return copy;
              });
            }
          } catch {
            // skip malformed lines
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // user cancelled
      } else {
        setMessages(prev => {
          const copy = [...prev];
          const last = copy[copy.length - 1];
          if (last.role === 'assistant' && !last.content) {
            copy[copy.length - 1] = { role: 'assistant', content: 'Error: Connection failed' };
          }
          return copy;
        });
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
    onSelectFiles(selectedFiles.filter(k => k !== key));
  }

  const selectedFileInfos = selectedFiles
    .map(key => files.find(f => f.key === key))
    .filter(Boolean) as ResearchFileInfo[];
  const activeAssistantIndex = streaming ? messages.length - 1 : -1;
  const streamStatus = streamPhase === 'working'
    ? 'Working...'
    : streamPhase === 'writing'
      ? 'Writing...'
      : 'Thinking...';

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto w-full px-4 py-4">
          {messages.length === 0 ? (
            <div className="flex items-center justify-center h-full min-h-[50vh]">
              <div className="text-center space-y-2">
                <p className="text-lg text-muted-foreground">What would you like to research?</p>
                <p className="text-sm text-muted-foreground/60">
                  Attach context files for grounded answers
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4 py-4">
              {messages.map((msg, i) => (
                <div key={i} className={msg.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                  <div
                    className={
                      msg.role === 'user'
                        ? 'bg-primary text-primary-foreground rounded-2xl px-4 py-2.5 max-w-[85%] text-sm'
                        : 'text-foreground max-w-[85%] text-sm whitespace-pre-wrap'
                    }
                  >
                    {msg.role === 'assistant' && i === activeAssistantIndex && (
                      <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium tracking-[0.08em] text-muted-foreground">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
                        <span>{streamStatus}</span>
                      </div>
                    )}
                    {msg.content}
                    {msg.role === 'assistant' && i === activeAssistantIndex && (
                      <span className="inline-block w-1.5 h-4 bg-foreground/70 ml-0.5 animate-pulse" />
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </div>

      {/* Input area */}
      <div className="bg-background pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-3xl mx-auto w-full px-3 sm:px-6 pt-2 pb-4">
          {selectedFileInfos.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2 px-1">
              {selectedFileInfos.map(f => (
                <span
                  key={f.key}
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground"
                >
                  {f.topic}
                  <button
                    type="button"
                    onClick={() => removeFile(f.key)}
                    className="hover:text-foreground ml-0.5"
                  >
                    &times;
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="rounded-2xl border border-input bg-muted/30 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 ring-offset-background">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your research..."
              disabled={streaming}
              rows={1}
              className="w-full bg-transparent px-4 pt-3 pb-1 text-base sm:text-sm resize-none focus:outline-none disabled:opacity-50 overflow-y-auto placeholder:text-muted-foreground"
              style={{ maxHeight: '144px' }}
            />
            <div className="flex items-center justify-between px-2 pb-2">
              <ContextFilesPopover
                files={files}
                selectedFiles={selectedFiles}
                onSelectFiles={onSelectFiles}
                filesLoading={filesLoading}
              />
              <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => { clearWorkingTimer(); setMessages([]); setSessionId(null); setStreamPhase(null); onNewChat(); }}
                disabled={streaming}
                aria-label="New chat"
                title="New chat"
                className="h-8 w-8 shrink-0 rounded-lg text-muted-foreground flex items-center justify-center disabled:opacity-30 hover:bg-muted transition-colors"
              >
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
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                </svg>
              </button>
              <button
                type="button"
                onClick={handleSend}
                disabled={streaming || !input.trim()}
                aria-label={streaming ? streamStatus : 'Send message'}
                className="h-8 w-8 shrink-0 rounded-lg bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-30 hover:bg-primary/90 transition-colors"
              >
                {streaming ? (
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
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
    </div>
  );
}

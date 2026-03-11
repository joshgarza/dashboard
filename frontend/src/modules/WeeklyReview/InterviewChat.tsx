import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { config } from '@/config';
import type { ChatMessage } from './types';
import { AllTodos } from './AllTodos';

type StreamPhase = 'thinking' | 'working' | 'writing' | null;
const REVIEW_START_MESSAGE = "Let's do my weekly review.";

interface InterviewChatProps {
  onFinalize: (messages: ChatMessage[]) => void | Promise<void>;
  finalizing: boolean;
  onStreamingChange?: (streaming: boolean) => void;
}

export function InterviewChat({ onFinalize, finalizing, onStreamingChange }: InterviewChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamPhase, setStreamPhase] = useState<StreamPhase>(null);
  const [allTodosRefreshKey, setAllTodosRefreshKey] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const workingTimerRef = useRef<number | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    return () => {
      if (workingTimerRef.current !== null) {
        window.clearTimeout(workingTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    onStreamingChange?.(streaming);
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

  function clearWorkingTimer() {
    if (workingTimerRef.current !== null) {
      window.clearTimeout(workingTimerRef.current);
      workingTimerRef.current = null;
    }
  }

  function beginStreamPhases() {
    clearWorkingTimer();
    setStreamPhase('thinking');
    workingTimerRef.current = window.setTimeout(() => {
      setStreamPhase((current) => current === 'thinking' ? 'working' : current);
    }, 1500);
  }

  async function streamResponse(updatedMessages: ChatMessage[]) {
    setMessages(updatedMessages);
    setStreaming(true);
    beginStreamPhases();

    const assistantMessage: ChatMessage = { role: 'assistant', content: '' };
    setMessages([...updatedMessages, assistantMessage]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`${config.apiBaseUrl}/api/weekly-review/interview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: updatedMessages, sessionId }),
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
            } else if (parsed.type === 'message_stop') {
              setAllTodosRefreshKey(k => k + 1);
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

  async function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || streaming) return;

    const userMessage: ChatMessage = { role: 'user', content: trimmed };
    const updatedMessages = [...messages, userMessage];
    setInput('');
    await streamResponse(updatedMessages);
  }

  async function handleStartReview() {
    if (streaming || finalizing || messages.length > 0) {
      return;
    }

    const kickoffMessage: ChatMessage = { role: 'user', content: REVIEW_START_MESSAGE };
    await streamResponse([kickoffMessage]);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const visibleMessages = messages.filter((message, index) => {
    return !(index === 0 && message.role === 'user' && message.content === REVIEW_START_MESSAGE);
  });
  const userTurns = visibleMessages.filter((message) => message.role === 'user').length;
  const showFinalize = userTurns >= 3 && !streaming;
  const activeAssistantIndex = streaming ? visibleMessages.length - 1 : -1;
  const streamStatus = streamPhase === 'working'
    ? 'Working...'
    : streamPhase === 'writing'
      ? 'Writing...'
      : 'Thinking...';

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="app-scrollbar flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto w-full max-w-[52rem] px-4 py-4 sm:px-6 lg:px-8">
          {visibleMessages.length === 0 ? (
            <div className="flex min-h-[50vh] items-center justify-center">
              <div className="space-y-4 text-center">
                <div className="space-y-2">
                  <p className="text-lg text-muted-foreground">Start a new weekly review</p>
                  <p className="text-sm text-muted-foreground/60">
                    Kick off the planning interview, type your own opening message, or reopen a saved review from the sidebar.
                  </p>
                </div>
                <div className="flex justify-center">
                  <Button onClick={() => void handleStartReview()} disabled={streaming || finalizing}>
                    Start review
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4 py-4">
              {visibleMessages.map((msg, i) => (
                <div
                  key={i}
                  className={msg.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
                >
                  <div
                    className={
                      msg.role === 'user'
                        ? 'max-w-[85%] rounded-2xl bg-primary px-4 py-2.5 text-sm text-primary-foreground'
                        : 'max-w-[85%] text-foreground'
                    }
                  >
                    {msg.role === 'assistant' && i === activeAssistantIndex && (
                      <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium tracking-[0.08em] text-muted-foreground">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
                        <span>{streamStatus}</span>
                      </div>
                    )}
                    {msg.role === 'assistant' ? (
                      <div className="whitespace-pre-wrap text-sm leading-7 text-foreground">{msg.content}</div>
                    ) : (
                      <div className="whitespace-pre-wrap">{msg.content}</div>
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
          <div className="rounded-2xl border border-input bg-muted/30 ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Reply to the planning assistant..."
              disabled={streaming || finalizing}
              rows={1}
              className="w-full resize-none overflow-y-auto bg-transparent px-4 pt-3 pb-1 text-base placeholder:text-muted-foreground focus:outline-none disabled:opacity-50 sm:text-sm"
              style={{ maxHeight: '144px' }}
            />

            <div className="flex items-center justify-between gap-2 px-2 pb-2">
              {showFinalize ? (
                <Button variant="ghost" size="sm" onClick={() => onFinalize(messages)} disabled={finalizing}>
                  {finalizing ? 'Generating Plan...' : 'Finalize Plan'}
                </Button>
              ) : (
                <div className="h-8" />
              )}

              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={streaming || finalizing || !input.trim()}
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

          <div className="pt-3">
            <AllTodos refreshKey={allTodosRefreshKey} />
          </div>
        </div>
      </div>
    </div>
  );
}

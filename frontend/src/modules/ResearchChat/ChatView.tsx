import { useState, useEffect, useRef, useCallback } from 'react';
import { config } from '@/config';
import { ContextFilesPopover } from './ContextFilesPopover.tsx';
import type { ChatMessage, ResearchFileInfo } from './types.ts';

interface ChatViewProps {
  files: ResearchFileInfo[];
  selectedFiles: string[];
  onSelectFiles: (files: string[]) => void;
  filesLoading: boolean;
}

export function ChatView({ files, selectedFiles, onSelectFiles, filesLoading }: ChatViewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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

    const assistantMessage: ChatMessage = { role: 'assistant', content: '' };
    setMessages([...updatedMessages, assistantMessage]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`${config.apiBaseUrl}/api/research/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: selectedFiles,
          messages: updatedMessages,
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
            if (parsed.type === 'content_block_delta' && parsed.text) {
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
                <div
                  key={i}
                  className={msg.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
                >
                  <div
                    className={
                      msg.role === 'user'
                        ? 'bg-primary text-primary-foreground rounded-2xl px-4 py-2.5 max-w-[85%] text-sm'
                        : 'text-foreground max-w-[85%] text-sm whitespace-pre-wrap'
                    }
                  >
                    {msg.content}
                    {msg.role === 'assistant' && streaming && i === messages.length - 1 && (
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
              <button
                type="button"
                onClick={handleSend}
                disabled={streaming || !input.trim()}
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
  );
}

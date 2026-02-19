import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { config } from '@/config';
import type { ChatMessage, ResearchFileInfo } from './types.ts';

export function ChatView() {
  const [files, setFiles] = useState<ResearchFileInfo[]>([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const [filesError, setFilesError] = useState<string | null>(null);

  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch(`${config.apiBaseUrl}/api/research/files`)
      .then(res => res.json())
      .then(json => {
        if (json.success) {
          setFiles(json.data);
        } else {
          const msg = typeof json.error === 'object' ? json.error?.message : json.error;
          setFilesError(msg || 'Failed to load files');
        }
        setFilesLoading(false);
      })
      .catch(() => {
        setFilesError('Failed to load research files');
        setFilesLoading(false);
      });
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function handleSelectChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const selected = Array.from(e.target.selectedOptions, opt => opt.value);
    if (selected.length <= 3) {
      setSelectedFiles(selected);
    }
  }

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

  const researchFiles = files.filter(f => f.type === 'research');
  const principleFiles = files.filter(f => f.type === 'principles');

  return (
    <div className="flex-1 flex flex-col gap-3">
      {filesLoading ? (
        <Skeleton className="h-8 w-full" />
      ) : filesError ? (
        <div className="text-destructive text-sm">{filesError}</div>
      ) : (
        <div className="space-y-1">
          <label className="text-sm font-medium leading-none">
            Context files{' '}
            <span className="text-muted-foreground font-normal">(select up to 3)</span>
          </label>
          <select
            multiple
            value={selectedFiles}
            onChange={handleSelectChange}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            size={4}
          >
            {researchFiles.length > 0 && (
              <optgroup label="Research">
                {researchFiles.map(f => (
                  <option key={f.key} value={f.key}>
                    {f.date} — {f.topic}
                  </option>
                ))}
              </optgroup>
            )}
            {principleFiles.length > 0 && (
              <optgroup label="Principles">
                {principleFiles.map(f => (
                  <option key={f.key} value={f.key}>
                    {f.topic}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
      )}

      <div className="rounded-md border bg-muted/30 overflow-y-auto flex-1 min-h-0 p-3 space-y-2">
        {messages.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-8">
            Ask a question about your research...
          </div>
        ) : (
          messages.map((msg, i) => (
            <div
              key={i}
              className={
                msg.role === 'user'
                  ? 'flex justify-end'
                  : 'flex justify-start'
              }
            >
              <div
                className={
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground rounded-lg px-3 py-2 max-w-[80%] text-sm'
                    : 'bg-muted rounded-lg px-3 py-2 max-w-[80%] text-sm whitespace-pre-wrap'
                }
              >
                {msg.content}
                {msg.role === 'assistant' && streaming && i === messages.length - 1 && (
                  <span className="inline-block w-1.5 h-4 bg-foreground/70 ml-0.5 animate-pulse" />
                )}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="flex gap-2">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about your research..."
          disabled={streaming}
          rows={1}
          className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none disabled:opacity-50"
        />
        <Button size="sm" onClick={handleSend} disabled={streaming || !input.trim()}>
          {streaming ? 'Sending...' : 'Send'}
        </Button>
      </div>
    </div>
  );
}

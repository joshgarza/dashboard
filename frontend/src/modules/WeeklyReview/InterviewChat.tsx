import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { config } from '@/config';
import type { ChatMessage } from './types';
import { AllTodos } from './AllTodos';

interface InterviewChatProps {
  onFinalize: (messages: ChatMessage[]) => void;
  finalizing: boolean;
}

export function InterviewChat({ onFinalize, finalizing }: InterviewChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [allTodosRefreshKey, setAllTodosRefreshKey] = useState(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const hasInitRef = useRef(false);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-start the conversation
  useEffect(() => {
    if (hasInitRef.current) return;
    hasInitRef.current = true;

    const initMessage: ChatMessage = { role: 'user', content: "Let's do my weekly review." };
    streamResponse([initMessage]);
  }, []);

  async function streamResponse(updatedMessages: ChatMessage[]) {
    setMessages(updatedMessages);
    setStreaming(true);

    const assistantMessage: ChatMessage = { role: 'assistant', content: '' };
    setMessages([...updatedMessages, assistantMessage]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`${config.apiBaseUrl}/api/weekly-review/interview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: updatedMessages }),
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

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  // Count user messages (excluding the auto-init) to decide when to show Finalize
  const userTurns = messages.filter(m => m.role === 'user').length;
  const showFinalize = userTurns >= 3 && !streaming;

  return (
    <div className="flex-1 flex flex-col gap-3 min-h-0">
      <div className="rounded-md border bg-muted/30 overflow-y-auto flex-1 min-h-0 p-3 space-y-2">
        {messages.filter((_m, i) => i > 0).map((msg, i) => (
          <div
            key={i}
            className={msg.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
          >
            <div
              className={
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground rounded-lg px-3 py-2 max-w-[80%] text-sm'
                  : 'bg-muted rounded-lg px-3 py-2 max-w-[80%] text-sm whitespace-pre-wrap'
              }
            >
              {msg.content}
              {msg.role === 'assistant' && streaming && i === messages.length - 2 && (
                <span className="inline-block w-1.5 h-4 bg-foreground/70 ml-0.5 animate-pulse" />
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="flex gap-2">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Reply to the planning assistant..."
          disabled={streaming || finalizing}
          rows={1}
          className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none disabled:opacity-50"
        />
        <Button size="sm" onClick={handleSend} disabled={streaming || !input.trim() || finalizing}>
          {streaming ? 'Sending...' : 'Send'}
        </Button>
      </div>

      {showFinalize && (
        <Button onClick={() => onFinalize(messages)} disabled={finalizing}>
          {finalizing ? 'Generating Plan...' : 'Finalize Plan'}
        </Button>
      )}

      <AllTodos refreshKey={allTodosRefreshKey} />
    </div>
  );
}

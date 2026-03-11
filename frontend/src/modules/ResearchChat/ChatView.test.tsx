import { jest } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import type { ResearchChatState, ResearchChatThread } from './types.ts';

jest.unstable_mockModule('@/config', () => ({
  config: {
    apiBaseUrl: 'http://localhost:3001',
  },
}));

jest.unstable_mockModule('./ContextFilesPopover.tsx', () => ({
  ContextFilesPopover: () => <div data-testid="context-files-popover" />,
}));

jest.unstable_mockModule('./MarkdownMessage.tsx', () => ({
  MarkdownMessage: ({ content }: { content: string }) => <div data-testid="markdown-message">{content}</div>,
}));

const { ChatView } = await import('./ChatView.tsx');

class MockTextDecoder {
  decode(value?: Uint8Array) {
    return value ? Array.from(value, (char) => String.fromCharCode(char)).join('') : '';
  }
}

function createControlledStream() {
  const pendingReads: Array<(value: { done: boolean; value?: Uint8Array }) => void> = [];
  let closed = false;

  function toBytes(chunk: string): Uint8Array {
    return Uint8Array.from(Array.from(chunk, (char) => char.charCodeAt(0)));
  }

  return {
    body: {
      getReader() {
        return {
          read() {
            if (closed) {
              return Promise.resolve({ done: true });
            }
            return new Promise<{ done: boolean; value?: Uint8Array }>((resolve) => {
              pendingReads.push(resolve);
            });
          },
        };
      },
    },
    enqueue(chunk: string) {
      const nextRead = pendingReads.shift();
      if (!nextRead) throw new Error('Tried to enqueue without a pending read');
      nextRead({ done: false, value: toBytes(chunk) });
    },
    close() {
      closed = true;
      pendingReads.shift()?.({ done: true });
    },
  };
}

describe('ChatView', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    window.HTMLElement.prototype.scrollIntoView = jest.fn();
    globalThis.TextDecoder = MockTextDecoder as unknown as typeof globalThis.TextDecoder;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows thinking, working, and writing phases while a response is in progress', async () => {
    const stream = createControlledStream();

    globalThis.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        body: stream.body,
      } as Response)
    ) as typeof fetch;

    function ChatViewHarness() {
      const [activeChatId, setActiveChatId] = useState<string | null>(null);
      const [chatState, setChatState] = useState<ResearchChatState>({
        messages: [],
        selectedFiles: [],
      });

      return (
        <ChatView
          chatId={activeChatId}
          chatTitle={activeChatId ? 'Saved chat' : 'New chat'}
          loading={false}
          files={[]}
          messages={chatState.messages}
          selectedFiles={chatState.selectedFiles}
          onSelectFiles={(files) => setChatState((prev) => ({ ...prev, selectedFiles: files }))}
          filesLoading={false}
          onCreateChat={(chat: ResearchChatThread) => {
            setActiveChatId(chat.id);
            setChatState({
              messages: chat.messages,
              selectedFiles: chat.selectedFiles,
            });
          }}
          onUpdateChat={(_chatId, updates) => setChatState((prev) => ({ ...prev, ...updates }))}
          onSyncChat={async () => {}}
          onStreamingChange={() => {}}
          onOpenSidebar={() => {}}
        />
      );
    }

    render(<ChatViewHarness />);

    fireEvent.change(screen.getByPlaceholderText('Ask about your research...'), {
      target: { value: 'Explain edge caching' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(screen.getByText('Thinking...')).toBeInTheDocument();
    });

    act(() => {
      jest.advanceTimersByTime(1500);
    });

    await waitFor(() => {
      expect(screen.getByText('Working...')).toBeInTheDocument();
    });

    await act(async () => {
      stream.enqueue(`data: ${JSON.stringify({
        type: 'chat_created',
        chat: {
          id: 'chat-1',
          title: 'Explain edge caching',
          createdAt: '2026-03-10T00:00:00.000Z',
          updatedAt: '2026-03-10T00:00:00.000Z',
          messageCount: 1,
        },
      })}\n\n`);
    });

    await act(async () => {
      stream.enqueue(`data: ${JSON.stringify({
        type: 'content_block_delta',
        text: 'Caching reduces latency.',
      })}\n\n`);
    });

    await waitFor(() => {
      expect(screen.getByText('Writing...')).toBeInTheDocument();
    });

    await act(async () => {
      stream.enqueue(`data: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
      stream.close();
    });

    await waitFor(() => {
      expect(screen.queryByText('Writing...')).not.toBeInTheDocument();
    });
  });
});

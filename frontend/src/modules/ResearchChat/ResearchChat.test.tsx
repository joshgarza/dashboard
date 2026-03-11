import { jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.unstable_mockModule('@/config', () => ({
  config: {
    apiBaseUrl: 'http://localhost:3001',
  },
}));

jest.unstable_mockModule('./ChatView.tsx', () => ({
  ChatView: ({
    chatId,
    messages,
    selectedFiles,
    onCreateChat,
    onOpenSidebar,
  }: {
    chatId: string | null;
    messages: Array<{ role: string; content: string }>;
    selectedFiles: string[];
    onCreateChat: (chat: {
      id: string;
      title: string;
      createdAt: string;
      updatedAt: string;
      messageCount: number;
      messages: Array<{ role: 'user' | 'assistant'; content: string }>;
      selectedFiles: string[];
    }) => void;
    onOpenSidebar: () => void;
  }) => (
    <div>
      <div data-testid="active-chat-id">{chatId ?? 'draft'}</div>
      <div data-testid="message-count">{messages.length}</div>
      <div data-testid="selected-files">{selectedFiles.join(',')}</div>
      <button
        type="button"
        onClick={() => onCreateChat({
          id: 'chat-2',
          title: 'Database-backed history',
          createdAt: '2026-03-10T00:00:00.000Z',
          updatedAt: '2026-03-10T00:00:00.000Z',
          messageCount: 1,
          messages: [{ role: 'user', content: 'Database-backed history' }],
          selectedFiles,
        })}
      >
        Create saved chat
      </button>
      <button type="button" onClick={onOpenSidebar}>Open sidebar</button>
    </div>
  ),
}));

const { ResearchChat } = await import('./ResearchChat.tsx');

describe('ResearchChat', () => {
  beforeEach(() => {
    globalThis.fetch = jest.fn((input: string | URL | Request) => {
      const url = String(input);

      if (url.endsWith('/api/research/files')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: [] }),
        } as Response);
      }

      if (url.endsWith('/api/research/chats')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: [{
              id: 'chat-1',
              title: 'Existing DB chat',
              createdAt: '2026-03-09T00:00:00.000Z',
              updatedAt: '2026-03-09T00:00:00.000Z',
              messageCount: 2,
            }],
          }),
        } as Response);
      }

      if (url.endsWith('/api/research/chats/chat-1')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            success: true,
            data: {
              id: 'chat-1',
              title: 'Existing DB chat',
              createdAt: '2026-03-09T00:00:00.000Z',
              updatedAt: '2026-03-09T00:00:00.000Z',
              messageCount: 2,
              messages: [
                { role: 'user', content: 'Existing question' },
                { role: 'assistant', content: 'Existing answer' },
              ],
              selectedFiles: [],
            },
          }),
        } as Response);
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }) as typeof fetch;
  });

  it('defaults to a fresh draft chat even when saved chats exist in the database', async () => {
    render(<ResearchChat />);

    await waitFor(() => {
      expect(screen.getByText('Existing DB chat')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /New chat/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('active-chat-id')).toHaveTextContent('draft');
    expect(screen.getByTestId('message-count')).toHaveTextContent('0');

    fireEvent.click(screen.getByText('Existing DB chat').closest('button') as HTMLButtonElement);

    await waitFor(() => {
      expect(screen.getByTestId('active-chat-id')).toHaveTextContent('chat-1');
    });

    await waitFor(() => {
      expect(screen.getByTestId('message-count')).toHaveTextContent('2');
    });
  });

  it('creates a saved chat from the draft and lets you return to a blank new chat', async () => {
    render(<ResearchChat />);

    fireEvent.click(screen.getByRole('button', { name: 'Create saved chat' }));

    await waitFor(() => {
      expect(screen.getByText('Database-backed history')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /New chat/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('active-chat-id')).toHaveTextContent('chat-2');
    expect(screen.getByTestId('message-count')).toHaveTextContent('1');

    fireEvent.click(screen.getByRole('button', { name: /New chat/ }));

    expect(screen.getByRole('button', { name: /New chat/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('active-chat-id')).toHaveTextContent('draft');
    expect(screen.getByTestId('message-count')).toHaveTextContent('0');
  });

  it('opens the mobile sidebar drawer from the chat view trigger', async () => {
    render(<ResearchChat />);

    fireEvent.click(screen.getByRole('button', { name: 'Open sidebar' }));

    expect(screen.getByRole('dialog', { name: 'Research chats' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close sidebar' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Research chats' })).not.toBeInTheDocument();
    });
  });
});

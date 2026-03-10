import { jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.unstable_mockModule('@/config', () => ({
  config: {
    apiBaseUrl: 'http://localhost:3001',
  },
}));

jest.unstable_mockModule('./ChatView.tsx', () => ({
  ChatView: ({ chatId, messages, selectedFiles, onPersistChat }: {
    chatId: string | null;
    messages: Array<{ role: string; content: string }>;
    selectedFiles: string[];
    onPersistChat: (chat: {
      messages: Array<{ role: 'user' | 'assistant'; content: string }>;
      sessionId: string | null;
      selectedFiles: string[];
    }) => string;
  }) => (
    <div>
      <div data-testid="active-chat-id">{chatId ?? 'draft'}</div>
      <div data-testid="message-count">{messages.length}</div>
      <div data-testid="selected-files">{selectedFiles.join(',')}</div>
      <button
        type="button"
        onClick={() => onPersistChat({
          messages: [{ role: 'user', content: 'Persistent cache invalidation question' }],
          sessionId: null,
          selectedFiles,
        })}
      >
        Persist draft chat
      </button>
    </div>
  ),
}));

const { ResearchChat } = await import('./ResearchChat.tsx');

describe('ResearchChat', () => {
  beforeEach(() => {
    localStorage.clear();
    globalThis.fetch = jest.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve({ success: true, data: [] }),
      } as Response)
    ) as typeof fetch;
  });

  it('defaults to a fresh draft chat even when saved chats exist, and migrates the legacy chat storage', async () => {
    localStorage.setItem('research-messages', JSON.stringify([
      { role: 'user', content: 'Legacy database cache question' },
      { role: 'assistant', content: 'Legacy answer' },
    ]));
    localStorage.setItem('research-session-id', 'legacy-session');

    render(<ResearchChat />);

    await waitFor(() => {
      expect(screen.getByText('Legacy database cache question')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /New chat/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('active-chat-id')).toHaveTextContent('draft');
    expect(screen.getByTestId('message-count')).toHaveTextContent('0');

    fireEvent.click(screen.getByText('Legacy database cache question').closest('button') as HTMLButtonElement);

    expect(screen.getByTestId('message-count')).toHaveTextContent('2');
    expect(localStorage.getItem('research-messages')).toBeNull();
    expect(localStorage.getItem('research-session-id')).toBeNull();
  });

  it('creates a saved chat from the draft and lets you return to a blank new chat', async () => {
    render(<ResearchChat />);

    fireEvent.click(screen.getByRole('button', { name: 'Persist draft chat' }));

    await waitFor(() => {
      expect(screen.getByText('Persistent cache invalidation question')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /New chat/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('message-count')).toHaveTextContent('1');

    fireEvent.click(screen.getByRole('button', { name: /New chat/ }));

    expect(screen.getByRole('button', { name: /New chat/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('active-chat-id')).toHaveTextContent('draft');
    expect(screen.getByTestId('message-count')).toHaveTextContent('0');
  });
});

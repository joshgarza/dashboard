import { jest } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.unstable_mockModule('@/config', () => ({
  config: {
    apiBaseUrl: 'http://localhost:3001',
  },
}));

jest.unstable_mockModule('./ContextFilesPopover.tsx', () => ({
  ContextFilesPopover: () => <div data-testid="context-files-popover" />,
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
    localStorage.clear();
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

    render(
      <ChatView
        files={[]}
        selectedFiles={[]}
        onSelectFiles={() => {}}
        filesLoading={false}
        onNewChat={() => {}}
      />
    );

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

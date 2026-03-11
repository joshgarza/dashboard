import { jest } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.unstable_mockModule('@/config', () => ({
  config: {
    apiBaseUrl: 'http://localhost:3001',
  },
}));

jest.unstable_mockModule('./AllTodos', () => ({
  AllTodos: () => <div data-testid="all-todos" />,
}));

const { InterviewChat } = await import('./InterviewChat');

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

describe('InterviewChat', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    window.HTMLElement.prototype.scrollIntoView = jest.fn();
    globalThis.TextDecoder = MockTextDecoder as unknown as typeof globalThis.TextDecoder;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('waits for an explicit start before showing streaming phases', async () => {
    const stream = createControlledStream();

    globalThis.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        body: stream.body,
      } as Response)
    ) as typeof fetch;

    render(<InterviewChat onFinalize={() => {}} finalizing={false} />);

    expect(screen.getByRole('button', { name: 'Start review' })).toBeInTheDocument();
    expect(screen.queryByText('Thinking...')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Start review' }));

    await waitFor(() => {
      expect(screen.getAllByText('Thinking...').length).toBeGreaterThan(0);
    });

    act(() => {
      jest.advanceTimersByTime(1500);
    });

    await waitFor(() => {
      expect(screen.getAllByText('Working...').length).toBeGreaterThan(0);
    });

    await act(async () => {
      stream.enqueue(`data: ${JSON.stringify({
        type: 'content_block_delta',
        text: "Let's review your week.",
      })}\n\n`);
    });

    await waitFor(() => {
      expect(screen.getAllByText('Writing...').length).toBeGreaterThan(0);
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

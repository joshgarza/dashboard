import { renderHook, waitFor, act } from '@testing-library/react';
import { useFetch } from './useFetch';

const mockFetch = (response: unknown, ok = true, delay = 0) => {
  globalThis.fetch = (() =>
    new Promise((resolve) =>
      setTimeout(
        () =>
          resolve({
            ok,
            json: () => Promise.resolve(response),
          } as Response),
        delay
      )
    )) as typeof fetch;
};

describe('useFetch', () => {
  afterEach(() => {
    (globalThis.fetch as unknown) = undefined;
  });

  it('starts in loading state', () => {
    mockFetch({ data: 'test' }, true, 100);

    const { result } = renderHook(() => useFetch('/api/test'));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('returns data on successful fetch', async () => {
    mockFetch({ data: 'test' });

    const { result } = renderHook(() => useFetch<{ data: string }>('/api/test'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual({ data: 'test' });
    expect(result.current.error).toBeNull();
  });

  it('returns error on failed fetch', async () => {
    mockFetch({ message: 'Not found' }, false);

    const { result } = renderHook(() => useFetch('/api/test'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeTruthy();
  });

  it('handles network errors', async () => {
    globalThis.fetch = (() => Promise.reject(new Error('Network error'))) as typeof fetch;

    const { result } = renderHook(() => useFetch('/api/test'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe('Network error');
  });

  it('refetches when refetch is called', async () => {
    let callCount = 0;
    globalThis.fetch = (() => {
      callCount++;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ count: callCount }),
      } as Response);
    }) as typeof fetch;

    const { result } = renderHook(() => useFetch<{ count: number }>('/api/test'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data?.count).toBe(1);

    await act(async () => {
      result.current.refetch();
    });

    await waitFor(() => {
      expect(result.current.data?.count).toBe(2);
    });
  });

  it('does not fetch when skip is true', () => {
    mockFetch({ data: 'test' });

    const { result } = renderHook(() => useFetch('/api/test', { skip: true }));

    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
  });
});

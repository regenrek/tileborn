// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useReadiness } from './queries';

const wrapper = ({ children }: { readonly children: ReactNode }) => {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Infinity,
      },
    },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

describe('useReadiness', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('surfaces a timed-out readiness IPC as an actionable query error', async () => {
    vi.useFakeTimers();
    const check = vi.fn(() => new Promise(() => undefined));
    (window as unknown as { tileborne: unknown }).tileborne = {
      readiness: {
        check,
      },
    };

    const { result } = renderHook(() => useReadiness('project-1', 'map-1', 'playtest'), {
      wrapper,
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(check).toHaveBeenCalledWith({
      projectId: 'project-1',
      mapId: 'map-1',
      purpose: 'playtest',
    });
    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_001);
      await Promise.resolve();
    });

    expect(result.current.isError).toBe(true);
    expect(result.current.error).toBeInstanceOf(Error);
    expect((result.current.error as Error).message).toContain(
      'readiness:playtest:project=project-1:map=map-1 did not resolve within 12000ms',
    );
    expect(result.current.failureCount).toBe(1);
    expect(check).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
      await Promise.resolve();
    });

    expect(check).toHaveBeenCalledTimes(1);

    await act(async () => {
      void result.current.refetch();
      await Promise.resolve();
    });

    expect(check).toHaveBeenCalledTimes(2);
  });

  it('retains a successful readiness result across same-key observer remounts', async () => {
    const check = vi.fn(async () => ({
      report: {
        ok: true,
        diagnostics: [],
      },
    }));
    (window as unknown as { tileborne: unknown }).tileborne = {
      readiness: {
        check,
      },
    };

    const client = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          gcTime: Infinity,
        },
      },
    });
    const stableWrapper = ({ children }: { readonly children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const first = renderHook(() => useReadiness('project-1', 'map-1', 'playtest'), {
      wrapper: stableWrapper,
    });

    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    const dataUpdatedAt = first.result.current.dataUpdatedAt;
    first.unmount();

    const second = renderHook(() => useReadiness('project-1', 'map-1', 'playtest'), {
      wrapper: stableWrapper,
    });

    expect(second.result.current.isSuccess).toBe(true);
    expect(second.result.current.dataUpdatedAt).toBe(dataUpdatedAt);
    expect(check).toHaveBeenCalledTimes(1);
  });
});

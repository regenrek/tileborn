// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';

import { invalidateBehaviorReferences, queryKeys } from '@/lib/query-client';

import { isMapsListQuery, useEventInvalidations } from './use-event-invalidations.js';

describe('isMapsListQuery', () => {
  it('matches map list queries without matching open map detail queries', () => {
    expect(isMapsListQuery(queryKeys.maps.list('project-1'))).toBe(true);
    expect(isMapsListQuery(queryKeys.maps.detail('project-1', 'map-1'))).toBe(false);
  });

  it('invalidates one open project registry or every registry when dynamic providers change', async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    await invalidateBehaviorReferences({ invalidateQueries }, 'project-1');
    await invalidateBehaviorReferences({ invalidateQueries });
    expect(invalidateQueries).toHaveBeenNthCalledWith(1, {
      queryKey: queryKeys.behaviorReferences.project('project-1'),
    });
    expect(invalidateQueries).toHaveBeenNthCalledWith(2, {
      queryKey: queryKeys.behaviorReferences.all,
    });
  });

  it('live-invalidates open reference pickers for project, map, asset, and plugin events', () => {
    const handlers = new Map<string, () => void>();
    const events = new Proxy({}, {
      get: (_target, property) => (handler: () => void) => {
        handlers.set(String(property), handler);
        return vi.fn();
      },
    });
    Object.assign(globalThis.window, { tileborne: { events } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateQueries = vi.spyOn(client, 'invalidateQueries');
    renderHook(() => useEventInvalidations(), {
      wrapper: ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children),
    });

    for (const event of ['onProjectsChanged', 'onMapsChanged', 'onAssetsChanged', 'onPluginsChanged']) {
      handlers.get(event)?.();
    }
    expect(invalidateQueries.mock.calls.filter(([input]) =>
      JSON.stringify(input?.queryKey) === JSON.stringify(queryKeys.behaviorReferences.all))).toHaveLength(4);
  });
});

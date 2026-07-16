// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useImportCatalog } from '@/hooks/mutations';
import { useValidateCatalog } from '@/hooks/queries';
import { useEventInvalidations } from '@/hooks/use-event-invalidations';
import { queryKeys } from '@/lib/query-client';

const PROJECT_ID = 'project:550e8400-e29b-41d4-a716-446655440101';

const setBridge = (value: unknown) => {
  Object.defineProperty(window, 'tileborne', { configurable: true, value });
};

const clientWrapper =
  (client: QueryClient) =>
  ({ children }: { readonly children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

describe('useValidateCatalog', () => {
  afterEach(() => vi.restoreAllMocks());

  it('runs tileborne:catalog:validate for the project and returns the report', async () => {
    const validateFn = vi
      .fn()
      .mockResolvedValue({ report: { ok: false, issues: [{ kind: 'coherence', message: 'x' }] } });
    setBridge({ catalog: { validate: validateFn } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { result } = renderHook(() => useValidateCatalog(PROJECT_ID), {
      wrapper: clientWrapper(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(validateFn).toHaveBeenCalledWith({ projectId: PROJECT_ID });
    expect(result.current.data?.report.ok).toBe(false);
  });

  it('is disabled (never calls the bridge) when no project is open', () => {
    const validateFn = vi.fn();
    setBridge({ catalog: { validate: validateFn } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    renderHook(() => useValidateCatalog(undefined), { wrapper: clientWrapper(client) });

    expect(validateFn).not.toHaveBeenCalled();
  });
});

describe('catalog report refresh', () => {
  let client: QueryClient;

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => vi.restoreAllMocks());

  it('useImportCatalog invalidates both the resolve and validate queries on a persisted import', async () => {
    const importFn = vi
      .fn()
      .mockResolvedValue({ imported: true, report: { ok: true, issues: [] } });
    setBridge({ catalog: { import: importFn } });
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useImportCatalog(), { wrapper: clientWrapper(client) });
    await result.current.mutateAsync({ projectId: PROJECT_ID, catalogJson: { id: 'catalog:x' } });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.catalog.resolve(PROJECT_ID) });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.catalog.validate(PROJECT_ID),
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.readiness.all });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.assetLibrary.useSitesProject(PROJECT_ID),
    });
  });

  it('does not invalidate when an import is rejected by validation (nothing persisted)', async () => {
    const importFn = vi.fn().mockResolvedValue({
      imported: false,
      report: { ok: false, issues: [{ kind: 'coherence', message: 'x' }] },
    });
    setBridge({ catalog: { import: importFn } });
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    const { result } = renderHook(() => useImportCatalog(), { wrapper: clientWrapper(client) });
    await result.current.mutateAsync({ projectId: PROJECT_ID, catalogJson: { id: 'catalog:x' } });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('refreshes the catalog (resolve + validate) when plugins change', () => {
    const handlers: Record<string, () => void> = {};
    const makeOn = (name: string) => (cb: () => void) => {
      handlers[name] = cb;
      return () => {};
    };
    setBridge({
      events: {
        onProjectsChanged: makeOn('projects'),
        onMapsChanged: makeOn('maps'),
        onAssetsChanged: makeOn('assets'),
        onAssetsCapabilityRefreshed: makeOn('assetsCapability'),
        onPluginsChanged: makeOn('plugins'),
        onJobsChanged: makeOn('jobs'),
        onBuildsChanged: makeOn('builds'),
        onExportsChanged: makeOn('exports'),
        onPlaytestChanged: makeOn('playtest'),
        onDeploymentsChanged: makeOn('deployments'),
        onSupportChanged: makeOn('support'),
        onLogsAppended: makeOn('logs'),
      },
    });
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    renderHook(() => useEventInvalidations(), { wrapper: clientWrapper(client) });
    act(() => handlers.plugins?.());

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.catalog.all });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.readiness.all });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.assetLibrary.useSitesAll(),
    });
  });

  it.each(['projects', 'maps', 'assets'] as const)(
    'refreshes asset use sites when %s consumers can change',
    (eventName) => {
      const handlers: Record<string, (payload?: unknown) => void> = {};
      const makeOn = (name: string) => (cb: (payload?: unknown) => void) => {
        handlers[name] = cb;
        return () => {};
      };
      setBridge({
        events: {
          onProjectsChanged: makeOn('projects'),
          onMapsChanged: makeOn('maps'),
          onAssetsChanged: makeOn('assets'),
          onAssetsCapabilityRefreshed: makeOn('assetsCapability'),
          onPluginsChanged: makeOn('plugins'),
          onJobsChanged: makeOn('jobs'),
          onBuildsChanged: makeOn('builds'),
          onExportsChanged: makeOn('exports'),
          onPlaytestChanged: makeOn('playtest'),
          onDeploymentsChanged: makeOn('deployments'),
          onSupportChanged: makeOn('support'),
          onLogsAppended: makeOn('logs'),
        },
      });
      const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
      renderHook(() => useEventInvalidations(), { wrapper: clientWrapper(client) });
      act(() => handlers[eventName]?.({}));
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: queryKeys.assetLibrary.useSitesAll(),
      });
    },
  );

  it.each(['projects', 'maps', 'assets', 'assetsCapability'] as const)(
    'refreshes readiness when %s prerequisites change',
    (eventName) => {
      const handlers: Record<string, (payload?: unknown) => void> = {};
      const makeOn = (name: string) => (cb: (payload?: unknown) => void) => {
        handlers[name] = cb;
        return () => {};
      };
      setBridge({
        events: {
          onProjectsChanged: makeOn('projects'),
          onMapsChanged: makeOn('maps'),
          onAssetsChanged: makeOn('assets'),
          onAssetsCapabilityRefreshed: makeOn('assetsCapability'),
          onPluginsChanged: makeOn('plugins'),
          onJobsChanged: makeOn('jobs'),
          onBuildsChanged: makeOn('builds'),
          onExportsChanged: makeOn('exports'),
          onPlaytestChanged: makeOn('playtest'),
          onDeploymentsChanged: makeOn('deployments'),
          onSupportChanged: makeOn('support'),
          onLogsAppended: makeOn('logs'),
        },
      });
      const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
      renderHook(() => useEventInvalidations(), { wrapper: clientWrapper(client) });
      act(() => handlers[eventName]?.({ packId: 'pack:x', capability: {} }));
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.readiness.all });
    },
  );
});

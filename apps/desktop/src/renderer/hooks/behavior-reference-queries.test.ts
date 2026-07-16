// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import {
  AssetBehaviorReference,
  CatalogBehaviorReference,
  EntityBehaviorReference,
  NestedBehaviorReference,
  makeAssetId,
  makeBehaviorId,
  makeGameObjectTypeId,
  makeObjectId,
  type Uuid,
} from '@tileborne/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  behaviorReferencePageQueryOptions,
  behaviorReferenceResolveQueries,
  behaviorReferenceResolveQueryOptions,
  chunkBehaviorReferences,
  useResolveBehaviorReferences,
} from './queries.js';

const response = (query: string) => ({
  kind: 'asset' as const,
  query,
  offset: 0,
  limit: 32,
  total: 1,
  options: [],
});
const uuid = (tail: string): Uuid =>
  `00000000-0000-4000-8000-${tail.padStart(12, '0')}` as Uuid;
const referenceId = (reference: EntityBehaviorReference | AssetBehaviorReference | CatalogBehaviorReference | NestedBehaviorReference) =>
  reference._tag === 'entity' ? String(reference.objectId)
    : reference._tag === 'asset' ? String(reference.assetId)
      : reference._tag === 'catalog' ? String(reference.objectTypeId)
        : String(reference.behaviorId);
const mixedReferences = (length: number) => Array.from({ length }, (_, index) => {
  const id = uuid(String(1_000 + index));
  switch (index % 4) {
    case 0: return new EntityBehaviorReference({ objectId: makeObjectId(id) });
    case 1: return new AssetBehaviorReference({ assetId: makeAssetId(id) });
    case 2: return new CatalogBehaviorReference({ objectTypeId: makeGameObjectTypeId(id) });
    default: return new NestedBehaviorReference({ behaviorId: makeBehaviorId(id) });
  }
});

afterEach(() => vi.restoreAllMocks());

describe('behavior reference page queries', () => {
  it('does not invoke IPC until the picker enables the query', async () => {
    const references = vi.fn().mockResolvedValue(response(''));
    Object.assign(globalThis.window, { tileborne: { behaviors: { references } } });
    const client = new QueryClient();
    const options = behaviorReferencePageQueryOptions({
      projectId: 'project-1',
      kind: 'asset',
      enabled: false,
    });

    expect(options.enabled).toBe(false);
    expect(references).not.toHaveBeenCalled();
    client.clear();
  });

  it('aborts stale searches and keeps query results isolated by search text', async () => {
    let resolveOld: ((value: ReturnType<typeof response>) => void) | undefined;
    const references = vi.fn(({ query }: { query: string }) =>
      query === 'old'
        ? new Promise<ReturnType<typeof response>>((resolve) => { resolveOld = resolve; })
        : Promise.resolve(response(query)),
    );
    Object.assign(globalThis.window, { tileborne: { behaviors: { references } } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const oldOptions = behaviorReferencePageQueryOptions({
      projectId: 'project-1',
      kind: 'asset',
      query: 'old',
    });
    const nextOptions = behaviorReferencePageQueryOptions({
      projectId: 'project-1',
      kind: 'asset',
      query: 'next',
    });

    const oldRequest = client.fetchQuery(oldOptions);
    await client.cancelQueries({ queryKey: oldOptions.queryKey });
    await expect(oldRequest).rejects.toMatchObject({ message: 'CancelledError' });
    await expect(client.fetchQuery(nextOptions)).resolves.toMatchObject({ query: 'next' });
    resolveOld?.(response('old'));
    await Promise.resolve();

    expect(client.getQueryData(nextOptions.queryKey)).toMatchObject({ query: 'next' });
    expect(client.getQueryData(oldOptions.queryKey)).toBeUndefined();
    client.clear();
  });

  it('hydrates selected IDs for all four kinds independently from paged browsing', async () => {
    const selected = [
      new EntityBehaviorReference({ objectId: makeObjectId(uuid('1')) }),
      new AssetBehaviorReference({ assetId: makeAssetId(uuid('2')) }),
      new CatalogBehaviorReference({ objectTypeId: makeGameObjectTypeId(uuid('3')) }),
      new NestedBehaviorReference({ behaviorId: makeBehaviorId(uuid('4')) }),
    ] as const;
    const options = selected.map((reference) => ({
      id: reference._tag,
      label: `Resolved ${reference._tag}`,
      reference,
    }));
    const resolveReferences = vi.fn().mockResolvedValue({ options, missing: [] });
    Object.assign(globalThis.window, { tileborne: { behaviors: { resolveReferences } } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const hydrated = await client.fetchQuery(
      behaviorReferenceResolveQueryOptions('project-1', selected),
    );

    expect(resolveReferences).toHaveBeenCalledWith({
      projectId: 'project-1',
      references: selected,
    });
    expect(hydrated.options.map(({ reference }) => reference._tag)).toEqual([
      'entity', 'asset', 'catalog', 'behavior',
    ]);
    expect(hydrated.missing).toEqual([]);
    client.clear();
  });

  it.each([
    [65, [64, 1]],
    [128, [64, 64]],
    [129, [64, 64, 1]],
  ] as const)('deduplicates and chunks all %i mixed references', (count, expectedSizes) => {
    expect(chunkBehaviorReferences(mixedReferences(count)).map(({ length }) => length)).toEqual(expectedSizes);
  });

  it('isolates cache keys when only reference 65 changes', () => {
    const first = Array.from({ length: 65 }, (_, index) =>
      new NestedBehaviorReference({ behaviorId: makeBehaviorId(uuid(String(2_000 + index))) }),
    );
    const changed = [...first.slice(0, 64), new NestedBehaviorReference({
      behaviorId: makeBehaviorId(uuid('9999')),
    })];
    const firstKeys = behaviorReferenceResolveQueries('project-1', first).map(({ queryKey }) => queryKey);
    const changedKeys = behaviorReferenceResolveQueries('project-1', changed).map(({ queryKey }) => queryKey);

    expect(firstKeys[0]).toEqual(changedKeys[0]);
    expect(firstKeys[1]).not.toEqual(changedKeys[1]);
  });

  it('combines 129 references and reports a missing item from the final chunk', async () => {
    const selected = mixedReferences(129);
    const missingReference = chunkBehaviorReferences(selected)[2]![0]!;
    const resolveReferences = vi.fn(async ({ references }: { references: typeof selected }) => ({
      options: references
        .filter((reference) => referenceId(reference) !== referenceId(missingReference))
        .map((reference) => ({ id: referenceId(reference), label: referenceId(reference), reference })),
      missing: references.filter((reference) => referenceId(reference) === referenceId(missingReference)),
    }));
    Object.assign(globalThis.window, { tileborne: { behaviors: { resolveReferences } } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useResolveBehaviorReferences('project-1', selected), {
      wrapper: ({ children }: { children: ReactNode }) => (
        createElement(QueryClientProvider, { client }, children)
      ),
    });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(resolveReferences).toHaveBeenCalledTimes(3);
    expect(resolveReferences.mock.calls.map(([input]) => input.references.length)).toEqual([64, 64, 1]);
    expect(result.current.data?.options).toHaveLength(128);
    expect(result.current.data?.missing).toEqual([missingReference]);
    expect(result.current.isFetching).toBe(false);
    client.clear();
  });
});

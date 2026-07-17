// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import {
  AssetLibraryGroup,
  AssetLibraryReference,
  hashJsonStable,
  makePackId,
  makePlaceableId,
  type Uuid,
} from '@tileborne/core';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SpritePickerDialog } from './sprite-picker-dialog';
import {
  SPRITE_PICKER_DOM_LIMIT,
  SPRITE_PICKER_PAGE_SIZE_PER_KIND,
} from '@/lib/sprite-picker-model';

const uuid = (suffix: string) => `550e8400-e29b-41d4-a716-${suffix.padStart(12, '0')}` as Uuid;
const firstPackId = makePackId(uuid('1'));
const secondPackId = makePackId(uuid('2'));

const groupAt = (kind: 'sprite' | 'placeable', index: number) => {
  const placeableId = makePlaceableId(uuid(String(index + (kind === 'sprite' ? 100 : 2_100))));
  const ref = new AssetLibraryReference({
    packId: firstPackId,
    kind,
    refId: placeableId,
  });
  return new AssetLibraryGroup({
    id: `${kind}:${placeableId}`,
    packId: firstPackId,
    kind,
    label: `${kind} ${index}`,
    count: 1,
    metadata: { width: '32', height: '48', clipsJson: '[]' },
    searchText: `${kind} ${index}`,
    primaryRef: ref,
    previewRefs: [ref],
  });
};

describe('SpritePickerDialog bounded data path', () => {
  let client: QueryClient;
  let getPackLibrary: ReturnType<typeof vi.fn>;
  let resolvePreviews: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    getPackLibrary = vi.fn(
      async (input: {
        readonly packId: string;
        readonly groupKind: 'sprite' | 'placeable';
        readonly offset: number;
        readonly limit: number;
      }) => ({
        packId: input.packId,
        integrityHash: hashJsonStable({ packId: input.packId }),
        indexSchemaVersion: 1,
        previewRefLimit: 8,
        total: 1_000,
        offset: input.offset,
        limit: input.limit,
        groups: Array.from({ length: input.limit }, (_, localIndex) =>
          groupAt(input.groupKind, input.offset + localIndex),
        ),
      }),
    );
    resolvePreviews = vi.fn(async () => ({ previews: [] }));
    Object.defineProperty(window, 'tileborne', {
      configurable: true,
      value: {
        assets: {
          listPacks: vi.fn(async () => ({
            packs: [
              {
                id: firstPackId,
                name: 'Two thousand sprites',
                integrityHash: hashJsonStable({ packId: firstPackId }),
              },
              {
                id: secondPackId,
                name: 'Must stay unloaded',
                integrityHash: hashJsonStable({ packId: secondPackId }),
              },
            ],
          })),
        },
        assetLibrary: { getPackLibrary, resolvePreviews },
      },
    });
  });

  afterEach(() => {
    cleanup();
    client.clear();
  });

  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

  it('keeps a 2,000-entry library to two selected-pack windows and bounded preview batches', async () => {
    render(
      <SpritePickerDialog
        open
        onOpenChange={vi.fn()}
        selectedPlaceableId={undefined}
        onSelect={vi.fn()}
      />,
      { wrapper },
    );

    await waitFor(() => expect(getPackLibrary).toHaveBeenCalledTimes(2));
    expect(getPackLibrary.mock.calls).toEqual(
      expect.arrayContaining([
        [
          expect.objectContaining({
            packId: firstPackId,
            groupKind: 'sprite',
            offset: 0,
            limit: SPRITE_PICKER_PAGE_SIZE_PER_KIND,
          }),
        ],
        [
          expect.objectContaining({
            packId: firstPackId,
            groupKind: 'placeable',
            offset: 0,
            limit: SPRITE_PICKER_PAGE_SIZE_PER_KIND,
          }),
        ],
      ]),
    );
    expect(getPackLibrary.mock.calls.some((call) => call[0]?.packId === String(secondPackId))).toBe(
      false,
    );

    await waitFor(() =>
      expect(document.querySelectorAll('[data-testid^="entity-sprite-picker-item-"]')).toHaveLength(
        SPRITE_PICKER_DOM_LIMIT,
      ),
    );
    await waitFor(() => expect(resolvePreviews).toHaveBeenCalledTimes(2));
    expect(
      resolvePreviews.mock.calls.map(
        (call) => (call[0] as { readonly refs: readonly unknown[] }).refs.length,
      ),
    ).toEqual([64, 32]);
    expect(screen.getByText(/showing 96 of 2000 results/i)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});

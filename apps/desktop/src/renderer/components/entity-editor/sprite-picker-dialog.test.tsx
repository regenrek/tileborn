import { makeAssetId, makePackId, makePlaceableId, makeTileId } from '@tileborne/core';
import {
  Placeable,
  PlaceableFrameRef,
  PlaceableSize,
  TiledPlaceableSource,
  TilesetPack,
  TilesetPackAsset,
  TilesetPackLicense,
  UVRect,
} from '@tileborne/sdk-tileset/schemas';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Option } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SpritePickerDialog } from './sprite-picker-dialog';

const uuid = (suffix: string) => `550e8400-e29b-41d4-a716-${suffix.padStart(12, '0')}`;
const PACK_ID = makePackId(uuid('1'));
const ASSET_ID = makeAssetId(uuid('2'));
const SWORD_PLACEABLE_ID = makePlaceableId(uuid('3'));
const CRATE_PLACEABLE_ID = makePlaceableId(uuid('4'));

const placeableFixture = (id: typeof SWORD_PLACEABLE_ID, name: string, width: number) =>
  new Placeable({
    id,
    name,
    size: new PlaceableSize({ width, height: width * 2 }),
    frames: [
      new PlaceableFrameRef({
        assetId: ASSET_ID,
        tileId: makeTileId(uuid('9')),
        uv: new UVRect({ x: 0, y: 0, w: width, h: width * 2 }),
        durationMs: Option.none(),
      }),
    ],
    tags: [],
    placementMode: 'object',
    source: new TiledPlaceableSource({
      format: 'tiled',
      tilesetName: 'objects',
      localTileId: 0,
      image: Option.some('objects/atlas.png'),
      imageWidth: Option.some(width),
      imageHeight: Option.some(width * 2),
      objectType: Option.none(),
      objectClass: Option.none(),
      properties: {},
    }),
  });

const packFixture = () =>
  new TilesetPack({
    schemaVersion: 1,
    id: PACK_ID,
    name: 'Fantasy Objects',
    version: '1.0.0',
    license: new TilesetPackLicense({
      spdxId: 'CC0-1.0',
      attribution: Option.none(),
      sourceUrl: Option.none(),
      notes: Option.none(),
      redistributable: true,
    }),
    tilesets: [],
    assets: [new TilesetPackAsset({ id: ASSET_ID, path: 'objects/atlas.png', mime: 'image/png' })],
    placeables: [
      placeableFixture(SWORD_PLACEABLE_ID, 'Sword', 24),
      placeableFixture(CRATE_PLACEABLE_ID, 'Loot Crate', 48),
    ],
  });

vi.mock('@/hooks/queries', () => ({
  useAssetPacks: () => ({
    data: { packs: [{ id: PACK_ID, name: 'Fantasy Objects', integrityHash: 'hash-1' }] },
    isLoading: false,
  }),
  useTilesetPacks: (packIds: readonly string[]) =>
    packIds.map(() => ({ data: packFixture(), isLoading: false })),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SpritePickerDialog', () => {
  it('lists placeables from installed packs and reports the selection (id + natural size)', () => {
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <SpritePickerDialog
        open
        onOpenChange={onOpenChange}
        selectedPlaceableId={undefined}
        onSelect={onSelect}
      />,
    );

    expect(screen.getByText('Sword')).toBeDefined();
    expect(screen.getByText('Loot Crate')).toBeDefined();

    fireEvent.click(screen.getByTestId(`entity-sprite-picker-item-${SWORD_PLACEABLE_ID}`));

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        placeableId: String(SWORD_PLACEABLE_ID),
        name: 'Sword',
        packId: String(PACK_ID),
        width: 24,
        height: 48,
      }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('filters by search and highlights the currently assigned sprite', () => {
    render(
      <SpritePickerDialog
        open
        onOpenChange={vi.fn()}
        selectedPlaceableId={String(CRATE_PLACEABLE_ID)}
        onSelect={vi.fn()}
      />,
    );

    expect(
      screen
        .getByTestId(`entity-sprite-picker-item-${CRATE_PLACEABLE_ID}`)
        .getAttribute('data-selected'),
    ).toBe('true');

    fireEvent.change(screen.getByTestId('entity-sprite-picker-search'), {
      target: { value: 'crate' },
    });

    expect(screen.queryByText('Sword')).toBeNull();
    expect(screen.getByText('Loot Crate')).toBeDefined();
  });
});

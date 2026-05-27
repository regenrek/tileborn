import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  makeAssetId,
  makePackId,
  makePlaceableId,
  makeTileId,
  type Uuid,
} from '@tileborne/core';
import {
  AutotileRuleId,
  CellSize,
  Placeable,
  PlaceableFrameRef,
  PlaceableSize,
  TerrainClass,
  TerrainTransition,
  Tile,
  Tileset,
  TilesetId,
  TilesetPack,
  TilesetPackAsset,
  TilesetPackLicense,
  TiledPlaceableSource,
  UVRect,
  Wang2EdgeAutotileRule,
} from '@tileborne/sdk-tileset/schemas';
import { Option, Schema } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useEditorUiStore } from '@/stores/editor-ui-store';

import { TilesetPalette } from './tileset-palette';

const useTilesetPackMock = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/queries', () => ({
  useTilesetPack: useTilesetPackMock,
  useAssetDataUrl: () => ({
    data: {
      dataUrl:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    },
    isLoading: false,
  }),
}));

const uuid = (suffix: string): Uuid =>
  `62656465-0000-4000-8000-${suffix.padStart(12, '0')}` as Uuid;

const terrain = Schema.decodeUnknownSync(TerrainClass)('grass');
const longTerrain = Schema.decodeUnknownSync(TerrainClass)(
  'tiled-source:Animated-Terrains-16-frames-terrain',
);
const emptyTerrain = Schema.decodeUnknownSync(TerrainClass)('tiled-source:empty-preview-terrain');
const tileId = makeTileId(uuid('1'));
const tileId2 = makeTileId(uuid('9'));
const ruleId = Schema.decodeUnknownSync(AutotileRuleId)(`autotile-rule:${uuid('2')}`);
const placeableId = makePlaceableId(uuid('6'));

const pack = new TilesetPack({
  schemaVersion: 1,
  id: makePackId(uuid('3')),
  name: 'Palette Pack',
  version: '1.0.0',
  license: new TilesetPackLicense({
    spdxId: 'CC0-1.0',
    attribution: Option.none(),
    sourceUrl: Option.none(),
    notes: Option.none(),
    redistributable: false,
  }),
  assets: [
    new TilesetPackAsset({
      id: makeAssetId(uuid('4')),
      path: 'tiles/grass.png',
      mime: 'image/png',
    }),
    new TilesetPackAsset({
      id: makeAssetId(uuid('7')),
      path: 'objects/statue.png',
      mime: 'image/png',
    }),
  ],
  tilesets: [
    new Tileset({
      id: Schema.decodeUnknownSync(TilesetId)(`tileset:${uuid('5')}`),
      name: 'Grassland',
      atlasAssetId: makeAssetId(uuid('4')),
      cellSize: new CellSize({ width: 32, height: 32 }),
      margin: 0,
      spacing: 0,
      tiles: [
        new Tile({
          id: tileId,
          uv: new UVRect({ x: 0, y: 0, w: 32, h: 32 }),
          tags: ['ground'],
          terrainClass: Option.some(terrain),
          collisionMask: Option.none(),
          animation: Option.none(),
        }),
        new Tile({
          id: tileId2,
          uv: new UVRect({ x: 32, y: 0, w: 32, h: 32 }),
          tags: ['ground'],
          terrainClass: Option.some(terrain),
          collisionMask: Option.none(),
          animation: Option.none(),
        }),
      ],
      autotileRules: [
        new Wang2EdgeAutotileRule({
          id: ruleId,
          name: 'Grass',
          terrainClasses: [terrain, longTerrain],
          maskToTileIds: { '0': [tileId], '1': [tileId2] },
          fallbackTileId: Option.some(tileId),
        }),
      ],
      variantFilters: [],
      terrainTransitions: [
        new TerrainTransition({
          from: longTerrain,
          to: emptyTerrain,
          ruleId,
        }),
      ],
    }),
  ],
  placeables: [
    new Placeable({
      id: placeableId,
      name: 'Sample Statue',
      size: new PlaceableSize({ width: 96, height: 128 }),
      frames: [
        new PlaceableFrameRef({
          assetId: makeAssetId(uuid('7')),
          tileId: makeTileId(uuid('8')),
          uv: new UVRect({ x: 0, y: 0, w: 96, h: 128 }),
          durationMs: Option.none(),
        }),
      ],
      tags: ['prop', 'tiled:class=statue'],
      placementMode: 'object',
      source: new TiledPlaceableSource({
        format: 'tiled',
        tilesetName: 'Objects',
        localTileId: 0,
        image: Option.some('objects/statue.png'),
        imageWidth: Option.some(96),
        imageHeight: Option.some(128),
        objectType: Option.none(),
        objectClass: Option.some('statue'),
        properties: {},
      }),
    }),
  ],
});

describe('TilesetPalette', () => {
  beforeEach(() => {
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    vi.stubGlobal('localStorage', storage);
    useTilesetPackMock.mockReturnValue({
      data: pack,
      isLoading: false,
      isError: false,
    });
    useEditorUiStore.setState({ activeTool: 'select', brushIntent: { kind: 'eraser' } });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('stages typed brush intents for tile, autotile, and terrain brushes', async () => {
    render(<TilesetPalette packId={pack.id} />);

    fireEvent.click(await screen.findByRole('button', { name: /grass 1/i }));
    expect(useEditorUiStore.getState().brushIntent).toEqual({ kind: 'tile', tileId });
    expect(useEditorUiStore.getState().activeTool).toBe('tileBrush');

    fireEvent.click(screen.getByRole('button', { name: /grass autotile/i }));
    expect(useEditorUiStore.getState().brushIntent).toEqual({ kind: 'autotile', ruleId });

    fireEvent.click(screen.getByRole('button', { name: /grass terrain/i }));
    expect(useEditorUiStore.getState().brushIntent).toEqual({ kind: 'terrain', classId: terrain });
  });

  it('stages placeable object brushes from the Objects section', async () => {
    render(<TilesetPalette packId={pack.id} />);

    fireEvent.click(await screen.findByRole('button', { name: /sample statue/i }));

    expect(useEditorUiStore.getState().brushIntent).toEqual({
      kind: 'placeable',
      placeableId,
    });
    expect(useEditorUiStore.getState().activeTool).toBe('objectPlace');
    expect(screen.getByText(/objects/i)).toBeTruthy();
  });

  it('renders existing tile cards with image previews', async () => {
    render(<TilesetPalette packId={pack.id} />);

    expect(await screen.findAllByTestId('tile-palette-thumb')).toHaveLength(2);
  });

  it('renders autotile entries with representative visual previews', async () => {
    render(<TilesetPalette packId={pack.id} />);

    expect(await screen.findByRole('button', { name: /grass autotile/i })).toBeTruthy();
    expect(screen.getAllByTestId('autotile-palette-thumb')).toHaveLength(2);
  });

  it('renders terrain entries with previews or intentional placeholders', async () => {
    render(<TilesetPalette packId={pack.id} />);

    expect(await screen.findByRole('button', { name: /grass terrain class/i })).toBeTruthy();
    expect(screen.getAllByTestId('terrain-palette-thumb').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /empty preview terrain class/i })).toBeTruthy();
    expect(screen.getByTestId('terrain-palette-placeholder')).toBeTruthy();
  });

  it('uses human-friendly terrain labels instead of long internal ids', async () => {
    render(<TilesetPalette packId={pack.id} />);

    expect(
      await screen.findByRole('button', { name: /animated terrains 16 frames terrain class/i }),
    ).toBeTruthy();
    expect(screen.queryByText(/tiled-source:Animated-Terrains-16-frames-terrain/)).toBeNull();
  });

  it('filters tile and terrain brushes by search query', async () => {
    render(<TilesetPalette packId={pack.id} />);

    expect(await screen.findByRole('button', { name: /grass 1/i })).toBeTruthy();

    const search = screen.getByTestId('tileset-palette-search') as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'zzz-nomatch' } });

    expect(screen.queryByRole('button', { name: /grass 1/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /grass autotile/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /grass terrain/i })).toBeNull();
  });

  it('renders the readout region', async () => {
    render(<TilesetPalette packId={pack.id} />);
    expect(await screen.findByTestId('tileset-palette-readout')).toBeTruthy();
  });
});

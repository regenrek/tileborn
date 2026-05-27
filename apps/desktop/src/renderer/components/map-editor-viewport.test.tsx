// @vitest-environment jsdom

import { cleanup, render, waitFor } from '@testing-library/react';
import {
  makeAssetId,
  makePackId,
  makePlaceableId,
  makeTileId,
  makeWorkingPaletteId,
  makeWorkingPaletteItemId,
  AssetLibraryReference,
  type Uuid,
} from '@tileborne/core';
import {
  AutotileRuleId,
  CellSize,
  Placeable,
  PlaceableFrameRef,
  PlaceableSize,
  TerrainClass,
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
import { Effect, Option, Schema } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTileEditCommand } from '@/editor/editor-commands';
import { createTestMap, TEST_TILE_LAYER_ID } from '@/editor/test-fixtures';
import type { BrushIntent } from '@/stores/editor-ui-store';

const setMapMock = vi.hoisted(() => vi.fn());
const resizeMock = vi.hoisted(() => vi.fn());
const setCameraMock = vi.hoisted(() => vi.fn());
const disposeMock = vi.hoisted(() => vi.fn());
const loadViewportAssetBundleMock = vi.hoisted(() => vi.fn());
const activePaletteMock = vi.hoisted(() => ({ current: undefined as unknown }));
const editorStateMock = vi.hoisted(() => ({
  current: {
    activeTool: 'select',
    camera: { zoom: 1, panX: 0, panY: 0 },
    selection: new Set<string>(),
    brushIntent: { kind: 'eraser' } as BrushIntent,
    stagedObjectKind: 'prop',
    activeLayerId: null,
    showGrid: true,
    showCollisionOverlay: false,
    showDebugOverlay: false,
    showMinimapOverlay: true,
    setCamera: vi.fn(),
    setSelection: vi.fn(),
    clearSelection: vi.fn(),
    setHoverTile: vi.fn(),
    setActiveLayerId: vi.fn(),
    setActiveTool: vi.fn(),
  },
}));

vi.mock('@tileborne/runtime', () => ({
  PixiRendererAdapter: class PixiRendererAdapter {
    mount = vi.fn(() => Effect.succeed({ container: {} }));
    loadAssets = vi.fn(() => Effect.succeed(new Map()));
    dispose = vi.fn(() => Effect.succeed(undefined));
  },
}));

vi.mock('@/editor/viewport/viewport-asset-manifest', () => ({
  loadViewportAssetBundle: loadViewportAssetBundleMock,
}));

vi.mock('@/editor/viewport/editor-viewport-controller', () => ({
  EditorViewportController: class EditorViewportController {
    setMap = setMapMock;
    resize = resizeMock;
    setCamera = setCameraMock;
    setShowGrid = vi.fn();
    setShowCollision = vi.fn();
    setShowDebug = vi.fn();
    setSelection = vi.fn();
    setActiveLayerId = vi.fn();
    setHoverTile = vi.fn();
    setBrushPreview = vi.fn();
    syncMapContent = vi.fn();
    patchFromCommand = vi.fn();
    dispose = disposeMock;
  },
  tileCoordsFromPointer: () => ({ x: 0, y: 0 }),
}));

vi.mock('@/editor/use-editor-commands', () => ({
  useEditorCommands: () => ({
    applyCommand: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
  }),
}));

vi.mock('@/hooks/use-working-palettes', () => ({
  useActiveWorkingPalette: () => activePaletteMock.current,
}));

vi.mock('@/stores/editor-ui-store', () => {
  const useEditorUiStore = (selector: (value: typeof editorStateMock.current) => unknown) =>
    selector(editorStateMock.current);
  return {
    useEditorUiStore: Object.assign(useEditorUiStore, { getState: () => editorStateMock.current }),
  };
});

import { MapEditorViewport, resolveBrushAction } from './map-editor-viewport';

class ResizeObserverStub {
  observe = vi.fn();
  disconnect = vi.fn();
}

const viewportBundle = {
  manifest: { assets: [] },
  packs: [],
  tileIndexByTileId: new Map(),
  tileIdByTileIndex: new Map(),
  collisionMaskByTileIndex: new Map(),
  renderableAssetIdByPath: new Map(),
};

const uuid = (suffix: string): Uuid =>
  `62656465-0000-4000-8000-${suffix.padStart(12, '0')}` as Uuid;

const terrain = Schema.decodeUnknownSync(TerrainClass)('grass');
const tileId = makeTileId(uuid('1'));
const ruleId = Schema.decodeUnknownSync(AutotileRuleId)(`autotile-rule:${uuid('2')}`);
const wallRuleId = Schema.decodeUnknownSync(AutotileRuleId)(`autotile-rule:${uuid('6')}`);

const paintablePack = new TilesetPack({
  schemaVersion: 1,
  id: makePackId(uuid('3')),
  name: 'Paintable Pack',
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
      ],
      autotileRules: [
        new Wang2EdgeAutotileRule({
          id: ruleId,
          name: 'Grass',
          terrainClasses: [terrain],
          maskToTileIds: { '0000': [tileId] },
          fallbackTileId: Option.some(tileId),
        }),
      ],
      variantFilters: [],
      terrainTransitions: [],
    }),
  ],
});

const wallRulePack = new TilesetPack({
  schemaVersion: paintablePack.schemaVersion,
  id: paintablePack.id,
  name: paintablePack.name,
  version: paintablePack.version,
  license: paintablePack.license,
  assets: paintablePack.assets,
  tilesets: [
    new Tileset({
      id: paintablePack.tilesets[0]!.id,
      name: paintablePack.tilesets[0]!.name,
      atlasAssetId: paintablePack.tilesets[0]!.atlasAssetId,
      cellSize: paintablePack.tilesets[0]!.cellSize,
      margin: paintablePack.tilesets[0]!.margin,
      spacing: paintablePack.tilesets[0]!.spacing,
      tiles: paintablePack.tilesets[0]!.tiles,
      autotileRules: [
        new Wang2EdgeAutotileRule({
          id: wallRuleId,
          name: 'wall-6',
          terrainClasses: [terrain],
          maskToTileIds: { '1010': [tileId] },
          fallbackTileId: Option.none(),
        }),
      ],
      variantFilters: paintablePack.tilesets[0]!.variantFilters,
      terrainTransitions: paintablePack.tilesets[0]!.terrainTransitions,
    }),
  ],
});

const placeableAssetId = makeAssetId(uuid('7'));
const placeableTileId = makeTileId(uuid('8'));
const placeableId = makePlaceableId(uuid('9'));
const placeablePack = new TilesetPack({
  schemaVersion: 1,
  id: makePackId(uuid('10')),
  name: 'Props Pack',
  version: '1.0.0',
  license: paintablePack.license,
  assets: [
    new TilesetPackAsset({
      id: placeableAssetId,
      path: 'props/statue.png',
      mime: 'image/png',
    }),
  ],
  tilesets: [],
  placeables: [
    new Placeable({
      id: placeableId,
      name: 'Statue',
      size: new PlaceableSize({ width: 96, height: 128 }),
      frames: [
        new PlaceableFrameRef({
          assetId: placeableAssetId,
          tileId: placeableTileId,
          uv: new UVRect({ x: 0, y: 0, w: 96, h: 128 }),
          durationMs: Option.none(),
        }),
      ],
      tags: [],
      placementMode: 'object',
      source: new TiledPlaceableSource({
        format: 'tiled',
        tilesetName: 'Props',
        localTileId: 0,
        image: Option.some('statue.png'),
        imageWidth: Option.some(96),
        imageHeight: Option.some(128),
        objectType: Option.none(),
        objectClass: Option.none(),
        properties: {},
      }),
    }),
  ],
});

describe('MapEditorViewport initial map sync', () => {
  beforeEach(() => {
    setMapMock.mockReset();
    resizeMock.mockReset();
    setCameraMock.mockReset();
    disposeMock.mockReset();
    loadViewportAssetBundleMock.mockReset();
    activePaletteMock.current = undefined;
    editorStateMock.current.brushIntent = { kind: 'eraser' };
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('uses the latest map prop when async viewport mount settles', async () => {
    let resolveBundle: (() => void) | undefined;
    loadViewportAssetBundleMock.mockReturnValue(
      Effect.promise(
        () =>
          new Promise((resolve) => {
            resolveBundle = () => resolve(viewportBundle);
          }),
      ),
    );
    const initialMap = createTestMap();
    const updatedMap = createTileEditCommand(initialMap, TEST_TILE_LAYER_ID, 2, 3, 4).apply(
      initialMap,
    );

    const { rerender } = render(
      <MapEditorViewport projectId="project-1" mapId="map-1" map={initialMap} />,
    );

    await waitFor(() => {
      expect(loadViewportAssetBundleMock).toHaveBeenCalled();
    });
    rerender(<MapEditorViewport projectId="project-1" mapId="map-1" map={updatedMap} />);

    expect(setMapMock).not.toHaveBeenCalled();
    resolveBundle?.();

    await waitFor(() => {
      expect(setMapMock).toHaveBeenCalledWith(updatedMap);
    });
  });

  it('loads palette placeable packs together with the map paint pack', async () => {
    loadViewportAssetBundleMock.mockReturnValue(Effect.succeed(viewportBundle));
    activePaletteMock.current = {
      id: makeWorkingPaletteId(uuid('20')),
      projectId: 'project-1',
      name: 'Props',
      createdAt: '2026-05-27T00:00:00.000Z',
      updatedAt: '2026-05-27T00:00:00.000Z',
      items: [
        {
          id: makeWorkingPaletteItemId(uuid('21')),
          ref: new AssetLibraryReference({
            packId: placeablePack.id,
            kind: 'placeable',
            refId: placeableId,
            tileId: placeableTileId,
          }),
          label: 'Statue',
        },
      ],
    };
    const map = {
      ...createTestMap(),
      properties: { tilesetPackId: paintablePack.id },
    };

    render(<MapEditorViewport projectId="project-1" mapId="map-1" map={map} />);

    await waitFor(() => {
      expect(loadViewportAssetBundleMock).toHaveBeenCalledWith({
        projectId: 'project-1',
        map,
        extraPackIds: [placeablePack.id],
        renderablePlaceableRefs: [],
      });
    });
  });

  it('loads the selected placeable brush pack even before palette metadata catches up', async () => {
    loadViewportAssetBundleMock.mockReturnValue(Effect.succeed(viewportBundle));
    editorStateMock.current.brushIntent = {
      kind: 'placeable',
      packId: placeablePack.id,
      placeableId,
    };
    const map = {
      ...createTestMap(),
      properties: { tilesetPackId: paintablePack.id },
    };

    render(<MapEditorViewport projectId="project-1" mapId="map-1" map={map} />);

    await waitFor(() => {
      expect(loadViewportAssetBundleMock).toHaveBeenCalledWith({
        projectId: 'project-1',
        map,
        extraPackIds: [placeablePack.id],
        renderablePlaceableRefs: [{ packId: placeablePack.id, placeableId }],
      });
    });
  });
});

describe('resolveBrushAction', () => {
  it('keeps autotile and terrain palette intents semantic for painting', () => {
    const tileIndexByTileId = new Map([[tileId, 9]]);

    expect(
      resolveBrushAction({
        brushIntent: { kind: 'tile', tileId },
        pack: paintablePack,
        tileIndexByTileId,
      }),
    ).toEqual({ kind: 'paintTile', tileIndex: 9 });
    expect(
      resolveBrushAction({
        brushIntent: { kind: 'autotile', ruleId },
        pack: paintablePack,
        tileIndexByTileId,
      }),
    ).toMatchObject({ kind: 'paintAutotile', ruleId, previewTileIndex: 9 });
    expect(
      resolveBrushAction({
        brushIntent: { kind: 'terrain', classId: terrain },
        pack: paintablePack,
        tileIndexByTileId,
      }),
    ).toMatchObject({ kind: 'paintAutotile', ruleId, previewTileIndex: 9 });
  });

  it('does not collapse imported autotiles without zero-mask fallbacks into fixed tile brushes', () => {
    expect(
      resolveBrushAction({
        brushIntent: { kind: 'autotile', ruleId: wallRuleId },
        pack: wallRulePack,
        tileIndexByTileId: new Map([[tileId, 9]]),
      }),
    ).toMatchObject({ kind: 'paintAutotile', ruleId: wallRuleId, previewTileIndex: 9 });
  });

  it('resolves placeable brushes from palette packs outside the map paint pack', () => {
    expect(
      resolveBrushAction({
        brushIntent: { kind: 'placeable', placeableId },
        pack: paintablePack,
        packs: [paintablePack, placeablePack],
        tileIndexByTileId: new Map([[tileId, 9]]),
      }),
    ).toEqual({
      kind: 'placeObject',
      packId: placeablePack.id,
      placeableId,
      width: 96,
      height: 128,
      frame: {
        assetId: placeableAssetId,
        tileId: placeableTileId,
        uv: new UVRect({ x: 0, y: 0, w: 96, h: 128 }),
      },
    });
  });

  it('resolves duplicate placeable ids by pack when the brush intent is scoped', () => {
    const otherAssetId = makeAssetId(uuid('30'));
    const otherTileId = makeTileId(uuid('31'));
    const sourcePlaceable = placeablePack.placeables?.[0];
    expect(sourcePlaceable).toBeDefined();
    const otherPack = new TilesetPack({
      ...placeablePack,
      id: makePackId(uuid('32')),
      name: 'Other Props Pack',
      assets: [new TilesetPackAsset({ id: otherAssetId, path: 'props/other.png', mime: 'image/png' })],
      placeables: [
        new Placeable({
          ...sourcePlaceable!,
          frames: [
            new PlaceableFrameRef({
              assetId: otherAssetId,
              tileId: otherTileId,
              uv: new UVRect({ x: 0, y: 0, w: 32, h: 48 }),
              durationMs: Option.none(),
            }),
          ],
          size: new PlaceableSize({ width: 32, height: 48 }),
        }),
      ],
    });

    expect(
      resolveBrushAction({
        brushIntent: { kind: 'placeable', packId: otherPack.id, placeableId },
        pack: paintablePack,
        packs: [placeablePack, otherPack],
        tileIndexByTileId: new Map([[tileId, 9]]),
      }),
    ).toEqual({
      kind: 'placeObject',
      packId: otherPack.id,
      placeableId,
      width: 32,
      height: 48,
      frame: {
        assetId: otherAssetId,
        tileId: otherTileId,
        uv: new UVRect({ x: 0, y: 0, w: 32, h: 48 }),
      },
    });
  });
});

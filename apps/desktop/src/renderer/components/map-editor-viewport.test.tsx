// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
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
  type TileIdType,
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
const mergeAssetBundleMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const controllerCtorMock = vi.hoisted(() => vi.fn());
const loadViewportAssetBundleMock = vi.hoisted(() => vi.fn());
const activePaletteMock = vi.hoisted(() => ({ current: undefined as unknown }));
const editorStateMock = vi.hoisted(() => ({
  current: {
    activeTool: 'select',
    camera: { zoom: 1, panX: 0, panY: 0 },
    selection: new Set<string>(),
    brushIntent: { kind: 'eraser' } as BrushIntent,
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
    selectTool: vi.fn(),
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
    constructor() {
      controllerCtorMock();
    }
    setMap = setMapMock;
    resize = resizeMock;
    setCamera = setCameraMock;
    setShowGrid = vi.fn();
    setShowCollision = vi.fn();
    setShowDebug = vi.fn();
    setSelection = vi.fn();
    setActiveLayerId = vi.fn();
    setCollisionFootprints = vi.fn();
    setHoverTile = vi.fn();
    setBrushPreview = vi.fn();
    syncMapContent = vi.fn();
    patchFromCommand = vi.fn();
    mergeAssetBundle = mergeAssetBundleMock;
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
import { createAutotilePaintResolver } from '@/editor/viewport/autotile-paint';

class ResizeObserverStub {
  observe = vi.fn();
  disconnect = vi.fn();
}

const viewportBundle = {
  hasPack: false,
  manifest: { assets: [] },
  tileIndexByTileId: new Map(),
  tileFramesByIndex: new Map(),
  collisionMaskByTileIndex: new Map(),
  terrainFirstTileId: new Map(),
  directTileIndexByTerrainClass: new Map(),
  autotileRules: [],
  terrainTransitions: [],
  renderableAssetIdByPath: new Map(),
  placeables: [],
  assetPathByPackAndId: new Map(),
  assetPathById: new Map(),
};

// MapEditorViewport calls `useResolvedCatalog` (TanStack Query), so it needs a
// QueryClient in scope. Mirrors the working-palette-sidebar test setup; the
// `wrapper` option keeps `rerender` calls wrapped in the same provider too.
const makeTestClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const renderViewport = (ui: ReactElement) => {
  const client = makeTestClient();
  return render(ui, {
    wrapper: ({ children }: { readonly children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
};

/**
 * Builds index-derived `resolveBrushAction` inputs from synthetic packs,
 * mirroring how `viewport-asset-manifest` wires the bundle. `tileIndexByTileId`
 * stays caller-controlled so paint-index assertions remain explicit.
 */
const brushContext = (input: {
  readonly packs: readonly TilesetPack[];
  readonly tileIndexByTileId?: ReadonlyMap<TileIdType, number>;
}) => {
  const tileIndexByTileId = input.tileIndexByTileId ?? new Map<TileIdType, number>();
  const autotileRules = input.packs[0]?.tilesets.flatMap((tileset) => tileset.autotileRules) ?? [];
  const placeables = input.packs.flatMap((pack) =>
    (pack.placeables ?? []).map((placeable) => ({ packId: pack.id, placeable })),
  );
  return {
    tileIndexByTileId,
    terrainFirstTileId: new Map(),
    placeables,
    autotileResolver: createAutotilePaintResolver({
      autotileRules,
      tileIndexByTileId,
      directTileIndexByTerrainClass: new Map(),
    }),
  };
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
    mergeAssetBundleMock.mockReset();
    mergeAssetBundleMock.mockResolvedValue(undefined);
    controllerCtorMock.mockReset();
    loadViewportAssetBundleMock.mockReset();
    editorStateMock.current.setHoverTile.mockReset();
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

    const { rerender } = renderViewport(
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

    renderViewport(<MapEditorViewport projectId="project-1" mapId="map-1" map={map} />);

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

    renderViewport(<MapEditorViewport projectId="project-1" mapId="map-1" map={map} />);

    await waitFor(() => {
      expect(loadViewportAssetBundleMock).toHaveBeenCalledWith({
        projectId: 'project-1',
        map,
        extraPackIds: [placeablePack.id],
        renderablePlaceableRefs: [{ packId: placeablePack.id, placeableId }],
      });
    });
  });

  it('keeps minimap pointer movement out of the underlying viewport tool handlers', async () => {
    loadViewportAssetBundleMock.mockReturnValue(Effect.succeed(viewportBundle));

    const { getByLabelText } = renderViewport(
      <MapEditorViewport projectId="project-1" mapId="map-1" map={createTestMap()} />,
    );

    await waitFor(() => {
      expect(loadViewportAssetBundleMock).toHaveBeenCalled();
    });

    fireEvent.pointerMove(getByLabelText('Map minimap'), {
      pointerId: 1,
      clientX: 12,
      clientY: 12,
    });

    expect(editorStateMock.current.setHoverTile).not.toHaveBeenCalled();
  });
});

describe('MapEditorViewport mount lifecycle', () => {
  // Returns a stable bundle object per request signature so the component's
  // "already applied" identity guard behaves exactly as it does in production.
  const makeBundleFor = () => {
    const byKey = new Map<string, typeof viewportBundle>();
    return (request: {
      readonly extraPackIds?: readonly unknown[];
      readonly renderablePlaceableRefs?: readonly {
        readonly packId?: unknown;
        readonly placeableId: unknown;
      }[];
    }) => {
      const key = JSON.stringify({
        extra: (request.extraPackIds ?? []).map(String),
        refs: (request.renderablePlaceableRefs ?? []).map(
          (ref) => `${ref.packId ?? ''}:${String(ref.placeableId)}`,
        ),
      });
      let bundle = byKey.get(key);
      if (bundle === undefined) {
        bundle = { ...viewportBundle };
        byKey.set(key, bundle);
      }
      return bundle;
    };
  };

  beforeEach(() => {
    setMapMock.mockReset();
    resizeMock.mockReset();
    setCameraMock.mockReset();
    disposeMock.mockReset();
    mergeAssetBundleMock.mockReset();
    mergeAssetBundleMock.mockResolvedValue(undefined);
    controllerCtorMock.mockReset();
    loadViewportAssetBundleMock.mockReset();
    activePaletteMock.current = undefined;
    editorStateMock.current.brushIntent = { kind: 'eraser' };
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('does not remount the viewport when the working-palette brush changes', async () => {
    const makeBundleForCall = makeBundleFor();
    loadViewportAssetBundleMock.mockImplementation((request) =>
      Effect.succeed(makeBundleForCall(request)),
    );
    activePaletteMock.current = {
      id: makeWorkingPaletteId(uuid('40')),
      projectId: 'project-1',
      name: 'Props',
      createdAt: '2026-05-27T00:00:00.000Z',
      updatedAt: '2026-05-27T00:00:00.000Z',
      items: [
        {
          id: makeWorkingPaletteItemId(uuid('41')),
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
    const map = { ...createTestMap(), properties: { tilesetPackId: paintablePack.id } };

    const { rerender } = renderViewport(
      <MapEditorViewport projectId="project-1" mapId="map-1" map={map} />,
    );

    await waitFor(() => {
      expect(controllerCtorMock).toHaveBeenCalledTimes(1);
    });
    // The mount applied its own bundle; with no brush change there is nothing
    // new to merge into the live controller yet.
    expect(mergeAssetBundleMock).not.toHaveBeenCalled();

    editorStateMock.current.brushIntent = {
      kind: 'placeable',
      packId: placeablePack.id,
      placeableId,
    };
    rerender(<MapEditorViewport projectId="project-1" mapId="map-1" map={map} />);

    // Selecting a placeable from another pack streams its textures into the
    // EXISTING controller …
    await waitFor(() => {
      expect(mergeAssetBundleMock).toHaveBeenCalledTimes(1);
    });
    // … and must not have remounted the viewport (no second controller).
    expect(controllerCtorMock).toHaveBeenCalledTimes(1);
    expect(disposeMock).not.toHaveBeenCalled();
  });

  it('mounts a fresh viewport when the map id changes', async () => {
    const makeBundleForCall = makeBundleFor();
    loadViewportAssetBundleMock.mockImplementation((request) => Effect.succeed(makeBundleForCall(request)));

    const { rerender } = renderViewport(
      <MapEditorViewport projectId="project-1" mapId="map-1" map={createTestMap()} />,
    );
    await waitFor(() => {
      expect(controllerCtorMock).toHaveBeenCalledTimes(1);
    });

    rerender(<MapEditorViewport projectId="project-1" mapId="map-2" map={createTestMap()} />);

    await waitFor(() => {
      expect(controllerCtorMock).toHaveBeenCalledTimes(2);
    });
  });
});

describe('resolveBrushAction', () => {
  it('keeps autotile and terrain palette intents semantic for painting', () => {
    const tileIndexByTileId = new Map([[tileId, 9]]);
    const context = brushContext({ packs: [paintablePack], tileIndexByTileId });

    expect(
      resolveBrushAction({
        brushIntent: { kind: 'tile', tileId },
        ...context,
      }),
    ).toEqual({ kind: 'paintTile', tileIndex: 9 });
    expect(
      resolveBrushAction({
        brushIntent: { kind: 'autotile', ruleId },
        ...context,
      }),
    ).toMatchObject({ kind: 'paintAutotile', ruleId, previewTileIndex: 9 });
    expect(
      resolveBrushAction({
        brushIntent: { kind: 'terrain', classId: terrain },
        ...context,
      }),
    ).toMatchObject({ kind: 'paintAutotile', ruleId, previewTileIndex: 9 });
  });

  it('does not collapse imported autotiles without zero-mask fallbacks into fixed tile brushes', () => {
    expect(
      resolveBrushAction({
        brushIntent: { kind: 'autotile', ruleId: wallRuleId },
        ...brushContext({ packs: [wallRulePack], tileIndexByTileId: new Map([[tileId, 9]]) }),
      }),
    ).toMatchObject({ kind: 'paintAutotile', ruleId: wallRuleId, previewTileIndex: 9 });
  });

  it('resolves placeable brushes from palette packs outside the map paint pack', () => {
    expect(
      resolveBrushAction({
        brushIntent: { kind: 'placeable', placeableId },
        ...brushContext({
          packs: [paintablePack, placeablePack],
          tileIndexByTileId: new Map([[tileId, 9]]),
        }),
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
        ...brushContext({
          packs: [placeablePack, otherPack],
          tileIndexByTileId: new Map([[tileId, 9]]),
        }),
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

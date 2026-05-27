import { afterEach, describe, expect, it, vi } from 'vitest';
import { Effect, Option } from 'effect';
import { Container, Sprite, Texture } from 'pixi.js';
import type { PixiRendererAdapter } from '@tileborne/runtime';
import {
  MapObject,
  MapObjectPlacement,
  ObjectLayer,
  TileborneMap,
  makeAssetId,
  makeLayerId,
  makeMapId,
  makeObjectId,
  makePackId,
  makePlaceableId,
  makeTileId,
  type Uuid,
} from '@tileborne/core';
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

import {
  EDITOR_GRID_OUTLINE_COLOR,
  EDITOR_GRID_STROKE_COLOR,
  EditorViewportController,
  MISSING_TILE_TEXTURE_DIAGNOSTIC_COLOR,
  missingTileTextureDiagnosticColor,
} from './editor-viewport-controller.js';
import { EditorLayerZIndex } from './layers.js';
import { createTileEditCommand } from '../editor-commands.js';
import { setTileIndex } from '../map-utils.js';
import { createTestMap, TEST_TILE_LAYER_ID } from '../test-fixtures.js';

describe('EditorViewportController texture diagnostics', () => {
  it('keeps the editor grid visible without using the missing-texture pink', () => {
    expect(EDITOR_GRID_OUTLINE_COLOR).toBe(0x020617);
    expect(EDITOR_GRID_STROKE_COLOR).toBe(0xf8fafc);
    expect(EDITOR_GRID_OUTLINE_COLOR).not.toBe(MISSING_TILE_TEXTURE_DIAGNOSTIC_COLOR);
    expect(EDITOR_GRID_STROKE_COLOR).not.toBe(MISSING_TILE_TEXTURE_DIAGNOSTIC_COLOR);
  });

  it('uses an explicit missing-texture diagnostic instead of index-colour fallback', () => {
    expect(missingTileTextureDiagnosticColor(1)).toBe(MISSING_TILE_TEXTURE_DIAGNOSTIC_COLOR);
    expect(missingTileTextureDiagnosticColor(2)).toBe(MISSING_TILE_TEXTURE_DIAGNOSTIC_COLOR);
  });

  it('renders the grid as an overlay above tile chunks', () => {
    expect(EditorLayerZIndex.gridOverlay).toBeGreaterThan(EditorLayerZIndex.tileChunks);
    expect(EditorLayerZIndex.gridOverlay).toBeLessThan(EditorLayerZIndex.collisionOverlay);
  });
});

describe('EditorViewportController render batching', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('coalesces render requests into one animation frame', async () => {
    const callbacks: FrameRequestCallback[] = [];
    const requestRender = vi.fn(() => Effect.void);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const adapter = {
      getEditorWorldRoot: () => new Container(),
      requestRender,
    } as unknown as PixiRendererAdapter;
    const controller = new EditorViewportController(adapter);

    controller.requestRender();
    controller.requestRender();

    expect(callbacks).toHaveLength(1);
    expect(requestRender).not.toHaveBeenCalled();

    callbacks[0]?.(performance.now());
    await Promise.resolve();

    expect(requestRender).toHaveBeenCalledTimes(1);
  });

  it('requests a render after resizing clears the Pixi framebuffer', async () => {
    const callbacks: FrameRequestCallback[] = [];
    const events: string[] = [];
    const requestRender = vi.fn(() =>
      Effect.sync(() => {
        events.push('render');
      }),
    );
    const resize = vi.fn(() =>
      Effect.sync(() => {
        events.push('resize');
      }),
    );
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const adapter = {
      getEditorWorldRoot: () => new Container(),
      requestRender,
      resize,
    } as unknown as PixiRendererAdapter;
    const controller = new EditorViewportController(adapter);

    controller.resize(700, 792);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(resize).toHaveBeenCalledWith(700, 792);
    expect(callbacks).toHaveLength(1);
    expect(requestRender).not.toHaveBeenCalled();

    callbacks[0]?.(performance.now());
    await Promise.resolve();

    expect(events).toEqual(['resize', 'render']);
    expect(requestRender).toHaveBeenCalledTimes(1);
  });

  it('patches a newly created tile chunk after map content is synced', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const worldRoot = new Container();
    const adapter = {
      getEditorWorldRoot: () => worldRoot,
      requestRender: vi.fn(() => Effect.void),
    } as unknown as PixiRendererAdapter;
    const controller = new EditorViewportController(adapter);
    const map = createTestMap();
    const command = createTileEditCommand(map, TEST_TILE_LAYER_ID, 2, 3, 4);
    const edited = command.apply(map);

    controller.setMap(map);
    controller.syncMapContent(edited);
    controller.patchFromCommand(command.preview);

    const tileLayerRoot = worldRoot.children.find((child) => child.label === 'tiles') as
      | Container
      | undefined;
    const patchedChunk = tileLayerRoot?.children.find(
      (child) => child.label === `${TEST_TILE_LAYER_ID}:0:0`,
    );

    expect(patchedChunk).toBeDefined();
    expect((patchedChunk as Container | undefined)?.children.length).toBeGreaterThan(0);
  });

  it('patches repeated paint without clearing unrelated existing chunks', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const worldRoot = new Container();
    const adapter = {
      getEditorWorldRoot: () => worldRoot,
      requestRender: vi.fn(() => Effect.void),
    } as unknown as PixiRendererAdapter;
    const controller = new EditorViewportController(adapter);
    const map = setTileIndex(
      setTileIndex(createTestMap(), TEST_TILE_LAYER_ID, 2, 3, 4),
      TEST_TILE_LAYER_ID,
      33,
      3,
      5,
    );
    const command = createTileEditCommand(map, TEST_TILE_LAYER_ID, 2, 4, 6);
    const edited = command.apply(map);

    controller.setMap(map);
    controller.syncMapContent(edited);
    controller.patchFromCommand(command.preview);

    const tileLayerRoot = worldRoot.children.find((child) => child.label === 'tiles') as
      | Container
      | undefined;
    const patchedChunk = tileLayerRoot?.children.find(
      (child) => child.label === `${TEST_TILE_LAYER_ID}:0:0`,
    );
    const unrelatedChunk = tileLayerRoot?.children.find(
      (child) => child.label === `${TEST_TILE_LAYER_ID}:32:0`,
    );

    expect(patchedChunk).toBeDefined();
    expect(unrelatedChunk).toBeDefined();
    expect((patchedChunk as Container | undefined)?.children.length).toBeGreaterThan(0);
    expect((unrelatedChunk as Container | undefined)?.children.length).toBeGreaterThan(0);
  });

  it('renders placement objects as sprites', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const uuid = (suffix: string): Uuid =>
      `62656465-0000-4000-8000-${suffix.padStart(12, '0')}` as Uuid;
    const assetId = makeAssetId(uuid('21'));
    const tileId = makeTileId(uuid('22'));
    const placeableId = makePlaceableId(uuid('23'));
    const layerId = makeLayerId(uuid('24'));
    const objectId = makeObjectId(uuid('25'));
    const pack = new TilesetPack({
      schemaVersion: 1,
      id: makePackId(uuid('26')),
      name: 'Objects',
      version: '1.0.0',
      license: new TilesetPackLicense({
        spdxId: 'CC0-1.0',
        attribution: Option.none(),
        sourceUrl: Option.none(),
        notes: Option.none(),
        redistributable: true,
      }),
      tilesets: [],
      assets: [new TilesetPackAsset({ id: assetId, path: 'objects/statue.png', mime: 'image/png' })],
      placeables: [
        new Placeable({
          id: placeableId,
          name: 'Statue',
          size: new PlaceableSize({ width: 96, height: 128 }),
          frames: [
            new PlaceableFrameRef({
              assetId,
              tileId,
              uv: new UVRect({ x: 0, y: 0, w: 96, h: 128 }),
              durationMs: Option.none(),
            }),
          ],
          tags: ['prop'],
          placementMode: 'object',
          source: new TiledPlaceableSource({
            format: 'tiled',
            tilesetName: 'objects',
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
    const map = new TileborneMap({
      id: makeMapId(uuid('27')),
      schemaVersion: 1,
      size: { width: 4, height: 4 },
      tileSize: { width: 32, height: 32 },
      layers: [
        new ObjectLayer({
          id: layerId,
          name: 'objects',
          visible: true,
          opacity: 1,
          objectIds: [objectId],
        }),
      ],
      objects: [
        new MapObject({
          id: objectId,
          kind: 'placeable',
          x: 32,
          y: 64,
          width: Option.some(96),
          height: Option.some(128),
          layerId,
          properties: {},
          placement: new MapObjectPlacement({
            placeableId,
            source: 'manual',
            assetId: Option.some(assetId),
            tileId: Option.some(tileId),
            gid: Option.none(),
          }),
        }),
      ],
      properties: {},
    });
    const worldRoot = new Container();
    const adapter = {
      getEditorWorldRoot: () => worldRoot,
      requestRender: vi.fn(() => Effect.void),
      textureForRenderableAssetId: vi.fn(() => Texture.WHITE),
    } as unknown as PixiRendererAdapter;
    const controller = new EditorViewportController(adapter, {
      pack,
      renderableAssetIdByPath: new Map([['objects/statue.png', 1]]),
    });

    controller.setMap(map);

    const objectLayerRoot = worldRoot.children.find((child) => child.label === 'objects') as
      | Container
      | undefined;
    const renderedObject = objectLayerRoot?.children[0] as Container | undefined;
    expect(renderedObject?.children[0]).toBeInstanceOf(Sprite);
    expect((renderedObject?.children[0] as Sprite | undefined)?.width).toBe(96);
  });
});

import { useCallback, useEffect, useRef } from 'react';
import type { TileborneMap } from '@tileborne/core';
import { PixiRendererAdapter } from '@tileborne/runtime';
import { Effect, Option } from 'effect';

import { MapEditorMinimap } from '@/components/map-editor-minimap';
import { isEditableTarget } from '@/editor/is-editable-target';
import { useEditorCommands } from '@/editor/use-editor-commands';
import { zoomCameraByWheel, wheelDeltaPixels } from '@/editor/viewport/viewport-navigation';
import {
  dispatchPointerDown,
  dispatchPointerMove,
  dispatchPointerUp,
  type ResolvedBrush,
  type ToolDispatchResult,
  type ToolSession,
} from '@/editor/viewport/tool-state';
import {
  EditorViewportController,
  tileCoordsFromPointer,
} from '@/editor/viewport/editor-viewport-controller';
import {
  chainViewportDispose,
  startSerializedViewportMount,
} from '@/editor/viewport/viewport-mount-lifecycle';
import { pixiTextureFromBytes } from '@/editor/viewport/pixi-texture-from-bytes';
import { loadViewportAssetBundle } from '@/editor/viewport/viewport-asset-manifest';
import {
  createAutotilePaintResolver,
  type AutotilePaintResolver,
} from '@/editor/viewport/autotile-paint';
import { useEditorUiStore, type BrushIntent, type EditorTool } from '@/stores/editor-ui-store';
import type { TileIdType, TilesetPack } from '@tileborne/sdk-tileset/schemas';

export interface MapEditorViewportProps {
  readonly projectId: string;
  readonly mapId: string;
  readonly map: TileborneMap;
}

export interface BrushActionContext {
  readonly brushIntent: BrushIntent;
  readonly pack?: TilesetPack | undefined;
  readonly tileIndexByTileId: ReadonlyMap<TileIdType, number>;
  readonly autotileResolver?: AutotilePaintResolver | undefined;
}

export const resolveBrushAction = ({
  brushIntent,
  pack,
  tileIndexByTileId,
  autotileResolver,
}: BrushActionContext): ResolvedBrush | undefined => {
  const resolver = autotileResolver ?? createAutotilePaintResolver(pack, tileIndexByTileId);
  switch (brushIntent.kind) {
    case 'tile':
      return tileIndexByTileId.has(brushIntent.tileId)
        ? { kind: 'paintTile', tileIndex: tileIndexByTileId.get(brushIntent.tileId)! }
        : undefined;
    case 'autotile':
      return resolver?.brushForRuleId(brushIntent.ruleId);
    case 'terrain': {
      const autotileBrush = resolver?.brushForTerrainClass(brushIntent.classId);
      if (autotileBrush !== undefined) {
        return autotileBrush;
      }
      const tile = pack?.tilesets
        .flatMap((tileset) => tileset.tiles)
        .find((candidate) => Option.getOrUndefined(candidate.terrainClass) === brushIntent.classId);
      const tileIndex = tile === undefined ? undefined : tileIndexByTileId.get(tile.id);
      return tileIndex === undefined ? undefined : { kind: 'paintTile', tileIndex };
    }
    case 'placeable': {
      const placeable = pack?.placeables?.find(
        (candidate) => candidate.id === brushIntent.placeableId,
      );
      const frame = placeable?.frames[0];
      if (placeable === undefined || frame === undefined) {
        return undefined;
      }
      return {
        kind: 'placeObject',
        placeableId: placeable.id,
        width: placeable.size.width,
        height: placeable.size.height,
        frame: {
          assetId: frame.assetId,
          tileId: frame.tileId,
          uv: frame.uv,
        },
      };
    }
    case 'eraser':
      return undefined;
  }
};

export function MapEditorViewport({ projectId, mapId, map }: MapEditorViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<EditorViewportController | null>(null);
  const sessionRef = useRef<ToolSession>({});
  const activePointerIdRef = useRef<number | null>(null);
  const strokeToolRef = useRef<EditorTool | null>(null);
  const currentMapRef = useRef(map);
  const lastHoverTileRef = useRef<{ x: number; y: number } | null>(null);
  const spaceDownRef = useRef(false);
  const panOriginRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const tileIndexByTileIdRef = useRef<ReadonlyMap<TileIdType, number>>(new Map());
  const viewportPackRef = useRef<TilesetPack | undefined>(undefined);
  const autotileResolverRef = useRef<AutotilePaintResolver | undefined>(undefined);
  const localEditPendingRef = useRef(false);

  const activeTool = useEditorUiStore((state) => state.activeTool);
  const camera = useEditorUiStore((state) => state.camera);
  const selection = useEditorUiStore((state) => state.selection);
  const brushIntent = useEditorUiStore((state) => state.brushIntent);
  const stagedObjectKind = useEditorUiStore((state) => state.stagedObjectKind);
  const activeLayerId = useEditorUiStore((state) => state.activeLayerId);
  const showGrid = useEditorUiStore((state) => state.showGrid);
  const showCollisionOverlay = useEditorUiStore((state) => state.showCollisionOverlay);
  const showDebugOverlay = useEditorUiStore((state) => state.showDebugOverlay);
  const showMinimapOverlay = useEditorUiStore((state) => state.showMinimapOverlay);
  const setCamera = useEditorUiStore((state) => state.setCamera);
  const setSelection = useEditorUiStore((state) => state.setSelection);
  const clearSelection = useEditorUiStore((state) => state.clearSelection);
  const setHoverTile = useEditorUiStore((state) => state.setHoverTile);

  const { applyCommand, undo, redo } = useEditorCommands({
    projectId,
    mapId,
    map,
    onMapPatched: (nextMap, command) => {
      localEditPendingRef.current = true;
      currentMapRef.current = nextMap;
      const controller = controllerRef.current;
      if (!controller) {
        return;
      }
      controller.syncMapContent(nextMap);
      if (command.preview) {
        controller.patchFromCommand(command.preview);
      } else {
        controller.patchFromCommand(undefined);
      }
    },
    onPersistSettled: (settledMap, status) => {
      localEditPendingRef.current = false;
      currentMapRef.current = settledMap;
      if (status === 'rolled-back') {
        controllerRef.current?.setMap(settledMap);
      } else {
        controllerRef.current?.syncMapContent(settledMap);
      }
    },
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const adapter = new PixiRendererAdapter({
      applicationOptions: { autoStart: false, backgroundAlpha: 0 },
      // The default factory loads textures via `Assets.load(blobUrl)`, but
      // Pixi v8 cannot autodetect the parser for blob URLs (they have no file
      // extension) and emits "[Assets] blob:… could not be loaded as we don't
      // know how to parse it". We decode bytes directly through an
      // HTMLImageElement instead so atlas textures actually reach the
      // editor viewport instead of falling through to `tileColor(index)`.
      // See .refs/v0.1.x-paint-bug/diag/diag.md.
      textureFactory: pixiTextureFromBytes,
    });

    const handle = startSerializedViewportMount<EditorViewportController>({
      performMount: async () => {
        const bundle = await Effect.runPromise(
          adapter.mount(container).pipe(
            Effect.flatMap(() => loadViewportAssetBundle({ projectId, map })),
            Effect.flatMap((bundle) => adapter.loadAssets(bundle.manifest).pipe(Effect.as(bundle))),
          ),
        );
        viewportPackRef.current = bundle.pack;
        tileIndexByTileIdRef.current = bundle.tileIndexByTileId;
        autotileResolverRef.current = createAutotilePaintResolver(
          bundle.pack,
          bundle.tileIndexByTileId,
        );
        return new EditorViewportController(adapter, {
          pack: bundle.pack,
          frameIndex: bundle.frameIndex,
          tileIdByTileIndex: bundle.tileIdByTileIndex,
          collisionMaskByTileIndex: bundle.collisionMaskByTileIndex,
          renderableAssetIdByPath: bundle.renderableAssetIdByPath,
        });
      },
      disposePendingMount: () => Effect.runPromise(adapter.dispose()),
      onMounted: (controller) => {
        controllerRef.current = controller;
        controller.setMap(currentMapRef.current);
        controller.resize(container.clientWidth, container.clientHeight);
        controller.setCamera(camera.zoom, camera.panX, camera.panY);
      },
    });
    handle.settled.catch(console.error);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      controllerRef.current?.resize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(container);

    return () => {
      handle.cancel();
      observer.disconnect();
      const active = controllerRef.current;
      controllerRef.current = null;
      chainViewportDispose(async () => {
        // Wait for the mount step to fully settle (mount completed or its
        // cancellation-dispose ran) before tearing down anything that depended
        // on it. This is what guarantees the next mount cannot overlap a live
        // adapter from this one.
        await handle.settled;
        if (active) {
          await active.dispose();
        } else {
          // Mount was cancelled before publishing; adapter was already disposed
          // inside `disposePendingMount`. No additional teardown required.
        }
      });
    };
  }, [mapId, projectId]);

  const loadedMapIdRef = useRef(mapId);
  useEffect(() => {
    const mapChanged = currentMapRef.current !== map;
    if (loadedMapIdRef.current !== mapId) {
      loadedMapIdRef.current = mapId;
      localEditPendingRef.current = false;
      currentMapRef.current = map;
      controllerRef.current?.setMap(map);
      return;
    }
    if (mapChanged && localEditPendingRef.current) {
      return;
    }
    if (mapChanged) {
      currentMapRef.current = map;
      controllerRef.current?.setMap(map);
    }
  }, [map, mapId]);

  useEffect(() => {
    controllerRef.current?.setCamera(camera.zoom, camera.panX, camera.panY);
  }, [camera.panX, camera.panY, camera.zoom]);

  useEffect(() => {
    controllerRef.current?.setShowGrid(showGrid);
  }, [showGrid]);

  useEffect(() => {
    controllerRef.current?.setShowCollision(showCollisionOverlay);
  }, [showCollisionOverlay]);

  useEffect(() => {
    controllerRef.current?.setShowDebug(showDebugOverlay);
  }, [showDebugOverlay]);

  useEffect(() => {
    controllerRef.current?.setSelection(selection);
  }, [selection]);

  useEffect(() => {
    const onUndo = () => {
      undo();
    };
    const onRedo = () => {
      redo();
    };
    window.addEventListener('tileborne:editor-undo', onUndo);
    window.addEventListener('tileborne:editor-redo', onRedo);
    return () => {
      window.removeEventListener('tileborne:editor-undo', onUndo);
      window.removeEventListener('tileborne:editor-redo', onRedo);
    };
  }, [redo, undo]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
        return;
      }
      if (
        (event.metaKey || event.ctrlKey) &&
        (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey))
      ) {
        event.preventDefault();
        redo();
        return;
      }
      if (event.code === 'Space') {
        event.preventDefault();
        spaceDownRef.current = true;
      }
      if (event.key === 'Escape') {
        clearSelection();
      }
      const toolEntry = Object.entries({
        v: 'select',
        h: 'pan',
        b: 'tileBrush',
        r: 'rectangleFill',
        e: 'eraser',
        o: 'objectPlace',
        m: 'objectMove',
        c: 'collisionPaint',
        t: 'regionMark',
      } as const).find(([key]) => event.key.toLowerCase() === key);
      if (toolEntry && !event.metaKey && !event.ctrlKey && !event.altKey) {
        useEditorUiStore.getState().setActiveTool(toolEntry[1]);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        spaceDownRef.current = false;
        panOriginRef.current = null;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [clearSelection, redo, undo]);

  const pointerContext = useCallback(
    () => ({
      map: currentMapRef.current,
      activeTool,
      brushIntent,
      resolvedBrush: resolveBrushAction({
        brushIntent,
        pack: viewportPackRef.current,
        tileIndexByTileId: tileIndexByTileIdRef.current,
        autotileResolver: autotileResolverRef.current,
      }),
      autotileResolver: autotileResolverRef.current,
      stagedObjectKind,
      activeLayerId: activeLayerId ?? undefined,
      selection,
      shiftKey: false,
    }),
    [activeLayerId, activeTool, brushIntent, selection, stagedObjectKind],
  );

  const toPoint = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const bounds = event.currentTarget.getBoundingClientRect();
      const currentMap = currentMapRef.current;
      const tile = tileCoordsFromPointer(
        currentMap,
        camera.zoom,
        camera.panX,
        camera.panY,
        event.clientX,
        event.clientY,
        bounds,
      );
      return {
        tileX: tile.x,
        tileY: tile.y,
        clientX: event.clientX,
        clientY: event.clientY,
      };
    },
    [camera.panX, camera.panY, camera.zoom],
  );

  const applyToolCommand = useCallback(
    (result: ToolDispatchResult) => {
      if (!result.command) {
        return;
      }
      applyCommand(result.command, {
        ...(result.historyMode === undefined ? {} : { history: result.historyMode }),
        ...(result.historyCommand === undefined ? {} : { historyCommand: result.historyCommand }),
      });
    },
    [applyCommand],
  );

  const updateHoverTile = useCallback(
    (tile: { x: number; y: number } | null) => {
      const previous = lastHoverTileRef.current;
      if (
        previous?.x === tile?.x &&
        previous?.y === tile?.y &&
        (previous !== null) === (tile !== null)
      ) {
        return;
      }
      lastHoverTileRef.current = tile;
      setHoverTile(tile);
      controllerRef.current?.setHoverTile(tile);
    },
    [setHoverTile],
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const effectiveTool =
      event.button === 1 || spaceDownRef.current
        ? 'pan'
        : event.button === 2
          ? 'eraser'
          : activeTool;
    activePointerIdRef.current = event.pointerId;
    strokeToolRef.current = effectiveTool;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (effectiveTool === 'pan') {
      panOriginRef.current = {
        x: event.clientX,
        y: event.clientY,
        panX: camera.panX,
        panY: camera.panY,
      };
      return;
    }
    const point = toPoint(event);
    const { session, result } = dispatchPointerDown(
      { ...pointerContext(), activeTool: effectiveTool, shiftKey: event.shiftKey },
      point,
      sessionRef.current,
    );
    sessionRef.current = session;
    if (result.selection) {
      setSelection(result.selection);
    }
    applyToolCommand(result);
    if (result.brushPreview !== undefined) {
      controllerRef.current?.setBrushPreview(result.brushPreview);
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current !== null && activePointerIdRef.current !== event.pointerId) {
      return;
    }
    const point = toPoint(event);
    updateHoverTile({ x: point.tileX, y: point.tileY });
    if (panOriginRef.current) {
      setCamera({
        panX: panOriginRef.current.panX + (event.clientX - panOriginRef.current.x),
        panY: panOriginRef.current.panY + (event.clientY - panOriginRef.current.y),
      });
      return;
    }
    const strokeTool = strokeToolRef.current;
    const { session, result } = dispatchPointerMove(
      { ...pointerContext(), activeTool: strokeTool ?? activeTool, shiftKey: event.shiftKey },
      point,
      sessionRef.current,
    );
    sessionRef.current = session;
    if (result.panDelta) {
      setCamera({
        panX: camera.panX + result.panDelta.dx,
        panY: camera.panY + result.panDelta.dy,
      });
    }
    applyToolCommand(result);
    if (result.brushPreview !== undefined) {
      controllerRef.current?.setBrushPreview(result.brushPreview);
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (activePointerIdRef.current !== null && activePointerIdRef.current !== event.pointerId) {
      return;
    }
    panOriginRef.current = null;
    const point = toPoint(event);
    const strokeTool = strokeToolRef.current;
    const { session, result } = dispatchPointerUp(
      { ...pointerContext(), activeTool: strokeTool ?? activeTool },
      point,
      sessionRef.current,
    );
    sessionRef.current = session;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    activePointerIdRef.current = null;
    strokeToolRef.current = null;
    if (result.selection) {
      setSelection(result.selection);
    }
    applyToolCommand(result);
    controllerRef.current?.setBrushPreview(result.brushPreview ?? null);
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    activePointerIdRef.current = null;
    strokeToolRef.current = null;
    panOriginRef.current = null;
    sessionRef.current = {};
    controllerRef.current?.setBrushPreview(null);
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.ctrlKey || event.metaKey) {
      const nextCamera = zoomCameraByWheel(
        camera,
        bounds,
        event.clientX,
        event.clientY,
        wheelDeltaPixels(event.deltaY, event.deltaMode),
      );
      setCamera(nextCamera);
      return;
    }

    setCamera({
      panX: camera.panX - wheelDeltaPixels(event.deltaX, event.deltaMode),
      panY: camera.panY - wheelDeltaPixels(event.deltaY, event.deltaMode),
    });
  };

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full touch-none overflow-hidden bg-background"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onWheel={handleWheel}
      onPointerLeave={() => {
        if (activePointerIdRef.current !== null) {
          return;
        }
        updateHoverTile(null);
        controllerRef.current?.setBrushPreview(null);
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {showMinimapOverlay ? (
        <MapEditorMinimap
          map={map}
          camera={camera}
          viewportRef={containerRef}
          onCameraChange={setCamera}
        />
      ) : null}
    </div>
  );
}

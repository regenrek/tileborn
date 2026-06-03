import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CollisionFootprintComponent, PackId, TileborneMap } from '@tileborne/core';
import { PixiRendererAdapter } from '@tileborne/runtime';
import { Effect } from 'effect';
import type {
  ViewportAssetBundle,
  ViewportPlaceableEntry,
} from '@/editor/viewport/viewport-asset-manifest';

import { MapEditorMinimap } from '@/components/map-editor-minimap';
import { isEditableTarget } from '@/editor/is-editable-target';
import { resolveToolActiveLayerId } from '@/editor/layer-selection';
import { useEditorCommands } from '@/editor/use-editor-commands';
import { zoomCameraByWheel, wheelDeltaPixels } from '@/editor/viewport/viewport-navigation';
import {
  createFillSelectionCommand,
  dispatchPointerDown,
  dispatchPointerMove,
  dispatchPointerUp,
  resolveLayerId,
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
import { assertNever } from '@/lib/assert-never';
import { useActiveWorkingPalette } from '@/hooks/use-working-palettes';
import { useResolvedCatalog } from '@/hooks/queries';
import { findCollisionFootprint } from '@/lib/catalog-collision-footprint';
import {
  createAutotilePaintResolver,
  type AutotilePaintResolver,
} from '@/editor/viewport/autotile-paint';
import { useEditorUiStore, type BrushIntent, type EditorTool } from '@/stores/editor-ui-store';
import type { TerrainClassType, TileIdType } from '@tileborne/sdk-tileset/schemas';

type ViewportPointerEvent = PointerEvent | React.PointerEvent<HTMLDivElement>;
type ViewportWheelEvent = WheelEvent | React.WheelEvent<HTMLDivElement>;

const isViewportOverlayEvent = (event: Event): boolean =>
  event.target instanceof Element && event.target.closest('[data-viewport-overlay]') !== null;

const trySetPointerCapture = (target: HTMLDivElement, pointerId: number): void => {
  try {
    target.setPointerCapture(pointerId);
  } catch {
    // Synthetic/CDP-dispatched pointer events may not have an active browser
    // pointer. Placement should still run; capture only improves drag continuity.
  }
};

const tryReleasePointerCapture = (target: HTMLDivElement, pointerId: number): void => {
  try {
    if (target.hasPointerCapture(pointerId)) {
      target.releasePointerCapture(pointerId);
    }
  } catch {
    // See trySetPointerCapture.
  }
};

export interface MapEditorViewportProps {
  readonly projectId: string;
  readonly mapId: string;
  readonly map: TileborneMap;
}

export interface BrushActionContext {
  readonly brushIntent: BrushIntent;
  readonly tileIndexByTileId: ReadonlyMap<TileIdType, number>;
  /** First-tile-per-terrain-class representative (terrain brush fallback). */
  readonly terrainFirstTileId: ReadonlyMap<TerrainClassType, TileIdType>;
  readonly placeables: readonly ViewportPlaceableEntry[];
  readonly autotileResolver?: AutotilePaintResolver | undefined;
}

export const resolveBrushAction = ({
  brushIntent,
  tileIndexByTileId,
  terrainFirstTileId,
  placeables,
  autotileResolver,
}: BrushActionContext): ResolvedBrush | undefined => {
  switch (brushIntent.kind) {
    case 'tile':
      return tileIndexByTileId.has(brushIntent.tileId)
        ? { kind: 'paintTile', tileIndex: tileIndexByTileId.get(brushIntent.tileId)! }
        : undefined;
    case 'autotile':
      return autotileResolver?.brushForRuleId(brushIntent.ruleId);
    case 'terrain': {
      const autotileBrush = autotileResolver?.brushForTerrainClass(brushIntent.classId);
      if (autotileBrush !== undefined) {
        return autotileBrush;
      }
      const tileId = terrainFirstTileId.get(brushIntent.classId);
      const tileIndex = tileId === undefined ? undefined : tileIndexByTileId.get(tileId);
      return tileIndex === undefined ? undefined : { kind: 'paintTile', tileIndex };
    }
    case 'placeable': {
      const placeableEntry = placeables
        .filter((entry) => brushIntent.packId === undefined || entry.packId === brushIntent.packId)
        .find((entry) => entry.placeable.id === brushIntent.placeableId);
      const frame = placeableEntry?.placeable.frames[0];
      if (placeableEntry === undefined || frame === undefined) {
        return undefined;
      }
      return {
        kind: 'placeObject',
        packId: placeableEntry.packId,
        placeableId: placeableEntry.placeable.id,
        width: placeableEntry.placeable.size.width,
        height: placeableEntry.placeable.size.height,
        frame: {
          assetId: frame.assetId,
          tileId: frame.tileId,
          uv: frame.uv,
        },
      };
    }
    case 'plugin-object':
      // Plugin-object marker brushes are placed by tool identity (objectPlace),
      // not resolved into a paint/placeObject brush.
      return undefined;
    case 'eraser':
      return undefined;
  }
  return assertNever(brushIntent);
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
  const terrainFirstTileIdRef = useRef<ReadonlyMap<TerrainClassType, TileIdType>>(new Map());
  const placeablesRef = useRef<readonly ViewportPlaceableEntry[]>([]);
  const autotileResolverRef = useRef<AutotilePaintResolver | undefined>(undefined);
  const localEditPendingRef = useRef(false);
  // Tracks the asset bundle currently applied to the live controller so the
  // incremental asset-load effect can skip work the mount already performed.
  const appliedBundleRef = useRef<ViewportAssetBundle | null>(null);
  // Bumped once the controller goes live so the incremental asset-load effect
  // re-runs against the freshly mounted controller with the latest brush refs.
  const [mountVersion, setMountVersion] = useState(0);

  const activeTool = useEditorUiStore((state) => state.activeTool);
  const camera = useEditorUiStore((state) => state.camera);
  const selection = useEditorUiStore((state) => state.selection);
  const brushIntent = useEditorUiStore((state) => state.brushIntent);
  const activeLayerId = useEditorUiStore((state) => state.activeLayerId);
  const setActiveLayerId = useEditorUiStore((state) => state.setActiveLayerId);
  const showGrid = useEditorUiStore((state) => state.showGrid);
  const showCollisionOverlay = useEditorUiStore((state) => state.showCollisionOverlay);
  const showDebugOverlay = useEditorUiStore((state) => state.showDebugOverlay);
  const showMinimapOverlay = useEditorUiStore((state) => state.showMinimapOverlay);
  const setCamera = useEditorUiStore((state) => state.setCamera);
  const setSelection = useEditorUiStore((state) => state.setSelection);
  const clearSelection = useEditorUiStore((state) => state.clearSelection);
  const setHoverTile = useEditorUiStore((state) => state.setHoverTile);
  const activePalette = useActiveWorkingPalette(projectId);
  const catalogQuery = useResolvedCatalog(projectId);
  // Project the resolved catalog into the footprint lookup the viewport overlay
  // needs: GameObjectTypeId -> read-only CollisionFootprintComponent. Renderer
  // consumes only the projected DTO, never `services-plugin` (ADR-0025 D2/D3).
  const collisionFootprintByObjectType = useMemo(() => {
    const footprints = new Map<string, CollisionFootprintComponent>();
    for (const entry of catalogQuery.data?.objectTypes ?? []) {
      const footprint = findCollisionFootprint(entry.objectType);
      if (footprint !== undefined) {
        footprints.set(String(entry.objectType.id), footprint);
      }
    }
    return footprints;
  }, [catalogQuery.data]);
  const brushPackId =
    brushIntent.kind === 'placeable' && brushIntent.packId !== map.properties.tilesetPackId
      ? brushIntent.packId
      : undefined;
  const extraPackIds = Array.from(
    new Set(
      [
        ...(activePalette?.items ?? [])
          .map((item) => item.ref.packId)
          .filter((packId): packId is PackId => packId !== map.properties.tilesetPackId),
        ...(brushPackId === undefined ? [] : [brushPackId]),
      ],
    ),
  ).sort();
  const renderablePlaceableRefs =
    brushIntent.kind === 'placeable'
      ? [{ packId: brushIntent.packId, placeableId: brushIntent.placeableId }]
      : [];
  const extraPackIdsKey = extraPackIds.join('|');
  const renderablePlaceableRefsKey = renderablePlaceableRefs
    .map((ref) => `${ref.packId ?? ''}:${ref.placeableId}`)
    .join('|');
  const resolvedActiveLayerId = resolveToolActiveLayerId(map, activeLayerId, activeTool, brushIntent);

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

  // Brush resolution reads tile/terrain/placeable lookups straight from refs so
  // pointer handlers never re-subscribe; both mount and incremental asset loads
  // refresh them from the latest bundle.
  const applyBrushResolutionRefs = useCallback((bundle: ViewportAssetBundle) => {
    tileIndexByTileIdRef.current = bundle.tileIndexByTileId;
    terrainFirstTileIdRef.current = bundle.terrainFirstTileId;
    placeablesRef.current = bundle.placeables;
    autotileResolverRef.current = createAutotilePaintResolver(
      bundle.hasPack
        ? {
            autotileRules: bundle.autotileRules,
            tileIndexByTileId: bundle.tileIndexByTileId,
            directTileIndexByTerrainClass: bundle.directTileIndexByTerrainClass,
          }
        : undefined,
    );
  }, []);

  // Mounts the Pixi viewport once per stable map identity. Brush/palette
  // selection must NEVER appear in this dependency array: re-running it would
  // tear down the adapter and rebuild every chunk (a visible "map reload").
  // Extra palette/placeable assets stream in via the incremental effect below.
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

    let mountedBundle: ViewportAssetBundle | null = null;
    const handle = startSerializedViewportMount<EditorViewportController>({
      performMount: async () => {
        await Effect.runPromise(adapter.mount(container));
        // Only the Pixi render surface (a direct child of the container) must be
        // click-through. Using a descendant selector here would also disable the
        // nested minimap overlay canvas, breaking its pointer handlers.
        for (const canvas of container.querySelectorAll(':scope > canvas')) {
          (canvas as HTMLCanvasElement).style.pointerEvents = 'none';
        }
        const bundle = await Effect.runPromise(
          loadViewportAssetBundle({ projectId, map, extraPackIds, renderablePlaceableRefs }),
        );
        mountedBundle = bundle;
        applyBrushResolutionRefs(bundle);
        await Effect.runPromise(adapter.loadAssets(bundle.manifest));
        return new EditorViewportController(adapter, {
          tileFramesByIndex: bundle.tileFramesByIndex,
          collisionMaskByTileIndex: bundle.collisionMaskByTileIndex,
          renderableAssetIdByPath: bundle.renderableAssetIdByPath,
          placeables: bundle.placeables,
          assetPathByPackAndId: bundle.assetPathByPackAndId,
          assetPathById: bundle.assetPathById,
          autotileRules: bundle.autotileRules,
          terrainTransitions: bundle.terrainTransitions,
        });
      },
      disposePendingMount: () => Effect.runPromise(adapter.dispose()),
      onMounted: (controller) => {
        controllerRef.current = controller;
        appliedBundleRef.current = mountedBundle;
        // Seed canvas size and camera before the first setMap so chunk culling
        // builds only the in-view chunks instead of every chunk of a large map.
        controller.resize(container.clientWidth, container.clientHeight);
        controller.setCamera(camera.zoom, camera.panX, camera.panY);
        controller.setMap(currentMapRef.current);
        // Re-run the incremental asset effect now that the controller is live so
        // any brush refs that changed while mounting still stream their assets in.
        setMountVersion((version) => version + 1);
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
      appliedBundleRef.current = null;
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
    // Mount identity is the project + map only. Brush/palette-driven values are
    // intentionally excluded so switching the working palette never remounts.
  }, [mapId, projectId]);

  // Incrementally streams the assets referenced by the current working palette /
  // selected brush (extra packs + selected placeable frames) into the live
  // controller without remounting. Skips the bundle the mount already applied.
  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) {
      return;
    }
    let cancelled = false;
    void Effect.runPromise(
      loadViewportAssetBundle({
        projectId,
        map: currentMapRef.current,
        extraPackIds,
        renderablePlaceableRefs,
      }),
    )
      .then((bundle) => {
        if (cancelled || controllerRef.current !== controller) {
          return;
        }
        if (bundle === appliedBundleRef.current) {
          return;
        }
        appliedBundleRef.current = bundle;
        applyBrushResolutionRefs(bundle);
        return controller.mergeAssetBundle(bundle);
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
    // `extraPackIds`/`renderablePlaceableRefs` are represented by their stable
    // key strings; `mountVersion` re-runs this once the controller goes live.
  }, [
    applyBrushResolutionRefs,
    extraPackIdsKey,
    mapId,
    mountVersion,
    projectId,
    renderablePlaceableRefsKey,
  ]);

  useEffect(() => {
    if (resolvedActiveLayerId !== activeLayerId) {
      setActiveLayerId(resolvedActiveLayerId);
    }
    controllerRef.current?.setActiveLayerId(resolvedActiveLayerId);
  }, [activeLayerId, resolvedActiveLayerId, setActiveLayerId]);

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

  // Feed the resolved catalog footprints to the live controller (also re-runs
  // once `mountVersion` bumps so a freshly mounted controller picks them up).
  useEffect(() => {
    controllerRef.current?.setCollisionFootprints(collisionFootprintByObjectType);
  }, [collisionFootprintByObjectType, mountVersion]);

  useEffect(() => {
    controllerRef.current?.setShowDebug(showDebugOverlay);
  }, [showDebugOverlay]);

  useEffect(() => {
    controllerRef.current?.setSelection(selection);
  }, [selection]);

  // Drop the last-rendered brush preview whenever the active tool or brush
  // intent changes so a previously-selected placeable's footprint cannot linger
  // (e.g. switching a large placeable -> a 1x1 spawn/marker). The next pointer
  // move recomputes the preview for the current brush from scratch.
  useEffect(() => {
    controllerRef.current?.setBrushPreview(null);
  }, [activeTool, brushIntent]);

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

  // Paints the active palette texture into the current tile selection (Enter).
  // Reads live state from the store/refs so the keydown listener never needs to
  // re-subscribe on every selection or brush change.
  const fillSelectionWithActiveBrush = useCallback(() => {
    const state = useEditorUiStore.getState();
    const currentSelection = state.selection;
    if (currentSelection.size === 0) {
      return;
    }
    const resolved = resolveBrushAction({
      brushIntent: state.brushIntent,
      tileIndexByTileId: tileIndexByTileIdRef.current,
      terrainFirstTileId: terrainFirstTileIdRef.current,
      placeables: placeablesRef.current,
      autotileResolver: autotileResolverRef.current,
    });
    if (!resolved) {
      return;
    }
    const map = currentMapRef.current;
    const layerId = resolveLayerId(map, state.activeLayerId ?? undefined);
    if (!layerId) {
      return;
    }
    const command = createFillSelectionCommand(map, layerId, currentSelection, resolved);
    if (command) {
      applyCommand(command, { history: 'push' });
    }
  }, [applyCommand]);

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
      if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        fillSelectionWithActiveBrush();
        return;
      }
      const toolEntry = Object.entries({
        v: 'select',
        h: 'pan',
        b: 'tileBrush',
        r: 'rectangleFill',
        e: 'eraser',
        m: 'objectMove',
        c: 'collisionPaint',
        t: 'regionMark',
      } as const).find(([key]) => event.key.toLowerCase() === key);
      if (toolEntry && !event.metaKey && !event.ctrlKey && !event.altKey) {
        useEditorUiStore.getState().selectTool(toolEntry[1]);
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
  }, [clearSelection, fillSelectionWithActiveBrush, redo, undo]);

  const pointerContext = useCallback(
    () => ({
      map: currentMapRef.current,
      activeTool,
      brushIntent,
      resolvedBrush: resolveBrushAction({
        brushIntent,
        tileIndexByTileId: tileIndexByTileIdRef.current,
        terrainFirstTileId: terrainFirstTileIdRef.current,
        placeables: placeablesRef.current,
        autotileResolver: autotileResolverRef.current,
      }),
      autotileResolver: autotileResolverRef.current,
      activeLayerId: resolvedActiveLayerId ?? undefined,
      selection,
      shiftKey: false,
    }),
    [activeTool, brushIntent, resolvedActiveLayerId, selection],
  );

  const toPoint = useCallback(
    (event: ViewportPointerEvent) => {
      const target = event.currentTarget as HTMLDivElement;
      const bounds = target.getBoundingClientRect();
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

  const handlePointerDown = (event: ViewportPointerEvent) => {
    const target = event.currentTarget as HTMLDivElement;
    const effectiveTool =
      event.button === 1 || spaceDownRef.current
        ? 'pan'
        : event.button === 2
          ? 'eraser'
          : activeTool;
    activePointerIdRef.current = event.pointerId;
    strokeToolRef.current = effectiveTool;
    trySetPointerCapture(target, event.pointerId);
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

  const handlePointerMove = (event: ViewportPointerEvent) => {
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

  const handlePointerUp = (event: ViewportPointerEvent) => {
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
    const target = event.currentTarget as HTMLDivElement;
    tryReleasePointerCapture(target, event.pointerId);
    activePointerIdRef.current = null;
    strokeToolRef.current = null;
    if (result.selection) {
      setSelection(result.selection);
    }
    applyToolCommand(result);
    controllerRef.current?.setBrushPreview(result.brushPreview ?? null);
  };

  const handlePointerCancel = (event: ViewportPointerEvent) => {
    const target = event.currentTarget as HTMLDivElement;
    tryReleasePointerCapture(target, event.pointerId);
    activePointerIdRef.current = null;
    strokeToolRef.current = null;
    panOriginRef.current = null;
    sessionRef.current = {};
    controllerRef.current?.setBrushPreview(null);
  };

  const handleWheel = (event: ViewportWheelEvent) => {
    event.preventDefault();
    const target = event.currentTarget as HTMLDivElement;
    const bounds = target.getBoundingClientRect();
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

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!isViewportOverlayEvent(event)) {
        handlePointerDown(event);
      }
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!isViewportOverlayEvent(event)) {
        handlePointerMove(event);
      }
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!isViewportOverlayEvent(event)) {
        handlePointerUp(event);
      }
    };
    const onPointerCancel = (event: PointerEvent) => {
      if (!isViewportOverlayEvent(event)) {
        handlePointerCancel(event);
      }
    };
    const onWheel = (event: WheelEvent) => {
      if (!isViewportOverlayEvent(event)) {
        handleWheel(event);
      }
    };
    const onPointerLeave = () => {
      if (activePointerIdRef.current !== null) {
        return;
      }
      updateHoverTile(null);
      controllerRef.current?.setBrushPreview(null);
    };
    const onContextMenu = (event: MouseEvent) => {
      if (!isViewportOverlayEvent(event)) {
        event.preventDefault();
      }
    };
    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerup', onPointerUp);
    container.addEventListener('pointercancel', onPointerCancel);
    container.addEventListener('pointerleave', onPointerLeave);
    container.addEventListener('contextmenu', onContextMenu);
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', onPointerUp);
      container.removeEventListener('pointercancel', onPointerCancel);
      container.removeEventListener('pointerleave', onPointerLeave);
      container.removeEventListener('contextmenu', onContextMenu);
      container.removeEventListener('wheel', onWheel);
    };
  });

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full touch-none overflow-hidden bg-background [&>canvas]:pointer-events-none"
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

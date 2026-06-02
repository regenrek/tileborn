import {
  useEffect,
  useMemo,
  useRef,
  type MutableRefObject,
  type RefObject,
} from 'react';
import type { TileborneMap } from '@tileborne/core';
import {
  interpolateRenderableEntities,
  PixiRendererAdapter,
  SnapshotEntityStore,
  type RenderableEntity,
  type RenderableEntityProjector,
} from '@tileborne/runtime';
import { Effect } from 'effect';

import { PlaytestHudOverlay } from '@/components/playtest-hud-overlay';
import { PlaytestOverlay } from '@/components/playtest-overlay';
import { EditorViewportController } from '@/editor/viewport/editor-viewport-controller';
import {
  chainViewportDispose,
  startSerializedViewportMount,
} from '@/editor/viewport/viewport-mount-lifecycle';
import {
  loadViewportAssetBundle,
  viewportControllerAtlas,
} from '@/editor/viewport/viewport-asset-manifest';
import { pixiTextureFromBytes } from '@/editor/viewport/pixi-texture-from-bytes';
import {
  computeAimDeg,
  isPlaytestMovementKey,
  movementKeysToDirection,
  parseWeaponSlotKey,
} from '@/lib/playtest-input';
import {
  BATTLE_ROYALE_PLUGIN_ID,
  resolvePlaytestPlugin,
  type ResolvedPlaytestPlugin,
} from '@/lib/playtest-plugin-bridge';
import {
  assemblePlaytestPlayerModelConfig,
  usePlaytestPlayerModels,
} from '@/hooks/use-playtest-player-models';
import type { BuiltPlayerModel } from '@/lib/player-model-render';
import type { PlaytestMultiplayerClient } from '@/lib/playtest-multiplayer-client';
import { multiplayerStateToConnectionInput } from '@/lib/playtest-multiplayer-status';
import { usePlaytestMultiplayerStore } from '@/stores/playtest-multiplayer-store';
import { useEditorUiStore } from '@/stores/editor-ui-store';

interface PlaytestMultiplayerViewportProps {
  readonly projectId: string;
  readonly map: TileborneMap;
}

const SHOOT_KEY = 'Space';

interface RuntimeBundle {
  readonly adapter: PixiRendererAdapter;
  readonly controller: EditorViewportController;
  readonly projector: RenderableEntityProjector<unknown>;
  readonly fixedZoom: number;
}

// Positions are interpolated once in world space before projection, so the
// renderer performs no second lerp (alpha 1, no previous-by-id map).
const EMPTY_PREVIOUS: ReadonlyMap<string, RenderableEntity> = new Map();

const projectEntity = (
  entity: RenderableEntity,
  cameraX: number,
  cameraY: number,
  cx: number,
  cy: number,
  fixedZoom: number,
): RenderableEntity => ({
  ...entity,
  x: (entity.x - cameraX) * fixedZoom + cx,
  y: (entity.y - cameraY) * fixedZoom + cy,
  scale: (entity.scale ?? 1) * fixedZoom,
});

function useMultiplayerRuntimeMount({
  containerRef,
  runtimeRef,
  projectId,
  map,
  builtModels,
  selectedModelId,
}: {
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly runtimeRef: MutableRefObject<RuntimeBundle | null>;
  readonly projectId: string;
  readonly map: TileborneMap;
  readonly builtModels: readonly BuiltPlayerModel[];
  readonly selectedModelId: string | undefined;
}) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    const basePlugin = resolvePlaytestPlugin(BATTLE_ROYALE_PLUGIN_ID);
    if (!basePlugin) {
      console.error(`[playtest] no projector for plugin ${BATTLE_ROYALE_PLUGIN_ID}`);
      return undefined;
    }
    let resolved: ResolvedPlaytestPlugin = basePlugin;

    const adapter = new PixiRendererAdapter({
      applicationOptions: { autoStart: false, backgroundAlpha: 0 },
      // Decode atlas bytes through an HTMLImageElement so blob/extensionless
      // atlas URLs load instead of failing Pixi v8's URL-extension parser
      // detection (mirrors map-editor-viewport.tsx).
      textureFactory: pixiTextureFromBytes,
    });

    const handle = startSerializedViewportMount<EditorViewportController>({
      performMount: async () => {
        // Resolve the projector with the lobby-chosen player models (defaultModelId
        // applies to every player without an explicit wire/selection model).
        if (builtModels.length > 0) {
          try {
            const playerModels = await assemblePlaytestPlayerModelConfig(
              builtModels,
              new Map<string, string>(),
              selectedModelId,
            );
            resolved = resolvePlaytestPlugin(BATTLE_ROYALE_PLUGIN_ID, { playerModels }) ?? basePlugin;
          } catch (error) {
            console.error('[playtest] failed to load player-model atlases', error);
            resolved = basePlugin;
          }
        }
        // Load the full viewport bundle (not just the manifest) so the
        // controller receives the tile-atlas lookups it needs to resolve real
        // terrain textures; without them every tile falls back to the
        // missing-texture diagnostic color.
        const bundle = await Effect.runPromise(
          adapter.mount(container).pipe(
            Effect.flatMap(() => loadViewportAssetBundle({ projectId, map })),
            Effect.tap((loaded) => adapter.loadAssets(loaded.manifest)),
            Effect.tap(() => adapter.loadBundledAssets(resolved.bundledAssets)),
          ),
        );
        return new EditorViewportController(adapter, viewportControllerAtlas(bundle));
      },
      disposePendingMount: () => Effect.runPromise(adapter.dispose()),
      onMounted: (controller) => {
        runtimeRef.current = {
          adapter,
          controller,
          projector: resolved.projector,
          fixedZoom: resolved.manifest.fixedZoom,
        };
        controller.setMap(map);
        // Seed from the live store rather than the subscribed render values so a
        // viewport-overlay toggle never re-runs this mount effect (which would
        // remount the viewport); the dedicated effects below keep the controller
        // in sync.
        const ui = useEditorUiStore.getState();
        controller.setShowGrid(ui.showGrid);
        controller.setShowDebug(ui.showDebugOverlay);
        controller.setShowCollision(ui.showCollisionOverlay);
        controller.resize(container.clientWidth, container.clientHeight);
      },
    });
    handle.settled.catch(console.error);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      runtimeRef.current?.controller.resize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(container);

    return () => {
      handle.cancel();
      observer.disconnect();
      const active = runtimeRef.current;
      runtimeRef.current = null;
      chainViewportDispose(async () => {
        await handle.settled;
        if (active) {
          await active.controller.dispose();
        }
      });
    };
  }, [containerRef, map, projectId, runtimeRef, builtModels, selectedModelId]);
}

function useMultiplayerSnapshotRenderer({
  client,
  containerRef,
  runtimeRef,
  map,
}: {
  readonly client: PlaytestMultiplayerClient | null;
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly runtimeRef: MutableRefObject<RuntimeBundle | null>;
  readonly map: TileborneMap;
}) {
  useEffect(() => {
    if (!client) {
      return undefined;
    }
    const plugin = resolvePlaytestPlugin(BATTLE_ROYALE_PLUGIN_ID);
    if (!plugin) {
      return undefined;
    }
    const store = new SnapshotEntityStore(plugin.projector.mergeFrame, {
      enableInterpolation: true,
      interpolationDelayMs: 100,
      ...(plugin.projector.getFrameTimestamp
        ? { getFrameTimestamp: plugin.projector.getFrameTimestamp }
        : {}),
    });
    let rafHandle = 0;
    const camera = { x: map.size.width / 2, y: map.size.height / 2 };

    const unsubscribe = client.setSnapshotFrameListener((frame) => {
      store.apply(frame);
    });

    const renderTick = (): void => {
      rafHandle = requestAnimationFrame(renderTick);
      const runtime = runtimeRef.current;
      const container = containerRef.current;
      if (!runtime || !container) {
        return;
      }
      const interpolated = store.sampleInterpolatedFullState(performance.now());
      const currentSnapshot = interpolated?.current ?? store.getCurrentFullState();
      if (currentSnapshot === undefined) {
        return;
      }
      // Interpolate world-space positions ONCE so the follow-camera and the
      // sprites share the same smoothed position; anchoring the camera to the
      // discrete latest snapshot reintroduces tick-rate stutter.
      const currentEntities = runtime.projector.project(currentSnapshot);
      const previousEntities =
        interpolated?.previous === undefined
          ? []
          : runtime.projector.project(interpolated.previous);
      const entities = interpolateRenderableEntities(
        currentEntities,
        previousEntities,
        interpolated?.alpha ?? 1,
      );

      const localPlayerId = client.getLocalPlayerId();
      const localEntityId =
        localPlayerId !== null ? `br:player:${localPlayerId}` : undefined;
      const localEntity =
        localEntityId !== undefined
          ? entities.find((entity) => entity.id === localEntityId)
          : undefined;
      if (localEntity) {
        camera.x = localEntity.x;
        camera.y = localEntity.y;
      }
      const cx = container.clientWidth / 2;
      const cy = container.clientHeight / 2;
      const { fixedZoom } = runtime;
      runtime.controller.setCamera(
        fixedZoom,
        cx - camera.x * fixedZoom,
        cy - camera.y * fixedZoom,
      );

      const projectedEntities = entities.map((entity) =>
        projectEntity(entity, camera.x, camera.y, cx, cy, fixedZoom),
      );
      // This loop renders the adapter directly, bypassing the controller's
      // `renderNow`, so advance the FPS counter / debug text here; otherwise the
      // debug overlay stays frozen in playtest.
      runtime.controller.tickDebugOverlay();
      void Effect.runPromise(
        runtime.adapter.renderFromEntities(projectedEntities, EMPTY_PREVIOUS, 1),
      );
    };
    rafHandle = requestAnimationFrame(renderTick);

    return () => {
      cancelAnimationFrame(rafHandle);
      unsubscribe();
    };
  }, [client, containerRef, map.size.height, map.size.width, runtimeRef]);
}

function useMultiplayerInputBridge({
  client,
  containerRef,
}: {
  readonly client: PlaytestMultiplayerClient | null;
  readonly containerRef: RefObject<HTMLDivElement | null>;
}) {
  useEffect(() => {
    if (!client) {
      return undefined;
    }
    const container = containerRef.current;
    const pressedKeys = new Set<string>();
    const pointer = { x: 0, y: 0, hasMoved: false };
    let pendingWeaponSlot: number | undefined;

    const computeAimDegFromPointer = (): number | undefined => {
      const liveContainer = containerRef.current;
      if (!liveContainer || !pointer.hasMoved) {
        return undefined;
      }
      const cx = liveContainer.clientWidth / 2;
      const cy = liveContainer.clientHeight / 2;
      return computeAimDeg(pointer.x, pointer.y, cx, cy);
    };

    const syncInput = (): void => {
      const aimDeg = computeAimDegFromPointer();
      const weaponSlot = pendingWeaponSlot;
      client.sendInput(
        movementKeysToDirection(pressedKeys),
        pressedKeys.has(SHOOT_KEY),
        {
          ...(aimDeg !== undefined ? { aimDeg } : {}),
          ...(weaponSlot !== undefined ? { weaponSlot } : {}),
        },
      );
      pendingWeaponSlot = undefined;
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      const isShoot = event.code === SHOOT_KEY;
      const isMove = isPlaytestMovementKey(event.code);
      const weaponSlot = parseWeaponSlotKey(event.code);
      if (!isMove && !isShoot && weaponSlot === undefined) {
        return;
      }
      event.preventDefault();
      if (weaponSlot !== undefined) {
        pendingWeaponSlot = weaponSlot;
        syncInput();
        return;
      }
      if (pressedKeys.has(event.code)) {
        return;
      }
      pressedKeys.add(event.code);
      syncInput();
    };

    const onKeyUp = (event: KeyboardEvent): void => {
      const isShoot = event.code === SHOOT_KEY;
      const isMove = isPlaytestMovementKey(event.code);
      if (!isMove && !isShoot) {
        return;
      }
      event.preventDefault();
      pressedKeys.delete(event.code);
      syncInput();
    };

    const onPointerMove = (event: PointerEvent): void => {
      const target = container;
      if (!target) {
        return;
      }
      const rect = target.getBoundingClientRect();
      pointer.x = event.clientX - rect.left;
      pointer.y = event.clientY - rect.top;
      pointer.hasMoved = true;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    container?.addEventListener('pointermove', onPointerMove);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      container?.removeEventListener('pointermove', onPointerMove);
    };
  }, [client, containerRef]);
}

export function PlaytestMultiplayerViewport({ projectId, map }: PlaytestMultiplayerViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<RuntimeBundle | null>(null);
  const showGrid = useEditorUiStore((state) => state.showGrid);
  const showDebugOverlay = useEditorUiStore((state) => state.showDebugOverlay);
  const showCollisionOverlay = useEditorUiStore((state) => state.showCollisionOverlay);
  const sessionState = usePlaytestMultiplayerStore((state) => state.sessionState);
  const client = usePlaytestMultiplayerStore((state) => state.client);
  const stopHosting = usePlaytestMultiplayerStore((state) => state.stopHosting);
  // Resolve the active plugin once to expose its render manifest (fixedZoom,
  // hudInsets) to the JSX layer without piping it through refs. The render
  // loop re-resolves inside its own effect for lifecycle reasons.
  const resolvedPlugin = useMemo(
    () => resolvePlaytestPlugin(BATTLE_ROYALE_PLUGIN_ID),
    [],
  );
  const hudInsets = resolvedPlugin?.manifest.hudInsets;
  const { builtModels, selectedModelId } = usePlaytestPlayerModels(projectId, map);

  useMultiplayerRuntimeMount({ containerRef, runtimeRef, projectId, map, builtModels, selectedModelId });
  useMultiplayerSnapshotRenderer({ client, containerRef, runtimeRef, map });
  useMultiplayerInputBridge({ client, containerRef });

  useEffect(() => {
    runtimeRef.current?.controller.setShowGrid(showGrid);
  }, [showGrid]);

  useEffect(() => {
    runtimeRef.current?.controller.setShowDebug(showDebugOverlay);
  }, [showDebugOverlay]);

  useEffect(() => {
    runtimeRef.current?.controller.setShowCollision(showCollisionOverlay);
  }, [showCollisionOverlay]);

  const sessionId = sessionState
    ? `multiplayer:${sessionState.localPlayerId ?? 'pending'}:${sessionState.tick}`
    : 'multiplayer:pending';

  return (
    <div
      className="absolute inset-0 z-20 flex min-h-0 flex-col bg-background/95 backdrop-blur-sm"
      data-testid="playtest-multiplayer-viewport"
    >
      <PlaytestOverlay
        sessionId={sessionId}
        activePlugins={[BATTLE_ROYALE_PLUGIN_ID]}
        session={multiplayerStateToConnectionInput(sessionState)}
        isStopping={false}
        onStop={stopHosting}
      />
      <div className="relative min-h-0 flex-1">
        <div
          ref={containerRef}
          className="absolute inset-0 outline-none"
          data-testid="playtest-multiplayer-canvas"
          tabIndex={0}
        />
        <PlaytestHudOverlay
          metrics={
            sessionState
              ? {
                  playerCount: sessionState.players.length,
                  tickCount: sessionState.tick,
                  hud: sessionState.hud,
                }
              : undefined
          }
          projectId={projectId}
          mapId={map.id}
          onBackToEditor={stopHosting}
          onPlayAgain={stopHosting}
          {...(hudInsets ? { hudInsets } : {})}
        />
      </div>
    </div>
  );
}

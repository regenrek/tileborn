import {
  useEffect,
  useMemo,
  useRef,
  type MutableRefObject,
  type RefObject,
} from 'react';
import type { TileborneMap } from '@tileborne/core';
import type { PlaytestSessionId } from '@tileborne/services-build';
import {
  interpolateRenderableEntities,
  PixiRendererAdapter,
  SnapshotEntityStore,
  type RenderableEntity,
  type RenderableEntityProjector,
} from '@tileborne/runtime';
import { Effect } from 'effect';

import { PlaytestOverlay } from '@/components/playtest-overlay';
import { PlaytestHudOverlay } from '@/components/playtest-hud-overlay';
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
import { usePlaytestSessions } from '@/hooks/queries';
import { usePlaytestControls } from '@/hooks/use-playtest-controls';
import { attachPlaytestInputCapture } from '@/lib/playtest-input';
import {
  resolvePlaytestPlugin,
  type ResolvedPlaytestPlugin,
} from '@/lib/playtest-plugin-bridge';
import {
  assemblePlaytestPlayerModelConfig,
  usePlaytestPlayerModels,
} from '@/hooks/use-playtest-player-models';
import type { BuiltPlayerModel } from '@/lib/player-model-render';
import { useEditorUiStore } from '@/stores/editor-ui-store';

const LOCAL_PLAYER_ID = 'player-1';
const LOCAL_PLAYER_INPUT_ID = 'player-1';

// Positions are interpolated once in world space before projection, so the
// renderer performs no second lerp (alpha 1, no previous-by-id map).
const EMPTY_PREVIOUS: ReadonlyMap<string, RenderableEntity> = new Map();

interface PlaytestViewportProps {
  readonly projectId: string;
  readonly map: TileborneMap;
  readonly sessionId: string;
  readonly activePlugins: readonly string[];
}

interface RuntimeBundle {
  readonly adapter: PixiRendererAdapter;
  readonly controller: EditorViewportController;
  readonly projector: RenderableEntityProjector<unknown>;
  readonly plugin: ResolvedPlaytestPlugin;
  readonly fixedZoom: number;
}

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

const findLocalPlayerEntity = (entities: readonly RenderableEntity[]): RenderableEntity | undefined =>
  entities.find((entity) => entity.id.startsWith('br:player:'));

function usePlaytestRuntimeMount({
  containerRef,
  runtimeRef,
  projectId,
  map,
  pluginId,
  builtModels,
  selectedModelId,
}: {
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly runtimeRef: MutableRefObject<RuntimeBundle | null>;
  readonly projectId: string;
  readonly map: TileborneMap;
  readonly pluginId: string | undefined;
  readonly builtModels: readonly BuiltPlayerModel[];
  readonly selectedModelId: string | undefined;
}) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }
    if (pluginId === undefined) {
      console.warn('[playtest] single-player viewport requires an active plugin id');
      return undefined;
    }
    const basePlugin = resolvePlaytestPlugin(pluginId);
    if (!basePlugin) {
      console.warn(`[playtest] no projector for plugin ${pluginId}`);
      return undefined;
    }
    // The configured plugin is resolved inside performMount once the chosen
    // player-model atlases are fetched; onMounted reads this holder.
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
        // Resolve the projector with the lobby-chosen player models so the
        // chosen sprite (and its clip) renders+animates per player; the model
        // atlases are loaded as runtime textures alongside the plugin defaults.
        if (builtModels.length > 0) {
          const playerModelIds = new Map<string, string>(
            selectedModelId === undefined ? [] : [[LOCAL_PLAYER_ID, selectedModelId]],
          );
          try {
            const playerModels = await assemblePlaytestPlayerModelConfig(
              builtModels,
              playerModelIds,
              selectedModelId,
            );
            resolved = resolvePlaytestPlugin(pluginId, { playerModels }) ?? basePlugin;
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
          plugin: resolved,
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
  }, [containerRef, map, pluginId, projectId, runtimeRef, builtModels, selectedModelId]);
}

function usePlaytestSnapshotRenderer({
  containerRef,
  runtimeRef,
  map,
  pluginId,
  sessionId,
}: {
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly runtimeRef: MutableRefObject<RuntimeBundle | null>;
  readonly map: TileborneMap;
  readonly pluginId: string | undefined;
  readonly sessionId: string;
}) {
  useEffect(() => {
    if (pluginId === undefined) {
      return undefined;
    }
    const plugin = resolvePlaytestPlugin(pluginId);
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

    const unsubscribe = window.tileborne.events.onRuntimeSnapshot((payload) => {
      if (payload.sessionId !== sessionId) {
        return;
      }
      const runtime = runtimeRef.current;
      if (!runtime) {
        return;
      }
      const decoded = runtime.plugin.decodeServerFrame(payload.frame);
      if (decoded === undefined) {
        return;
      }
      store.apply(decoded);
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

      const localEntity = findLocalPlayerEntity(entities);
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
  }, [containerRef, map.size.height, map.size.width, pluginId, runtimeRef, sessionId]);
}

function usePlaytestInputBridge({
  containerRef,
  pluginId,
  sessionId,
  tickCount,
}: {
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly pluginId: string | undefined;
  readonly sessionId: string;
  readonly tickCount: number | undefined;
}) {
  // The capture/resolver lifecycle MUST NOT depend on `tickCount`: a tick refresh
  // tearing down + recreating the resolver would drop held mouse/key state (a
  // held mouse has no repeat `mousedown`, so PrimaryAction/`shoot` would silently
  // clear on the next tick). Keep the latest tick in a ref the emit path reads so
  // outgoing frames carry the current tick without re-running the effect.
  const tickCountRef = useRef(tickCount);
  useEffect(() => {
    tickCountRef.current = tickCount;
  }, [tickCount]);

  useEffect(() => {
    if (pluginId === undefined) {
      return undefined;
    }
    const plugin = resolvePlaytestPlugin(pluginId);
    if (!plugin) {
      return undefined;
    }
    let seq = 0;

    const handle = attachPlaytestInputCapture({
      container: containerRef.current,
      inputMap: plugin.inputMap,
      controlScheme: plugin.controlScheme,
      profile: plugin.inputCaptureProfile,
      resolveIntent: plugin.resolveInputIntent,
      onIntent: (intent) => {
        seq += 1;
        const idle = intent.dir === undefined && !intent.shoot && intent.weaponSlot === undefined;
        const payload = {
          sessionId: sessionId as PlaytestSessionId,
          playerId: LOCAL_PLAYER_INPUT_ID,
          tick: tickCountRef.current ?? 0,
          seq,
          dir: (intent.dir ?? 0) as 0,
          shoot: intent.shoot,
          ...(intent.aimDeg === undefined ? {} : { aimDeg: intent.aimDeg }),
          ...(intent.weaponSlot === undefined ? {} : { weaponSlot: intent.weaponSlot }),
          ...(idle ? { active: false } : {}),
        };
        void window.tileborne.runtime.playtestInput(payload);
      },
    });

    return () => {
      handle.dispose();
    };
  }, [containerRef, pluginId, sessionId]);
}

export function PlaytestViewport({
  projectId,
  map,
  sessionId,
  activePlugins,
}: PlaytestViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<RuntimeBundle | null>(null);
  const showGrid = useEditorUiStore((state) => state.showGrid);
  const showDebugOverlay = useEditorUiStore((state) => state.showDebugOverlay);
  const showCollisionOverlay = useEditorUiStore((state) => state.showCollisionOverlay);
  const { stop, start, isStopping, isStarting } = usePlaytestControls();
  const playtestQuery = usePlaytestSessions({ refetchInterval: 500 });
  const session = playtestQuery.data?.sessions.find((entry) => entry.id === sessionId);
  const pluginId = activePlugins[0];
  const resolvedPlugin = useMemo(
    () => (pluginId !== undefined ? resolvePlaytestPlugin(pluginId) : undefined),
    [pluginId],
  );
  const hudInsets = resolvedPlugin?.manifest.hudInsets;
  const { builtModels, selectedModelId } = usePlaytestPlayerModels(projectId, map);

  usePlaytestRuntimeMount({
    containerRef,
    runtimeRef,
    projectId,
    map,
    pluginId,
    builtModels,
    selectedModelId,
  });
  usePlaytestSnapshotRenderer({ containerRef, runtimeRef, map, pluginId, sessionId });

  useEffect(() => {
    runtimeRef.current?.controller.setShowGrid(showGrid);
  }, [showGrid]);

  useEffect(() => {
    runtimeRef.current?.controller.setShowDebug(showDebugOverlay);
  }, [showDebugOverlay]);

  useEffect(() => {
    runtimeRef.current?.controller.setShowCollision(showCollisionOverlay);
  }, [showCollisionOverlay]);

  usePlaytestInputBridge({
    containerRef,
    pluginId,
    sessionId,
    tickCount: session?.runtimeMetrics?.tickCount,
  });

  return (
    <div className="absolute inset-0 z-20 flex min-h-0 flex-col bg-background/95 backdrop-blur-sm">
      <PlaytestOverlay
        sessionId={sessionId}
        activePlugins={activePlugins}
        session={session}
        isStopping={isStopping}
        onStop={stop}
      />
      <div className="relative min-h-0 flex-1">
        <div
          ref={containerRef}
          className="absolute inset-0 outline-none"
          data-testid="playtest-viewport"
          tabIndex={0}
        />
        <PlaytestHudOverlay
          metrics={
            session?.runtimeMetrics
              ? {
                  playerCount: session.runtimeMetrics.playerCount,
                  tickCount: session.runtimeMetrics.tickCount,
                  hud: session.runtimeMetrics.hud
                    ? {
                        totalPlayers: session.runtimeMetrics.hud.totalPlayers,
                        recentEvents: [...session.runtimeMetrics.hud.recentEvents],
                        ...(session.runtimeMetrics.hud.localPlayer
                          ? { localPlayer: session.runtimeMetrics.hud.localPlayer }
                          : {}),
                        ...(session.runtimeMetrics.hud.zoneStatus
                          ? { zoneStatus: session.runtimeMetrics.hud.zoneStatus }
                          : {}),
                        ...(session.runtimeMetrics.hud.gameOver
                          ? { gameOver: session.runtimeMetrics.hud.gameOver }
                          : {}),
                      }
                    : undefined,
                }
              : undefined
          }
          projectId={projectId}
          mapId={map.id}
          isRestarting={isStarting || isStopping}
          onBackToEditor={stop}
          onPlayAgain={async (nextProjectId, nextMapId) => {
            await stop();
            await start(nextProjectId, nextMapId);
          }}
          {...(hudInsets ? { hudInsets } : {})}
        />
      </div>
    </div>
  );
}

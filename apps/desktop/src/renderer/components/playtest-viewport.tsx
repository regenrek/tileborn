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
  PixiRendererAdapter,
  SnapshotEntityStore,
  type RenderableEntity,
  type RenderableEntityProjector,
} from '@tileborne/runtime';
import { Effect } from 'effect';

import { PlaytestOverlay } from '@/components/playtest-overlay';
import { PlaytestHudOverlay } from '@/components/playtest-hud-overlay';
import { SLICE_SERVER_TICK_MS } from '@/components/playtest-render-constants';
import { EditorViewportController } from '@/editor/viewport/editor-viewport-controller';
import {
  chainViewportDispose,
  startSerializedViewportMount,
} from '@/editor/viewport/viewport-mount-lifecycle';
import { loadViewportAssetManifest } from '@/editor/viewport/viewport-asset-manifest';
import { usePlaytestSessions } from '@/hooks/queries';
import { usePlaytestControls } from '@/hooks/use-playtest-controls';
import {
  computeAimDeg,
  isPlaytestMovementKey,
  movementKeysToDirection,
  parseWeaponSlotKey,
} from '@/lib/playtest-input';
import {
  resolvePlaytestPlugin,
  type ResolvedPlaytestPlugin,
} from '@/lib/playtest-plugin-bridge';

interface PlaytestViewportProps {
  readonly projectId: string;
  readonly map: TileborneMap;
  readonly sessionId: string;
  readonly activePlugins: readonly string[];
}

const SHOOT_KEY = 'Space';

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
}: {
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly runtimeRef: MutableRefObject<RuntimeBundle | null>;
  readonly projectId: string;
  readonly map: TileborneMap;
  readonly pluginId: string | undefined;
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
    const plugin = resolvePlaytestPlugin(pluginId);
    if (!plugin) {
      console.warn(`[playtest] no projector for plugin ${pluginId}`);
      return undefined;
    }

    const adapter = new PixiRendererAdapter({
      applicationOptions: { autoStart: false, backgroundAlpha: 0 },
    });

    const handle = startSerializedViewportMount<EditorViewportController>({
      performMount: async () => {
        await Effect.runPromise(
          adapter.mount(container).pipe(
            Effect.flatMap(() => loadViewportAssetManifest({ projectId, map })),
            Effect.flatMap((manifest) => adapter.loadAssets(manifest)),
            Effect.flatMap(() => adapter.loadBundledAssets(plugin.bundledAssets)),
          ),
        );
        return new EditorViewportController(adapter);
      },
      disposePendingMount: () => Effect.runPromise(adapter.dispose()),
      onMounted: (controller) => {
        runtimeRef.current = {
          adapter,
          controller,
          projector: plugin.projector,
          plugin,
          fixedZoom: plugin.manifest.fixedZoom,
        };
        controller.setMap(map);
        controller.setShowGrid(true);
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
  }, [containerRef, map, pluginId, projectId, runtimeRef]);
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
    let lastSnapshotAt = 0;
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
      lastSnapshotAt = performance.now();
    });

    const renderTick = (): void => {
      rafHandle = requestAnimationFrame(renderTick);
      const runtime = runtimeRef.current;
      const container = containerRef.current;
      if (!runtime || !container) {
        return;
      }
      const interpolated = store.sampleInterpolatedFullState(performance.now());
      const snapshot = interpolated?.current ?? store.getCurrentFullState();
      if (snapshot === undefined) {
        return;
      }
      const entities = runtime.projector.project(snapshot);
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
      const previousSnapshot =
        interpolated?.previous ?? store.getPreviousFullState();
      const previousEntities =
        previousSnapshot === undefined ? [] : runtime.projector.project(previousSnapshot);
      const projectedPrev = new Map<string, RenderableEntity>();
      for (const entity of previousEntities) {
        const { id } = entity;
        projectedPrev.set(id, projectEntity(entity, camera.x, camera.y, cx, cy, fixedZoom));
      }

      const alpha =
        interpolated?.alpha ??
        Math.min(1, (lastSnapshotAt === 0 ? 0 : performance.now() - lastSnapshotAt) / SLICE_SERVER_TICK_MS);
      void Effect.runPromise(
        runtime.adapter.renderFromEntities(projectedEntities, projectedPrev, alpha),
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
  sessionId,
  tickCount,
}: {
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly sessionId: string;
  readonly tickCount: number | undefined;
}) {
  useEffect(() => {
    const container = containerRef.current;
    const pressedKeys = new Set<string>();
    const pointer = { x: 0, y: 0, hasMoved: false };
    let pendingWeaponSlot: number | undefined;
    let seq = 0;

    const computeAimDegFromPointer = (): number | undefined => {
      const liveContainer = containerRef.current;
      if (!liveContainer || !pointer.hasMoved) {
        return undefined;
      }
      const cx = liveContainer.clientWidth / 2;
      const cy = liveContainer.clientHeight / 2;
      return computeAimDeg(pointer.x, pointer.y, cx, cy);
    };

    const sendInput = (dir: ReturnType<typeof movementKeysToDirection>): void => {
      seq += 1;
      const aimDeg = computeAimDegFromPointer();
      const weaponSlot = pendingWeaponSlot;
      const payload = {
        sessionId: sessionId as PlaytestSessionId,
        playerId: 'player-1',
        tick: tickCount ?? 0,
        seq,
        dir: (dir ?? 0) as 0,
        shoot: pressedKeys.has(SHOOT_KEY),
        ...(aimDeg === undefined ? {} : { aimDeg }),
        ...(weaponSlot === undefined ? {} : { weaponSlot }),
      };
      if (dir === undefined && !pressedKeys.has(SHOOT_KEY) && weaponSlot === undefined) {
        void window.tileborne.runtime.playtestInput({ ...payload, active: false });
        return;
      }
      void window.tileborne.runtime.playtestInput(payload);
      pendingWeaponSlot = undefined;
    };

    const syncInput = (): void => {
      sendInput(movementKeysToDirection(pressedKeys));
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      const isMove = isPlaytestMovementKey(event.code);
      const isShoot = event.code === SHOOT_KEY;
      const weaponSlot = parseWeaponSlotKey(event.code);
      if (!isMove && !isShoot && weaponSlot === undefined) {
        return;
      }
      if (pressedKeys.has(event.code)) {
        return;
      }
      event.preventDefault();
      if (weaponSlot !== undefined) {
        pendingWeaponSlot = weaponSlot;
        syncInput();
        return;
      }
      pressedKeys.add(event.code);
      syncInput();
    };

    const onKeyUp = (event: KeyboardEvent): void => {
      const isMove = isPlaytestMovementKey(event.code);
      const isShoot = event.code === SHOOT_KEY;
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
  }, [containerRef, sessionId, tickCount]);
}

export function PlaytestViewport({
  projectId,
  map,
  sessionId,
  activePlugins,
}: PlaytestViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<RuntimeBundle | null>(null);
  const { stop, start, isStopping, isStarting } = usePlaytestControls();
  const playtestQuery = usePlaytestSessions({ refetchInterval: 500 });
  const session = playtestQuery.data?.sessions.find((entry) => entry.id === sessionId);
  const pluginId = activePlugins[0];
  const resolvedPlugin = useMemo(
    () => (pluginId !== undefined ? resolvePlaytestPlugin(pluginId) : undefined),
    [pluginId],
  );
  const hudInsets = resolvedPlugin?.manifest.hudInsets;

  usePlaytestRuntimeMount({ containerRef, runtimeRef, projectId, map, pluginId });
  usePlaytestSnapshotRenderer({ containerRef, runtimeRef, map, pluginId, sessionId });
  usePlaytestInputBridge({
    containerRef,
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

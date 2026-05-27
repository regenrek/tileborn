import {
  useEffect,
  useMemo,
  useRef,
  type MutableRefObject,
  type RefObject,
} from 'react';
import type { TileborneMap } from '@tileborne/core';
import {
  PixiRendererAdapter,
  SnapshotEntityStore,
  type RenderableEntity,
  type RenderableEntityProjector,
} from '@tileborne/runtime';
import { Effect } from 'effect';

import { PlaytestHudOverlay } from '@/components/playtest-hud-overlay';
import { PlaytestOverlay } from '@/components/playtest-overlay';
import { SLICE_SERVER_TICK_MS } from '@/components/playtest-render-constants';
import { EditorViewportController } from '@/editor/viewport/editor-viewport-controller';
import {
  chainViewportDispose,
  startSerializedViewportMount,
} from '@/editor/viewport/viewport-mount-lifecycle';
import { loadViewportAssetManifest } from '@/editor/viewport/viewport-asset-manifest';
import {
  computeAimDeg,
  isPlaytestMovementKey,
  movementKeysToDirection,
  parseWeaponSlotKey,
} from '@/lib/playtest-input';
import {
  BATTLE_ROYALE_PLUGIN_ID,
  resolvePlaytestPlugin,
} from '@/lib/playtest-plugin-bridge';
import type { PlaytestMultiplayerClient } from '@/lib/playtest-multiplayer-client';
import { multiplayerStateToConnectionInput } from '@/lib/playtest-multiplayer-status';
import { usePlaytestMultiplayerStore } from '@/stores/playtest-multiplayer-store';

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
}: {
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly runtimeRef: MutableRefObject<RuntimeBundle | null>;
  readonly projectId: string;
  readonly map: TileborneMap;
}) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    const plugin = resolvePlaytestPlugin(BATTLE_ROYALE_PLUGIN_ID);
    if (!plugin) {
      console.error(`[playtest] no projector for plugin ${BATTLE_ROYALE_PLUGIN_ID}`);
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
  }, [containerRef, map, projectId, runtimeRef]);
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
    let lastSnapshotAt = 0;
    let rafHandle = 0;
    const camera = { x: map.size.width / 2, y: map.size.height / 2 };

    const unsubscribe = client.setSnapshotFrameListener((frame) => {
      store.apply(frame);
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

  useMultiplayerRuntimeMount({ containerRef, runtimeRef, projectId, map });
  useMultiplayerSnapshotRenderer({ client, containerRef, runtimeRef, map });
  useMultiplayerInputBridge({ client, containerRef });

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

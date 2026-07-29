import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from 'react';
import type { TileborneMap } from '@tileborne/core';
import { Button, cn } from '@tileborne/ui';
import { PencilRulerIcon } from 'lucide-react';
import type { ProjectId } from '@tileborne/core';
import type { PlaytestSessionId } from '@tileborne/services-build';
import {
  audioAuthoringStateFromDocument,
  buildRuntimeAudioProjectionFromAuthoring,
  decodeRuntimeGameShellProjection,
  interpolateRenderableEntities,
  PixiRendererAdapter,
  SnapshotEntityStore,
  type RuntimeGameShellProjection,
  type RenderableEntity,
  type RenderableEntityProjector,
} from '@tileborne/runtime';
import {
  dispatchGameplayLifecycleAudioEvents,
  initialMenuState,
  RuntimeRoot,
  type RuntimeRootProps,
  type RuntimeShellBehaviorBridge,
} from '@tileborne/game-client';
import { Effect } from 'effect';

import { PlaytestOverlay } from '@/components/playtest-overlay';
import { PlaytestHudEditor } from '@/components/playtest-hud-editor';
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
import {
  usePlaytestSessions,
  usePluginContributions,
  useProject,
  useProjectAudio,
  useProjectGameShell,
} from '@/hooks/queries';
import { useHudEditing } from '@/hooks/use-hud-editing';
import { readProjectHudLayout } from '@/lib/project-hud-layout';
import { usePlaytestControls } from '@/hooks/use-playtest-controls';
import { resolvePlaytestPlugin, type ResolvedPlaytestPlugin } from '@/lib/playtest-plugin-bridge';
import { usePlaytestInputBridge } from '@/components/playtest-viewport-input-bridge';
import { assetProtocolUrl } from '@/lib/asset-url';
import {
  assemblePlaytestOverlayVisualConfig,
  assemblePlaytestPlayerModelConfig,
  assemblePlaytestWeaponVisualConfig,
  usePlaytestPlayerModels,
  usePlaytestOverlayVisuals,
  usePlaytestWeaponVisuals,
} from '@/hooks/use-playtest-player-models';
import type { BuiltPlayerModel } from '@/lib/player-model-render';

type PendingPlaytestOwnerDisposal = {
  readonly ownerKey: string;
  readonly cancel: () => void;
};
import type { BuiltOverlayVisual } from '@/lib/overlay-visual-render';
import type { BuiltWeaponVisual } from '@/lib/weapon-visual-render';
import { useEditorUiStore } from '@/stores/editor-ui-store';

const SHELL_FALLBACK_TIMEOUT_MS = 10_000;

type ShellFallbackStatus = 'idle' | 'pending' | 'success' | 'invalid' | 'error' | 'timeout';

type ShellMountEvent = {
  generation: number;
  event: 'mount' | 'unmount';
  reason: string;
  projectId: string;
  mapId: string;
  sessionId: string;
};

type PlaytestShellDebugWindow = Window & {
  __tileborneShellDebug?: {
    renderLobbyCount?: number;
    mountEvents?: ShellMountEvent[];
  };
};

type CachedShellProjection = {
  cacheKey: string;
  generation: number;
  projection: RuntimeGameShellProjection | undefined;
  source: 'query' | 'fallback' | undefined;
};

const pendingShellRetryKeys = new Set<string>();

const formatShellError = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message;
  }
  return String(error);
};

const runtimeShellProjectionFromIpc = (value: unknown): RuntimeGameShellProjection | undefined => {
  const decoded = decodeRuntimeGameShellProjection(value);
  if (decoded !== undefined) return decoded;
  if (
    value !== null &&
    typeof value === 'object' &&
    Array.isArray((value as { screens?: unknown }).screens) &&
    Array.isArray((value as { screenOrder?: unknown }).screenOrder) &&
    Array.isArray((value as { assets?: unknown }).assets) &&
    Array.isArray((value as { registeredEvents?: unknown }).registeredEvents) &&
    typeof (value as { entryScreenId?: unknown }).entryScreenId === 'string'
  ) {
    return value as RuntimeGameShellProjection;
  }
  return undefined;
};

const appendShellMountEvent = (event: ShellMountEvent): void => {
  const debugWindow = window as PlaytestShellDebugWindow;
  if (debugWindow.__tileborneShellDebug === undefined) return;
  debugWindow.__tileborneShellDebug.mountEvents = [
    ...(debugWindow.__tileborneShellDebug.mountEvents ?? []),
    event,
  ].slice(-20);
};

function InstrumentedRuntimeRoot({
  generation,
  reason,
  projectId,
  mapId,
  sessionId,
  ...props
}: RuntimeRootProps & {
  readonly generation: number;
  readonly reason: string;
  readonly projectId: string;
  readonly mapId: string;
  readonly sessionId: string;
}) {
  useEffect(() => {
    appendShellMountEvent({
      generation,
      event: 'mount',
      reason,
      projectId,
      mapId,
      sessionId,
    });
    return () => {
      appendShellMountEvent({
        generation,
        event: 'unmount',
        reason,
        projectId,
        mapId,
        sessionId,
      });
    };
  }, [generation, mapId, projectId, reason, sessionId]);
  return <RuntimeRoot {...props} />;
}

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
  ...(entity.scale === undefined ? {} : { scale: entity.scale * fixedZoom }),
  scaleX: (entity.scaleX ?? entity.scale ?? 1) * fixedZoom,
  scaleY: (entity.scaleY ?? entity.scale ?? 1) * fixedZoom,
});

const findLocalPlayerEntity = (
  entities: readonly RenderableEntity[],
): RenderableEntity | undefined =>
  entities.find((entity) => typeof entity.id === 'string' && entity.id.startsWith('br:player:'));

function usePlaytestRuntimeMount({
  containerRef,
  runtimeRef,
  projectId,
  map,
  pluginId,
  builtModels,
  builtOverlays,
  builtWeapons,
}: {
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly runtimeRef: MutableRefObject<RuntimeBundle | null>;
  readonly projectId: string;
  readonly map: TileborneMap;
  readonly pluginId: string | undefined;
  readonly builtModels: readonly BuiltPlayerModel[];
  readonly builtOverlays: readonly BuiltOverlayVisual[];
  readonly builtWeapons: readonly BuiltWeaponVisual[];
}) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }
    if (pluginId === undefined) {
      console.error('[playtest] active game mode does not declare capabilities.renderer');
      return undefined;
    }
    const basePlugin = resolvePlaytestPlugin(pluginId);
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
        // runtime-emitted player model ids can resolve to sprites; the model
        // atlases are loaded as runtime textures alongside the plugin defaults.
        if (builtModels.length > 0 || builtOverlays.length > 0 || builtWeapons.length > 0) {
          try {
            const [playerModels, overlayVisuals, weaponVisuals] = await Promise.all([
              builtModels.length > 0 ? assemblePlaytestPlayerModelConfig(builtModels) : undefined,
              builtOverlays.length > 0
                ? assemblePlaytestOverlayVisualConfig(builtOverlays)
                : undefined,
              builtWeapons.length > 0
                ? assemblePlaytestWeaponVisualConfig(builtWeapons)
                : undefined,
            ]);
            resolved = resolvePlaytestPlugin(pluginId, {
              ...(playerModels === undefined ? {} : { playerModels }),
              ...(overlayVisuals === undefined ? {} : { overlayVisuals }),
              ...(weaponVisuals === undefined ? {} : { weaponVisuals }),
            });
          } catch (error) {
            console.error('[playtest] failed to load playtest visual atlases', error);
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
  }, [
    containerRef,
    map,
    pluginId,
    projectId,
    runtimeRef,
    builtModels,
    builtOverlays,
    builtWeapons,
  ]);
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
    let disposed = false;
    void window.tileborne.runtime
      .playtestSnapshot({ sessionId: sessionId as PlaytestSessionId })
      .then((snapshot) => {
        if (disposed || snapshot.frame === undefined) {
          return;
        }
        const decoded = plugin.decodeServerFrame(snapshot.frame);
        if (decoded !== undefined) {
          store.apply(decoded);
        }
      })
      .catch((error) => {
        console.error('[playtest] failed to seed runtime snapshot', error);
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
      runtime.controller.setCamera(fixedZoom, cx - camera.x * fixedZoom, cy - camera.y * fixedZoom);

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
      disposed = true;
      cancelAnimationFrame(rafHandle);
      unsubscribe();
    };
  }, [containerRef, map.size.height, map.size.width, pluginId, runtimeRef, sessionId]);
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
  // Prefer the manifest-DISCOVERED HUD layout of the active mode (the
  // `gameModes` IPC carries the decoded `runtime.hudLayouts` data) so an
  // installed third-party mode's HUD arrangement applies without a bundled
  // code default; the bridge falls back to its bundled default otherwise.
  const contributionsQuery = usePluginContributions();
  const activeMode = contributionsQuery.data?.gameModes.find((mode) => mode.pluginId === pluginId);
  const rendererKey = activeMode?.rendererCapabilityId;
  const manifestHudLayout = activeMode?.hudLayout;
  // The project's designer-authored HUD overlay sits between the plugin
  // default and the player's personal overlay (`pluginDefault ⊕ project ⊕ player`).
  const projectQuery = useProject(projectId);
  const audioQuery = useProjectAudio(projectId);
  const shellQuery = useProjectGameShell(projectId);
  const dispatchedGameplayAudioKeysRef = useRef(new Set<string>());
  const projectHudLayout = readProjectHudLayout(projectQuery.data?.project);
  const projectAudio = useMemo(() => {
    const document = audioQuery.data?.document;
    if (document === undefined) return undefined;
    const projection = buildRuntimeAudioProjectionFromAuthoring(
      audioAuthoringStateFromDocument(document),
      {
        resolveSource: (source) => {
          if (source.url !== undefined) return source;
          if (source.path !== undefined) {
            return {
              ...source,
              url: source.path.startsWith('assets/') ? source.path : `assets/${source.path}`,
            };
          }
          return undefined;
        },
      },
    );
    return projection.cues.length === 0
      ? undefined
      : {
          buses: projection.buses,
          cues: projection.cues,
          settings: {
            ...projection.settings,
            busVolumes: projection.settings.busVolumes ?? {},
          },
        };
  }, [audioQuery.data?.document]);
  const shellProjection = useMemo(
    () => runtimeShellProjectionFromIpc(shellQuery.data?.projection),
    [shellQuery.data?.projection],
  );
  const shellCacheKey = `${projectId}:${map.id}`;
  const shellProjectionCacheRef = useRef<CachedShellProjection>({
    cacheKey: shellCacheKey,
    generation: 1,
    projection: undefined,
    source: undefined,
  });
  if (shellProjectionCacheRef.current.cacheKey !== shellCacheKey) {
    shellProjectionCacheRef.current = {
      cacheKey: shellCacheKey,
      generation: shellProjectionCacheRef.current.generation + 1,
      projection: undefined,
      source: undefined,
    };
  }
  if (shellProjection !== undefined) {
    shellProjectionCacheRef.current.projection = shellProjection;
    shellProjectionCacheRef.current.source = 'query';
  }
  const [fallbackShellProjection, setFallbackShellProjection] = useState<
    RuntimeGameShellProjection | undefined
  >(undefined);
  const [fallbackShellStatus, setFallbackShellStatus] = useState<ShellFallbackStatus>('idle');
  const [fallbackShellError, setFallbackShellError] = useState<string | undefined>(undefined);
  useEffect(() => {
    setFallbackShellProjection(undefined);
    setFallbackShellStatus('idle');
    setFallbackShellError(undefined);
  }, [shellCacheKey]);
  useEffect(() => {
    if (shellProjection !== undefined) {
      setFallbackShellStatus('idle');
      setFallbackShellError(undefined);
    }
  }, [shellProjection]);
  const [hudOverlayVersion, setHudOverlayVersion] = useState(0);
  const rendererResolution = useMemo(
    () => {
      if (rendererKey === undefined) {
        return {
          error:
            'Active game mode does not declare capabilities.renderer; update contributes.gameModes before playtest.',
        } as const;
      }
      try {
        return {
          plugin: resolvePlaytestPlugin(rendererKey, {
            ...(manifestHudLayout === undefined ? {} : { manifestHudLayout }),
            ...(projectHudLayout === undefined ? {} : { projectHudLayout }),
          }),
        } as const;
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) } as const;
      }
    },
    // hudOverlayVersion re-resolves after the HUD editor persists an overlay.
    [rendererKey, manifestHudLayout, projectHudLayout, hudOverlayVersion],
  );
  const resolvedPlugin = 'plugin' in rendererResolution ? rendererResolution.plugin : undefined;
  const rendererError = 'error' in rendererResolution ? rendererResolution.error : undefined;
  const bumpHudOverlayVersion = useCallback(
    () => setHudOverlayVersion((version) => version + 1),
    [],
  );
  const hudEditing = useHudEditing({
    baseLayout: resolvedPlugin?.hudLayout,
    project: projectQuery.data?.project,
    scopeId: `map:${projectId}:${map.id}`,
    onPersisted: bumpHudOverlayVersion,
  });
  const hudInsets = resolvedPlugin?.manifest.hudInsets;
  const { builtModels, selectedModelId } = usePlaytestPlayerModels(projectId, map);
  const { builtOverlays } = usePlaytestOverlayVisuals(projectId);
  const { builtWeapons } = usePlaytestWeaponVisuals(projectId);
  const [shellMatchStarted, setShellMatchStarted] = useState(false);
  const [shellRetryEpoch, setShellRetryEpoch] = useState(() =>
    pendingShellRetryKeys.has(shellCacheKey) ? 1 : 0,
  );
  const ignoredShellGameOverRef = useRef<unknown | undefined>(undefined);
  useEffect(() => {
    pendingShellRetryKeys.delete(shellCacheKey);
  }, [shellCacheKey]);
  const playtestHudMetrics = session?.runtimeMetrics
    ? {
        playerCount: session.runtimeMetrics.playerCount,
        tickCount: session.runtimeMetrics.tickCount,
        hud: session.runtimeMetrics.hud
          ? {
              totalPlayers: session.runtimeMetrics.hud.totalPlayers,
              gameplayEvents: [...session.runtimeMetrics.hud.gameplayEvents],
              ...(session.runtimeMetrics.hud.localPlayer
                ? { localPlayer: session.runtimeMetrics.hud.localPlayer }
                : {}),
              ...(session.runtimeMetrics.hud.zoneStatus
                ? { zoneStatus: session.runtimeMetrics.hud.zoneStatus }
                : {}),
              ...(session.runtimeMetrics.hud.scoreboard
                ? { scoreboard: session.runtimeMetrics.hud.scoreboard }
                : {}),
              ...(session.runtimeMetrics.hud.minimap
                ? { minimap: session.runtimeMetrics.hud.minimap }
                : {}),
              ...(session.runtimeMetrics.hud.gameOver
                ? { gameOver: session.runtimeMetrics.hud.gameOver }
                : {}),
            }
          : undefined,
      }
    : undefined;
  const currentShellGameOver = session?.runtimeMetrics?.hud?.gameOver;
  const currentShellScoreboard = session?.runtimeMetrics?.hud?.scoreboard;
  const shellGameOver =
    shellMatchStarted && currentShellGameOver !== ignoredShellGameOverRef.current
      ? currentShellGameOver
      : undefined;
  const shellResults = shellGameOver
    ? {
        title: 'Results',
        rows:
          currentShellScoreboard?.map((entry, index) => ({
            rank: index + 1,
            name: entry.displayName,
            score: entry.kills,
          })) ?? [],
      }
    : undefined;
  const shellHudMetrics =
    shellGameOver === undefined
      ? undefined
      : playtestHudMetrics === undefined
        ? undefined
        : {
            ...playtestHudMetrics,
            hud:
              playtestHudMetrics.hud === undefined
                ? undefined
                : {
                    ...playtestHudMetrics.hud,
                    gameOver: shellGameOver,
                  },
          };
  const stopPlaytestRef = useRef(stop);
  useEffect(() => {
    stopPlaytestRef.current = stop;
  }, [stop]);
  const playtestOwner = useMemo(
    () => ({ sessionId, projectId, mapId: map.id }),
    [map.id, projectId, sessionId],
  );
  const playtestOwnerKey = `${sessionId}\u0000${projectId}\u0000${map.id}`;
  const stopCurrentPlaytest = useCallback(() => {
    return stopPlaytestRef.current(playtestOwner);
  }, [playtestOwner]);
  const pendingPlaytestOwnerDisposalsRef = useRef(new Map<string, PendingPlaytestOwnerDisposal>());
  useEffect(() => {
    const pendingDisposal = pendingPlaytestOwnerDisposalsRef.current.get(playtestOwnerKey);
    if (pendingDisposal !== undefined) {
      pendingDisposal.cancel();
      pendingPlaytestOwnerDisposalsRef.current.delete(playtestOwnerKey);
    }

    return () => {
      const pendingDisposal = pendingPlaytestOwnerDisposalsRef.current.get(playtestOwnerKey);
      if (pendingDisposal !== undefined) {
        pendingDisposal.cancel();
      }

      let cancelled = false;
      const cancel = () => {
        cancelled = true;
      };
      queueMicrotask(() => {
        if (
          cancelled ||
          pendingPlaytestOwnerDisposalsRef.current.get(playtestOwnerKey)?.cancel !== cancel
        ) {
          return;
        }
        pendingPlaytestOwnerDisposalsRef.current.delete(playtestOwnerKey);
        const stopOwnedPlaytest = () => stopPlaytestRef.current(playtestOwner);
        void stopOwnedPlaytest().catch(() => stopOwnedPlaytest().catch(() => undefined));
      });
      pendingPlaytestOwnerDisposalsRef.current.set(playtestOwnerKey, {
        ownerKey: playtestOwnerKey,
        cancel,
      });
    };
  }, [playtestOwner, playtestOwnerKey]);
  const startCurrentPlaytest = useCallback(async () => {
    await start(
      projectId,
      map.id,
      selectedModelId === undefined ? {} : { selectedPlayerModelId: selectedModelId },
    );
  }, [map.id, projectId, selectedModelId, start]);
  const restartCurrentPlaytest = useCallback(async () => {
    ignoredShellGameOverRef.current = currentShellGameOver;
    setShellMatchStarted(false);
    pendingShellRetryKeys.add(shellCacheKey);
    setShellRetryEpoch((epoch) => epoch + 1);
    await stopCurrentPlaytest();
    await startCurrentPlaytest();
  }, [currentShellGameOver, shellCacheKey, startCurrentPlaytest, stopCurrentPlaytest]);
  const exitCurrentPlaytest = useCallback(() => {
    void stopCurrentPlaytest().catch(() => undefined);
  }, [stopCurrentPlaytest]);
  const controlCurrentPlaytestLifecycle = useCallback(
    async (command: 'start' | 'pause' | 'resume') => {
      if (!sessionId) {
        throw new Error('Cannot control playtest lifecycle without an active session.');
      }
      const response = await window.tileborne.playtest.lifecycleControl({
        sessionId: sessionId as PlaytestSessionId,
        command,
      });
      const expectedStatus = command === 'pause' ? 'paused' : 'running';
      if (response.status !== expectedStatus) {
        throw new Error(
          `Playtest lifecycle ${command} returned ${response.status}; expected ${expectedStatus}.`,
        );
      }
    },
    [sessionId],
  );
  const noopShellEffect = useCallback(() => undefined, []);
  const runtimeInitialState = useMemo(
    () => ({ ...initialMenuState, phase: 'menu' as const, screen: 'main' as const }),
    [],
  );
  const shellInitialState = useMemo(
    () =>
      shellRetryEpoch === 0
        ? runtimeInitialState
        : { ...initialMenuState, phase: 'lobby' as const, screen: 'main' as const },
    [runtimeInitialState, shellRetryEpoch],
  );
  const [shellNavigationRequests, setShellNavigationRequests] = useState<
    NonNullable<RuntimeShellBehaviorBridge['shellNavigationRequests']>
  >([]);
  const currentShellSessionIdRef = useRef(sessionId);
  currentShellSessionIdRef.current = sessionId;
  const playtestShellBridge = useMemo<RuntimeShellBehaviorBridge>(
    () => ({
      shellNavigationRequests,
      emitShellEvent: (event) => {
        const requestSessionId = sessionId;
        void window.tileborne.playtest
          .shellEvent({ sessionId: requestSessionId as PlaytestSessionId, event })
          .then((response) => {
            if (currentShellSessionIdRef.current !== requestSessionId) {
              return;
            }
            setShellNavigationRequests((current) => {
              const epoch = requestSessionId;
              const seen = new Set(current.map((entry) => `${entry.epoch}:${entry.sequence}`));
              const next = [...current];
              for (const entry of response.requests) {
                const key = `${epoch}:${entry.sequence}`;
                if (seen.has(key)) continue;
                seen.add(key);
                next.push({
                  epoch,
                  sequence: entry.sequence,
                  sourceEvent: event,
                  request: entry.request,
                });
              }
              return next.length === current.length ? current : next;
            });
          })
          .catch(() => undefined);
      },
    }),
    [sessionId, shellNavigationRequests],
  );
  useEffect(() => {
    setShellNavigationRequests([]);
    setShellMatchStarted(false);
    ignoredShellGameOverRef.current = undefined;
    dispatchedGameplayAudioKeysRef.current.clear();
  }, [sessionId]);
  if (
    shellProjectionCacheRef.current.projection === undefined &&
    fallbackShellProjection !== undefined
  ) {
    shellProjectionCacheRef.current.projection = fallbackShellProjection;
    shellProjectionCacheRef.current.source = 'fallback';
  }
  const cachedShellProjection = shellProjectionCacheRef.current.projection;
  const cachedShellProjectionSource = shellProjectionCacheRef.current.source;
  const displayedShellProjection = shellProjection ?? cachedShellProjection;
  const playtestHudOverlayMetrics =
    displayedShellProjection === undefined ||
    currentShellGameOver === undefined ||
    playtestHudMetrics?.hud === undefined
      ? playtestHudMetrics
      : (() => {
          const { gameOver, ...hudWithoutGameOver } = playtestHudMetrics.hud;
          void gameOver;
          return {
            ...playtestHudMetrics,
            hud: hudWithoutGameOver,
          };
        })();
  useEffect(() => {
    if (displayedShellProjection !== undefined || projectId.length === 0) return;
    let cancelled = false;
    const open = window.tileborne?.gameShell?.open;
    if (open === undefined) {
      setFallbackShellStatus('error');
      setFallbackShellError('Game shell IPC bridge is unavailable in the playtest renderer.');
      return;
    }
    setFallbackShellStatus('pending');
    setFallbackShellError(undefined);
    const timeout = window.setTimeout(() => {
      if (cancelled) return;
      setFallbackShellStatus('timeout');
      setFallbackShellError(
        `Game shell projection did not resolve within ${SHELL_FALLBACK_TIMEOUT_MS}ms.`,
      );
    }, SHELL_FALLBACK_TIMEOUT_MS);
    void open({ projectId: projectId as ProjectId })
      .then((response) => {
        if (cancelled) return;
        window.clearTimeout(timeout);
        const projection = runtimeShellProjectionFromIpc(response.projection);
        if (projection !== undefined) {
          setFallbackShellProjection(projection);
          setFallbackShellStatus('success');
          return;
        }
        setFallbackShellStatus('invalid');
        setFallbackShellError('Game shell IPC returned no decodable projection.');
      })
      .catch((error) => {
        if (cancelled) return;
        window.clearTimeout(timeout);
        setFallbackShellStatus('error');
        setFallbackShellError(formatShellError(error));
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [displayedShellProjection, projectId]);
  const shellQueryError =
    shellQuery.error === null || shellQuery.error === undefined
      ? undefined
      : formatShellError(shellQuery.error);
  const shellUnavailableMessage =
    displayedShellProjection !== undefined
      ? undefined
      : fallbackShellStatus === 'timeout'
        ? fallbackShellError
        : fallbackShellStatus === 'error'
          ? fallbackShellError
          : fallbackShellStatus === 'invalid'
            ? fallbackShellError
            : shellQueryError;
  const shellProjectionState =
    displayedShellProjection === undefined
      ? shellUnavailableMessage !== undefined
        ? 'unavailable'
        : shellQuery.data === undefined
          ? 'loading'
          : 'invalid'
      : shellProjection === undefined
        ? cachedShellProjectionSource === 'fallback'
          ? 'fallback'
          : 'retained'
        : 'fresh';
  const shellRuntimeRootState =
    displayedShellProjection === undefined
      ? shellUnavailableMessage === undefined
        ? 'loading'
        : 'unavailable'
      : 'mounted';
  const shellAssetUrlResolver = useCallback(
    (asset: NonNullable<typeof displayedShellProjection>['assets'][number]) =>
      assetProtocolUrl(asset.packId, asset.path, asset.packVersion),
    [],
  );
  const canStartPlaytestRuntime = displayedShellProjection !== undefined;
  const renderPlaytestLobby = useCallback(
    ({
      matchmaking,
      onStartMatch,
      onBack,
    }: Parameters<NonNullable<RuntimeRootProps['renderLobby']>>[0]) => {
      const debugWindow = window as PlaytestShellDebugWindow;
      if (debugWindow.__tileborneShellDebug !== undefined) {
        debugWindow.__tileborneShellDebug.renderLobbyCount =
          (debugWindow.__tileborneShellDebug.renderLobbyCount ?? 0) + 1;
      }
      return (
        <div className="tb-menu-card tb-lobby-panel" data-testid="playtest-shell-lobby">
          <p className="tb-label">Local playtest</p>
          <h2>Lobby</h2>
          <p className="tb-tagline">
            {matchmaking ? 'Starting session...' : 'Ready to enter the active playtest.'}
          </p>
          <div className="tb-menu-actions">
            <Button
              type="button"
              size="lg"
              onClick={onStartMatch}
              data-testid="playtest-shell-start-match"
            >
              Start Match
            </Button>
            <Button type="button" variant="outline" size="lg" onClick={onBack}>
              Back
            </Button>
          </div>
        </div>
      );
    },
    [],
  );
  const runtimeShellElement = useMemo(
    () =>
      displayedShellProjection === undefined ? (
        shellUnavailableMessage === undefined ? (
          <div
            role="status"
            className="tb-scrim tb-shell-screen tb-shell-layout-center"
            data-testid="shell-screen-loading"
          >
            <div className="tb-panel">
              <p className="tb-tagline">Loading shell</p>
            </div>
          </div>
        ) : (
          <div
            role="alert"
            className="tb-scrim tb-shell-screen tb-shell-layout-center"
            data-testid="shell-screen-unavailable"
          >
            <div className="tb-panel">
              <p className="tb-label">Shell unavailable</p>
              <p className="tb-tagline">{shellUnavailableMessage}</p>
            </div>
          </div>
        )
      ) : (
        <InstrumentedRuntimeRoot
          key={`${shellCacheKey}:${shellRetryEpoch}`}
          generation={shellProjectionCacheRef.current.generation}
          reason={`cache:${shellCacheKey}:${cachedShellProjectionSource ?? 'none'}`}
          projectId={projectId}
          mapId={map.id}
          sessionId={sessionId}
          canvas={null}
          initialState={shellInitialState}
          shellProjection={displayedShellProjection}
          shellAssetUrlResolver={shellAssetUrlResolver}
          shellBridge={playtestShellBridge}
          {...(projectAudio === undefined
            ? {}
            : { audio: { ...projectAudio, onChange: noopShellEffect } })}
          {...(shellHudMetrics === undefined ? {} : { hudMetrics: shellHudMetrics })}
          {...(shellResults === undefined ? {} : { results: shellResults })}
          onPlay={noopShellEffect}
          onMatchStart={async () => {
            await controlCurrentPlaytestLifecycle('start');
            ignoredShellGameOverRef.current = currentShellGameOver;
            setShellMatchStarted(true);
          }}
          onPause={() => controlCurrentPlaytestLifecycle('pause')}
          onResume={() => controlCurrentPlaytestLifecycle('resume')}
          onPlayAgain={() => {
            void restartCurrentPlaytest();
          }}
          onExitToMenu={exitCurrentPlaytest}
          onQuit={stopCurrentPlaytest}
          renderLobby={renderPlaytestLobby}
        />
      ),
    [
      displayedShellProjection,
      cachedShellProjectionSource,
      controlCurrentPlaytestLifecycle,
      currentShellGameOver,
      exitCurrentPlaytest,
      map.id,
      noopShellEffect,
      playtestShellBridge,
      projectId,
      projectAudio,
      renderPlaytestLobby,
      restartCurrentPlaytest,
      runtimeInitialState,
      shellInitialState,
      shellRetryEpoch,
      shellAssetUrlResolver,
      shellCacheKey,
      shellUnavailableMessage,
      shellHudMetrics,
      shellResults,
      sessionId,
      stopCurrentPlaytest,
    ],
  );

  usePlaytestRuntimeMount({
    containerRef,
    runtimeRef,
    projectId,
    map,
    pluginId: canStartPlaytestRuntime ? rendererKey : undefined,
    builtModels,
    builtOverlays,
    builtWeapons,
  });
  usePlaytestSnapshotRenderer({
    containerRef,
    runtimeRef,
    map,
    pluginId: canStartPlaytestRuntime ? rendererKey : undefined,
    sessionId,
  });

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
    pluginId: canStartPlaytestRuntime ? rendererKey : undefined,
    sessionId,
    tickCount: session?.runtimeMetrics?.tickCount,
    projectAudio,
  });

  useEffect(() => {
    const pluginAudioCues = resolvedPlugin?.audio?.cues ?? [];
    dispatchGameplayLifecycleAudioEvents({
      engine: window.__tilebornePlaytestAudio,
      cues: [...pluginAudioCues, ...(projectAudio?.cues ?? [])],
      events: session?.runtimeMetrics?.hud?.sequencedGameplayEvents ?? [],
      seenKeys: dispatchedGameplayAudioKeysRef.current,
    });
  }, [
    projectAudio?.cues,
    resolvedPlugin?.audio?.cues,
    session?.runtimeMetrics?.hud?.sequencedGameplayEvents,
  ]);

  if (rendererError !== undefined) {
    return (
      <div className="absolute inset-0 z-20 grid place-items-center bg-background/95 p-6">
        <p role="alert" className="max-w-xl text-sm text-destructive">
          {rendererError}
        </p>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-20 flex min-h-0 flex-col bg-background/95 backdrop-blur-sm">
      <PlaytestOverlay
        sessionId={sessionId}
        activePlugins={activePlugins}
        session={session}
        isStopping={isStopping}
        onStop={stopCurrentPlaytest}
      />
      <div className="relative min-h-0 flex-1">
        <div
          ref={containerRef}
          className="absolute inset-0 outline-none"
          data-testid="playtest-viewport"
          tabIndex={0}
        />
        <PlaytestHudOverlay
          metrics={playtestHudOverlayMetrics}
          projectId={projectId}
          mapId={map.id}
          isRestarting={isStarting || isStopping}
          onBackToEditor={stopCurrentPlaytest}
          onPlayAgain={async (nextProjectId, nextMapId) => {
            await stopCurrentPlaytest();
            await start(
              nextProjectId,
              nextMapId,
              selectedModelId === undefined ? {} : { selectedPlayerModelId: selectedModelId },
            );
          }}
          {...(hudInsets ? { hudInsets } : {})}
          {...(hudEditing.layout !== undefined
            ? { layout: hudEditing.layout }
            : resolvedPlugin
              ? { layout: resolvedPlugin.hudLayout }
              : {})}
          editing={hudEditing.editing}
          onMoveWidget={hudEditing.moveWidget}
        />
        <div
          className={cn('tb-runtime-shell-host absolute inset-0 z-30 pointer-events-auto')}
          data-testid="playtest-runtime-shell"
          data-shell-query-status={shellQuery.status}
          data-shell-query-fetch-status={shellQuery.fetchStatus}
          data-shell-query-error={shellQueryError}
          data-shell-fallback-status={fallbackShellStatus}
          data-shell-fallback-error={fallbackShellError}
          data-shell-projection-state={shellProjectionState}
          data-shell-runtime-root-state={shellRuntimeRootState}
          data-shell-session-state={session?.status ?? 'missing'}
          data-shell-renderer-key={rendererKey ?? 'missing'}
          data-shell-cache-key={shellCacheKey}
          data-shell-projection-source={cachedShellProjectionSource ?? 'none'}
          data-shell-host-generation={String(shellProjectionCacheRef.current.generation)}
        >
          {runtimeShellElement}
        </div>
        {resolvedPlugin && !hudEditing.editing ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="absolute right-3 top-3 z-40 bg-background/85 backdrop-blur-sm"
            onClick={hudEditing.start}
            data-testid="playtest-hud-edit-toggle"
          >
            <PencilRulerIcon className="size-3.5" />
            Edit HUD
          </Button>
        ) : null}
        {hudEditing.editing && hudEditing.layout !== undefined ? (
          <PlaytestHudEditor
            layout={hudEditing.layout}
            onSetAnchor={hudEditing.moveWidget}
            onSetEnabled={hudEditing.toggleWidget}
            onMoveOrder={hudEditing.reorderWidget}
            onSaveUser={hudEditing.saveForMe}
            onSaveProject={
              hudEditing.canSaveProject ? () => void hudEditing.saveToProject() : undefined
            }
            onResetUser={hudEditing.resetUser}
            onClose={hudEditing.close}
            isSaving={hudEditing.isSaving}
          />
        ) : null}
      </div>
    </div>
  );
}

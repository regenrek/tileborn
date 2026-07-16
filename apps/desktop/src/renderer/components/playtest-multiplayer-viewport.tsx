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
import type { RoomLobbySummary } from '@tileborne/game-client';
import { Button } from '@tileborne/ui';
import { PencilRulerIcon } from 'lucide-react';
import {
  interpolateRenderableEntities,
  PixiRendererAdapter,
  SnapshotEntityStore,
  type RenderableEntity,
  type RenderableEntityProjector,
} from '@tileborne/runtime';
import { Effect } from 'effect';

import { PlaytestHudEditor } from '@/components/playtest-hud-editor';
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
import { attachPlaytestInputCapture } from '@/lib/playtest-input';
import {
  resolvePlaytestPlugin,
  type InputDirection,
  type ResolvedPlaytestPlugin,
} from '@/lib/playtest-plugin-bridge';
import { usePluginContributions, useProject } from '@/hooks/queries';
import { useHudEditing } from '@/hooks/use-hud-editing';
import {
  assemblePlaytestOverlayVisualConfig,
  assemblePlaytestPlayerModelConfig,
  assemblePlaytestWeaponVisualConfig,
  usePlaytestPlayerModels,
  usePlaytestOverlayVisuals,
  usePlaytestWeaponVisuals,
} from '@/hooks/use-playtest-player-models';
import { resolveProjectActiveGameMode } from '@/lib/active-game-mode-selection';
import { readProjectHudLayout } from '@/lib/project-hud-layout';
import type { BuiltPlayerModel } from '@/lib/player-model-render';
import type { BuiltOverlayVisual } from '@/lib/overlay-visual-render';
import type { BuiltWeaponVisual } from '@/lib/weapon-visual-render';
import type { PlaytestMultiplayerClient } from '@/lib/playtest-multiplayer-client';
import type {
  LocalMultiplayerParticipantSession,
  LocalMultiplayerRoomResults,
} from '@/lib/playtest-room-url';
import { multiplayerStateToConnectionInput } from '@/lib/playtest-multiplayer-status';
import { usePlaytestMultiplayerStore } from '@/stores/playtest-multiplayer-store';
import { useEditorUiStore } from '@/stores/editor-ui-store';

interface PlaytestMultiplayerViewportProps {
  readonly projectId: string;
  readonly map: TileborneMap;
}

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
  ...(entity.scale === undefined ? {} : { scale: entity.scale * fixedZoom }),
  scaleX: (entity.scaleX ?? entity.scale ?? 1) * fixedZoom,
  scaleY: (entity.scaleY ?? entity.scale ?? 1) * fixedZoom,
});

function useMultiplayerRuntimeMount({
  containerRef,
  runtimeRef,
  projectId,
  map,
  rendererCapabilityId,
  builtModels,
  builtOverlays,
  builtWeapons,
}: {
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly runtimeRef: MutableRefObject<RuntimeBundle | null>;
  readonly projectId: string;
  readonly map: TileborneMap;
  readonly rendererCapabilityId: string | undefined;
  readonly builtModels: readonly BuiltPlayerModel[];
  readonly builtOverlays: readonly BuiltOverlayVisual[];
  readonly builtWeapons: readonly BuiltWeaponVisual[];
}) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }
    // ADR-0023 section B: the manifest-declared renderer capability is the sole
    // bridge key. Plugin ids are metadata and never act as runtime aliases.
    if (rendererCapabilityId === undefined) {
      return undefined;
    }
    const basePlugin = resolvePlaytestPlugin(rendererCapabilityId);
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
        // Resolve the projector with the roster models so runtime-emitted model
        // ids can resolve to sprites. The server owns per-player selection.
        if (builtModels.length > 0 || builtOverlays.length > 0 || builtWeapons.length > 0) {
          try {
            const [playerModels, overlayVisuals, weaponVisuals] = await Promise.all([
              builtModels.length > 0 ? assemblePlaytestPlayerModelConfig(builtModels) : undefined,
              builtOverlays.length > 0 ? assemblePlaytestOverlayVisualConfig(builtOverlays) : undefined,
              builtWeapons.length > 0
                ? assemblePlaytestWeaponVisualConfig(builtWeapons)
                : undefined,
            ]);
            resolved = resolvePlaytestPlugin(rendererCapabilityId, {
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
  }, [containerRef, map, projectId, runtimeRef, rendererCapabilityId, builtModels, builtOverlays, builtWeapons]);
}

function useMultiplayerSnapshotRenderer({
  client,
  containerRef,
  runtimeRef,
  map,
  rendererCapabilityId,
}: {
  readonly client: PlaytestMultiplayerClient | null;
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly runtimeRef: MutableRefObject<RuntimeBundle | null>;
  readonly map: TileborneMap;
  readonly rendererCapabilityId: string | undefined;
}) {
  useEffect(() => {
    if (!client || rendererCapabilityId === undefined) {
      return undefined;
    }
    const plugin = resolvePlaytestPlugin(rendererCapabilityId);
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
  }, [client, containerRef, map.size.height, map.size.width, runtimeRef, rendererCapabilityId]);
}

function useMultiplayerInputBridge({
  client,
  containerRef,
  rendererCapabilityId,
  enabled,
}: {
  readonly client: PlaytestMultiplayerClient | null;
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly rendererCapabilityId: string | undefined;
  readonly enabled: boolean;
}) {
  useEffect(() => {
    if (!enabled || !client || rendererCapabilityId === undefined) {
      return undefined;
    }
    // Remap-apply policy (ADR-0024): remaps persisted by the Controls UI apply
    // on the NEXT playtest session. `resolvePlaytestPlugin` reloads the LATEST
    // persisted overlay on each capture-attach (effect run), so a session always
    // starts on the freshest saved bindings; no live cross-surface wiring here.
    const plugin = resolvePlaytestPlugin(rendererCapabilityId);
    if (!plugin) {
      return undefined;
    }

    const handle = attachPlaytestInputCapture({
      container: containerRef.current,
      inputMap: plugin.inputMap,
      controlScheme: plugin.controlScheme,
      profile: plugin.inputCaptureProfile,
      resolveIntent: plugin.resolveInputIntent,
      onIntent: (intent) => {
        client.sendInput(intent.dir as InputDirection | undefined, intent.shoot, {
          reload: intent.reload,
          interact: intent.interact,
          drop: intent.drop,
          abilities: intent.abilities,
          ...(intent.aimDeg === undefined ? {} : { aimDeg: intent.aimDeg }),
          ...(intent.swapSlot === undefined ? {} : { swapSlot: intent.swapSlot }),
        });
      },
    });

    return () => {
      handle.dispose();
    };
  }, [client, containerRef, enabled, rendererCapabilityId]);
}

function MultiplayerLobbyOverlay({
  lobby,
  participant,
  results,
  isReadyPending,
  error,
  onSetReady,
  onBackToEditor,
}: {
  readonly lobby: RoomLobbySummary | null;
  readonly participant: LocalMultiplayerParticipantSession | null;
  readonly results: LocalMultiplayerRoomResults | null;
  readonly isReadyPending: boolean;
  readonly error: string | null;
  readonly onSetReady: (ready: boolean) => Promise<void>;
  readonly onBackToEditor: () => void | Promise<void>;
}) {
  if (lobby === null || lobby.phase === 'active') {
    return null;
  }

  const terminal = lobby.phase === 'finished' || lobby.phase === 'archived';
  const localPlayer = lobby.players.find(
    (player) => player.playerId === participant?.playerId,
  );
  const readyPlayers = lobby.players.filter((player) => player.ready).length;

  if (terminal) {
    return (
      <section
        className="absolute inset-0 z-50 grid place-items-center bg-background/80 p-6 backdrop-blur-sm"
        data-testid="multiplayer-results"
        aria-label="Multiplayer results"
      >
        <div className="w-full max-w-lg rounded-lg border bg-card p-5 shadow-xl">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Match finished
          </p>
          <h2 className="mt-1 text-xl font-semibold">Results</h2>
          {results === null ? (
            <p className="mt-3 text-sm text-muted-foreground">Final results are loading…</p>
          ) : (
            <>
              <p className="mt-2 text-sm text-muted-foreground">
                {results.reason ?? 'Match completed'}
              </p>
              <ol className="mt-4 space-y-2">
                {[...results.players]
                  .sort(
                    (left, right) =>
                      (left.placement ?? Number.MAX_SAFE_INTEGER) -
                        (right.placement ?? Number.MAX_SAFE_INTEGER) ||
                      left.playerId.localeCompare(right.playerId),
                  )
                  .map((player) => (
                    <li
                      key={player.playerId}
                      className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                    >
                      <span>
                        {player.placement === undefined ? '—' : `#${player.placement}`} ·{' '}
                        {player.playerId}
                      </span>
                      <span className="text-muted-foreground">
                        {player.outcome ?? 'finished'}
                        {player.score === undefined ? '' : ` · ${player.score} pts`}
                      </span>
                    </li>
                  ))}
              </ol>
            </>
          )}
          <Button className="mt-5 w-full" type="button" onClick={() => void onBackToEditor()}>
            Back to editor
          </Button>
        </div>
      </section>
    );
  }

  const canToggleReady =
    localPlayer !== undefined &&
    localPlayer.status === 'connected' &&
    (lobby.phase === 'lobby' || lobby.phase === 'countdown');

  return (
    <section
      className="absolute inset-0 z-50 grid place-items-center bg-background/75 p-6 backdrop-blur-sm"
      data-testid="multiplayer-lobby"
      aria-label="Multiplayer lobby"
    >
      <div className="w-full max-w-lg rounded-lg border bg-card p-5 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Room {lobby.roomId}
            </p>
            <h2 className="mt-1 text-xl font-semibold">
              {lobby.phase === 'countdown' ? 'Match starting…' : 'Ready lobby'}
            </h2>
          </div>
          <span className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground">
            {lobby.playerCount}/{lobby.maxPlayers} players
          </span>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {readyPlayers}/{lobby.minReadyPlayers} required players ready
        </p>
        <ul className="mt-4 space-y-2">
          {lobby.players.map((player) => (
            <li
              key={player.playerId}
              className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
              data-testid={`multiplayer-lobby-player-${player.playerId}`}
            >
              <span>
                {player.displayName ?? player.playerId}
                {player.playerId === participant?.playerId ? ' (you)' : ''}
              </span>
              <span className={player.ready ? 'text-emerald-500' : 'text-muted-foreground'}>
                {player.status === 'disconnected'
                  ? 'Disconnected'
                  : player.ready
                    ? 'Ready'
                    : 'Not ready'}
              </span>
            </li>
          ))}
        </ul>
        {error === null ? null : (
          <p className="mt-3 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <Button
          className="mt-5 w-full"
          type="button"
          data-testid="multiplayer-ready-toggle"
          aria-pressed={localPlayer?.ready ?? false}
          disabled={!canToggleReady || isReadyPending}
          onClick={() => void onSetReady(!(localPlayer?.ready ?? false)).catch(() => undefined)}
        >
          {isReadyPending
            ? 'Updating…'
            : localPlayer?.ready
              ? 'Unready'
              : 'Ready up'}
        </Button>
      </div>
    </section>
  );
}

export function PlaytestMultiplayerViewport({ projectId, map }: PlaytestMultiplayerViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<RuntimeBundle | null>(null);
  const showGrid = useEditorUiStore((state) => state.showGrid);
  const showDebugOverlay = useEditorUiStore((state) => state.showDebugOverlay);
  const showCollisionOverlay = useEditorUiStore((state) => state.showCollisionOverlay);
  const sessionState = usePlaytestMultiplayerStore((state) => state.sessionState);
  const client = usePlaytestMultiplayerStore((state) => state.client);
  const participantSession = usePlaytestMultiplayerStore((state) => state.participantSession);
  const lobbyState = usePlaytestMultiplayerStore((state) => state.lobbyState);
  const roomResults = usePlaytestMultiplayerStore((state) => state.roomResults);
  const roomReady = usePlaytestMultiplayerStore((state) => state.roomReady);
  const isReadyPending = usePlaytestMultiplayerStore((state) => state.isReadyPending);
  const lobbyError = usePlaytestMultiplayerStore((state) => state.lobbyError);
  const setLocalReady = usePlaytestMultiplayerStore((state) => state.setLocalReady);
  const leaveSession = usePlaytestMultiplayerStore((state) => state.leaveSession);
  const stopHosting = usePlaytestMultiplayerStore((state) => state.stopHosting);
  const exitMultiplayer = roomReady === null ? leaveSession : stopHosting;
  // ADR-0023 section B: the active game mode is discovered from the enabled
  // plugins' manifests (the `gameModes` IPC), then resolved through the
  // per-project active selection. Multi-mode projects intentionally do not
  // default to the first discovered mode, so the demo arena cannot drive a BR
  // map by accident. No battle-royale id literal selects the mode here.
  const contributionsQuery = usePluginContributions();
  const projectQuery = useProject(projectId);
  const activeMode = resolveProjectActiveGameMode(
    contributionsQuery.data?.gameModes ?? [],
    projectQuery.data?.project,
  );
  const activeModePluginId = activeMode?.pluginId;
  const rendererCapabilityId = activeMode?.rendererCapabilityId;
  // Resolve the active plugin once to expose its render manifest (fixedZoom,
  // hudInsets) and effective HUD layout (manifest-discovered default ⊕ user
  // overlay) to the JSX layer without piping it through refs. The render loop
  // re-resolves inside its own effect for lifecycle reasons.
  const manifestHudLayout = activeMode?.hudLayout;
  const projectHudLayout = readProjectHudLayout(projectQuery.data?.project);
  const [hudOverlayVersion, setHudOverlayVersion] = useState(0);
  const rendererResolution = useMemo((): {
    readonly plugin: ResolvedPlaytestPlugin | undefined;
    readonly error: string | undefined;
  } => {
    // This version is an explicit cache-buster: the resolver reads the latest
    // persisted HUD overlay from storage after the HUD editor saves it.
    void hudOverlayVersion;
    if (rendererCapabilityId === undefined) {
      return {
        plugin: undefined,
        error:
          activeMode === undefined
            ? 'Select an active game mode before starting multiplayer playtest.'
            : `Game mode ${activeMode.modeId} does not declare a rendererCapabilityId. Fix or reinstall the plugin manifest.`,
      };
    }
    try {
      return {
        plugin: resolvePlaytestPlugin(rendererCapabilityId, {
            ...(manifestHudLayout === undefined ? {} : { manifestHudLayout }),
            ...(projectHudLayout === undefined ? {} : { projectHudLayout }),
          }),
        error: undefined,
      };
    } catch (error) {
      return {
        plugin: undefined,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
    // hudOverlayVersion re-resolves after the HUD editor persists an overlay.
    [
      activeMode,
      rendererCapabilityId,
      manifestHudLayout,
      projectHudLayout,
      hudOverlayVersion,
    ],
  );
  const resolvedPlugin = rendererResolution.plugin;
  const usableRendererCapabilityId =
    rendererResolution.error === undefined ? rendererCapabilityId : undefined;
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
  const { builtModels } = usePlaytestPlayerModels(projectId, map);
  const { builtOverlays } = usePlaytestOverlayVisuals(projectId);
  const { builtWeapons } = usePlaytestWeaponVisuals(projectId);

  useMultiplayerRuntimeMount({
    containerRef,
    runtimeRef,
    projectId,
    map,
    rendererCapabilityId: usableRendererCapabilityId,
    builtModels,
    builtOverlays,
    builtWeapons,
  });
  useMultiplayerSnapshotRenderer({
    client,
    containerRef,
    runtimeRef,
    map,
    rendererCapabilityId: usableRendererCapabilityId,
  });
  useMultiplayerInputBridge({
    client,
    containerRef,
    rendererCapabilityId: usableRendererCapabilityId,
    enabled: lobbyState?.phase === 'active',
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
        activePlugins={activeModePluginId === undefined ? [] : [activeModePluginId]}
        session={multiplayerStateToConnectionInput(sessionState)}
        isStopping={false}
        onStop={exitMultiplayer}
      />
      <div className="relative min-h-0 flex-1">
        {rendererResolution.error !== undefined ? (
          <div
            className="absolute inset-x-4 top-4 z-50 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
            role="alert"
          >
            {rendererResolution.error}
          </div>
        ) : null}
        <div
          ref={containerRef}
          className="absolute inset-0 outline-none"
          data-testid="playtest-multiplayer-canvas"
          tabIndex={0}
        />
        <MultiplayerLobbyOverlay
          lobby={lobbyState}
          participant={participantSession}
          results={roomResults}
          isReadyPending={isReadyPending}
          error={lobbyError}
          onSetReady={setLocalReady}
          onBackToEditor={exitMultiplayer}
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
          {...(sessionState === null
            ? {}
            : { localPlayerId: sessionState.localPlayerId })}
          onBackToEditor={exitMultiplayer}
          onPlayAgain={exitMultiplayer}
          {...(hudInsets ? { hudInsets } : {})}
          {...(hudEditing.layout !== undefined
            ? { layout: hudEditing.layout }
            : resolvedPlugin
              ? { layout: resolvedPlugin.hudLayout }
              : {})}
          editing={hudEditing.editing}
          onMoveWidget={hudEditing.moveWidget}
        />
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

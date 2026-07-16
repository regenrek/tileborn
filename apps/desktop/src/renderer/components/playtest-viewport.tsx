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
import { Button } from '@tileborne/ui';
import { PencilRulerIcon } from 'lucide-react';
import type { PlaytestSessionId } from '@tileborne/services-build';
import {
  defaultRuntimeAudioSettings,
  interpolateRenderableEntities,
  PixiRendererAdapter,
  SnapshotEntityStore,
  type RenderableEntity,
  type RenderableEntityProjector,
} from '@tileborne/runtime';
import {
  bindBrowserRuntimeAudioFocusState,
  createBrowserRuntimeAudioEngine,
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
import { usePlaytestSessions, usePluginContributions, useProject } from '@/hooks/queries';
import { useHudEditing } from '@/hooks/use-hud-editing';
import { readProjectHudLayout } from '@/lib/project-hud-layout';
import { usePlaytestControls } from '@/hooks/use-playtest-controls';
import { attachPlaytestInputCapture } from '@/lib/playtest-input';
import { resolvePlaytestPlugin, type ResolvedPlaytestPlugin } from '@/lib/playtest-plugin-bridge';
import {
  assemblePlaytestOverlayVisualConfig,
  assemblePlaytestPlayerModelConfig,
  assemblePlaytestWeaponVisualConfig,
  usePlaytestPlayerModels,
  usePlaytestOverlayVisuals,
  usePlaytestWeaponVisuals,
} from '@/hooks/use-playtest-player-models';
import type { BuiltPlayerModel } from '@/lib/player-model-render';
import type { BuiltOverlayVisual } from '@/lib/overlay-visual-render';
import type { BuiltWeaponVisual } from '@/lib/weapon-visual-render';
import { useEditorUiStore } from '@/stores/editor-ui-store';

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
  ...(entity.scale === undefined ? {} : { scale: entity.scale * fixedZoom }),
  scaleX: (entity.scaleX ?? entity.scale ?? 1) * fixedZoom,
  scaleY: (entity.scaleY ?? entity.scale ?? 1) * fixedZoom,
});

const findLocalPlayerEntity = (
  entities: readonly RenderableEntity[],
): RenderableEntity | undefined => entities.find((entity) => entity.id.startsWith('br:player:'));

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
    // Remap-apply policy (ADR-0024): a keybind remap is persisted by the
    // Controls UI (a separate player-settings surface) to the shared overlay
    // store; the desktop playtest has no in-session Controls UI to wire a live
    // `handle.setEffectiveMap` to, so remaps apply on the NEXT playtest session.
    // `resolvePlaytestPlugin` reloads the LATEST persisted overlay every time
    // this effect (re)runs — i.e. on each capture-attach — so a session always
    // starts on the freshest saved bindings. The live `setEffectiveMap` seam
    // stays available for a future same-surface remap UI.
    const plugin = resolvePlaytestPlugin(pluginId);
    const audioEngine =
      plugin.audio === undefined
        ? undefined
        : createBrowserRuntimeAudioEngine({
            buses: plugin.audio.buses,
            cues: plugin.audio.cues,
            settings: defaultRuntimeAudioSettings(),
          });
    const unbindAudioFocusState =
      audioEngine === undefined ? undefined : bindBrowserRuntimeAudioFocusState(audioEngine);
    if (audioEngine !== undefined) {
      window.__tilebornePlaytestAudio = audioEngine;
    }
    let seq = 0;
    let previousIntent: ReturnType<ResolvedPlaytestPlugin['resolveInputIntent']> | undefined;

    const handle = attachPlaytestInputCapture({
      container: containerRef.current,
      inputMap: plugin.inputMap,
      controlScheme: plugin.controlScheme,
      profile: plugin.inputCaptureProfile,
      resolveIntent: plugin.resolveInputIntent,
      onIntent: (intent) => {
        seq += 1;
        const audioCueId = plugin.audio?.cueForIntent(intent, previousIntent);
        if (audioCueId !== undefined) {
          audioEngine?.playCue(audioCueId);
        }
        previousIntent = intent;
        const idle =
          intent.dir === undefined &&
          !intent.shoot &&
          !intent.reload &&
          !intent.interact &&
          !intent.drop &&
          intent.abilities.length === 0 &&
          intent.swapSlot === undefined;
        const payload = {
          sessionId: sessionId as PlaytestSessionId,
          playerId: LOCAL_PLAYER_INPUT_ID,
          tick: tickCountRef.current ?? 0,
          seq,
          ...(intent.dir === undefined ? {} : { dir: intent.dir }),
          shoot: intent.shoot,
          reload: intent.reload,
          interact: intent.interact,
          drop: intent.drop,
          abilities: [...intent.abilities],
          ...(intent.aimDeg === undefined ? {} : { aimDeg: intent.aimDeg }),
          ...(intent.swapSlot === undefined ? {} : { swapSlot: intent.swapSlot }),
          ...(idle ? { active: false } : {}),
        };
        void window.tileborne.runtime.playtestInput(payload);
      },
    });

    return () => {
      handle.dispose();
      unbindAudioFocusState?.();
      if (window.__tilebornePlaytestAudio === audioEngine) {
        window.__tilebornePlaytestAudio = undefined;
      }
      audioEngine?.dispose();
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
  const projectHudLayout = readProjectHudLayout(projectQuery.data?.project);
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

  usePlaytestRuntimeMount({
    containerRef,
    runtimeRef,
    projectId,
    map,
    pluginId: rendererKey,
    builtModels,
    builtOverlays,
    builtWeapons,
  });
  usePlaytestSnapshotRenderer({
    containerRef,
    runtimeRef,
    map,
    pluginId: rendererKey,
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
    pluginId: rendererKey,
    sessionId,
    tickCount: session?.runtimeMetrics?.tickCount,
  });

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
              : undefined
          }
          projectId={projectId}
          mapId={map.id}
          isRestarting={isStarting || isStopping}
          onBackToEditor={stop}
          onPlayAgain={async (nextProjectId, nextMapId) => {
            await stop();
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

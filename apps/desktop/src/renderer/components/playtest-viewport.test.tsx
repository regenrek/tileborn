// @vitest-environment jsdom

import { cleanup, render, waitFor } from '@testing-library/react';
import { Effect } from 'effect';
import { PLUGIN_ID } from '@tileborne/plugin-battle-royale/constants';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestMap } from '@/editor/test-fixtures';
import { resetViewportDisposeChainForTests } from '@/editor/viewport/viewport-mount-lifecycle';

const controllerCtorMock = vi.hoisted(() => vi.fn());
const setShowGridMock = vi.hoisted(() => vi.fn());
const setShowDebugMock = vi.hoisted(() => vi.fn());
const setShowCollisionMock = vi.hoisted(() => vi.fn());
const editorStateMock = vi.hoisted(() => ({
  current: {
    showGrid: true,
    showDebugOverlay: false,
    showCollisionOverlay: false,
  } as { showGrid: boolean; showDebugOverlay: boolean; showCollisionOverlay: boolean },
}));
const setCameraMock = vi.hoisted(() => vi.fn());
const renderFromEntitiesSpy = vi.hoisted(() => vi.fn());
const sampleInterpolatedMock = vi.hoisted(() => vi.fn(() => undefined as unknown));
const snapshotApplySpy = vi.hoisted(() => vi.fn());
const projectMock = vi.hoisted(() => vi.fn<(snapshot: unknown) => unknown[]>());
const decodeServerFrameMock = vi.hoisted(() => vi.fn(() => undefined as unknown));
const hudOverlayMock = vi.hoisted(() => vi.fn(() => null));

vi.mock('@tileborne/runtime', async () => {
  // Use the REAL neutral input resolver + raw-event classes so the input-bridge
  // lifecycle test exercises actual PrimaryAction resolution (held mouse → shoot)
  // rather than a stub. Pixi/Snapshot/interpolation stay stubbed below.
  const actual = await vi.importActual<typeof import('@tileborne/runtime')>('@tileborne/runtime');
  return {
    // Keep every real export (InputResolver, raw-event classes, schemas pulled
    // in transitively by the BR plugin) and only override the Pixi/Snapshot/
    // interpolation surface the overlay + camera tests stub.
    ...actual,
    PixiRendererAdapter: class PixiRendererAdapter {
      mount = vi.fn(() => Effect.succeed(undefined));
      loadAssets = vi.fn(() => Effect.succeed(new Map()));
      loadBundledAssets = vi.fn(() => Effect.succeed(undefined));
      renderFromEntities = vi.fn((...args: unknown[]) => {
        renderFromEntitiesSpy(...args);
        return Effect.succeed(undefined);
      });
      dispose = vi.fn(() => Effect.succeed(undefined));
    },
    SnapshotEntityStore: class SnapshotEntityStore {
      current: unknown | undefined;
      apply = vi.fn((frame: unknown) => {
        snapshotApplySpy(frame);
        this.current = frame;
      });
      sampleInterpolatedFullState = sampleInterpolatedMock;
      getCurrentFullState = vi.fn(() => this.current);
      getPreviousFullState = vi.fn(() => undefined);
    },
    // Real interpolation (not identity) so the render-loop test can assert the
    // camera follows the INTERPOLATED local entity, mirroring the runtime helper.
    interpolateRenderableEntities: (
      current: readonly { id: string; x: number; y: number }[],
      previous: readonly { id: string; x: number; y: number }[],
      alpha: number,
    ) => {
      const resolved = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 1;
      if (previous.length === 0 || resolved >= 1) {
        return [...current];
      }
      const previousById = new Map(previous.map((value) => [value.id, value] as const));
      return current.map((value) => {
        const prior = previousById.get(value.id);
        return prior === undefined
          ? value
          : {
              ...value,
              x: prior.x + (value.x - prior.x) * resolved,
              y: prior.y + (value.y - prior.y) * resolved,
            };
      });
    },
  };
});

vi.mock('@/editor/viewport/editor-viewport-controller', () => ({
  EditorViewportController: class EditorViewportController {
    constructor() {
      controllerCtorMock();
    }
    setMap = vi.fn();
    resize = vi.fn();
    setCamera = setCameraMock;
    setShowGrid = setShowGridMock;
    setShowDebug = setShowDebugMock;
    setShowCollision = setShowCollisionMock;
    tickDebugOverlay = vi.fn();
    dispose = vi.fn(() => Promise.resolve());
  },
}));

vi.mock('@/editor/viewport/viewport-asset-manifest', () => ({
  loadViewportAssetBundle: vi.fn(() => Effect.succeed({ manifest: { assets: [] } })),
  viewportControllerAtlas: vi.fn(() => ({ renderableAssetIdByPath: new Map() })),
}));

vi.mock('@/editor/viewport/pixi-texture-from-bytes', () => ({
  pixiTextureFromBytes: vi.fn(),
}));

vi.mock('@/lib/playtest-plugin-bridge', async () => {
  // Real BR input map + action→intent adapter so the input bridge resolves
  // PrimaryAction (Space / mouse-0 → shoot) for real; only the renderer-side
  // projector/manifest stays stubbed for the overlay + camera tests.
  const core = await vi.importActual<typeof import('@tileborne/core')>('@tileborne/core');
  const br = await vi.importActual<typeof import('@tileborne/plugin-battle-royale/renderer')>(
    '@tileborne/plugin-battle-royale/renderer',
  );
  const brAudio = await vi.importActual<typeof import('@tileborne/plugin-battle-royale')>(
    '@tileborne/plugin-battle-royale',
  );
  const inputMap = br.battleRoyaleDefaultInputMap();
  const scheme = core.controlScheme(core.CONTROL_SCHEMES.KeyboardMouse);
  const bindings = inputMap.schemeDefaults[scheme] ?? [];
  const boundKeyCodes = new Set<string>();
  let usesMouseButtons = false;
  for (const binding of bindings) {
    if (binding.trigger._tag === 'key') {
      boundKeyCodes.add(binding.trigger.code);
    } else if (binding.trigger._tag === 'mouseButton') {
      usesMouseButtons = true;
    }
  }
  return {
    BATTLE_ROYALE_PLUGIN_ID: (
      await vi.importActual<typeof import('@tileborne/plugin-battle-royale/constants')>(
        '@tileborne/plugin-battle-royale/constants',
      )
    ).PLUGIN_ID,
    resolvePlaytestPlugin: vi.fn(() => ({
      projector: { mergeFrame: vi.fn(), project: projectMock },
      bundledAssets: [],
      manifest: { fixedZoom: 4, hudInsets: { top: 0, right: 0, bottom: 0, left: 0 } },
      decodeServerFrame: decodeServerFrameMock,
      inputMap,
      controlScheme: scheme,
      inputCaptureProfile: { boundKeyCodes, usesMouseButtons },
      audio: {
        buses: [brAudio.battleRoyaleSfxBus],
        cues: brAudio.battleRoyaleAudioCues,
        cueForIntent: (
          intent: ReturnType<typeof br.resolveBattleRoyaleInputIntent>,
          previousIntent: ReturnType<typeof br.resolveBattleRoyaleInputIntent> | undefined,
        ) => {
          if (intent.shoot && previousIntent?.shoot !== true) {
            return brAudio.BR_AUDIO_CUES.WeaponFire;
          }
          if (intent.reload && previousIntent?.reload !== true) {
            return brAudio.BR_AUDIO_CUES.WeaponReload;
          }
          return undefined;
        },
      },
      resolveInputIntent: br.resolveBattleRoyaleInputIntent,
    })),
  };
});

vi.mock('@/components/playtest-overlay', () => ({ PlaytestOverlay: () => null }));
vi.mock('@/components/playtest-hud-overlay', () => ({ PlaytestHudOverlay: hudOverlayMock }));

const sessionsMock = vi.hoisted(() => ({
  current: { data: { sessions: [] as { id: string; runtimeMetrics?: Record<string, unknown> }[] } },
}));
vi.mock('@/hooks/queries', () => ({
  usePlaytestSessions: () => sessionsMock.current,
  usePluginContributions: () => ({
    data: {
      gameModes: [
        {
          modeId: PLUGIN_ID,
          pluginId: PLUGIN_ID,
          label: 'Battle Royale',
          rendererCapabilityId: 'battle-royale.renderer',
          hasAuthoringPanel: true,
        },
      ],
    },
  }),
  useProject: () => ({
    data: { project: { settings: { activeGameMode: PLUGIN_ID } } },
  }),
}));

vi.mock('@/hooks/mutations', () => ({
  useUpdateProject: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const stablePlayerModels = vi.hoisted(() => ({
  builtModels: [] as const,
  selectedModelId: undefined,
  roster: [] as const,
}));
const stableOverlayVisuals = vi.hoisted(() => ({
  builtOverlays: [] as const,
}));
const stableWeaponVisuals = vi.hoisted(() => ({
  builtWeapons: [] as const,
}));
vi.mock('@/hooks/use-playtest-player-models', () => ({
  usePlaytestPlayerModels: () => stablePlayerModels,
  usePlaytestOverlayVisuals: () => stableOverlayVisuals,
  usePlaytestWeaponVisuals: () => stableWeaponVisuals,
  assemblePlaytestPlayerModelConfig: vi.fn(),
  assemblePlaytestOverlayVisualConfig: vi.fn(),
  assemblePlaytestWeaponVisualConfig: vi.fn(),
}));

vi.mock('@/hooks/use-playtest-controls', () => ({
  usePlaytestControls: () => ({
    stop: vi.fn(),
    start: vi.fn(),
    isStopping: false,
    isStarting: false,
  }),
}));

vi.mock('@/stores/editor-ui-store', () => {
  const useEditorUiStore = (selector: (value: typeof editorStateMock.current) => unknown) =>
    selector(editorStateMock.current);
  return {
    useEditorUiStore: Object.assign(useEditorUiStore, {
      getState: () => editorStateMock.current,
    }),
  };
});

import { PlaytestViewport } from './playtest-viewport';

class ResizeObserverStub {
  observe = vi.fn();
  disconnect = vi.fn();
}

// The mount effect keys on the `map` object identity, so a stable instance is
// shared across rerenders; passing a fresh map would remount the viewport.
const stableMap = createTestMap();

const viewport = () => (
  <PlaytestViewport
    projectId="project-1"
    map={stableMap}
    sessionId="session-1"
    activePlugins={[PLUGIN_ID]}
  />
);

const renderViewport = () => render(viewport());

describe('PlaytestViewport overlay wiring', () => {
  beforeEach(() => {
    resetViewportDisposeChainForTests();
    controllerCtorMock.mockReset();
    setShowGridMock.mockReset();
    setShowDebugMock.mockReset();
    setShowCollisionMock.mockReset();
    setCameraMock.mockReset();
    renderFromEntitiesSpy.mockReset();
    snapshotApplySpy.mockReset();
    hudOverlayMock.mockClear();
    sampleInterpolatedMock.mockReset();
    sampleInterpolatedMock.mockReturnValue(undefined);
    projectMock.mockReset();
    projectMock.mockReturnValue([]);
    decodeServerFrameMock.mockReset();
    decodeServerFrameMock.mockReturnValue(undefined);
    sessionsMock.current = { data: { sessions: [] } };
    editorStateMock.current = {
      showGrid: true,
      showDebugOverlay: false,
      showCollisionOverlay: false,
    };
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 0),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    (window as unknown as { tileborne: unknown }).tileborne = {
      events: { onRuntimeSnapshot: vi.fn(() => vi.fn()) },
      runtime: {
        playtestInput: vi.fn(),
        playtestSnapshot: vi.fn(() => Promise.resolve({ players: [] })),
      },
    };
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('passes rich HUD scoreboard and minimap fields through to the overlay', () => {
    sessionsMock.current = {
      data: {
        sessions: [
          {
            id: 'session-1',
            runtimeMetrics: {
              tickCount: 7,
              playerCount: 2,
              hud: {
                totalPlayers: 2,
                localPlayer: {
                  playerId: 'player-1',
                  displayName: 'Player 1',
                  health: 100,
                  maxHealth: 100,
                },
                gameplayEvents: [],
                scoreboard: [
                  {
                    playerId: 'player-1',
                    displayName: 'Player 1',
                    health: 100,
                    alive: true,
                    kills: 1,
                    deaths: 0,
                  },
                ],
                minimap: {
                  zone: { cx: 16, cy: 16, radius: 16 },
                  players: [
                    { playerId: 'player-1', x: 8, y: 8, local: true, alive: true, health: 100 },
                  ],
                  objects: [],
                },
              },
            },
          },
        ],
      },
    };

    renderViewport();

    expect(hudOverlayMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metrics: expect.objectContaining({
          hud: expect.objectContaining({
            scoreboard: [expect.objectContaining({ playerId: 'player-1', kills: 1 })],
            minimap: expect.objectContaining({ zone: { cx: 16, cy: 16, radius: 16 } }),
          }),
        }),
      }),
      undefined,
    );
  });

  it('seeds the debug and collision overlays from the live store at mount', async () => {
    editorStateMock.current.showDebugOverlay = true;
    editorStateMock.current.showCollisionOverlay = true;

    renderViewport();

    await waitFor(() => {
      expect(controllerCtorMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(setShowDebugMock).toHaveBeenCalledWith(true);
      expect(setShowCollisionMock).toHaveBeenCalledWith(true);
    });
  });

  it('pushes debug overlay changes into the controller without remounting', async () => {
    const { rerender } = renderViewport();

    await waitFor(() => {
      expect(controllerCtorMock).toHaveBeenCalledTimes(1);
    });
    setShowDebugMock.mockClear();

    editorStateMock.current.showDebugOverlay = true;
    rerender(viewport());

    await waitFor(() => {
      expect(setShowDebugMock).toHaveBeenCalledWith(true);
    });
    // No second controller: the overlay toggle must not remount the viewport.
    expect(controllerCtorMock).toHaveBeenCalledTimes(1);
  });

  it('pushes collision overlay changes into the controller', async () => {
    const { rerender } = renderViewport();

    await waitFor(() => {
      expect(controllerCtorMock).toHaveBeenCalledTimes(1);
    });
    setShowCollisionMock.mockClear();

    editorStateMock.current.showCollisionOverlay = true;
    rerender(viewport());

    await waitFor(() => {
      expect(setShowCollisionMock).toHaveBeenCalledWith(true);
    });
  });

  it('seeds the render store from the retained runtime snapshot frame', async () => {
    const seedFrame = new Uint8Array([1, 2, 3]);
    const seedSnapshot = { tag: 'seed' };
    const animation = {
      clipId: 'maltipoo-mae:idle',
      frames: [
        { assetId: 'pet', uv: { x: 0, y: 0, w: 192, h: 208 }, durationMs: 130 },
        { assetId: 'pet', uv: { x: 192, y: 0, w: 192, h: 208 }, durationMs: 130 },
      ],
      loop: true,
      clockMs: 0,
    };
    decodeServerFrameMock.mockReturnValue(seedSnapshot);
    projectMock.mockImplementation((snapshot: unknown) =>
      snapshot === seedSnapshot
        ? [{ id: 'br:player:p1', assetId: 'pet', x: 10, y: 20, animation }]
        : [],
    );
    const runtime = (
      window as unknown as {
        tileborne: { runtime: { playtestSnapshot: ReturnType<typeof vi.fn> } };
      }
    ).tileborne.runtime;
    runtime.playtestSnapshot.mockResolvedValue({ players: [], frame: seedFrame });

    let capturedTick: FrameRequestCallback | undefined;
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        capturedTick = callback;
        return 1;
      }),
    );

    renderViewport();

    await waitFor(() => {
      expect(runtime.playtestSnapshot).toHaveBeenCalledWith({ sessionId: 'session-1' });
      expect(snapshotApplySpy).toHaveBeenCalledWith(seedSnapshot);
    });

    expect(capturedTick).toBeDefined();
    capturedTick!(0);

    expect(renderFromEntitiesSpy).toHaveBeenCalledTimes(1);
    const [projected] = renderFromEntitiesSpy.mock.calls[0]!;
    expect(projected).toHaveLength(1);
    expect(projected[0]).toEqual(
      expect.objectContaining({
        id: 'br:player:p1',
        assetId: 'pet',
        animation,
      }),
    );
  });

  // Regression lock for the snapshot-interpolation smoothness fix: the
  // follow-camera must track the INTERPOLATED local-player position (not the
  // discrete latest snapshot), and the renderer must receive an empty
  // previous-by-id map with alpha 1 so it does not lerp a second time.
  it('drives the camera from the interpolated local entity and renders without a double lerp', async () => {
    const previousSnapshot = { tag: 'previous' };
    const currentSnapshot = { tag: 'current' };
    const animation = {
      clipId: 'maltipoo-mae:idle',
      frames: [{ assetId: 'pet', uv: { x: 0, y: 0, w: 192, h: 208 }, durationMs: 130 }],
      loop: true,
      clockMs: 0,
    };
    // Local player walks from (0,0) -> (10,20); at alpha 0.5 the interpolated
    // position is (5,10). The discrete `current` would be (10,20).
    projectMock.mockImplementation((snapshot: unknown) => {
      if (snapshot === currentSnapshot) {
        return [{ id: 'br:player:p1', assetId: 'pet', x: 10, y: 20, animation }];
      }
      if (snapshot === previousSnapshot) {
        return [{ id: 'br:player:p1', assetId: 'pet', x: 0, y: 0, animation }];
      }
      return [];
    });
    sampleInterpolatedMock.mockReturnValue({
      previous: previousSnapshot,
      current: currentSnapshot,
      alpha: 0.5,
    });

    let capturedTick: FrameRequestCallback | undefined;
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        capturedTick = callback;
        return 1;
      }),
    );

    renderViewport();

    // Wait for the async mount: onMounted seeds the grid overlay after wiring
    // runtimeRef, so this guarantees the render loop has a live runtime.
    await waitFor(() => {
      expect(setShowGridMock).toHaveBeenCalled();
    });

    expect(capturedTick).toBeDefined();
    capturedTick!(0);

    // (a) Camera follows the interpolated position (5,10), zoom 4, jsdom
    // container has zero size so the screen centre is (0,0):
    //   setCamera(zoom, cx - camX*zoom, cy - camY*zoom) = (4, -20, -40).
    // The discrete `current` (10,20) would have produced (4, -40, -80).
    expect(setCameraMock).toHaveBeenCalledTimes(1);
    expect(setCameraMock).toHaveBeenCalledWith(4, -20, -40);

    // (b) renderFromEntities(projected, EMPTY_PREVIOUS, 1) — no second lerp.
    expect(renderFromEntitiesSpy).toHaveBeenCalledTimes(1);
    const [projected, previousById, alpha] = renderFromEntitiesSpy.mock.calls[0]!;
    expect(alpha).toBe(1);
    expect(previousById).toBeInstanceOf(Map);
    expect((previousById as Map<string, unknown>).size).toBe(0);
    // The projected local entity sits at the screen centre because the camera
    // tracks the same interpolated position the sprite is drawn at.
    expect(projected).toHaveLength(1);
    expect(projected[0]).toEqual(
      expect.objectContaining({
        id: 'br:player:p1',
        assetId: 'pet',
        x: 0,
        y: 0,
        scaleX: 4,
        scaleY: 4,
      }),
    );
    expect(projected[0]?.scale).toBeUndefined();
  });

  it('sends WASD movement frames with a dir value', async () => {
    const playtestInput = (
      window as unknown as { tileborne: { runtime: { playtestInput: ReturnType<typeof vi.fn> } } }
    ).tileborne.runtime.playtestInput;

    sessionsMock.current = {
      data: { sessions: [{ id: 'session-1', runtimeMetrics: { tickCount: 5 } }] },
    };

    renderViewport();

    await waitFor(() => {
      expect(controllerCtorMock).toHaveBeenCalledTimes(1);
    });

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' }));

    const payload = playtestInput.mock.calls.at(-1)?.[0] as {
      shoot: boolean;
      tick: number;
      dir: number;
      active?: boolean;
    };
    expect(payload.shoot).toBe(false);
    expect(payload.dir).toBe(0);
    expect(payload.tick).toBe(5);
    expect(payload).not.toHaveProperty('active');
  });

  // Regression lock for the capture-lifecycle decoupling: a held mouse button
  // (PrimaryAction → shoot) must survive a `tickCount` change. If the capture
  // effect re-ran on tickCount it would tear down + recreate the resolver,
  // dropping the held button (no repeat mousedown), so the next bound input
  // would resolve shoot:false.
  it('keeps a held-mouse shoot true across a tickCount change (capture not recreated)', async () => {
    const playtestInput = (
      window as unknown as { tileborne: { runtime: { playtestInput: ReturnType<typeof vi.fn> } } }
    ).tileborne.runtime.playtestInput;

    sessionsMock.current = {
      data: { sessions: [{ id: 'session-1', runtimeMetrics: { tickCount: 5 } }] },
    };

    const { rerender } = renderViewport();

    await waitFor(() => {
      expect(controllerCtorMock).toHaveBeenCalledTimes(1);
    });

    const container = document.querySelector<HTMLDivElement>('[data-testid="playtest-viewport"]');
    expect(container).not.toBeNull();

    // Hold mouse button 0 inside the viewport → PrimaryAction shoot.
    container!.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
    const afterPress = playtestInput.mock.calls.at(-1)?.[0] as {
      shoot: boolean;
      tick: number;
      dir?: number;
    };
    expect(afterPress.shoot).toBe(true);
    expect(afterPress.tick).toBe(5);
    expect(afterPress).not.toHaveProperty('dir');
    expect(window.__tilebornePlaytestAudio?.snapshot()).toEqual(
      expect.objectContaining({
        playCount: 1,
        lastRequest: { cueId: 'battle-royale.weapon.fire' },
      }),
    );

    // A live tick refresh arrives (session metrics update). The capture must NOT
    // be recreated, so the resolver keeps the held mouse button.
    sessionsMock.current = {
      data: { sessions: [{ id: 'session-1', runtimeMetrics: { tickCount: 6 } }] },
    };
    rerender(viewport());

    // The mouse is still physically held (no new mousedown); a different bound
    // input (movement key) emits the next frame. Shoot must still be true and the
    // frame must carry the refreshed tick from the ref.
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' }));
    const afterTick = playtestInput.mock.calls.at(-1)?.[0] as {
      shoot: boolean;
      tick: number;
      dir: number;
    };
    expect(afterTick.shoot).toBe(true);
    expect(afterTick.dir).toBe(0);
    expect(afterTick.tick).toBe(6);
    expect(window.__tilebornePlaytestAudio?.snapshot().playCount).toBe(1);
    // The capture was set up once and never torn down by the tick change.
    expect(controllerCtorMock).toHaveBeenCalledTimes(1);
  });
});

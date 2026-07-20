// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ComponentProps, useLayoutEffect } from 'react';
import { Effect } from 'effect';
import { PLUGIN_ID } from '@tileborne/plugin-battle-royale/constants';
import {
  applyGameShellAuthoringCommand,
  buildRuntimeGameShellProjection,
  defaultProjectGameShellState,
} from '@tileborne/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestMap } from '@/editor/test-fixtures';
import { resetViewportDisposeChainForTests } from '@/editor/viewport/viewport-mount-lifecycle';

type PlaytestHudOverlayComponent =
  (typeof import('@/components/playtest-hud-overlay'))['PlaytestHudOverlay'];
type PlaytestHudOverlayProps = ComponentProps<PlaytestHudOverlayComponent>;

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
const hudOverlayMock = vi.hoisted(() =>
  vi.fn<(props: PlaytestHudOverlayProps) => null>(() => null),
);

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
    audioCueForResolvedIntent: vi.fn(
      (
        cues: typeof brAudio.battleRoyaleAudioCues,
        intent: ReturnType<typeof br.resolveBattleRoyaleInputIntent>,
        previousIntent: ReturnType<typeof br.resolveBattleRoyaleInputIntent> | undefined,
      ) => {
        const byBinding = (binding: string) => cues.find((cue) => cue.binding === binding)?.id;
        if (intent.shoot && previousIntent?.shoot !== true) return byBinding('weapon.fire');
        if (intent.reload && previousIntent?.reload !== true) return byBinding('weapon.reload');
        return undefined;
      },
    ),
    dispatchRuntimeAudioEvent: vi.fn(
      (
        dispatcher: { playCue: (cueId: string) => unknown } | undefined,
        cues: typeof brAudio.battleRoyaleAudioCues,
        event: string,
      ) => {
        const cueId = cues.find((cue) => cue.binding === event)?.id;
        if (cueId !== undefined) dispatcher?.playCue(cueId);
        return cueId;
      },
    ),
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
  current: {
    data: {
      sessions: [] as { id: string; status?: string; runtimeMetrics?: Record<string, unknown> }[],
    },
  },
}));
const shellQueryMock = vi.hoisted(() => ({
  current: { data: undefined as { projection: unknown } | undefined },
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
  useProjectAudio: () => ({ data: undefined }),
  useProjectGameShell: () => shellQueryMock.current,
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
const startPlaytestControlMock = vi.hoisted(() => vi.fn());
const stopPlaytestControlMock = vi.hoisted(() => vi.fn());
const shellEventMock = vi.hoisted(() => vi.fn());
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
    stop: stopPlaytestControlMock,
    start: startPlaytestControlMock,
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

const entityId = (id: string) => id as never;
const itemId = (id: string) => id as never;

class ResizeObserverStub {
  observe = vi.fn();
  disconnect = vi.fn();
}

// The mount effect keys on the `map` object identity, so a stable instance is
// shared across rerenders; passing a fresh map would remount the viewport.
const stableMap = createTestMap();

const viewport = (options: { readonly sessionId?: string | undefined } = {}) => (
  <PlaytestViewport
    projectId="project-1"
    map={stableMap}
    sessionId={options.sessionId ?? 'session-1'}
    activePlugins={[PLUGIN_ID]}
  />
);

const renderViewport = () => render(viewport());

const deferredShellEventResponse = () => {
  let resolve!: (value: {
    requests: readonly {
      sequence: number;
      request: { type: 'navigate'; targetScreenId: string };
    }[];
  }) => void;
  const promise = new Promise<{
    requests: readonly {
      sequence: number;
      request: { type: 'navigate'; targetScreenId: string };
    }[];
  }>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

const authoredShellProjection = (
  options: {
    readonly backgroundPath?: string | undefined;
    readonly fontPath?: string | undefined;
  } = {},
) => {
  let state = defaultProjectGameShellState();
  state = applyGameShellAuthoringCommand(state, {
    type: 'set-entry-screen',
    screenId: 'main-menu',
  });
  if (options.backgroundPath !== undefined) {
    state = applyGameShellAuthoringCommand(state, {
      type: 'register-asset',
      asset: {
        assetId: 'asset:bg',
        packId: 'pack:desktop-shell',
        packVersion: 'sha256:bg',
        path: options.backgroundPath,
        mime: 'image/png',
        kind: 'background',
      },
    });
    state = applyGameShellAuthoringCommand(state, {
      type: 'set-screen-asset',
      screenId: 'main-menu',
      slot: 'background',
      assetId: 'asset:bg',
    });
  }
  if (options.fontPath !== undefined) {
    state = applyGameShellAuthoringCommand(state, {
      type: 'register-asset',
      asset: {
        assetId: 'asset:font',
        packId: 'pack:desktop-shell',
        packVersion: 'sha256:font',
        path: options.fontPath,
        mime: 'font/woff2',
        kind: 'font',
      },
    });
    state = applyGameShellAuthoringCommand(state, {
      type: 'set-screen-asset',
      screenId: 'main-menu',
      slot: 'font',
      assetId: 'asset:font',
    });
  }
  state = applyGameShellAuthoringCommand(state, {
    type: 'upsert-action',
    screenId: 'main-menu',
    action: { id: 'menu.title', label: 'Title', type: 'navigate', targetScreenId: 'title' },
  });
  return buildRuntimeGameShellProjection(state);
};

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
    startPlaytestControlMock.mockReset();
    startPlaytestControlMock.mockResolvedValue(undefined);
    stopPlaytestControlMock.mockReset();
    stopPlaytestControlMock.mockResolvedValue(undefined);
    shellEventMock.mockReset();
    shellEventMock.mockResolvedValue({ requests: [] });
    sessionsMock.current = { data: { sessions: [] } };
    shellQueryMock.current = {
      data: { projection: buildRuntimeGameShellProjection(defaultProjectGameShellState()) },
    };
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
      gameShell: { open: vi.fn(() => new Promise(() => undefined)) },
      runtime: {
        playtestInput: vi.fn(),
        playtestSnapshot: vi.fn(() => Promise.resolve({ players: [] })),
      },
      playtest: {
        shellEvent: shellEventMock,
      },
    };
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
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

  it('mounts the authored runtime shell projection in desktop playtest', async () => {
    const authoredState = applyGameShellAuthoringCommand(
      applyGameShellAuthoringCommand(defaultProjectGameShellState(), {
        type: 'set-entry-screen',
        screenId: 'main-menu',
      }),
      {
        type: 'set-screen-text',
        screenId: 'main-menu',
        title: 'Playtest Arena Shell',
        subtitle: 'Desktop authored projection',
      },
    );
    shellQueryMock.current = {
      data: { projection: buildRuntimeGameShellProjection(authoredState) },
    };

    renderViewport();

    expect(await screen.findByTestId('playtest-runtime-shell')).not.toBeNull();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Playtest Arena Shell' })).not.toBeNull();
      expect(screen.getByText('Desktop authored projection')).not.toBeNull();
    });
    expect(
      screen.getByTestId('playtest-runtime-shell').getAttribute('data-shell-runtime-root-state'),
    ).toBe('mounted');
  });

  it('keeps fallback shell DOM out of desktop playtest while the authored shell loads', async () => {
    shellQueryMock.current = { data: undefined };

    renderViewport();

    expect(await screen.findByTestId('shell-screen-loading')).not.toBeNull();
    expect(
      screen.getByTestId('playtest-runtime-shell').getAttribute('data-shell-runtime-root-state'),
    ).toBe('loading');
    expect(screen.queryByTestId('main-menu')).toBeNull();
    expect(screen.queryByTestId('shell-screen-main-menu')).toBeNull();
  });

  it('renders an authored entry after startup loading and retains it across projection refetch churn', async () => {
    shellQueryMock.current = { data: undefined };
    const { rerender } = renderViewport();

    expect(await screen.findByTestId('shell-screen-loading')).not.toBeNull();
    expect(
      screen.getByTestId('playtest-runtime-shell').getAttribute('data-shell-runtime-root-state'),
    ).toBe('loading');

    shellQueryMock.current = {
      data: { projection: buildRuntimeGameShellProjection(defaultProjectGameShellState()) },
    };
    rerender(viewport());

    expect(await screen.findByTestId('shell-screen-title')).not.toBeNull();
    expect(
      screen.getByTestId('playtest-runtime-shell').getAttribute('data-shell-runtime-root-state'),
    ).toBe('mounted');
    expect(screen.queryByTestId('shell-screen-loading')).toBeNull();

    shellQueryMock.current = { data: undefined };
    rerender(viewport());

    expect(screen.getByTestId('shell-screen-title')).not.toBeNull();
    expect(
      screen.getByTestId('playtest-runtime-shell').getAttribute('data-shell-runtime-root-state'),
    ).toBe('mounted');
    expect(
      screen.getByTestId('playtest-runtime-shell').getAttribute('data-shell-projection-state'),
    ).toBe('retained');
    expect(screen.queryByTestId('shell-screen-loading')).toBeNull();
  });

  it('keeps the same RuntimeRoot DOM node across session and projection refetch churn', async () => {
    shellQueryMock.current = {
      data: { projection: buildRuntimeGameShellProjection(defaultProjectGameShellState()) },
    };
    sessionsMock.current = {
      data: {
        sessions: [
          {
            id: 'session-1',
            status: 'Running',
            runtimeMetrics: {
              tickCount: 1,
              playerCount: 1,
              hud: { totalPlayers: 1, gameplayEvents: [] },
            },
          },
        ],
      },
    };
    const { rerender } = renderViewport();

    expect(await screen.findByTestId('shell-screen-title')).not.toBeNull();
    const shellHost = screen.getByTestId('playtest-runtime-shell');
    const root = shellHost.querySelector('.tb-root');
    expect(root).not.toBeNull();
    expect(shellHost.getAttribute('data-shell-runtime-root-state')).toBe('mounted');
    expect(shellHost.getAttribute('data-shell-host-generation')).toBe('1');

    shellQueryMock.current = { data: undefined };
    sessionsMock.current = {
      data: {
        sessions: [
          {
            id: 'session-1',
            status: 'Running',
            runtimeMetrics: {
              tickCount: 2,
              playerCount: 1,
              hud: { totalPlayers: 1, gameplayEvents: [] },
            },
          },
        ],
      },
    };
    rerender(viewport());

    expect(screen.getByTestId('playtest-runtime-shell').querySelector('.tb-root')).toBe(root);
    expect(
      screen.getByTestId('playtest-runtime-shell').getAttribute('data-shell-projection-state'),
    ).toBe('retained');
    expect(
      screen.getByTestId('playtest-runtime-shell').getAttribute('data-shell-host-generation'),
    ).toBe('1');
    expect(screen.queryByTestId('shell-screen-loading')).toBeNull();

    shellQueryMock.current = {
      data: { projection: buildRuntimeGameShellProjection(defaultProjectGameShellState()) },
    };
    rerender(viewport());

    expect(screen.getByTestId('playtest-runtime-shell').querySelector('.tb-root')).toBe(root);
    expect(
      screen.getByTestId('playtest-runtime-shell').getAttribute('data-shell-projection-state'),
    ).toBe('fresh');
    expect(
      screen.getByTestId('playtest-runtime-shell').getAttribute('data-shell-host-generation'),
    ).toBe('1');
  });

  it('opens the shell projection directly when query startup stays loading', async () => {
    const projection = buildRuntimeGameShellProjection(defaultProjectGameShellState());
    shellQueryMock.current = { data: undefined };
    const open = vi.fn(async () => ({ projection }));
    Object.assign(window.tileborne, {
      gameShell: { open },
    });

    renderViewport();

    expect(await screen.findByTestId('shell-screen-title')).not.toBeNull();
    expect(open).toHaveBeenCalledWith({ projectId: 'project-1' });
    expect(
      screen.getByTestId('playtest-runtime-shell').getAttribute('data-shell-runtime-root-state'),
    ).toBe('mounted');
    expect(screen.queryByTestId('shell-screen-loading')).toBeNull();
  });

  it('fails soft when direct shell projection startup rejects', async () => {
    shellQueryMock.current = { data: undefined };
    const open = vi.fn(async () => {
      throw new Error('shell open rejected');
    });
    Object.assign(window.tileborne, {
      gameShell: { open },
    });

    renderViewport();

    expect(await screen.findByTestId('shell-screen-unavailable')).not.toBeNull();
    expect(
      screen.getByTestId('playtest-runtime-shell').getAttribute('data-shell-fallback-status'),
    ).toBe('error');
    expect(
      screen.getByTestId('playtest-runtime-shell').getAttribute('data-shell-runtime-root-state'),
    ).toBe('unavailable');
    expect(screen.getByRole('alert').textContent).toContain('shell open rejected');
    expect(screen.queryByTestId('shell-screen-loading')).toBeNull();
  });

  it('fails soft when direct shell projection startup returns an invalid response', async () => {
    shellQueryMock.current = { data: undefined };
    const open = vi.fn(async () => ({ projection: undefined }));
    Object.assign(window.tileborne, {
      gameShell: { open },
    });

    renderViewport();

    expect(await screen.findByTestId('shell-screen-unavailable')).not.toBeNull();
    expect(
      screen.getByTestId('playtest-runtime-shell').getAttribute('data-shell-fallback-status'),
    ).toBe('invalid');
    expect(
      screen.getByTestId('playtest-runtime-shell').getAttribute('data-shell-runtime-root-state'),
    ).toBe('unavailable');
    expect(screen.getByRole('alert').textContent).toContain('no decodable projection');
    expect(screen.queryByTestId('shell-screen-loading')).toBeNull();
  });

  it('fails soft when direct shell projection startup stays pending', async () => {
    vi.useFakeTimers();
    try {
      shellQueryMock.current = { data: undefined };
      const open = vi.fn(() => new Promise(() => undefined));
      Object.assign(window.tileborne, {
        gameShell: { open },
      });

      renderViewport();

      expect(screen.getByTestId('shell-screen-loading')).not.toBeNull();
      expect(
        screen.getByTestId('playtest-runtime-shell').getAttribute('data-shell-runtime-root-state'),
      ).toBe('loading');
      await act(async () => {
        vi.advanceTimersByTime(10_000);
      });

      expect(screen.getByTestId('shell-screen-unavailable')).not.toBeNull();
      expect(
        screen.getByTestId('playtest-runtime-shell').getAttribute('data-shell-fallback-status'),
      ).toBe('timeout');
      expect(
        screen.getByTestId('playtest-runtime-shell').getAttribute('data-shell-runtime-root-state'),
      ).toBe('unavailable');
      expect(screen.getByRole('alert').textContent).toContain('10000ms');
      expect(screen.queryByTestId('shell-screen-loading')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('applies distinct async shell action navigation responses exactly once when they resolve out of order', async () => {
    const state = applyGameShellAuthoringCommand(
      applyGameShellAuthoringCommand(defaultProjectGameShellState(), {
        type: 'upsert-action',
        screenId: 'main-menu',
        action: {
          id: 'menu.first',
          label: 'First',
          type: 'emit-event',
          event: 'shell.action.invoked',
        },
      }),
      {
        type: 'upsert-action',
        screenId: 'main-menu',
        action: {
          id: 'menu.second',
          label: 'Second',
          type: 'emit-event',
          event: 'shell.action.invoked',
        },
      },
    );
    shellQueryMock.current = {
      data: { projection: buildRuntimeGameShellProjection(state) },
    };
    const first = deferredShellEventResponse();
    const second = deferredShellEventResponse();
    const calls: string[] = [];
    shellEventMock.mockImplementation(async ({ event }) => {
      calls.push(`${event.event}:${event.screenId}:${event.actionId ?? ''}`);
      if (event.event === 'shell.action.invoked' && event.actionId === 'menu.first') {
        return first.promise;
      }
      if (event.event === 'shell.action.invoked' && event.actionId === 'menu.second') {
        return second.promise;
      }
      return { requests: [] };
    });
    const user = userEvent.setup();
    (window as unknown as { __tileborneShellDebug?: unknown }).__tileborneShellDebug = {};

    renderViewport();

    await user.click(await screen.findByTestId('shell-action-title-start'));
    await waitFor(() => expect(screen.getByTestId('shell-screen-main-menu')).not.toBeNull());
    await user.click(screen.getByTestId('shell-action-menu-first'));
    await user.click(screen.getByTestId('shell-action-menu-second'));

    const settingsEnteredBeforeSecondResponse = calls.filter(
      (entry) => entry === 'shell.settings.entered:settings:',
    ).length;
    await act(async () => {
      second.resolve({
        requests: [{ sequence: 2, request: { type: 'navigate', targetScreenId: 'settings' } }],
      });
    });
    await waitFor(() => expect(screen.getByTestId('settings-dialog')).not.toBeNull());
    await waitFor(() =>
      expect(calls.filter((entry) => entry === 'shell.settings.entered:settings:').length).toBe(
        settingsEnteredBeforeSecondResponse + 1,
      ),
    );
    const titleEnteredBeforeFirstResponse = calls.filter(
      (entry) => entry === 'shell.title.entered:title:',
    ).length;
    await act(async () => {
      first.resolve({
        requests: [{ sequence: 1, request: { type: 'navigate', targetScreenId: 'title' } }],
      });
    });
    await waitFor(() => expect(screen.getByTestId('shell-screen-title')).not.toBeNull());
    await waitFor(() =>
      expect(calls.filter((entry) => entry === 'shell.title.entered:title:').length).toBe(
        titleEnteredBeforeFirstResponse + 1,
      ),
    );
  });

  it('discards late shell action navigation responses from a replaced playtest session', async () => {
    const state = applyGameShellAuthoringCommand(defaultProjectGameShellState(), {
      type: 'upsert-action',
      screenId: 'main-menu',
      action: {
        id: 'menu.late',
        label: 'Late',
        type: 'emit-event',
        event: 'shell.action.invoked',
      },
    });
    shellQueryMock.current = {
      data: { projection: buildRuntimeGameShellProjection(state) },
    };
    const late = deferredShellEventResponse();
    shellEventMock.mockImplementation(async ({ event }) => {
      if (event.event === 'shell.action.invoked' && event.actionId === 'menu.late') {
        return late.promise;
      }
      return { requests: [] };
    });
    const user = userEvent.setup();

    const { rerender } = render(viewport({ sessionId: 'session-old' }));

    await user.click(await screen.findByTestId('shell-action-title-start'));
    await waitFor(() => expect(screen.getByTestId('shell-screen-main-menu')).not.toBeNull());
    await user.click(screen.getByTestId('shell-action-menu-late'));

    rerender(viewport({ sessionId: 'session-new' }));
    await waitFor(() => expect(screen.getByTestId('shell-screen-main-menu')).not.toBeNull());
    await act(async () => {
      late.resolve({
        requests: [{ sequence: 12, request: { type: 'navigate', targetScreenId: 'settings' } }],
      });
    });

    await waitFor(() => expect(screen.getByTestId('shell-screen-main-menu')).not.toBeNull());
    expect(screen.queryByTestId('settings-dialog')).toBeNull();
  });

  it('discards stale shell action navigation resolved during the new-session commit before passive effects', async () => {
    const state = applyGameShellAuthoringCommand(defaultProjectGameShellState(), {
      type: 'upsert-action',
      screenId: 'main-menu',
      action: {
        id: 'menu.boundary',
        label: 'Boundary',
        type: 'emit-event',
        event: 'shell.action.invoked',
      },
    });
    shellQueryMock.current = {
      data: { projection: buildRuntimeGameShellProjection(state) },
    };
    const late = deferredShellEventResponse();
    shellEventMock.mockImplementation(async ({ event }) => {
      if (event.event === 'shell.action.invoked' && event.actionId === 'menu.boundary') {
        return late.promise;
      }
      return { requests: [] };
    });
    const user = userEvent.setup();
    const ViewportResolvingOldResponseDuringCommit = ({
      sessionId,
    }: {
      readonly sessionId: string;
    }) => {
      useLayoutEffect(() => {
        if (sessionId !== 'session-new') return;
        late.resolve({
          requests: [{ sequence: 13, request: { type: 'navigate', targetScreenId: 'settings' } }],
        });
      }, [sessionId]);
      return viewport({ sessionId });
    };

    const { rerender } = render(
      <ViewportResolvingOldResponseDuringCommit sessionId="session-old" />,
    );

    await user.click(await screen.findByTestId('shell-action-title-start'));
    await waitFor(() => expect(screen.getByTestId('shell-screen-main-menu')).not.toBeNull());
    await user.click(screen.getByTestId('shell-action-menu-boundary'));

    rerender(<ViewportResolvingOldResponseDuringCommit sessionId="session-new" />);

    await waitFor(() => expect(screen.getByTestId('shell-screen-main-menu')).not.toBeNull());
    expect(screen.queryByTestId('settings-dialog')).toBeNull();
  });

  it('keeps authored title-start navigation local even when entered events return navigation responses', async () => {
    shellQueryMock.current = {
      data: { projection: buildRuntimeGameShellProjection(defaultProjectGameShellState()) },
    };
    const user = userEvent.setup();
    const transitions: string[] = [];
    const responseSequences: number[] = [];
    shellEventMock.mockImplementation(async ({ event }) => {
      transitions.push(`${event.event}:${event.screenId}:${event.actionId ?? ''}`);
      if (event.event === 'shell.menu.entered' && event.screenId === 'main-menu') {
        responseSequences.push(7);
        return {
          requests: [
            { sequence: 7, request: { type: 'navigate', targetScreenId: 'settings' } },
            { sequence: 7, request: { type: 'navigate', targetScreenId: 'settings' } },
          ],
        };
      }
      return { requests: [] };
    });

    renderViewport();

    await user.click(await screen.findByTestId('shell-action-title-start'));
    await waitFor(() => expect(screen.getByTestId('shell-screen-main-menu')).not.toBeNull());

    expect(screen.queryByTestId('settings-dialog')).toBeNull();
    expect(responseSequences).toEqual([7, 7]);
    expect(transitions.some((entry) => entry === 'shell.action.invoked:title:title.start')).toBe(
      false,
    );
    await waitFor(() =>
      expect(
        transitions.filter((entry) => entry === 'shell.menu.entered:main-menu:').length,
      ).toBeGreaterThanOrEqual(1),
    );
  });

  it('loads desktop authored shell background and font through tileborne-asset URLs', async () => {
    const loadedImages: string[] = [];
    class LoadingImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(value: string) {
        loadedImages.push(value);
        queueMicrotask(() => this.onload?.());
      }
    }
    const addedFonts: string[] = [];
    class LoadingFontFace {
      readonly family: string;
      readonly source: string;
      constructor(family: string, source: string) {
        this.family = family;
        this.source = source;
      }
      load = vi.fn(async () => this);
    }
    vi.stubGlobal('Image', LoadingImage);
    vi.stubGlobal('FontFace', LoadingFontFace);
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { add: (face: LoadingFontFace) => addedFonts.push(face.source) },
    });
    shellQueryMock.current = {
      data: {
        projection: authoredShellProjection({
          backgroundPath: 'shell/title.png',
          fontPath: 'shell/title.woff2',
        }),
      },
    };

    renderViewport();

    const mainShell = await screen.findByTestId('shell-screen-main-menu');
    await waitFor(() => {
      expect(loadedImages[0]).toContain('tileborne-asset://pack?');
      expect(loadedImages[0]).toContain('id=pack%3Adesktop-shell');
      expect(loadedImages[0]).toContain('path=shell%2Ftitle.png');
      expect(addedFonts[0]).toContain('tileborne-asset://pack?');
      expect(addedFonts[0]).toContain('path=shell%2Ftitle.woff2');
    });
    expect(mainShell.getAttribute('style')).toContain('tileborne-asset://pack?');
    expect(screen.queryByTestId('shell-asset-diagnostics')).toBeNull();
  });

  it('reports desktop authored shell background and font load failures without blocking navigation', async () => {
    class FailingImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    class FailingFontFace {
      constructor() {}
      load = vi.fn(async () => {
        throw new Error('font missing');
      });
    }
    vi.stubGlobal('Image', FailingImage);
    vi.stubGlobal('FontFace', FailingFontFace);
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { add: vi.fn() },
    });
    shellQueryMock.current = {
      data: {
        projection: authoredShellProjection({
          backgroundPath: 'shell/missing.png',
          fontPath: 'shell/missing.woff2',
        }),
      },
    };

    renderViewport();

    await waitFor(() => expect(screen.getByTestId('shell-asset-diagnostics')).not.toBeNull());
    expect(screen.getByRole('alert').textContent).toContain('Background asset failed to load');
    expect(screen.getByRole('alert').textContent).toContain('Font asset failed to load');
    await userEvent.click(screen.getByTestId('shell-action-menu-settings'));
    await waitFor(() => expect(screen.getByTestId('settings-dialog')).not.toBeNull());
  });

  it('walks desktop runtime shell through lobby, match, and live-metric results', async () => {
    const user = userEvent.setup();
    const authoredState = applyGameShellAuthoringCommand(
      applyGameShellAuthoringCommand(
        applyGameShellAuthoringCommand(defaultProjectGameShellState(), {
          type: 'register-asset',
          asset: {
            assetId: 'asset:bg',
            packId: 'project-1',
            packVersion: '1.0.0',
            path: 'assets/ui/title.png',
            mime: 'image/png',
            kind: 'background',
          },
        }),
        {
          type: 'set-entry-screen',
          screenId: 'main-menu',
        },
      ),
      {
        type: 'set-screen-asset',
        screenId: 'main-menu',
        slot: 'background',
        assetId: 'asset:bg',
      },
    );
    shellQueryMock.current = {
      data: { projection: buildRuntimeGameShellProjection(authoredState) },
    };
    shellEventMock.mockImplementation(async ({ event }) => {
      if (event.event === 'shell.action.invoked' && event.actionId === 'results.retry') {
        return {
          requests: [{ sequence: 99, request: { type: 'navigate', targetScreenId: 'title' } }],
        };
      }
      return { requests: [] };
    });
    sessionsMock.current = {
      data: {
        sessions: [
          {
            id: 'session-1',
            runtimeMetrics: {
              tickCount: 20,
              playerCount: 1,
              hud: {
                totalPlayers: 1,
                gameplayEvents: [],
                gameOver: { winnerId: 'player-1', reason: 'last-player-standing' },
                scoreboard: [
                  {
                    playerId: 'player-1',
                    displayName: 'Ada',
                    health: 100,
                    alive: true,
                    kills: 3,
                    deaths: 0,
                  },
                ],
              },
            },
          },
        ],
      },
    };

    const { rerender } = renderViewport();
    const mainShell = await screen.findByTestId('shell-screen-main-menu');
    expect(mainShell.getAttribute('style')).toContain('tileborne-asset://pack?');
    expect(mainShell.getAttribute('style')).toContain('id=project-1');
    expect(mainShell.getAttribute('style')).toContain('path=assets%2Fui%2Ftitle.png');
    expect(mainShell.getAttribute('style')).toContain('v=1.0.0');

    await user.click(await screen.findByTestId('shell-action-menu-settings'));
    await waitFor(() => expect(screen.getByTestId('settings-dialog')).not.toBeNull());
    await user.click(screen.getByTestId('shell-action-settings-back'));
    await waitFor(() => expect(screen.getByTestId('shell-screen-main-menu')).not.toBeNull());

    await user.click(await screen.findByTestId('shell-action-menu-single'));
    await waitFor(() => expect(screen.getByTestId('playtest-shell-lobby')).not.toBeNull());
    expect(startPlaytestControlMock).not.toHaveBeenCalled();
    expect(shellEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        event: expect.objectContaining({
          event: 'shell.action.invoked',
          screenId: 'main-menu',
          actionId: 'menu.single',
        }),
      }),
    );
    expect(screen.getByTestId('playtest-shell-lobby')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Start Match' }));
    expect(startPlaytestControlMock).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('in-match')).not.toBeNull());
    sessionsMock.current = {
      data: {
        sessions: [
          {
            id: 'session-1',
            runtimeMetrics: {
              tickCount: 21,
              playerCount: 1,
              hud: {
                totalPlayers: 1,
                gameplayEvents: [],
                gameOver: { winnerId: 'player-1', reason: 'last-player-standing' },
                scoreboard: [
                  {
                    playerId: 'player-1',
                    displayName: 'Ada',
                    health: 100,
                    alive: true,
                    kills: 3,
                    deaths: 0,
                  },
                ],
              },
            },
          },
        ],
      },
    };
    rerender(viewport());
    await waitFor(() => expect(screen.getByTestId('results-screen')).not.toBeNull());
    await waitFor(() => {
      const latestHudOverlayCall = hudOverlayMock.mock.calls.at(-1);
      if (latestHudOverlayCall === undefined) {
        throw new Error('Expected PlaytestHudOverlay to be called');
      }
      const [props] = latestHudOverlayCall;
      expect(props.metrics?.hud?.gameOver).toBeUndefined();
    });
    expect(screen.getByText('Ada')).not.toBeNull();
    expect(screen.getByText('3')).not.toBeNull();

    await user.click(screen.getByTestId('shell-action-results-retry'));
    await waitFor(() => {
      expect(stopPlaytestControlMock).toHaveBeenCalledTimes(1);
      expect(startPlaytestControlMock).toHaveBeenCalledTimes(1);
      expect(startPlaytestControlMock).toHaveBeenCalledWith('project-1', stableMap.id, {});
    });
    await waitFor(() => expect(screen.getByTestId('playtest-shell-lobby')).not.toBeNull());
    expect(screen.queryByTestId('results-screen')).toBeNull();
    sessionsMock.current = {
      data: {
        sessions: [
          {
            id: 'session-1',
            runtimeMetrics: {
              tickCount: 22,
              playerCount: 1,
              hud: {
                totalPlayers: 1,
                gameplayEvents: [],
                scoreboard: [],
              },
            },
          },
        ],
      },
    };
    rerender(viewport());

    await user.click(screen.getByRole('button', { name: 'Start Match' }));
    expect(startPlaytestControlMock).toHaveBeenCalledTimes(1);
    sessionsMock.current = {
      data: {
        sessions: [
          {
            id: 'session-1',
            runtimeMetrics: {
              tickCount: 23,
              playerCount: 1,
              hud: {
                totalPlayers: 1,
                gameplayEvents: [],
                gameOver: { winnerId: 'player-1', reason: 'last-player-standing' },
                scoreboard: [
                  {
                    playerId: 'player-1',
                    displayName: 'Ada',
                    health: 100,
                    alive: true,
                    kills: 4,
                    deaths: 0,
                  },
                ],
              },
            },
          },
        ],
      },
    };
    rerender(viewport());
    await waitFor(() => expect(screen.getByTestId('results-screen')).not.toBeNull());
    await user.click(screen.getByTestId('shell-action-results-menu'));
    await waitFor(() => {
      expect(stopPlaytestControlMock).toHaveBeenCalledTimes(2);
    });
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

  it('ignores renderable entities without string ids when selecting the local camera target', async () => {
    const currentSnapshot = { tag: 'current' };
    projectMock.mockImplementation((snapshot: unknown) =>
      snapshot === currentSnapshot
        ? [
            {
              assetId: 'pet',
              x: 10,
              y: 20,
            },
          ]
        : [],
    );
    sampleInterpolatedMock.mockReturnValue({
      current: currentSnapshot,
      alpha: 1,
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

    await waitFor(() => {
      expect(setShowGridMock).toHaveBeenCalled();
    });

    expect(capturedTick).toBeDefined();
    expect(() => capturedTick!(0)).not.toThrow();
    expect(setCameraMock).toHaveBeenCalledTimes(1);
    expect(setCameraMock.mock.calls[0]?.[0]).toBe(4);
    expect(renderFromEntitiesSpy).toHaveBeenCalledTimes(1);
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
        playCount: 2,
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
    expect(window.__tilebornePlaytestAudio?.snapshot().playCount).toBe(2);
    // The capture was set up once and never torn down by the tick change.
    expect(controllerCtorMock).toHaveBeenCalledTimes(1);
  });

  it('plays lifecycle audio from runtime HUD events instead of raw controls', async () => {
    const gameplayEvents = [
      {
        _tag: 'ItemGranted',
        targetId: entityId('player-1'),
        itemId: itemId('health-pack:rare'),
        quantity: 1,
        tick: 11,
      },
      {
        _tag: 'DamageApplied',
        targetId: entityId('player-1'),
        sourceId: entityId('player-2'),
        amount: 15,
        healthBefore: 100,
        healthAfter: 85,
        tick: 12,
      },
      {
        _tag: 'EntityDefeated',
        targetId: entityId('player-2'),
        sourceId: entityId('player-1'),
        tick: 13,
      },
      { _tag: 'ZonePhaseChanged', phase: 'countdown', secondsRemaining: 9, tick: 14 },
      {
        _tag: 'MatchPhaseChanged',
        phase: 'finished',
        winnerId: entityId('player-1'),
        tick: 15,
      },
    ];
    sessionsMock.current = {
      data: {
        sessions: [
          {
            id: 'session-1',
            runtimeMetrics: {
              tickCount: 15,
              playerCount: 2,
              hud: { totalPlayers: 2, gameplayEvents },
            },
          },
        ],
      },
    };

    const { rerender } = renderViewport();

    await waitFor(() => {
      expect(window.__tilebornePlaytestAudio?.snapshot()).toEqual(
        expect.objectContaining({
          playCount: 6,
          lastRequest: { cueId: 'battle-royale.match.end' },
        }),
      );
    });

    rerender(viewport());

    await waitFor(() => {
      expect(window.__tilebornePlaytestAudio?.snapshot().playCount).toBe(6);
    });
  });
});

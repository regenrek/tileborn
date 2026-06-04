// @vitest-environment jsdom

import { cleanup, render, waitFor } from '@testing-library/react';
import { Effect } from 'effect';
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
const multiplayerStateMock = vi.hoisted(() => ({
  current: {
    sessionState: null as unknown,
    client: null as unknown,
    stopHosting: vi.fn(),
  },
}));
const setCameraMock = vi.hoisted(() => vi.fn());
const renderFromEntitiesSpy = vi.hoisted(() => vi.fn());
const sampleInterpolatedMock = vi.hoisted(() => vi.fn(() => undefined as unknown));
const projectMock = vi.hoisted(() => vi.fn<(snapshot: unknown) => unknown[]>());

vi.mock('@tileborne/runtime', () => ({
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
    apply = vi.fn();
    sampleInterpolatedFullState = sampleInterpolatedMock;
    getCurrentFullState = vi.fn(() => undefined);
    getPreviousFullState = vi.fn(() => undefined);
  },
  // Neutral input-resolver stubs (ADR-0024): the input bridge constructs an
  // InputResolver + raw-event values; these overlay tests do not dispatch input.
  InputResolver: class InputResolver {
    apply = vi.fn();
    resolve = vi.fn(() => ({ digital: new Map(), analog: new Map(), pointer: new Map() }));
  },
  KeyInputEvent: class KeyInputEvent {
    constructor(props: Record<string, unknown>) {
      Object.assign(this, props);
    }
  },
  MouseMoveInputEvent: class MouseMoveInputEvent {
    constructor(props: Record<string, unknown>) {
      Object.assign(this, props);
    }
  },
  MouseButtonInputEvent: class MouseButtonInputEvent {
    constructor(props: Record<string, unknown>) {
      Object.assign(this, props);
    }
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
        : { ...value, x: prior.x + (value.x - prior.x) * resolved, y: prior.y + (value.y - prior.y) * resolved };
    });
  },
}));

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

vi.mock('@/lib/playtest-plugin-bridge', async () => ({
  BATTLE_ROYALE_PLUGIN_ID: (
    await vi.importActual<typeof import('@tileborne/plugin-battle-royale/constants')>(
      '@tileborne/plugin-battle-royale/constants',
    )
  ).PLUGIN_ID,
  resolvePlaytestPlugin: vi.fn(() => ({
    projector: { mergeFrame: vi.fn(), project: projectMock },
    bundledAssets: [],
    manifest: { fixedZoom: 4, hudInsets: { top: 0, right: 0, bottom: 0, left: 0 } },
    decodeServerFrame: vi.fn(() => undefined),
    inputMap: { id: 'test', actions: [], schemeDefaults: {} },
    controlScheme: 'keyboard-mouse',
    inputCaptureProfile: { boundKeyCodes: new Set<string>(), usesMouseButtons: false },
    resolveInputIntent: vi.fn(() => ({ dir: undefined, shoot: false })),
  })),
}));

vi.mock('@/components/playtest-overlay', () => ({ PlaytestOverlay: () => null }));
vi.mock('@/components/playtest-hud-overlay', () => ({ PlaytestHudOverlay: () => null }));

const stablePlayerModels = vi.hoisted(() => ({
  builtModels: [] as const,
  selectedModelId: undefined,
  roster: [] as const,
}));
vi.mock('@/hooks/use-playtest-player-models', () => ({
  usePlaytestPlayerModels: () => stablePlayerModels,
  assemblePlaytestPlayerModelConfig: vi.fn(),
}));

vi.mock('@/stores/playtest-multiplayer-store', () => {
  const usePlaytestMultiplayerStore = (
    selector: (value: typeof multiplayerStateMock.current) => unknown,
  ) => selector(multiplayerStateMock.current);
  return { usePlaytestMultiplayerStore };
});

vi.mock('@/stores/editor-ui-store', () => {
  const useEditorUiStore = (selector: (value: typeof editorStateMock.current) => unknown) =>
    selector(editorStateMock.current);
  return {
    useEditorUiStore: Object.assign(useEditorUiStore, {
      getState: () => editorStateMock.current,
    }),
  };
});

import { PlaytestMultiplayerViewport } from './playtest-multiplayer-viewport';

class ResizeObserverStub {
  observe = vi.fn();
  disconnect = vi.fn();
}

// The mount effect keys on the `map` object identity, so a stable instance is
// shared across rerenders; passing a fresh map would remount the viewport.
const stableMap = createTestMap();

const viewport = () => <PlaytestMultiplayerViewport projectId="project-1" map={stableMap} />;

const renderViewport = () => render(viewport());

describe('PlaytestMultiplayerViewport overlay wiring', () => {
  beforeEach(() => {
    resetViewportDisposeChainForTests();
    controllerCtorMock.mockReset();
    setShowGridMock.mockReset();
    setShowDebugMock.mockReset();
    setShowCollisionMock.mockReset();
    setCameraMock.mockReset();
    renderFromEntitiesSpy.mockReset();
    sampleInterpolatedMock.mockReset();
    sampleInterpolatedMock.mockReturnValue(undefined);
    projectMock.mockReset();
    projectMock.mockReturnValue([]);
    editorStateMock.current = {
      showGrid: true,
      showDebugOverlay: false,
      showCollisionOverlay: false,
    };
    multiplayerStateMock.current = {
      sessionState: null,
      client: null,
      stopHosting: vi.fn(),
    };
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 0));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
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

  // Regression lock for the snapshot-interpolation smoothness fix: the
  // follow-camera must track the INTERPOLATED local-player position (not the
  // discrete latest snapshot), and the renderer must receive an empty
  // previous-by-id map with alpha 1 so it does not lerp a second time.
  it('drives the camera from the interpolated local entity and renders without a double lerp', async () => {
    const fakeClient = {
      setSnapshotFrameListener: vi.fn(() => vi.fn()),
      getLocalPlayerId: vi.fn(() => 'p1'),
      sendInput: vi.fn(),
    };
    multiplayerStateMock.current.client = fakeClient;

    const previousSnapshot = { tag: 'previous' };
    const currentSnapshot = { tag: 'current' };
    // Local player walks from (0,0) -> (10,20); at alpha 0.5 the interpolated
    // position is (5,10). The discrete `current` would be (10,20).
    projectMock.mockImplementation((snapshot: unknown) => {
      if (snapshot === currentSnapshot) {
        return [{ id: 'br:player:p1', assetId: 'pet', x: 10, y: 20 }];
      }
      if (snapshot === previousSnapshot) {
        return [{ id: 'br:player:p1', assetId: 'pet', x: 0, y: 0 }];
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
    expect(projected).toEqual([
      { id: 'br:player:p1', assetId: 'pet', x: 0, y: 0, scale: 4 },
    ]);
  });
});

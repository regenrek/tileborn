// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MainIpcRegistry, registerIpcHandlers } from '@tileborne/ipc-contracts';
import { Effect, Schema } from 'effect';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { TextDecoder, TextEncoder } from 'node:util';
import React, { type PropsWithChildren, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  gameModeIdFromPluginId,
  MapId,
  PluginId,
  ProjectId,
  type TileborneMap,
} from '@tileborne/core';

import { createTestMap } from '@/editor/test-fixtures';
import { useEditorUiStore } from '@/stores/editor-ui-store';
import { PlaytestTab } from '@/components/bottom-drawer/playtest-tab';
import { MapEditorPage } from '../../renderer/routes/map-editor-page';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
    getVersion: () => '0.0.0-test',
  },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: {},
  shell: {},
}));

const routeParams = vi.hoisted(() => ({
  current: { projectId: '', mapId: '' },
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { readonly children: ReactNode }) => <a>{children}</a>,
  useParams: () => routeParams.current,
  useSearch: () => ({}),
}));

vi.mock('@tileborne/runtime', async () => {
  const actual = await vi.importActual<typeof import('@tileborne/runtime')>('@tileborne/runtime');
  return {
    ...actual,
    PixiRendererAdapter: class PixiRendererAdapter {
      mount = vi.fn(() => Effect.succeed(undefined));
      loadAssets = vi.fn(() => Effect.succeed(new Map()));
      loadBundledAssets = vi.fn(() => Effect.succeed(undefined));
      renderFromEntities = vi.fn(() => Effect.succeed(undefined));
      dispose = vi.fn(() => Effect.succeed(undefined));
    },
    SnapshotEntityStore: class SnapshotEntityStore {
      apply = vi.fn();
      sampleInterpolatedFullState = vi.fn(() => undefined);
      getCurrentFullState = vi.fn(() => undefined);
    },
  };
});

vi.mock('@/editor/viewport/editor-viewport-controller', () => ({
  EditorViewportController: class EditorViewportController {
    setMap = vi.fn();
    resize = vi.fn();
    setCamera = vi.fn();
    setShowGrid = vi.fn();
    setShowDebug = vi.fn();
    setShowCollision = vi.fn();
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

vi.mock('@/components/map-editor-viewport', () => ({
  MapEditorViewport: () => <div data-testid="editor-viewport" />,
}));

vi.mock('@/components/map-editor-toolbar', () => ({
  MapEditorToolbar: () => <div data-testid="editor-toolbar" />,
}));

vi.mock('@/components/playtest-multiplayer-viewport', () => ({
  PlaytestMultiplayerViewport: () => <div data-testid="multiplayer-playtest-viewport" />,
}));

vi.mock('@/hooks/use-playtest-player-models', () => ({
  assemblePlaytestOverlayVisualConfig: vi.fn(),
  assemblePlaytestPlayerModelConfig: vi.fn(),
  assemblePlaytestWeaponVisualConfig: vi.fn(),
  usePlaytestOverlayVisuals: () => ({ builtOverlays: [] }),
  usePlaytestPlayerModels: () => ({ builtModels: [], selectedModelId: undefined }),
  usePlaytestWeaponVisuals: () => ({ builtWeapons: [] }),
}));

vi.mock('@/lib/playtest-plugin-bridge', () => ({
  audioCueForResolvedIntent: vi.fn(() => undefined),
  dispatchRuntimeAudioEvent: vi.fn(),
  resolvePlaytestPlugin: vi.fn(() => ({
    audio: undefined,
    bundledAssets: [],
    decodeServerFrame: vi.fn(() => undefined),
    fixedZoom: 1,
    hudLayout: undefined,
    inputCaptureProfile: undefined,
    inputMap: { schemeDefaults: {} },
    manifest: { fixedZoom: 1 },
    projector: {
      mergeFrame: vi.fn(),
      project: vi.fn(() => []),
    },
    resolveInputIntent: vi.fn(() => ({
      abilities: [],
      drop: false,
      interact: false,
      reload: false,
      shoot: false,
    })),
  })),
}));

const TEST_PLUGIN_ID = '@tileborne-plugins/renderer-owner-integration';
const TEST_PLUGIN_BRAND = Schema.decodeUnknownSync(PluginId)(TEST_PLUGIN_ID);
// This mounted integration assembles runtime packages, registers main IPC handlers, and renders
// the editor shell; it is intentionally broader than a unit test and needs headroom under CI load.
const MOUNTED_PLAYTEST_OWNER_INTEGRATION_TIMEOUT_MS = 20_000;
const projectId = (value: string): ProjectId => Schema.decodeUnknownSync(ProjectId)(value);
const mapId = (value: string): MapId => Schema.decodeUnknownSync(MapId)(value);
const createRuntimeMap = (mapId: string): TileborneMap =>
  Object.assign(createTestMap(), { id: Schema.decodeUnknownSync(MapId)(mapId) });

const withTempHome = async <A,>(run: (home: string) => Promise<A>): Promise<A> => {
  const previous = process.env['TILEBORNE_HOME'];
  const home = await mkdtemp(path.join(tmpdir(), 'tileborne-renderer-owner-'));
  process.env['TILEBORNE_HOME'] = home;
  try {
    return await run(home);
  } finally {
    if (previous === undefined) {
      delete process.env['TILEBORNE_HOME'];
    } else {
      process.env['TILEBORNE_HOME'] = previous;
    }
    await rm(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
};

const createHarness = async () => {
  const [{ AppLayer }, { buildMainIpcHandlersForTests }, { createDesktopUpdaterController }] =
    await Promise.all([
      import('../app-layer.js'),
      import('../ipc/handlers.js'),
      import('../updater.js'),
    ]);
  const registeredHandlers = new Map<string, (payload: unknown) => Promise<unknown>>();
  const transport = {
    handle: (channel: string, handler: (payload: unknown) => Promise<unknown>) => {
      registeredHandlers.set(channel, handler);
      return () => registeredHandlers.delete(channel);
    },
    emit: vi.fn(),
  };
  const packet = await Effect.runPromise(
    buildMainIpcHandlersForTests(
      createDesktopUpdaterController({ currentVersion: '0.0.0-test', packaged: false }),
    ).pipe(Effect.provide(AppLayer)),
  );
  const registration = registerIpcHandlers(MainIpcRegistry, transport, packet.handlers);
  const invoke = async (channel: string, payload: unknown) => {
    const handler = registeredHandlers.get(channel);
    if (handler === undefined) throw new Error(`No IPC handler for ${channel}`);
    const response = await handler(payload);
    if (
      typeof response === 'object' &&
      response !== null &&
      '_tag' in response &&
      typeof (response as { readonly _tag: unknown })._tag === 'string' &&
      String((response as { readonly _tag: string })._tag).startsWith('Ipc')
    ) {
      throw new Error((response as { readonly message?: string }).message ?? 'IPC request failed');
    }
    return response;
  };
  return { ...packet, invoke, unregister: registration.unregister };
};

const installRuntimeFixture = async (root: string): Promise<string> => {
  const pluginRoot = path.join(root, 'runtime-plugin');
  await mkdir(path.join(pluginRoot, 'dist'), { recursive: true });
  const runtimeEntry = path.resolve(
    import.meta.dirname,
    '__fixtures__/playtest-runtime-stop-once.mjs',
  );
  await writeFile(
    path.join(pluginRoot, 'tileborne-plugin.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        id: TEST_PLUGIN_ID,
        name: TEST_PLUGIN_ID,
        version: '0.0.1',
        entry: { runtime: runtimeEntry },
        contributes: {},
        permissions: [],
        dependsOn: [],
      },
      null,
      2,
    ),
    'utf8',
  );
  return pluginRoot;
};

const installFreshStopOnceRuntimeFixture = async (root: string): Promise<string> => {
  const pluginRoot = path.join(root, 'runtime-plugin-fresh-stop-once');
  await mkdir(path.join(pluginRoot, 'dist'), { recursive: true });
  const runtimeEntry = path.resolve(
    import.meta.dirname,
    '__fixtures__/playtest-runtime-stop-once-deferred.mjs',
  );
  await writeFile(
    path.join(pluginRoot, 'tileborne-plugin.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        id: TEST_PLUGIN_ID,
        name: TEST_PLUGIN_ID,
        version: '0.0.1',
        entry: { runtime: runtimeEntry },
        contributes: {},
        permissions: [],
        dependsOn: [],
      },
      null,
      2,
    ),
    'utf8',
  );
  return pluginRoot;
};

const installCleanRuntimeFixture = async (root: string): Promise<string> => {
  const pluginRoot = path.join(root, 'runtime-plugin-clean');
  await mkdir(path.join(pluginRoot, 'dist'), { recursive: true });
  const runtimeEntry = path.resolve(
    import.meta.dirname,
    '__fixtures__/playtest-runtime-clean.mjs',
  );
  await writeFile(
    path.join(pluginRoot, 'tileborne-plugin.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        id: TEST_PLUGIN_ID,
        name: TEST_PLUGIN_ID,
        version: '0.0.1',
        entry: { runtime: runtimeEntry },
        contributes: {},
        permissions: [],
        dependsOn: [],
      },
      null,
      2,
    ),
    'utf8',
  );
  return pluginRoot;
};

const startRuntime = async (input: {
  readonly sessionId: string;
  readonly projectId: string;
  readonly mapId: string;
  readonly map: TileborneMap;
  readonly root: string;
  readonly pluginRoot: string;
}): Promise<void> => {
  const [{ assembleRuntimeMapPackage }, { startPlaytestRuntimeHost }] = await Promise.all([
    import('@tileborne/services-build'),
    import('../playtest-runtime-host.js'),
  ]);
  const artifactDirectory = path.join(input.root, `artifact-${input.sessionId.split(':').at(-1)}`);
  await mkdir(artifactDirectory, { recursive: true });
  await Effect.runPromise(
    assembleRuntimeMapPackage({
      projectId: input.projectId,
      map: input.map,
      activeMode: {
        modeId: gameModeIdFromPluginId(TEST_PLUGIN_BRAND),
        pluginId: TEST_PLUGIN_BRAND,
      },
      pluginCatalogs: [],
      playerCapacity: 1,
      playerModels: [],
      engineVersion: '0.0.0-test',
      outputDirectory: artifactDirectory,
    }),
  );
  await startPlaytestRuntimeHost({
    sessionId: input.sessionId,
    projectId: projectId(input.projectId),
    mapId: mapId(input.mapId),
    packageDirectory: artifactDirectory,
    pluginInstalls: [{ pluginId: TEST_PLUGIN_ID, rootPath: input.pluginRoot }],
  });
};

const setSinglePlaytest = (sessionId: string | null) => {
  useEditorUiStore.setState({
    playtestActive: sessionId !== null,
    playtestMode: sessionId === null ? 'none' : 'single',
    playtestSessionId: sessionId,
    playtestActivePlugins: sessionId === null ? [] : [TEST_PLUGIN_ID],
  });
};

const renderWithClient = (ui: ReactNode) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const Wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, ...render(ui, { wrapper: Wrapper }) };
};

const getStopPlaytestButtons = (): HTMLButtonElement[] =>
  screen
    .getAllByRole('button', { name: /stop playtest/i })
    .filter((button): button is HTMLButtonElement => button instanceof HTMLButtonElement);

const clickConfirmedStop = async (buttonIndex = 0) => {
  fireEvent.click(getStopPlaytestButtons()[buttonIndex]!);
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: /stop playtest/i }),
  );
};

const createGate = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};

describe('MapEditorPage mounted playtest ownership integration', () => {
  const sessionIds: string[] = [];

  beforeEach(() => {
    vi.useRealTimers();
    const NodeUint8Array = new TextEncoder().encode('').constructor;
    Object.assign(globalThis, { TextDecoder, TextEncoder, Uint8Array: NodeUint8Array });
    Object.assign(globalThis, {
      ResizeObserver: class ResizeObserver {
        observe() {}
        disconnect() {}
      },
    });
    Object.assign(window, {
      requestAnimationFrame: (callback: FrameRequestCallback) =>
        window.setTimeout(() => callback(performance.now()), 16),
      cancelAnimationFrame: (handle: number) => window.clearTimeout(handle),
    });
    useEditorUiStore.setState({
      playtestActive: false,
      playtestMode: 'none',
      playtestSessionId: null,
      playtestActivePlugins: [],
    });
  });

  afterEach(async () => {
    cleanup();
    const { stopPlaytestRuntimeHost } = await import('../playtest-runtime-host.js');
    for (const sessionId of sessionIds.splice(0)) {
      await stopPlaytestRuntimeHost(sessionId).catch(() => undefined);
    }
    delete (window as unknown as { tileborne?: unknown }).tileborne;
  });

  it('drives owner cleanup through the mounted page, viewport, control hook, IPC handler, service, and runtime', async () =>
    withTempHome(async (home) => {
      const harness = await createHarness();
      const pluginRoot = await installRuntimeFixture(home);
      const stopCalls: unknown[] = [];
      const stopRejections: string[] = [];
      let pendingPlaytestListGate:
        | { readonly promise: Promise<void>; readonly release: () => void }
        | undefined;
      const readPlaytestList = () =>
        harness.invoke('tileborne:playtest:list', {}) as Promise<{
          readonly sessions: readonly { readonly id: string; readonly status: string }[];
        }>;
      const list = async () => {
        await pendingPlaytestListGate?.promise;
        return readPlaytestList();
      };
      const gatePlaytestList = () => {
        pendingPlaytestListGate = createGate();
        return () => {
          pendingPlaytestListGate?.release();
          pendingPlaytestListGate = undefined;
        };
      };
      (window as unknown as { tileborne: unknown }).tileborne = {
        events: { onRuntimeSnapshot: vi.fn(() => () => undefined) },
        runtime: {
          playtestInput: vi.fn(async () => ({})),
          playtestSnapshot: vi.fn(async () => ({ players: [] })),
        },
        maps: {
          get: (input: unknown) => harness.invoke('tileborne:maps:get', input),
          list: (input: unknown) => harness.invoke('tileborne:maps:list', input),
        },
        projects: {
          get: (input: unknown) => harness.invoke('tileborne:projects:get', input),
        },
        plugins: {
          listContributions: vi.fn(async () => ({
            panels: [],
            tools: [],
            gameModes: [
              {
                id: 'renderer-owner-integration',
                pluginId: TEST_PLUGIN_ID,
                label: 'Renderer Owner Integration',
                rendererCapabilityId: TEST_PLUGIN_ID,
              },
            ],
          })),
        },
        audio: { open: vi.fn(async () => ({ document: undefined })) },
        gameShell: { open: vi.fn(async () => ({ projection: undefined })) },
        playtest: {
          list,
          lifecycleControl: (input: unknown) =>
            harness.invoke('tileborne:playtest:lifecycleControl', input),
          shellEvent: vi.fn(async () => ({ requests: [] })),
          start: vi.fn(async () => {
            throw new Error('renderer start is outside this owner-cleanup integration');
          }),
          stop: (input: unknown) => {
            stopCalls.push(input);
            return harness.invoke('tileborne:playtest:stop', input).catch((error: unknown) => {
              stopRejections.push(error instanceof Error ? error.message : String(error));
              throw error;
            });
          },
        },
      };

      try {
        const createdProject = (await harness.invoke('tileborne:projects:create', {
          name: 'Renderer Owner Integration',
        })) as { readonly projectId: string };
        const firstMap = (await harness.invoke('tileborne:maps:create', {
          projectId: createdProject.projectId,
          width: 16,
          height: 16,
        })) as { readonly mapId: string };
        const secondMap = (await harness.invoke('tileborne:maps:create', {
          projectId: createdProject.projectId,
          width: 16,
          height: 16,
        })) as { readonly mapId: string };
        routeParams.current = {
          projectId: createdProject.projectId,
          mapId: firstMap.mapId,
        };

        const firstSession = await Effect.runPromise(
          harness.playtest.start(projectId(createdProject.projectId), mapId(firstMap.mapId)),
        );
        sessionIds.push(firstSession.id);
        await startRuntime({
          sessionId: firstSession.id,
          projectId: createdProject.projectId,
          mapId: firstMap.mapId,
          map: createRuntimeMap(firstMap.mapId),
          root: home,
          pluginRoot,
        });
        setSinglePlaytest(firstSession.id);
        const runtimeHost = await import('../playtest-runtime-host.js');

        const page = renderWithClient(
          <>
            <MapEditorPage />
            <PlaytestTab />
          </>,
        );
        await screen.findByTestId('playtest-viewport');
        await waitFor(() => expect(runtimeHost.getActivePlaytestRuntimeCountForTests()).toBe(1));

        await expect(
          window.tileborne.playtest.stop({
            sessionId: firstSession.id,
            projectId: projectId(createdProject.projectId),
            mapId: mapId(secondMap.mapId),
          }),
        ).rejects.toThrow('playtest session owner mismatch');
        expect(runtimeHost.getPlaytestRuntimeMetrics(firstSession.id)).toBeDefined();
        expect(
          (await list()).sessions.filter((session) => session.status === 'Running'),
        ).toHaveLength(1);

        await clickConfirmedStop();
        await waitFor(() =>
          expect(stopCalls).toContainEqual({
            sessionId: firstSession.id,
            projectId: createdProject.projectId,
            mapId: firstMap.mapId,
          }),
        );
        expect(runtimeHost.getActivePlaytestRuntimeCountForTests()).toBe(1);
        expect(
          (await readPlaytestList()).sessions.filter((session) => session.status === 'Running'),
        ).toHaveLength(1);
        expect(runtimeHost.getPlaytestRuntimeMetrics(firstSession.id)).toBeDefined();
        expect(getStopPlaytestButtons()[0]).toHaveProperty('disabled', false);

        await clickConfirmedStop();
        await waitFor(() => {
          expect(stopCalls).toContainEqual({
            sessionId: firstSession.id,
            projectId: createdProject.projectId,
            mapId: firstMap.mapId,
          });
        });
        await waitFor(() => expect(runtimeHost.getActivePlaytestRuntimeCountForTests()).toBe(0));
        await waitFor(async () =>
          expect(
            (await list()).sessions.filter((session) => session.status === 'Running'),
          ).toHaveLength(0),
        );

        const staleSession = await Effect.runPromise(
          harness.playtest.start(projectId(createdProject.projectId), mapId(firstMap.mapId)),
        );
        sessionIds.push(staleSession.id);
        await startRuntime({
          sessionId: staleSession.id,
          projectId: createdProject.projectId,
          mapId: firstMap.mapId,
          map: createRuntimeMap(firstMap.mapId),
          root: home,
          pluginRoot,
        });
        setSinglePlaytest(staleSession.id);
        page.rerender(
          <>
            <MapEditorPage />
            <PlaytestTab />
          </>,
        );
        await screen.findByTestId('playtest-viewport');

        const replacementSession = await Effect.runPromise(
          harness.playtest.start(projectId(createdProject.projectId), mapId(secondMap.mapId)),
        );
        sessionIds.push(replacementSession.id);
        await startRuntime({
          sessionId: replacementSession.id,
          projectId: createdProject.projectId,
          mapId: secondMap.mapId,
          map: createRuntimeMap(secondMap.mapId),
          root: home,
          pluginRoot,
        });
        routeParams.current = {
          projectId: createdProject.projectId,
          mapId: secondMap.mapId,
        };
        setSinglePlaytest(replacementSession.id);
        const releaseRegisteredPlaytestList = gatePlaytestList();
        page.rerender(
          <>
            <MapEditorPage />
            <PlaytestTab />
          </>,
        );

        await waitFor(() =>
          expect(runtimeHost.getPlaytestRuntimeMetrics(staleSession.id)).toBeUndefined(),
        );
        expect(runtimeHost.getPlaytestRuntimeMetrics(replacementSession.id)).toBeDefined();
        await waitFor(() =>
          expect(
            screen.getByTestId('playtest-runtime-shell').getAttribute('data-shell-cache-key'),
          ).toBe(`${createdProject.projectId}:${secondMap.mapId}`),
        );

        const replacementStopCallCount = stopCalls.length;
        const unloadedDrawerStop = getStopPlaytestButtons().at(-1);
        expect(unloadedDrawerStop).toBeDefined();
        expect(unloadedDrawerStop).toHaveProperty('disabled', true);
        fireEvent.click(unloadedDrawerStop!);
        expect(stopCalls).toHaveLength(replacementStopCallCount);

        releaseRegisteredPlaytestList();
        await waitFor(() =>
          expect(getStopPlaytestButtons().at(-1)).toHaveProperty('disabled', false),
        );
        const replacementOwner = {
          sessionId: replacementSession.id,
          projectId: createdProject.projectId,
          mapId: secondMap.mapId,
        };
        const replacementStopCalls = () =>
          stopCalls.filter((call) => {
            if (typeof call !== 'object' || call === null) return false;
            const owner = call as {
              readonly sessionId?: unknown;
              readonly projectId?: unknown;
              readonly mapId?: unknown;
            };
            return (
              owner.sessionId === replacementOwner.sessionId &&
              owner.projectId === replacementOwner.projectId &&
              owner.mapId === replacementOwner.mapId
            );
          });
        fireEvent.click(getStopPlaytestButtons().at(-1)!);
        await waitFor(() => expect(replacementStopCalls()).toHaveLength(1));
        await waitFor(() => expect(runtimeHost.getActivePlaytestRuntimeCountForTests()).toBe(0));
        await waitFor(async () =>
          expect(
            (await readPlaytestList()).sessions.filter((session) => session.status === 'Running'),
          ).toHaveLength(0),
        );

        page.unmount();
        expect(replacementStopCalls()).toHaveLength(1);
        expect(stopRejections).not.toContain(
          `playtest runtime owner mismatch or inactive runtime for ${replacementSession.id}`,
        );
        await waitFor(() => expect(runtimeHost.getActivePlaytestRuntimeCountForTests()).toBe(0));
        await waitFor(async () =>
          expect(
            (await list()).sessions.filter((session) => session.status === 'Running'),
          ).toHaveLength(0),
        );
      } finally {
        harness.unregister();
      }
    }),
    MOUNTED_PLAYTEST_OWNER_INTEGRATION_TIMEOUT_MS);

  it('does not stop a mounted playtest during StrictMode effect replay', async () =>
    withTempHome(async (home) => {
      const harness = await createHarness();
      const pluginRoot = await installCleanRuntimeFixture(home);
      const stopCalls: unknown[] = [];
      const readPlaytestList = () =>
        harness.invoke('tileborne:playtest:list', {}) as Promise<{
          readonly sessions: readonly { readonly id: string; readonly status: string }[];
        }>;

      try {
        const createdProject = (await harness.invoke('tileborne:projects:create', {
          name: 'Renderer Owner StrictMode Integration',
        })) as { readonly projectId: string };
        const firstMap = (await harness.invoke('tileborne:maps:create', {
          projectId: createdProject.projectId,
          width: 16,
          height: 16,
        })) as { readonly mapId: string };
        routeParams.current = {
          projectId: createdProject.projectId,
          mapId: firstMap.mapId,
        };

        (window as unknown as { tileborne: unknown }).tileborne = {
          events: { onRuntimeSnapshot: vi.fn(() => () => undefined) },
          runtime: {
            playtestInput: vi.fn(async () => ({})),
            playtestSnapshot: vi.fn(async () => ({ players: [] })),
          },
          maps: {
            get: (input: unknown) => harness.invoke('tileborne:maps:get', input),
            list: (input: unknown) => harness.invoke('tileborne:maps:list', input),
          },
          projects: {
            get: (input: unknown) => harness.invoke('tileborne:projects:get', input),
          },
          plugins: {
            listContributions: vi.fn(async () => ({
              panels: [],
              tools: [],
              gameModes: [
                {
                  id: 'renderer-owner-integration',
                  pluginId: TEST_PLUGIN_ID,
                  label: 'Renderer Owner Integration',
                  rendererCapabilityId: TEST_PLUGIN_ID,
                },
              ],
            })),
          },
          audio: { open: vi.fn(async () => ({ document: undefined })) },
          gameShell: { open: vi.fn(async () => ({ projection: undefined })) },
          playtest: {
            list: readPlaytestList,
            lifecycleControl: (input: unknown) =>
              harness.invoke('tileborne:playtest:lifecycleControl', input),
            shellEvent: vi.fn(async () => ({ requests: [] })),
            start: vi.fn(async () => {
              throw new Error('renderer start is outside this owner-cleanup integration');
            }),
            stop: (input: unknown) => {
              stopCalls.push(input);
              return harness.invoke('tileborne:playtest:stop', input);
            },
          },
        };

        const session = await Effect.runPromise(
          harness.playtest.start(projectId(createdProject.projectId), mapId(firstMap.mapId)),
        );
        sessionIds.push(session.id);
        await startRuntime({
          sessionId: session.id,
          projectId: createdProject.projectId,
          mapId: firstMap.mapId,
          map: createRuntimeMap(firstMap.mapId),
          root: home,
          pluginRoot,
        });
        setSinglePlaytest(session.id);
        const runtimeHost = await import('../playtest-runtime-host.js');

        const page = renderWithClient(
          <React.StrictMode>
            <MapEditorPage />
            <PlaytestTab />
          </React.StrictMode>,
        );
        await screen.findByTestId('playtest-viewport');
        await new Promise((resolve) => window.setTimeout(resolve, 0));
        expect(stopCalls).toHaveLength(0);
        expect(runtimeHost.getActivePlaytestRuntimeCountForTests()).toBe(1);
        expect(
          (await readPlaytestList()).sessions.filter((entry) => entry.status === 'Running'),
        ).toHaveLength(1);

        page.unmount();
        await waitFor(() =>
          expect(stopCalls).toEqual([
            {
              sessionId: session.id,
              projectId: createdProject.projectId,
              mapId: firstMap.mapId,
            },
          ]),
        );
        await waitFor(() => expect(runtimeHost.getActivePlaytestRuntimeCountForTests()).toBe(0));
        await waitFor(async () =>
          expect(
            (await readPlaytestList()).sessions.filter((entry) => entry.status === 'Running'),
          ).toHaveLength(0),
        );
      } finally {
        harness.unregister();
      }
    }),
    MOUNTED_PLAYTEST_OWNER_INTEGRATION_TIMEOUT_MS);

  it('deduplicates a successful registered drawer stop when viewport cleanup unmounts before it settles', async () =>
    withTempHome(async (home) => {
      const harness = await createHarness();
      const pluginRoot = await installCleanRuntimeFixture(home);
      const stopCalls: unknown[] = [];
      const stopRejections: string[] = [];
      const drawerStopGate = createGate();
      let drawerStopDeferred = false;
      let registeredStopCompleted = false;
      const readPlaytestList = () =>
        harness.invoke('tileborne:playtest:list', {}) as Promise<{
          readonly sessions: readonly { readonly id: string; readonly status: string }[];
        }>;

      try {
        const createdProject = (await harness.invoke('tileborne:projects:create', {
          name: 'Renderer Owner Pending Success Integration',
        })) as { readonly projectId: string };
        const firstMap = (await harness.invoke('tileborne:maps:create', {
          projectId: createdProject.projectId,
          width: 16,
          height: 16,
        })) as { readonly mapId: string };
        routeParams.current = {
          projectId: createdProject.projectId,
          mapId: firstMap.mapId,
        };

        (window as unknown as { tileborne: unknown }).tileborne = {
          events: { onRuntimeSnapshot: vi.fn(() => () => undefined) },
          runtime: {
            playtestInput: vi.fn(async () => ({})),
            playtestSnapshot: vi.fn(async () => ({ players: [] })),
          },
          maps: {
            get: (input: unknown) => harness.invoke('tileborne:maps:get', input),
            list: (input: unknown) => harness.invoke('tileborne:maps:list', input),
          },
          projects: {
            get: (input: unknown) => harness.invoke('tileborne:projects:get', input),
          },
          plugins: {
            listContributions: vi.fn(async () => ({
              panels: [],
              tools: [],
              gameModes: [
                {
                  id: 'renderer-owner-integration',
                  pluginId: TEST_PLUGIN_ID,
                  label: 'Renderer Owner Integration',
                  rendererCapabilityId: TEST_PLUGIN_ID,
                },
              ],
            })),
          },
          audio: { open: vi.fn(async () => ({ document: undefined })) },
          gameShell: { open: vi.fn(async () => ({ projection: undefined })) },
          playtest: {
            list: readPlaytestList,
            lifecycleControl: (input: unknown) =>
              harness.invoke('tileborne:playtest:lifecycleControl', input),
            shellEvent: vi.fn(async () => ({ requests: [] })),
            start: vi.fn(async () => {
              throw new Error('renderer start is outside this owner-cleanup integration');
            }),
            stop: (input: unknown) => {
              stopCalls.push(input);
              const registeredStop = harness
                .invoke('tileborne:playtest:stop', input)
                .then((value) => {
                  registeredStopCompleted = true;
                  return value;
                })
                .catch((error: unknown) => {
                  const message = error instanceof Error ? error.message : String(error);
                  stopRejections.push(message);
                  throw error;
                });
              const owner = input as {
                readonly sessionId?: string;
                readonly projectId?: string;
                readonly mapId?: string;
              };
              if (
                !drawerStopDeferred &&
                owner.sessionId === session.id &&
                owner.projectId === createdProject.projectId &&
                owner.mapId === firstMap.mapId
              ) {
                drawerStopDeferred = true;
                return registeredStop.then(
                  (value) => drawerStopGate.promise.then(() => value),
                  (error: unknown) =>
                    drawerStopGate.promise.then(() => Promise.reject(error)),
                );
              }
              return registeredStop;
            },
          },
        };

        const session = await Effect.runPromise(
          harness.playtest.start(projectId(createdProject.projectId), mapId(firstMap.mapId)),
        );
        sessionIds.push(session.id);
        await startRuntime({
          sessionId: session.id,
          projectId: createdProject.projectId,
          mapId: firstMap.mapId,
          map: createRuntimeMap(firstMap.mapId),
          root: home,
          pluginRoot,
        });
        setSinglePlaytest(session.id);
        const runtimeHost = await import('../playtest-runtime-host.js');

        const page = renderWithClient(
          <>
            <MapEditorPage />
            <PlaytestTab />
          </>,
        );
        await screen.findByTestId('playtest-viewport');
        await waitFor(() => expect(runtimeHost.getActivePlaytestRuntimeCountForTests()).toBe(1));

        await clickConfirmedStop();
        await waitFor(() => expect(stopCalls).toHaveLength(1));
        await waitFor(() => expect(registeredStopCompleted).toBe(true));
        expect(drawerStopDeferred).toBe(true);
        expect(stopCalls).toEqual([
          {
            sessionId: session.id,
            projectId: createdProject.projectId,
            mapId: firstMap.mapId,
          },
        ]);

        page.unmount();
        expect(stopCalls).toHaveLength(1);
        drawerStopGate.release();

        await waitFor(() => expect(stopCalls).toHaveLength(1));
        expect(stopRejections).not.toContain(
          `playtest runtime owner mismatch or inactive runtime for ${session.id}`,
        );
        await waitFor(() => expect(runtimeHost.getActivePlaytestRuntimeCountForTests()).toBe(0));
        await waitFor(async () =>
          expect(
            (await readPlaytestList()).sessions.filter((entry) => entry.status === 'Running'),
          ).toHaveLength(0),
        );
      } finally {
        drawerStopGate.release();
        harness.unregister();
      }
    }),
    MOUNTED_PLAYTEST_OWNER_INTEGRATION_TIMEOUT_MS);

  it('retries the registered stop handler when unmount happens before explicit stop rejection settles', async () =>
    withTempHome(async (home) => {
      const harness = await createHarness();
      const pluginRoot = await installFreshStopOnceRuntimeFixture(home);
      const stopCalls: unknown[] = [];
      const firstOwnedStopGate = createGate();
      let firstOwnedStopDeferred = false;
      const readPlaytestList = () =>
        harness.invoke('tileborne:playtest:list', {}) as Promise<{
          readonly sessions: readonly { readonly id: string; readonly status: string }[];
        }>;
      const list = readPlaytestList;

      try {
        const createdProject = (await harness.invoke('tileborne:projects:create', {
          name: 'Renderer Owner Deferred Stop Integration',
        })) as { readonly projectId: string };
        const firstMap = (await harness.invoke('tileborne:maps:create', {
          projectId: createdProject.projectId,
          width: 16,
          height: 16,
        })) as { readonly mapId: string };
        routeParams.current = {
          projectId: createdProject.projectId,
          mapId: firstMap.mapId,
        };

        (window as unknown as { tileborne: unknown }).tileborne = {
          events: { onRuntimeSnapshot: vi.fn(() => () => undefined) },
          runtime: {
            playtestInput: vi.fn(async () => ({})),
            playtestSnapshot: vi.fn(async () => ({ players: [] })),
          },
          maps: {
            get: (input: unknown) => harness.invoke('tileborne:maps:get', input),
            list: (input: unknown) => harness.invoke('tileborne:maps:list', input),
          },
          projects: {
            get: (input: unknown) => harness.invoke('tileborne:projects:get', input),
          },
          plugins: {
            listContributions: vi.fn(async () => ({
              panels: [],
              tools: [],
              gameModes: [
                {
                  id: 'renderer-owner-integration',
                  pluginId: TEST_PLUGIN_ID,
                  label: 'Renderer Owner Integration',
                  rendererCapabilityId: TEST_PLUGIN_ID,
                },
              ],
            })),
          },
          audio: { open: vi.fn(async () => ({ document: undefined })) },
          gameShell: { open: vi.fn(async () => ({ projection: undefined })) },
          playtest: {
            list,
            lifecycleControl: (input: unknown) =>
              harness.invoke('tileborne:playtest:lifecycleControl', input),
            shellEvent: vi.fn(async () => ({ requests: [] })),
            start: vi.fn(async () => {
              throw new Error('renderer start is outside this owner-cleanup integration');
            }),
            stop: (input: unknown) => {
              stopCalls.push(input);
              const registeredStop = harness.invoke('tileborne:playtest:stop', input);
              const owner = input as {
                readonly sessionId?: string;
                readonly projectId?: string;
                readonly mapId?: string;
              };
              if (
                !firstOwnedStopDeferred &&
                owner.sessionId === session.id &&
                owner.projectId === createdProject.projectId &&
                owner.mapId === firstMap.mapId
              ) {
                firstOwnedStopDeferred = true;
                return registeredStop.then(
                  (value) => firstOwnedStopGate.promise.then(() => value),
                  (error: unknown) =>
                    firstOwnedStopGate.promise.then(() => Promise.reject(error)),
                );
              }
              return registeredStop;
            },
          },
        };

        const session = await Effect.runPromise(
          harness.playtest.start(projectId(createdProject.projectId), mapId(firstMap.mapId)),
        );
        sessionIds.push(session.id);
        await startRuntime({
          sessionId: session.id,
          projectId: createdProject.projectId,
          mapId: firstMap.mapId,
          map: createRuntimeMap(firstMap.mapId),
          root: home,
          pluginRoot,
        });
        setSinglePlaytest(session.id);
        const runtimeHost = await import('../playtest-runtime-host.js');

        const page = renderWithClient(
          <>
            <MapEditorPage />
            <PlaytestTab />
          </>,
        );
        await screen.findByTestId('playtest-viewport');
        await waitFor(() => expect(runtimeHost.getActivePlaytestRuntimeCountForTests()).toBe(1));

        await clickConfirmedStop();
        await waitFor(() => expect(stopCalls).toHaveLength(1));
        expect(firstOwnedStopDeferred).toBe(true);
        expect(runtimeHost.getActivePlaytestRuntimeCountForTests()).toBe(1);
        expect(
          (await readPlaytestList()).sessions.filter((entry) => entry.status === 'Running'),
        ).toHaveLength(1);

        page.unmount();
        expect(stopCalls).toHaveLength(1);
        firstOwnedStopGate.release();

        await waitFor(() =>
          expect(stopCalls).toEqual([
            {
              sessionId: session.id,
              projectId: createdProject.projectId,
              mapId: firstMap.mapId,
            },
            {
              sessionId: session.id,
              projectId: createdProject.projectId,
              mapId: firstMap.mapId,
            },
          ]),
        );
        await waitFor(() => expect(runtimeHost.getActivePlaytestRuntimeCountForTests()).toBe(0));
        await waitFor(async () =>
          expect(
            (await readPlaytestList()).sessions.filter((entry) => entry.status === 'Running'),
          ).toHaveLength(0),
        );
      } finally {
        firstOwnedStopGate.release();
        harness.unregister();
      }
    }),
    MOUNTED_PLAYTEST_OWNER_INTEGRATION_TIMEOUT_MS);
});

import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { normalizeAndMigratePersistedMapJson } from "@tileborne/core";
import type { BattleRoyaleAbilityId } from "@tileborne/ipc-contracts/protocols/battle-royale";
import { makeGameRuntime, makePluginHost, type RuntimePlugin } from "@tileborne/runtime";
import { Effect } from "effect";

import {
  createPlaytestRuntimeHudTracker,
  type PlaytestHudWorldStateDeriver,
  type PlaytestRuntimeHudState,
} from "./playtest-runtime-hud.js";
import { createPlaytestPluginWorld, type PlaytestPluginWorld } from "./playtest-plugin-world.js";
import {
  createPlaytestRuntimeDiagnosticsRecorder,
  type PlaytestRuntimeDiagnostics,
  type PlaytestRuntimeDiagnosticsRecorder,
} from "./playtest-runtime-diagnostics.js";

const TICK_RATE = 20;
const TICK_MS = 1000 / TICK_RATE;
const METRICS_NOTIFY_MS = 200;

export interface PlaytestRuntimeMetrics {
  readonly tickCount: number;
  readonly playerCount: number;
  readonly lastPluginEvent: string;
  readonly lastTickAtMs: number;
  readonly hud?: PlaytestRuntimeHudState;
  readonly diagnostics?: PlaytestRuntimeDiagnostics;
}

export interface PlaytestRuntimePlayerInput {
  readonly tick: number;
  readonly seq: number;
  readonly dir?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  readonly shoot: boolean;
  readonly reload: boolean;
  readonly interact: boolean;
  readonly drop: boolean;
  readonly abilities: readonly BattleRoyaleAbilityId[];
  readonly aimDeg?: number;
  readonly swapSlot?: number;
}

export interface PlaytestRuntimePlayerSnapshot {
  readonly playerId: string;
  readonly x: number;
  readonly y: number;
}

export interface PlaytestRuntimeSnapshot {
  readonly players: readonly PlaytestRuntimePlayerSnapshot[];
  readonly frame?: Uint8Array;
}

interface PlaytestSessionState {
  readonly inputByPlayerId: Map<string, PlaytestRuntimePlayerInput>;
  readonly world: PlaytestPluginWorld;
  readonly diagnosticsRecorder: PlaytestRuntimeDiagnosticsRecorder;
  seedFrame?: Uint8Array;
}

interface PlaytestTickPlugin {
  readonly id: string;
  readonly onInit?: (ctx: { pluginId: string }, world: PlaytestPluginWorld) => void;
  readonly onTick?: (world: PlaytestPluginWorld, dt: number, tick: number) => void;
  readonly onShutdown?: () => void;
}

interface RuntimePluginModule {
  readonly default?: PlaytestTickPlugin | RuntimePlugin;
  readonly plugin?: RuntimePlugin;
  readonly createRuntimeAdapter?: (host: {
    readonly getArtifact: () => unknown;
    readonly getPlayerInput?: (playerId: string) => PlaytestRuntimePlayerInput | undefined;
    readonly msgOut?: { readonly push: (frame: Uint8Array) => void };
    readonly setReplayFrames?: (frames: readonly Uint8Array[]) => void;
  }) => PlaytestTickPlugin;
  readonly exportArtifact?: (
    map: unknown,
    options?: {
      readonly playerModels?: readonly unknown[];
      readonly selectedPlayerModelId?: string;
      readonly objectTypes?: readonly unknown[];
    },
  ) => unknown;
  /**
   * Plugin-owned world→HUD derivation (HUD-state SSOT). When the runtime
   * bundle exports it, the host's HUD tracker delegates the per-tick world
   * slice (player status, scoreboard, minimap, zone phase) to the plugin.
   */
  readonly derivePlaytestHudWorldState?: PlaytestHudWorldStateDeriver;
}

interface ActivePlaytestRuntime {
  readonly getMetrics: () => PlaytestRuntimeMetrics;
  readonly interval?: ReturnType<typeof setInterval>;
  readonly stop: () => Promise<void>;
}

const activeRuntimes = new Map<string, ActivePlaytestRuntime>();
const sessionStates = new Map<string, PlaytestSessionState>();

type PlaytestRuntimeLogFields = Readonly<Record<string, unknown>>;

export interface PlaytestRuntimeLogger {
  readonly info: (message: string, fields?: PlaytestRuntimeLogFields) => Promise<void>;
  readonly error: (message: string, fields?: PlaytestRuntimeLogFields) => Promise<void>;
}

let notifyPlaytestChanged: (() => void) | undefined;
let lastNotifyAt = 0;

export const setPlaytestRuntimeChangedNotifier = (notifier: (() => void) | undefined): void => {
  notifyPlaytestChanged = notifier;
  lastNotifyAt = 0;
};

/**
 * Notifier invoked once per plugin-emitted snapshot frame (ADR-0014 P0.9).
 * The handler forwards `{ sessionId, frame }` over the `tileborne:runtime:snapshot`
 * IPC event so the single-player playtest viewport can decode + render via the
 * plugin projector. The renderer treats the frame as opaque bytes.
 */
let notifyPlaytestSnapshot:
  | ((sessionId: string, frame: Uint8Array) => void)
  | undefined;

export const setPlaytestRuntimeSnapshotNotifier = (
  notifier: ((sessionId: string, frame: Uint8Array) => void) | undefined,
): void => {
  notifyPlaytestSnapshot = notifier;
};

const maybeNotifyPlaytestChanged = (): void => {
  const now = Date.now();
  if (now - lastNotifyAt < METRICS_NOTIFY_MS) {
    return;
  }
  lastNotifyAt = now;
  notifyPlaytestChanged?.();
};

const createMetricsState = (
  playerCount: number,
  readHud: () => PlaytestRuntimeHudState | undefined,
  readDiagnostics: () => PlaytestRuntimeDiagnostics | undefined,
) => {
  const state = {
    tickCount: 0,
    playerCount,
    lastPluginEvent: "onInit",
    lastTickAtMs: Date.now(),
  };
  return {
    state,
    getMetrics: (): PlaytestRuntimeMetrics => {
      const hud = readHud();
      const diagnostics = readDiagnostics();
      return {
        tickCount: state.tickCount,
        playerCount: state.playerCount,
        lastPluginEvent: state.lastPluginEvent,
        lastTickAtMs: state.lastTickAtMs,
        ...(hud !== undefined ? { hud } : {}),
        ...(diagnostics !== undefined ? { diagnostics } : {}),
      };
    },
    recordEvent: (event: string): void => {
      state.lastPluginEvent = event;
      state.lastTickAtMs = Date.now();
    },
  };
};

const countPlayers = (world: PlaytestPluginWorld): number => {
  try {
    const playerStore = world.getComponent<{ alive: number }>("Player");
    let count = 0;
    for (const [, player] of playerStore.entries()) {
      if (player.alive === 1) {
        count += 1;
      }
    }
    return count;
  } catch {
    return 0;
  }
};

const loadRuntimeModule = async (entryPath: string): Promise<RuntimePluginModule> => {
  const href = pathToFileURL(entryPath).href;
  return (await import(href)) as RuntimePluginModule;
};

const resolveRuntimeEntry = async (rootPath: string): Promise<string> => {
  const manifestPath = path.join(rootPath, "tileborne-plugin.json");
  const manifestRaw = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestRaw) as {
    entry?: { runtime?: string; server?: string; editor?: string };
  };
  const runtimeEntry = manifest.entry?.runtime ?? manifest.entry?.server ?? manifest.entry?.editor;
  if (!runtimeEntry) {
    throw new Error(`plugin at ${rootPath} has no runtime entry`);
  }
  return path.resolve(rootPath, runtimeEntry);
};

const resolveNodeEntry = async (rootPath: string): Promise<string | undefined> => {
  const manifestPath = path.join(rootPath, "tileborne-plugin.json");
  const manifestRaw = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(manifestRaw) as {
    entry?: { server?: string; editor?: string };
  };
  const nodeEntry = manifest.entry?.server ?? manifest.entry?.editor;
  return nodeEntry ? path.resolve(rootPath, nodeEntry) : undefined;
};

interface PlainRuntimeStubModule {
  readonly default?: PlaytestTickPlugin;
}

const readPlainStub = (moduleValue: RuntimePluginModule): PlaytestTickPlugin | undefined => {
  const plainModule = moduleValue as PlainRuntimeStubModule;
  return plainModule.default;
};

const loadPluginForPlaytest = async (
  pluginId: string,
  rootPath: string,
  mapPayload: unknown,
  hostExtras: {
    readonly getPlayerInput: (playerId: string) => PlaytestRuntimePlayerInput | undefined;
    readonly msgOut: { readonly push: (frame: Uint8Array) => void };
    readonly recordArtifact?: (artifact: unknown) => void;
    readonly setSeedFrame: (frame: Uint8Array | undefined) => void;
    readonly setHudWorldStateDeriver?: (deriver: PlaytestHudWorldStateDeriver) => void;
    readonly playerModels?: readonly unknown[];
    readonly selectedPlayerModelId?: string;
    readonly objectTypes?: readonly unknown[];
  },
): Promise<PlaytestTickPlugin> => {
  const runtimeEntry = await resolveRuntimeEntry(rootPath);
  const runtimeModule = await loadRuntimeModule(runtimeEntry);

  if (typeof runtimeModule.derivePlaytestHudWorldState === "function") {
    hostExtras.setHudWorldStateDeriver?.(runtimeModule.derivePlaytestHudWorldState);
  }

  if (typeof runtimeModule.createRuntimeAdapter === "function") {
    const artifact = await exportRuntimeArtifactForPlugin(rootPath, mapPayload, hostExtras);
    hostExtras.recordArtifact?.(artifact);
    return runtimeModule.createRuntimeAdapter({
      getArtifact: () => artifact,
      getPlayerInput: hostExtras.getPlayerInput,
      msgOut: hostExtras.msgOut,
      setReplayFrames: (frames) => {
        hostExtras.setSeedFrame(frames[0]);
      },
    });
  }

  const plainStub = readPlainStub(runtimeModule);
  if (plainStub) {
    return plainStub;
  }
  throw new Error(`plugin ${pluginId} did not export a runtime adapter`);
};

const readArtifactMapPayload = async (artifactDirectory: string): Promise<unknown> => {
  const mapPath = path.join(artifactDirectory, "map.json");
  return normalizeAndMigratePersistedMapJson(
    JSON.parse(await readFile(mapPath, "utf8")),
  );
};

const exportRuntimeArtifactForPlugin = async (
  rootPath: string,
  mapPayload: unknown,
  options: {
    readonly playerModels?: readonly unknown[];
    readonly selectedPlayerModelId?: string;
    readonly objectTypes?: readonly unknown[];
  },
): Promise<unknown> => {
  const nodeEntry = await resolveNodeEntry(rootPath);
  if (!nodeEntry) {
    return mapPayload;
  }
  const nodeModule = await loadRuntimeModule(nodeEntry);
  if (typeof nodeModule.exportArtifact !== "function") {
    return mapPayload;
  }
  return nodeModule.exportArtifact(mapPayload, {
    ...(options.playerModels === undefined ? {} : { playerModels: options.playerModels }),
    ...(options.selectedPlayerModelId === undefined
      ? {}
      : { selectedPlayerModelId: options.selectedPlayerModelId }),
    ...(options.objectTypes === undefined ? {} : { objectTypes: options.objectTypes }),
  });
};

export const exportPlaytestRuntimeArtifact = async (input: {
  readonly artifactDirectory: string;
  readonly pluginRootPath: string;
  readonly playerModels?: readonly unknown[];
  readonly selectedPlayerModelId?: string;
  readonly objectTypes?: readonly unknown[];
}): Promise<unknown> => {
  const mapPayload = await readArtifactMapPayload(input.artifactDirectory);
  return exportRuntimeArtifactForPlugin(input.pluginRootPath, mapPayload, {
    ...(input.playerModels === undefined ? {} : { playerModels: input.playerModels }),
    ...(input.selectedPlayerModelId === undefined ? {} : { selectedPlayerModelId: input.selectedPlayerModelId }),
    ...(input.objectTypes === undefined ? {} : { objectTypes: input.objectTypes }),
  });
};

const errorMessage = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

const logRuntimeInfo = async (
  logger: PlaytestRuntimeLogger | undefined,
  message: string,
  fields: PlaytestRuntimeLogFields,
): Promise<void> => {
  try {
    await logger?.info(message, fields);
  } catch {
    // Runtime progress must not depend on log delivery.
  }
};

const logRuntimeError = async (
  logger: PlaytestRuntimeLogger | undefined,
  message: string,
  fields: PlaytestRuntimeLogFields,
): Promise<void> => {
  try {
    await logger?.error(message, fields);
  } catch {
    // Preserve the metrics failure path even if the logger backend fails.
  }
};

export const getPlaytestRuntimeMetrics = (sessionId: string): PlaytestRuntimeMetrics | undefined =>
  activeRuntimes.get(sessionId)?.getMetrics();

export const setPlaytestRuntimeInput = (
  sessionId: string,
  playerId: string,
  input: PlaytestRuntimePlayerInput,
): void => {
  const state = sessionStates.get(sessionId);
  if (!state) {
    return;
  }
  const currentTick = activeRuntimes.get(sessionId)?.getMetrics().tickCount ?? 0;
  state.diagnosticsRecorder.recordInput(playerId, input, currentTick);
  state.inputByPlayerId.set(playerId, input);
};

export const clearPlaytestRuntimeInput = (sessionId: string, playerId: string): void => {
  sessionStates.get(sessionId)?.inputByPlayerId.delete(playerId);
};

export const getPlaytestRuntimeSnapshot = (
  sessionId: string,
): PlaytestRuntimeSnapshot | undefined => {
  const state = sessionStates.get(sessionId);
  if (!state) {
    return undefined;
  }

  try {
    const players = state.world.getComponent<{ playerId: string }>("Player");
    const positions = state.world.getComponent<{ x: number; y: number }>("Position");
    const snapshots: PlaytestRuntimePlayerSnapshot[] = [];
    for (const [entity, player] of players.entries()) {
      const position = positions.get(entity);
      if (!position) {
        continue;
      }
      snapshots.push({
        playerId: player.playerId,
        x: position.x,
        y: position.y,
      });
    }
    return {
      players: snapshots,
      ...(state.seedFrame === undefined ? {} : { frame: new Uint8Array(state.seedFrame) }),
    };
  } catch {
    return {
      players: [],
      ...(state.seedFrame === undefined ? {} : { frame: new Uint8Array(state.seedFrame) }),
    };
  }
};

export const startPlaytestRuntimeHost = async (input: {
  readonly sessionId: string;
  readonly artifactDirectory: string;
  readonly pluginInstalls: readonly { readonly pluginId: string; readonly rootPath: string }[];
  readonly logger?: PlaytestRuntimeLogger;
  readonly playerModels?: readonly unknown[];
  readonly selectedPlayerModelId?: string;
  readonly objectTypes?: readonly unknown[];
}): Promise<PlaytestRuntimeMetrics> => {
  await stopPlaytestRuntimeHost(input.sessionId);

  // Route through the single ADR-0019 plain-JSON load contract shared with the
  // map services / CLI / IPC: migrate legacy free-string `MapObject.kind` to
  // catalog GameObjectTypeIds AND fill the optional object/placement keys that
  // on-disk JSON omits, so legacy maps cannot drift here. The plugin consumes
  // plain JSON (not a decoded `TileborneMap` class). Idempotent.
  const mapPayload = await readArtifactMapPayload(input.artifactDirectory);

  const pluginWorld = createPlaytestPluginWorld();
  const inputByPlayerId = new Map<string, PlaytestRuntimePlayerInput>();
  const diagnosticsRecorder = createPlaytestRuntimeDiagnosticsRecorder({
    tickRate: TICK_RATE,
    tickBudgetMs: TICK_MS,
  });
  const sessionState: PlaytestSessionState = {
    inputByPlayerId,
    world: pluginWorld,
    diagnosticsRecorder,
  };
  sessionStates.set(input.sessionId, sessionState);
  const pendingPluginFrames: Uint8Array[] = [];
  const msgOut = {
    push: (frame: Uint8Array): void => {
      diagnosticsRecorder.recordPluginFrame(frame);
      pendingPluginFrames.push(frame);
    },
  };
  // HUD-state SSOT: the loaded plugin's runtime bundle provides the world→HUD
  // derivation; the tracker only composes it with host-tracked wire events.
  const hudDeriverRef: { current: PlaytestHudWorldStateDeriver | undefined } = {
    current: undefined,
  };
  const hudTracker = createPlaytestRuntimeHudTracker((world, tick) =>
    hudDeriverRef.current?.(world, tick),
  );
  const tickState = { tickCount: 0 };
  const flushPluginFrames = (): void => {
    if (pendingPluginFrames.length === 0) {
      return;
    }
    const drained = pendingPluginFrames.splice(0);
    hudTracker.ingestFrames(drained);
    if (notifyPlaytestSnapshot !== undefined) {
      for (const frame of drained) {
        try {
          notifyPlaytestSnapshot(input.sessionId, frame);
        } catch {
          // Snapshot delivery must not abort the tick loop.
        }
      }
    }
  };
  const metricsState = createMetricsState(
    countPlayers(pluginWorld),
    () => hudTracker.snapshot(pluginWorld, tickState.tickCount),
    () =>
      diagnosticsRecorder.snapshot({
        world: pluginWorld,
        pendingSnapshotFrames: pendingPluginFrames.length,
      }),
  );
  const loadedPlugins: PlaytestTickPlugin[] = [];
  const pluginIds = input.pluginInstalls.map((install) => install.pluginId);
  let gameRuntime: ReturnType<typeof makeGameRuntime> | undefined;

  try {
    for (const install of input.pluginInstalls) {
      const plugin = await loadPluginForPlaytest(install.pluginId, install.rootPath, mapPayload, {
        getPlayerInput: (playerId) => inputByPlayerId.get(playerId),
        msgOut,
        recordArtifact: diagnosticsRecorder.recordArtifact,
        setSeedFrame: (frame) => {
          if (frame === undefined) {
            delete sessionState.seedFrame;
          } else {
            sessionState.seedFrame = new Uint8Array(frame);
          }
        },
        setHudWorldStateDeriver: (deriver) => {
          hudDeriverRef.current = deriver;
        },
        ...(input.playerModels === undefined ? {} : { playerModels: input.playerModels }),
        ...(input.selectedPlayerModelId === undefined
          ? {}
          : { selectedPlayerModelId: input.selectedPlayerModelId }),
        ...(input.objectTypes === undefined ? {} : { objectTypes: input.objectTypes }),
      });
      loadedPlugins.push(plugin);
      await logRuntimeInfo(input.logger, `Plugin ${install.pluginId} loaded`, {
        sessionId: input.sessionId,
        pluginId: install.pluginId,
        rootPath: install.rootPath,
      });
    }

    gameRuntime = makeGameRuntime();
    const pluginHost = makePluginHost();
    await Effect.runPromise(
      pluginHost.register({
        id: "tileborne-playtest-runtime-bridge",
        onTick: (_world, _dt, tick) =>
          Effect.sync(() => {
            for (const plugin of loadedPlugins) {
              plugin.onTick?.(pluginWorld, _dt, tick);
            }
          }),
      }),
    );

    await Effect.runPromise(gameRuntime.init({ tickRate: TICK_RATE, pluginHost }));
    await Effect.runPromise(gameRuntime.start());
    const runtime = gameRuntime;

    for (const plugin of loadedPlugins) {
      plugin.onInit?.({ pluginId: plugin.id }, pluginWorld);
      metricsState.recordEvent("onInit");
      await logRuntimeInfo(input.logger, `Plugin ${plugin.id} onInit`, {
        sessionId: input.sessionId,
        pluginId: plugin.id,
      });
      plugin.onTick?.(pluginWorld, 0, 0);
      flushPluginFrames();
    }
    metricsState.state.playerCount = countPlayers(pluginWorld);
    maybeNotifyPlaytestChanged();

    const interval = setInterval(() => {
      const tickStartedAt = performance.now();
      void Effect.runPromise(runtime.step(1)).then(() => {
        diagnosticsRecorder.recordTick(performance.now() - tickStartedAt);
        metricsState.state.tickCount += 1;
        tickState.tickCount = metricsState.state.tickCount;
        metricsState.state.playerCount = countPlayers(pluginWorld);
        metricsState.recordEvent(`onTick:${metricsState.state.tickCount}`);
        flushPluginFrames();
        maybeNotifyPlaytestChanged();
      }).catch((cause) => {
        const message = errorMessage(cause);
        diagnosticsRecorder.recordError(message);
        metricsState.recordEvent(`runtime-error:${message}`);
        void logRuntimeError(input.logger, "Playtest plugin runtime tick failed", {
          sessionId: input.sessionId,
          pluginIds,
          message,
        });
        maybeNotifyPlaytestChanged();
      });
    }, TICK_MS);

    const stop = async (): Promise<void> => {
      clearInterval(interval);
      sessionStates.delete(input.sessionId);
      for (const plugin of loadedPlugins) {
        plugin.onShutdown?.();
      }
      await Effect.runPromise(runtime.stop());
    };

    activeRuntimes.set(input.sessionId, {
      getMetrics: metricsState.getMetrics,
      interval,
      stop,
    });
    return metricsState.getMetrics();
  } catch (cause) {
    const message = errorMessage(cause);
    sessionStates.delete(input.sessionId);
    activeRuntimes.delete(input.sessionId);
    await logRuntimeError(input.logger, "Playtest plugin runtime startup failed", {
      sessionId: input.sessionId,
      pluginIds,
      message,
    });
    for (const plugin of loadedPlugins) {
      try {
        plugin.onShutdown?.();
      } catch {
        // Startup is already failing; keep the original boundary error visible.
      }
    }
    if (gameRuntime) {
      await Effect.runPromise(gameRuntime.stop()).catch(() => undefined);
    }
    maybeNotifyPlaytestChanged();
    throw new Error(`Playtest runtime startup failed: ${message}`, { cause });
  }
};

export const stopPlaytestRuntimeHost = async (sessionId: string): Promise<void> => {
  const active = activeRuntimes.get(sessionId);
  if (!active) {
    return;
  }
  activeRuntimes.delete(sessionId);
  sessionStates.delete(sessionId);
  if (active.interval) {
    clearInterval(active.interval);
  }
  await active.stop();
};

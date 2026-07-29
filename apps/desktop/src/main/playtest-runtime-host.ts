import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  RuntimeMapPackage,
  type BehaviorId,
  type JsonObject,
  type ProjectId,
} from '@tileborne/core';
import type { RuntimeModeDataExporter } from '@tileborne/plugin-api';
import {
  createRuntimeInputEdgeTransport,
  makeGameRuntime,
  makePluginHost,
  type RuntimeInputEdgeTransport,
  type RuntimeInputEdgeField,
  type RuntimePlugin,
} from '@tileborne/runtime';
import {
  loadRuntimeMapPackage,
  type RuntimeMapPackageEntryReader,
} from '@tileborne/runtime/map-package';
import { NodeIsolatedBehaviorRuntimeHost } from '@tileborne/game-host/behavior-node';
import type {
  BehaviorExecutionTrace,
  BehaviorRuntimeDiagnostic,
  BehaviorSchedulerSnapshot,
  BehaviorWorkerResponse,
  RuntimeBehaviorArtifactIdentity,
} from '@tileborne/runtime/behavior';
import type {
  RuntimeShellBehaviorEventPayload,
  RuntimeShellNavigationRequest,
} from '@tileborne/runtime';
import { Effect, Result, Schema } from 'effect';

import {
  createPlaytestRuntimeHudTracker,
  type PlaytestHudWorldStateDeriver,
  type PlaytestRuntimeHudState,
} from './playtest-runtime-hud.js';
import { createPlaytestPluginWorld, type PlaytestPluginWorld } from './playtest-plugin-world.js';
import {
  createPlaytestRuntimeDiagnosticsRecorder,
  type PlaytestRuntimeDiagnostics,
  type PlaytestRuntimeDiagnosticsRecorder,
} from './playtest-runtime-diagnostics.js';

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
  /** Mode-owned action ids stay opaque to the neutral runtime host. */
  readonly abilities: readonly string[];
  readonly aimDeg?: number;
  readonly swapSlot?: number;
}

type PlaytestRuntimeInputEdgeField = RuntimeInputEdgeField<PlaytestRuntimePlayerInput>;

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
  readonly inputTransport: RuntimeInputEdgeTransport<PlaytestRuntimePlayerInput>;
  inputEdgeFields: readonly PlaytestRuntimeInputEdgeField[];
  heldBooleanInputFields: readonly PlaytestRuntimeInputEdgeField[];
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
    readonly getMapPackage: () => unknown;
    readonly getPlayerModelSelections?: () => readonly {
      readonly playerId: string;
      readonly modelId: string;
    }[];
    readonly getPlayerInput?: (playerId: string) => PlaytestRuntimePlayerInput | undefined;
    readonly msgOut?: { readonly push: (frame: Uint8Array) => void };
    readonly setReplayFrames?: (frames: readonly Uint8Array[]) => void;
  }) => PlaytestTickPlugin;
  readonly playtestInputEdgeFields?: readonly PlaytestRuntimeInputEdgeField[];
  readonly playtestHeldBooleanInputFields?: readonly PlaytestRuntimeInputEdgeField[];
  /**
   * Plugin-owned world→HUD derivation (HUD-state SSOT). When the runtime
   * bundle exports it, the host's HUD tracker delegates the per-tick world
   * slice (player status, scoreboard, minimap, zone phase) to the plugin.
   */
  readonly derivePlaytestHudWorldState?: PlaytestHudWorldStateDeriver;
  /**
   * The active mode's narrowed `RuntimeModeDataExporter` (ADR-0030): the node
   * entry exports it under this generic name so package assembly can inject
   * the mode's `modeData.<pluginId>` section.
   */
  readonly exportModeData?: RuntimeModeDataExporter;
}

interface ActivePlaytestRuntime {
  readonly projectId?: ProjectId;
  readonly mapId?: string;
  readonly getMetrics: () => PlaytestRuntimeMetrics;
  readonly behaviorDebug?: PlaytestBehaviorDebugState;
  lifecycle: PlaytestRuntimeLifecycleStatus;
  shellNavigationSequence: number;
  shellNavigationRequests: {
    readonly sequence: number;
    readonly request: RuntimeShellNavigationRequest;
  }[];
  readonly interval?: ReturnType<typeof setInterval>;
  readonly stop: () => Promise<void>;
}

export type PlaytestRuntimeLifecycleCommand = 'start' | 'pause' | 'resume';
export type PlaytestRuntimeLifecycleStatus = 'waiting-to-start' | 'running' | 'paused';
export type PlaytestBehaviorDebugStatus = 'running' | 'paused';

export interface PlaytestBehaviorSourceLocation {
  readonly sourceKind: 'visual' | 'typescript';
  readonly filePath: string;
  readonly nodeId?: string;
}

export interface PlaytestBehaviorDebugTrace {
  readonly sequence: number;
  readonly tick: number;
  readonly behaviorId: BehaviorId;
  readonly instanceId: string;
  readonly sourceKind: 'visual' | 'typescript';
  readonly eventId: string;
  readonly event: JsonObject;
  readonly stateBefore: JsonObject;
  readonly commands: ReadonlyArray<{ readonly kind: string; readonly payload: JsonObject }>;
  readonly state: JsonObject;
  readonly steps: BehaviorExecutionTrace['steps'];
  readonly source: PlaytestBehaviorSourceLocation;
}

export interface PlaytestBehaviorReloadStatus {
  readonly behaviorId: BehaviorId;
  readonly status: 'applied' | 'rejected-using-last-known-good';
  readonly hash?: string;
  readonly diagnostic?: BehaviorRuntimeDiagnostic;
}

export interface PlaytestBehaviorDebugSnapshot {
  readonly sessionId: string;
  readonly status: PlaytestBehaviorDebugStatus;
  readonly tick: number;
  readonly traces: readonly PlaytestBehaviorDebugTrace[];
  readonly diagnostics: readonly BehaviorRuntimeDiagnostic[];
  readonly states: BehaviorSchedulerSnapshot['states'];
  readonly lastReload?: PlaytestBehaviorReloadStatus;
}

interface PlaytestBehaviorDebugState {
  readonly host: NodeIsolatedBehaviorRuntimeHost;
  readonly sourceByBehaviorId: Map<BehaviorId, PlaytestBehaviorSourceLocation>;
  readonly traces: PlaytestBehaviorDebugTrace[];
  readonly diagnostics: BehaviorRuntimeDiagnostic[];
  status: PlaytestBehaviorDebugStatus;
  tick: number;
  states: BehaviorSchedulerSnapshot['states'];
  lastReload?: PlaytestBehaviorReloadStatus;
  tail: Promise<void>;
}

const MAX_BEHAVIOR_DEBUG_TRACES = 256;
const MAX_BEHAVIOR_DEBUG_DIAGNOSTICS = 256;

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
let notifyPlaytestSnapshot: ((sessionId: string, frame: Uint8Array) => void) | undefined;

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
    lastPluginEvent: 'onInit',
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
    const playerStore = world.getComponent<{ alive: number }>('Player');
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
  const manifestPath = path.join(rootPath, 'tileborne-plugin.json');
  const manifestRaw = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestRaw) as {
    entry?: { runtime?: string; server?: string; editor?: string };
  };
  const runtimeEntry = manifest.entry?.runtime ?? manifest.entry?.server ?? manifest.entry?.editor;
  if (!runtimeEntry) {
    throw new Error(`plugin at ${rootPath} has no runtime entry`);
  }
  return path.resolve(rootPath, runtimeEntry);
};

interface PlainRuntimeStubModule {
  readonly default?: PlaytestTickPlugin;
}

const readPlainStub = (moduleValue: RuntimePluginModule): PlaytestTickPlugin | undefined => {
  const plainModule = moduleValue as PlainRuntimeStubModule;
  return plainModule.default;
};

const readPlaytestInputEdgeFields = (
  moduleValue: RuntimePluginModule,
): readonly PlaytestRuntimeInputEdgeField[] => {
  const fields = moduleValue.playtestInputEdgeFields ?? [];
  return fields.filter(
    (field): field is PlaytestRuntimeInputEdgeField => typeof field === 'string',
  );
};

const readPlaytestHeldBooleanInputFields = (
  moduleValue: RuntimePluginModule,
): readonly PlaytestRuntimeInputEdgeField[] => {
  const fields = moduleValue.playtestHeldBooleanInputFields ?? [];
  return fields.filter(
    (field): field is PlaytestRuntimeInputEdgeField => typeof field === 'string',
  );
};

const encodeMapPackage = Schema.encodeSync(RuntimeMapPackage);

const directoryEntryReader =
  (directory: string): RuntimeMapPackageEntryReader =>
  async (entryPath) => {
    try {
      return new Uint8Array(await readFile(path.join(directory, entryPath)));
    } catch {
      return undefined;
    }
  };

/**
 * Load + integrity-verify the typed package, then re-encode it as the ONE
 * wire-JSON payload every runtime host hands the plugin (ADR-0030): plugins
 * consume the encoded `RuntimeMapPackage`, never decoded class instances.
 */
export const loadPlaytestMapPackage = async (packageDirectory: string): Promise<unknown> => {
  const loaded = await loadRuntimeMapPackage(directoryEntryReader(packageDirectory));
  if (Result.isFailure(loaded)) {
    throw new Error(
      `runtime map package at ${packageDirectory} failed to load (${loaded.failure.reason}): ${loaded.failure.message}`,
    );
  }
  return encodeMapPackage(loaded.success);
};

const startPlaytestBehaviorRuntime = async (
  packageDirectory: string,
): Promise<PlaytestBehaviorDebugState | undefined> => {
  const loaded = await loadRuntimeMapPackage(directoryEntryReader(packageDirectory));
  if (Result.isFailure(loaded)) {
    throw new Error(`cannot start behavior runtime: ${loaded.failure.message}`);
  }
  if (loaded.success.behaviors.modules.length === 0) return undefined;
  const smokeWallTimeMs =
    process.env.TILEBORNE_E2E === '1' || process.env.TILEBORNE_SMOKE === 'true' ? 500 : TICK_MS;
  const host = new NodeIsolatedBehaviorRuntimeHost({
    ticksPerSecond: TICK_RATE,
    maxWallTimeMs: Math.max(25, smokeWallTimeMs),
  });
  try {
    for (const artifact of loaded.success.behaviors.modules) {
      const modulePath = path.resolve(packageDirectory, artifact.modulePath);
      const relative = path.relative(packageDirectory, modulePath);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`behavior module escapes runtime package: ${artifact.modulePath}`);
      }
      const response = await host.load({
        behaviorId: artifact.behaviorId,
        sourceKind: artifact.sourceKind,
        modulePath: artifact.modulePath,
        hash: artifact.hash,
        code: await readFile(modulePath, 'utf8'),
      });
      if (!response.ok) {
        throw new Error(response.diagnostic.message);
      }
    }
    const sourceByBehaviorId = new Map<BehaviorId, PlaytestBehaviorSourceLocation>();
    for (const manifest of loaded.success.behaviors.manifests) {
      sourceByBehaviorId.set(
        manifest.id,
        manifest.source._tag === 'visual'
          ? {
              sourceKind: 'visual',
              filePath: safeDebugSourcePath(manifest.source.definitionPath),
            }
          : {
              sourceKind: 'typescript',
              filePath: safeDebugSourcePath(manifest.source.sourcePath),
            },
      );
    }
    return {
      host,
      sourceByBehaviorId,
      traces: [],
      diagnostics: [],
      status: 'running',
      tick: 0,
      states: [],
      tail: Promise.resolve(),
    };
  } catch (error) {
    await host.dispose();
    throw error;
  }
};

const stepPlaytestBehaviorRuntime = async (debug: PlaytestBehaviorDebugState): Promise<void> => {
  const execute = async (): Promise<void> => {
    const tick = debug.tick + 1;
    const advanced = await debug.host.advanceTo(tick);
    if (!advanced.ok) throw new Error(advanced.diagnostic.message);
    captureBehaviorDebugResponse(debug, advanced);
    const dispatched = await debug.host.dispatch({ eventId: 'runtime.tick', event: { tick } });
    if (!dispatched.ok) throw new Error(dispatched.diagnostic.message);
    captureBehaviorDebugResponse(debug, dispatched);
    debug.tick = tick;
  };
  const result = debug.tail.then(execute, execute);
  debug.tail = result.catch(() => undefined);
  await result;
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const SECRET_DEBUG_KEY = /(?:authorization|cookie|password|secret|token|api[-_]?key)/iu;
const MAX_DEBUG_COLLECTION_ITEMS = 64;
const MAX_DEBUG_STRING_LENGTH = 4_096;
const MAX_DEBUG_OBJECT_BYTES = 16 * 1_024;
const MAX_DEBUG_COMMAND_BYTES = 32 * 1_024;
const EMBEDDED_FILE_URI = /\bfile:(?:\/{2,3})?(?:\/|[a-z]:[\\/]|\\\\)/iu;
const EMBEDDED_WINDOWS_PATH =
  /(?:^|[\s"'([{=:])(?:[a-z]:(?:[\\/]|[^\s"'\])}]+)|\\\\[^\s\\/]+[\\/][^\s\\/]+)/iu;
const EMBEDDED_TILDE_PATH = /(?:^|[\s"'([{=:])~(?:[^\s\\/]+)?[\\/]/u;
const EMBEDDED_POSIX_PATH = /(?:^|[^a-z0-9_/\\])\/(?!\/)[^\s"'\])}]+/iu;

const isSensitiveDebugPath = (value: string): boolean => {
  const normalized = value.replaceAll('\\', '/');
  const segments = normalized.split('/');
  return (
    normalized.startsWith('/') ||
    segments.includes('..') ||
    EMBEDDED_FILE_URI.test(value) ||
    EMBEDDED_WINDOWS_PATH.test(value) ||
    EMBEDDED_TILDE_PATH.test(value) ||
    EMBEDDED_POSIX_PATH.test(value)
  );
};

const safeDebugSourcePath = (sourcePath: string): string => {
  const normalized = sourcePath.replaceAll('\\', '/');
  return isSensitiveDebugPath(sourcePath) ? '<behavior source>' : normalized;
};

/** Keeps inspector payloads local, bounded, JSON-only, and free of obvious credentials/host paths. */
const sanitizeDebugValue = (value: unknown, key = '', depth = 0): unknown => {
  if (SECRET_DEBUG_KEY.test(key)) return '[redacted]';
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    if (isSensitiveDebugPath(value)) return '[redacted path]';
    return value.length > MAX_DEBUG_STRING_LENGTH
      ? `${value.slice(0, MAX_DEBUG_STRING_LENGTH)}…`
      : value;
  }
  if (depth >= 6) return '[depth limit]';
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_DEBUG_COLLECTION_ITEMS)
      .map((entry) => sanitizeDebugValue(entry, key, depth + 1));
  }
  if (!isRecord(value)) return String(value);
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, MAX_DEBUG_COLLECTION_ITEMS)
      .map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeDebugValue(entryValue, entryKey, depth + 1),
      ]),
  );
};

const debugJsonBytes = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;

const boundedDebugObject = (value: unknown): JsonObject => {
  const sanitized = sanitizeDebugValue(value);
  if (isRecord(sanitized) && debugJsonBytes(sanitized) <= MAX_DEBUG_OBJECT_BYTES) {
    return sanitized as JsonObject;
  }
  const preview = JSON.stringify(sanitized).slice(0, MAX_DEBUG_STRING_LENGTH);
  return { truncated: true, preview };
};

const boundedDebugCommands = (
  value: ReadonlyArray<{
    readonly kind: string;
    readonly payload: Readonly<Record<string, unknown>>;
  }>,
): ReadonlyArray<{ readonly kind: string; readonly payload: JsonObject }> => {
  const result: Array<{ readonly kind: string; readonly payload: JsonObject }> = [];
  for (const command of value) {
    const candidate = { kind: command.kind, payload: boundedDebugObject(command.payload) };
    if (debugJsonBytes([...result, candidate]) > MAX_DEBUG_COMMAND_BYTES) {
      result.push({
        kind: 'tileborne.inspector.truncated',
        payload: { omitted: value.length - result.length },
      });
      break;
    }
    result.push(candidate);
  }
  return result;
};

const captureBehaviorDebugResponse = (
  debug: PlaytestBehaviorDebugState,
  response: BehaviorWorkerResponse,
): void => {
  if (!response.ok || !isRecord(response.value)) {
    if (!response.ok) {
      debug.diagnostics.push(sanitizeDebugValue(response.diagnostic) as BehaviorRuntimeDiagnostic);
      if (debug.diagnostics.length > MAX_BEHAVIOR_DEBUG_DIAGNOSTICS) {
        debug.diagnostics.splice(0, debug.diagnostics.length - MAX_BEHAVIOR_DEBUG_DIAGNOSTICS);
      }
    }
    return;
  }
  const value = response.value;
  if (Array.isArray(value.traces)) {
    for (const candidate of value.traces) {
      if (!isRecord(candidate) || typeof candidate.behaviorId !== 'string') continue;
      const trace = candidate as unknown as BehaviorExecutionTrace;
      const baseSource = debug.sourceByBehaviorId.get(trace.behaviorId) ?? {
        sourceKind: trace.sourceKind,
        filePath: '<behavior>',
      };
      const steps = Array.isArray(trace.steps) ? trace.steps : [];
      const currentStep = steps.at(-1);
      const sanitized = sanitizeDebugValue(trace) as PlaytestBehaviorDebugTrace;
      debug.traces.push({
        ...sanitized,
        instanceId:
          typeof trace.instanceId === 'string' ? trace.instanceId : String(trace.behaviorId),
        event: boundedDebugObject(trace.event),
        stateBefore: boundedDebugObject(
          isRecord(trace.stateBefore) ? trace.stateBefore : trace.state,
        ),
        commands: boundedDebugCommands(trace.commands),
        state: boundedDebugObject(trace.state),
        steps: sanitizeDebugValue(steps) as BehaviorExecutionTrace['steps'],
        source: {
          ...baseSource,
          ...(currentStep === undefined ? {} : { nodeId: currentStep.nodeId }),
        },
      });
    }
    if (debug.traces.length > MAX_BEHAVIOR_DEBUG_TRACES) {
      debug.traces.splice(0, debug.traces.length - MAX_BEHAVIOR_DEBUG_TRACES);
    }
  }
  if (Array.isArray(value.diagnostics)) {
    debug.diagnostics.push(
      ...(sanitizeDebugValue(value.diagnostics) as BehaviorRuntimeDiagnostic[]),
    );
    if (debug.diagnostics.length > MAX_BEHAVIOR_DEBUG_DIAGNOSTICS) {
      debug.diagnostics.splice(0, debug.diagnostics.length - MAX_BEHAVIOR_DEBUG_DIAGNOSTICS);
    }
  }
  if (isRecord(value.snapshot) && Array.isArray(value.snapshot.states)) {
    debug.states = (
      value.snapshot.states as ReadonlyArray<{
        readonly behaviorId: BehaviorId;
        readonly state: unknown;
      }>
    ).map(({ behaviorId, state }) => ({ behaviorId, state: boundedDebugObject(state) }));
  }
};

/** Single-player playtest session: the local player is always player-1. */
const toPlayerModelSelections = (
  selectedPlayerModelId: string | undefined,
): readonly { readonly playerId: string; readonly modelId: string }[] =>
  selectedPlayerModelId === undefined
    ? []
    : [{ playerId: 'player-1', modelId: selectedPlayerModelId }];

const loadPluginForPlaytest = async (
  pluginId: string,
  rootPath: string,
  mapPackage: unknown,
  hostExtras: {
    readonly getPlayerInput: (playerId: string) => PlaytestRuntimePlayerInput | undefined;
    readonly msgOut: { readonly push: (frame: Uint8Array) => void };
    readonly recordMapPackage?: (mapPackage: unknown) => void;
    readonly recordInputEdgeFields?: (fields: readonly PlaytestRuntimeInputEdgeField[]) => void;
    readonly recordHeldBooleanInputFields?: (
      fields: readonly PlaytestRuntimeInputEdgeField[],
    ) => void;
    readonly setSeedFrame: (frame: Uint8Array | undefined) => void;
    readonly setHudWorldStateDeriver?: (deriver: PlaytestHudWorldStateDeriver) => void;
    readonly selectedPlayerModelId?: string;
  },
): Promise<PlaytestTickPlugin> => {
  const runtimeEntry = await resolveRuntimeEntry(rootPath);
  const runtimeModule = await loadRuntimeModule(runtimeEntry);
  hostExtras.recordInputEdgeFields?.(readPlaytestInputEdgeFields(runtimeModule));
  hostExtras.recordHeldBooleanInputFields?.(readPlaytestHeldBooleanInputFields(runtimeModule));

  if (typeof runtimeModule.derivePlaytestHudWorldState === 'function') {
    hostExtras.setHudWorldStateDeriver?.(runtimeModule.derivePlaytestHudWorldState);
  }

  if (typeof runtimeModule.createRuntimeAdapter === 'function') {
    hostExtras.recordMapPackage?.(mapPackage);
    const selections = toPlayerModelSelections(hostExtras.selectedPlayerModelId);
    return runtimeModule.createRuntimeAdapter({
      getMapPackage: () => mapPackage,
      ...(selections.length === 0 ? {} : { getPlayerModelSelections: () => selections }),
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

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

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

export const getActivePlaytestRuntimeCountForTests = (): number => activeRuntimes.size;

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
  const resolvedInput = state.inputTransport.set(playerId, input);
  state.diagnosticsRecorder.recordInput(playerId, resolvedInput, currentTick);
};

export const clearPlaytestRuntimeInput = (sessionId: string, playerId: string): void => {
  const state = sessionStates.get(sessionId);
  state?.inputTransport.delete(playerId);
};

export const getPlaytestRuntimeInputForTests = (
  sessionId: string,
  playerId: string,
): PlaytestRuntimePlayerInput | undefined =>
  sessionStates.get(sessionId)?.inputTransport.get(playerId);

export const getPlaytestRuntimeSnapshot = (
  sessionId: string,
): PlaytestRuntimeSnapshot | undefined => {
  const state = sessionStates.get(sessionId);
  if (!state) {
    return undefined;
  }

  try {
    const players = state.world.getComponent<{ playerId: string }>('Player');
    const positions = state.world.getComponent<{ x: number; y: number }>('Position');
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
  readonly projectId?: ProjectId;
  readonly mapId?: string;
  /** Directory holding the assembled `RuntimeMapPackage` this host boots from. */
  readonly packageDirectory: string;
  readonly pluginInstalls: readonly { readonly pluginId: string; readonly rootPath: string }[];
  readonly logger?: PlaytestRuntimeLogger;
  readonly selectedPlayerModelId?: string;
}): Promise<PlaytestRuntimeMetrics> => {
  await stopPlaytestRuntimeHost(input.sessionId);

  // ADR-0030: every host boots from the ONE typed runtime map package —
  // decode + hash-verify + version-gate via the shared worker-safe loader,
  // then hand the plugin the canonical encoded package wire JSON.
  const mapPackage = await loadPlaytestMapPackage(input.packageDirectory);
  const behaviorRuntime = await startPlaytestBehaviorRuntime(input.packageDirectory);

  const pluginWorld = createPlaytestPluginWorld();
  const inputEdgeFields = new Set<PlaytestRuntimeInputEdgeField>();
  const heldBooleanInputFields = new Set<PlaytestRuntimeInputEdgeField>();
  const inputTransport = createRuntimeInputEdgeTransport<PlaytestRuntimePlayerInput>(() => [
    ...inputEdgeFields,
  ], {
    heldBooleanFields: () => [...heldBooleanInputFields],
  });
  const diagnosticsRecorder = createPlaytestRuntimeDiagnosticsRecorder({
    tickRate: TICK_RATE,
    tickBudgetMs: TICK_MS,
  });
  const sessionState: PlaytestSessionState = {
    inputTransport,
    inputEdgeFields: [],
    heldBooleanInputFields: [],
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
      const plugin = await loadPluginForPlaytest(install.pluginId, install.rootPath, mapPackage, {
        getPlayerInput: (playerId) => inputTransport.get(playerId),
        msgOut,
        recordMapPackage: diagnosticsRecorder.recordMapPackage,
        recordInputEdgeFields: (fields) => {
          for (const field of fields) {
            inputEdgeFields.add(field);
          }
          sessionState.inputEdgeFields = [...inputEdgeFields];
        },
        recordHeldBooleanInputFields: (fields) => {
          for (const field of fields) {
            heldBooleanInputFields.add(field);
          }
          sessionState.heldBooleanInputFields = [...heldBooleanInputFields];
        },
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
        ...(input.selectedPlayerModelId === undefined
          ? {}
          : { selectedPlayerModelId: input.selectedPlayerModelId }),
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
        id: 'tileborne-playtest-runtime-bridge',
        onTick: (_world, _dt, tick) =>
          Effect.sync(() => {
            for (const plugin of loadedPlugins) {
              plugin.onTick?.(pluginWorld, _dt, tick);
            }
          }),
      }),
    );

    await Effect.runPromise(gameRuntime.init({ tickRate: TICK_RATE, pluginHost }));
    const runtime = gameRuntime;

    for (const plugin of loadedPlugins) {
      plugin.onInit?.({ pluginId: plugin.id }, pluginWorld);
      metricsState.recordEvent('onInit');
      await logRuntimeInfo(input.logger, `Plugin ${plugin.id} onInit`, {
        sessionId: input.sessionId,
        pluginId: plugin.id,
      });
      plugin.onTick?.(pluginWorld, 0, 0);
      flushPluginFrames();
    }
    metricsState.state.playerCount = countPlayers(pluginWorld);
    maybeNotifyPlaytestChanged();

    let tickInFlight = false;
    const interval = setInterval(() => {
      const active = activeRuntimes.get(input.sessionId);
      if (active?.lifecycle !== 'running' || tickInFlight) {
        return;
      }
      tickInFlight = true;
      const tickStartedAt = performance.now();
      const inputAcknowledgement = inputTransport.capturePendingAcknowledgement();
      void Effect.runPromise(runtime.step(1))
        .then(async () => {
          inputTransport.acknowledgePending(inputAcknowledgement);
          if (behaviorRuntime?.status === 'running') {
            await stepPlaytestBehaviorRuntime(behaviorRuntime);
          }
          diagnosticsRecorder.recordTick(performance.now() - tickStartedAt);
          metricsState.state.tickCount += 1;
          tickState.tickCount = metricsState.state.tickCount;
          metricsState.state.playerCount = countPlayers(pluginWorld);
          metricsState.recordEvent(`onTick:${metricsState.state.tickCount}`);
          flushPluginFrames();
          maybeNotifyPlaytestChanged();
        })
        .catch((cause) => {
          const message = errorMessage(cause);
          diagnosticsRecorder.recordError(message);
          metricsState.recordEvent(`runtime-error:${message}`);
          void logRuntimeError(input.logger, 'Playtest plugin runtime tick failed', {
            sessionId: input.sessionId,
            pluginIds,
            message,
          });
          maybeNotifyPlaytestChanged();
        })
        .finally(() => {
          tickInFlight = false;
        });
    }, TICK_MS);

    const stop = async (): Promise<void> => {
      clearInterval(interval);
      for (const plugin of loadedPlugins) {
        plugin.onShutdown?.();
      }
      await Effect.runPromise(runtime.stop());
      if (behaviorRuntime) {
        await behaviorRuntime.tail;
        await behaviorRuntime.host.dispose();
      }
    };

    activeRuntimes.set(input.sessionId, {
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
      ...(input.mapId === undefined ? {} : { mapId: input.mapId }),
      getMetrics: metricsState.getMetrics,
      ...(behaviorRuntime === undefined ? {} : { behaviorDebug: behaviorRuntime }),
      lifecycle: 'waiting-to-start',
      shellNavigationSequence: 0,
      shellNavigationRequests: [],
      interval,
      stop,
    });
    return metricsState.getMetrics();
  } catch (cause) {
    const message = errorMessage(cause);
    sessionStates.delete(input.sessionId);
    activeRuntimes.delete(input.sessionId);
    await logRuntimeError(input.logger, 'Playtest plugin runtime startup failed', {
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
    await behaviorRuntime?.host.dispose().catch(() => undefined);
    maybeNotifyPlaytestChanged();
    throw new Error(`Playtest runtime startup failed: ${message}`, { cause });
  }
};

export const controlPlaytestRuntimeLifecycle = (
  sessionId: string,
  command: PlaytestRuntimeLifecycleCommand,
): PlaytestRuntimeLifecycleStatus => {
  const active = activeRuntimes.get(sessionId);
  if (active === undefined) {
    throw new Error(`playtest runtime is not active for ${sessionId}`);
  }
  if (command === 'start' || command === 'resume') {
    active.lifecycle = 'running';
  } else {
    active.lifecycle = 'paused';
  }
  maybeNotifyPlaytestChanged();
  return active.lifecycle;
};

export const stopPlaytestRuntimeHost = async (sessionId: string): Promise<void> => {
  const active = activeRuntimes.get(sessionId);
  if (!active) {
    return;
  }
  if (active.interval) {
    clearInterval(active.interval);
  }
  await active.stop();
  activeRuntimes.delete(sessionId);
  sessionStates.delete(sessionId);
};

export const stopOwnedPlaytestRuntimeHost = async (input: {
  readonly sessionId: string;
  readonly projectId?: ProjectId;
  readonly mapId?: string;
}): Promise<boolean> => {
  const active = activeRuntimes.get(input.sessionId);
  if (!active) {
    return false;
  }
  if (input.projectId !== undefined && active.projectId !== input.projectId) {
    return false;
  }
  if (input.mapId !== undefined && active.mapId !== input.mapId) {
    return false;
  }
  await stopPlaytestRuntimeHost(input.sessionId);
  return true;
};

export const getPlaytestBehaviorDebugSnapshot = (
  sessionId: string,
): PlaytestBehaviorDebugSnapshot | undefined => {
  const debug = activeRuntimes.get(sessionId)?.behaviorDebug;
  if (debug === undefined) return undefined;
  return {
    sessionId,
    status: debug.status,
    tick: debug.tick,
    traces: structuredClone(debug.traces),
    diagnostics: structuredClone(debug.diagnostics),
    states: structuredClone(debug.states),
    ...(debug.lastReload === undefined ? {} : { lastReload: structuredClone(debug.lastReload) }),
  };
};

export const controlPlaytestBehaviorDebug = async (
  sessionId: string,
  command: 'pause' | 'step' | 'continue',
): Promise<PlaytestBehaviorDebugSnapshot> => {
  const debug = activeRuntimes.get(sessionId)?.behaviorDebug;
  if (debug === undefined) throw new Error(`behavior runtime is not active for ${sessionId}`);
  if (command === 'pause') {
    debug.status = 'paused';
    await debug.tail;
  } else if (command === 'continue') {
    await debug.tail;
    debug.status = 'running';
  } else {
    if (debug.status !== 'paused') {
      throw new Error('pause the behavior runtime before stepping');
    }
    await stepPlaytestBehaviorRuntime(debug);
  }
  return getPlaytestBehaviorDebugSnapshot(sessionId)!;
};

export const emitPlaytestShellBehaviorEvent = async (
  sessionId: string,
  event: RuntimeShellBehaviorEventPayload,
): Promise<
  readonly { readonly sequence: number; readonly request: RuntimeShellNavigationRequest }[]
> => {
  const active = activeRuntimes.get(sessionId);
  const debug = active?.behaviorDebug;
  if (active === undefined || debug === undefined) {
    return [];
  }
  const execute = async (): Promise<void> => {
    const response = await debug.host.dispatch({
      eventId: 'shell.event',
      event: {
        event: event.event,
        screenId: event.screenId,
        ...(event.actionId === undefined ? {} : { actionId: event.actionId }),
        ...(event.targetScreenId === undefined ? {} : { targetScreenId: event.targetScreenId }),
      },
    });
    if (!response.ok) throw new Error(response.diagnostic.message);
    captureBehaviorDebugResponse(debug, response);
    const value = response.value;
    if (!isRecord(value) || !Array.isArray(value.shellNavigationRequests)) return;
    for (const request of value.shellNavigationRequests) {
      if (
        !isRecord(request) ||
        request.type !== 'navigate' ||
        typeof request.targetScreenId !== 'string'
      ) {
        continue;
      }
      active.shellNavigationRequests.push({
        sequence: active.shellNavigationSequence,
        request: { type: 'navigate', targetScreenId: request.targetScreenId },
      });
      active.shellNavigationSequence += 1;
    }
  };
  const result = debug.tail.then(execute, execute);
  debug.tail = result.catch(() => undefined);
  await result;
  const queued = [...active.shellNavigationRequests];
  active.shellNavigationRequests = [];
  return queued;
};

export type PlaytestHotReloadArtifact = RuntimeBehaviorArtifactIdentity & {
  readonly code: string;
  readonly sourcePath?: string;
};

/** Applies one verified compile to every live playtest for the project; rejected modules keep LKG. */
export const hotReloadPlaytestBehavior = async (
  projectId: ProjectId,
  artifact: PlaytestHotReloadArtifact,
): Promise<readonly PlaytestBehaviorReloadStatus[]> => {
  const results: PlaytestBehaviorReloadStatus[] = [];
  for (const active of activeRuntimes.values()) {
    const debug = active.behaviorDebug;
    if (active.projectId !== projectId || debug === undefined) continue;
    await debug.tail;
    const response = await debug.host.hotReload(artifact);
    captureBehaviorDebugResponse(debug, response);
    if (response.ok && artifact.sourcePath !== undefined) {
      debug.sourceByBehaviorId.set(artifact.behaviorId, {
        sourceKind: artifact.sourceKind,
        filePath: safeDebugSourcePath(artifact.sourcePath),
      });
    }
    const result: PlaytestBehaviorReloadStatus = response.ok
      ? {
          behaviorId: artifact.behaviorId,
          status: 'applied',
          hash: String(artifact.hash),
        }
      : {
          behaviorId: artifact.behaviorId,
          status: 'rejected-using-last-known-good',
          hash: String(artifact.hash),
          diagnostic: sanitizeDebugValue(response.diagnostic) as BehaviorRuntimeDiagnostic,
        };
    debug.lastReload = result;
    results.push(result);
  }
  return results;
};

/** Records compile rejection without ever sending invalid code to the live worker. */
export const rejectPlaytestBehaviorReload = (
  projectId: ProjectId,
  behaviorId: BehaviorId,
  diagnostic: BehaviorRuntimeDiagnostic,
): readonly PlaytestBehaviorReloadStatus[] => {
  const results: PlaytestBehaviorReloadStatus[] = [];
  for (const active of activeRuntimes.values()) {
    const debug = active.behaviorDebug;
    if (active.projectId !== projectId || debug === undefined) continue;
    const result: PlaytestBehaviorReloadStatus = {
      behaviorId,
      status: 'rejected-using-last-known-good',
      diagnostic,
    };
    debug.lastReload = result;
    debug.diagnostics.push(diagnostic);
    if (debug.diagnostics.length > MAX_BEHAVIOR_DEBUG_DIAGNOSTICS) debug.diagnostics.shift();
    results.push(result);
  }
  return results;
};

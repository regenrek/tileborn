import { Effect, Option } from 'effect';

import {
  encodeMessage,
  Events,
  makeGameRuntime,
  makePluginHost,
  PlayerJoined,
  PlayerLeft,
  SnapshotDelta,
  SnapshotFull,
  type GameRuntimeApi,
  type PluginHostApi,
  type RuntimeMessage,
} from '@tileborne/runtime/worker';
import {
  buildRuntimeGameShellProjection,
  createRuntimeInputEdgeTransport,
  defaultProjectGameShellState,
  type RuntimeInputEdgeField,
} from '@tileborne/runtime';
import { MATCH_ENDED_CLOSE_CODE } from '@tileborne/runtime/net';

import {
  createBundledPluginLoader,
  defaultBundledPluginRuntimeRegistration,
  resolveBundledRuntimePluginId,
  type BundledPluginProtocolBridge,
  type BundledPluginRuntimeRegistration,
  type BundledRuntimeInput,
} from '../bundled-plugin-loader.js';
import {
  createWorkerdBehaviorRuntimeClient,
  type AuthoritativeBehaviorRuntimeClient,
} from '../behavior-runtime.js';
import {
  broadcastBinaryFrame,
  createRoomMeta,
  parsePlaytestInitBody,
  toPlaytestSessionMetrics,
  toPlaytestSummary,
  type BinarySocket,
} from '../room.js';
import {
  smokeControlEnabled,
  type Env,
  type PlaytestRoomMeta,
  type PlaytestSummary,
  type RoomLobbySummary,
} from '../types.js';
import { isHandoffSigningKeyValid, verifyHandoffToken } from './handoff-token.js';
import {
  INVALID_HANDOFF_CLOSE_CODE,
  PERSIST_EVERY_N_TICKS,
  ROOM_BACKPRESSURE_CLOSE_CODE,
  ROOM_INVALID_ACK_CLOSE_CODE,
  ROOM_REPLACED_CLOSE_CODE,
  TICK_HZ,
  TICK_INTERVAL_MS,
  heartbeatTimeoutMs,
  roomReconnectWindowMs,
  roomIdleTimeoutMs,
} from './room-config.js';
import {
  RoomAdmissionRejectedError,
  RoomLifecycleRejectedError,
  admitPlayerToRoom,
  advanceLifecycleForAlarm,
  archiveRoom,
  finishRoomFromMatchEnd,
  finishRoomIfEmpty,
  createRoomJoinCode,
  markRoomPlayerDisconnected,
  projectRoomPresence,
  reserveRoomPlayer,
  resolveRoomPlayerCapacity,
  resolveRoomReadyGate,
  resolveRoomReconnectEligibility,
  setRoomPlayerReady,
  startRoomFromOwner,
  stopRoomFromOwner,
  shouldHydrateRuntime,
  validateRoomOptions,
} from './room-lifecycle.js';
import {
  STORAGE_KEY,
  emptyRoomCurrentSocketState,
  emptyRoomStorage,
  migrateRoomStorage,
  type PersistedRoomStorage,
  type RoomJoinCode,
  type RoomLobbyVisibility,
  type RoomPlayerModelSelection,
  type RoomPlayerRecord,
  type RoomStorage,
} from './storage-schema.js';
import {
  MAX_OUTBOUND_FRAMES_PER_TICK,
  MAX_STALE_SNAPSHOT_ACKS,
  applySnapshotAck,
  compareQueuedInputs,
  createRoomSocketRecord,
  decideSnapshotOutbound,
  recordOutboundDropped,
  recordSnapshotProduced,
  recordSnapshotResyncSent,
  recordSnapshotSent,
  socketBufferedAmount,
  toClientTransportStats,
  type ClientTransportStats,
  type QueuedInput,
  type RoomSocketRecord,
  decodeRoomShellClientFrame,
  encodeRoomShellNavigationServerFrame,
} from './room-transport.js';
import type { JsonObject, JsonValue } from '@tileborne/core';
import type { RuntimeGameShellProjection } from '@tileborne/runtime';

export interface RoomCreateOptions {
  readonly mapId: string;
  readonly seed?: string | number;
  readonly options?: Record<string, string | number | boolean | null>;
  /** Encoded `RuntimeMapPackage` wire JSON the room runtime boots from (ADR-0030). */
  readonly mapPackage?: JsonObject;
  readonly shellProjection?: RuntimeGameShellProjection;
  readonly playerModelSelections?: readonly RoomPlayerModelSelection[];
  readonly idempotencyKey?: string;
}

export interface PlaytestRoomDeps {
  readonly now?: () => number;
  readonly createRuntime?: () => GameRuntimeApi;
  readonly createPluginHost?: (emit: (message: RuntimeMessage) => void) => PluginHostApi;
  readonly createBehaviorRuntime?: (input: {
    readonly mapPackage?: JsonObject;
    readonly seed?: string | number;
    readonly shellProjection?: RuntimeGameShellProjection | undefined;
  }) => AuthoritativeBehaviorRuntimeClient;
  readonly pluginRegistrations?: readonly BundledPluginRuntimeRegistration[];
}

interface RoomSocketAttachment {
  readonly playerId: string;
  readonly socketId: string;
}

interface RoomPlayerReservationRequest {
  readonly playerId?: unknown;
  readonly displayName?: unknown;
}

interface RoomPlayerReservationPayload {
  readonly playerId?: string;
  readonly displayName?: string;
}

interface RoomLobbyConfigRequest {
  readonly joinCode?: unknown;
  readonly visibility?: unknown;
  readonly displayName?: unknown;
  readonly createdByPlayerId?: unknown;
}

interface RoomLobbyConfigPayload {
  readonly joinCode: RoomJoinCode;
  readonly visibility?: RoomLobbyVisibility;
  readonly displayName?: string;
  readonly createdByPlayerId?: string;
}

interface RoomReadyRequest {
  readonly playerId?: unknown;
  readonly ready?: unknown;
}

interface RoomReadyPayload {
  readonly playerId: string;
  readonly ready: boolean;
}

interface RoomOwnerActionRequest {
  readonly playerId?: unknown;
}

interface RoomOwnerActionPayload {
  readonly playerId: string;
}

interface SmokeDropParticipantSocketRequest {
  readonly playerId?: unknown;
}

interface SmokeDropParticipantSocketPayload {
  readonly playerId: string;
}

const SMOKE_TRANSPORT_LOSS_CLOSE_CODE = 4000;
const SMOKE_TRANSPORT_LOSS_CLOSE_REASON = 'smoke transport loss';
const MATCH_ENDED_CLOSE_REASON = 'match ended';

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseRoomSocketAttachment = (value: unknown): RoomSocketAttachment | null => {
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value.playerId !== 'string' || value.playerId.length === 0) {
    return null;
  }
  if (typeof value.socketId !== 'string' || value.socketId.length === 0) {
    return null;
  }
  return { playerId: value.playerId, socketId: value.socketId };
};

const defaultSeed = (): string | number => crypto.randomUUID();
const defaultShellProjection = (): RuntimeGameShellProjection =>
  buildRuntimeGameShellProjection(defaultProjectGameShellState('tileborne.battle-royale'));

export { MAX_QUEUED_INPUTS_PER_PLAYER } from './room-transport.js';

let nextRoomConstructionSequence = 0;
let smokeFailNextInitialization = false;
const SMOKE_FAIL_NEXT_INITIALIZATION_KEY = '__smoke_fail_next_initialization';
const SMOKE_CONSTRUCTION_SEQUENCE_KEY = '__smoke_construction_sequence';

const parseRoomPlayerReservationBody = async (
  request: Request,
): Promise<RoomPlayerReservationPayload> => {
  const text = await request.text();
  if (text.trim().length === 0) {
    return {};
  }
  let body: RoomPlayerReservationRequest;
  try {
    body = JSON.parse(text) as RoomPlayerReservationRequest;
  } catch {
    throw new Error('reservation body must be valid JSON');
  }
  if (body.playerId === undefined) {
    if (body.displayName !== undefined) {
      if (typeof body.displayName !== 'string' || body.displayName.length === 0) {
        throw new Error('displayName must be a non-empty string');
      }
      return { displayName: body.displayName };
    }
    return {};
  }
  if (typeof body.playerId !== 'string' || body.playerId.length === 0) {
    throw new Error('playerId must be a non-empty string');
  }
  if (body.displayName !== undefined) {
    if (typeof body.displayName !== 'string' || body.displayName.length === 0) {
      throw new Error('displayName must be a non-empty string');
    }
    return { playerId: body.playerId, displayName: body.displayName };
  }
  return { playerId: body.playerId };
};

const parseRoomLobbyConfigBody = async (request: Request): Promise<RoomLobbyConfigPayload> => {
  let body: RoomLobbyConfigRequest;
  try {
    body = (await request.json()) as RoomLobbyConfigRequest;
  } catch {
    throw new Error('lobby config body must be valid JSON');
  }
  if (typeof body.joinCode !== 'string') {
    throw new Error('joinCode is required');
  }
  const joinCode = createRoomJoinCode(body.joinCode);
  if (
    body.visibility !== undefined &&
    body.visibility !== 'private' &&
    body.visibility !== 'public'
  ) {
    throw new Error('visibility must be private or public');
  }
  if (
    body.displayName !== undefined &&
    (typeof body.displayName !== 'string' || body.displayName.length === 0)
  ) {
    throw new Error('displayName must be a non-empty string');
  }
  if (
    body.createdByPlayerId !== undefined &&
    (typeof body.createdByPlayerId !== 'string' || body.createdByPlayerId.length === 0)
  ) {
    throw new Error('createdByPlayerId must be a non-empty string');
  }
  return {
    joinCode,
    ...(body.visibility === undefined ? {} : { visibility: body.visibility }),
    ...(body.displayName === undefined ? {} : { displayName: body.displayName }),
    ...(body.createdByPlayerId === undefined ? {} : { createdByPlayerId: body.createdByPlayerId }),
  };
};

const parseRoomReadyBody = async (request: Request): Promise<RoomReadyPayload> => {
  let body: RoomReadyRequest;
  try {
    body = (await request.json()) as RoomReadyRequest;
  } catch {
    throw new Error('ready body must be valid JSON');
  }
  if (typeof body.playerId !== 'string' || body.playerId.length === 0) {
    throw new Error('playerId is required');
  }
  if (typeof body.ready !== 'boolean') {
    throw new Error('ready must be a boolean');
  }
  return {
    playerId: body.playerId,
    ready: body.ready,
  };
};

const parseRoomOwnerActionBody = async (request: Request): Promise<RoomOwnerActionPayload> => {
  let body: RoomOwnerActionRequest;
  try {
    body = (await request.json()) as RoomOwnerActionRequest;
  } catch {
    throw new Error('owner action body must be valid JSON');
  }
  if (typeof body.playerId !== 'string' || body.playerId.length === 0) {
    throw new Error('playerId is required');
  }
  return { playerId: body.playerId };
};

const parseSmokeDropParticipantSocketBody = async (
  request: Request,
): Promise<SmokeDropParticipantSocketPayload> => {
  let body: SmokeDropParticipantSocketRequest;
  try {
    body = (await request.json()) as SmokeDropParticipantSocketRequest;
  } catch {
    throw new Error('drop participant socket body must be valid JSON');
  }
  if (typeof body.playerId !== 'string' || body.playerId.length === 0) {
    throw new Error('playerId is required');
  }
  return { playerId: body.playerId };
};

const websocketUpgradeResponse = (client: WebSocket): Response => {
  try {
    return new Response(null, { status: 101, webSocket: client });
  } catch {
    return new Response(null, { status: 200, webSocket: client });
  }
};

const PLUGIN_CHECKPOINT_SIM_STATE_PREFIX = 'pluginCheckpoint:';

const pluginCheckpointSimStateKey = (pluginId: string): string =>
  `${PLUGIN_CHECKPOINT_SIM_STATE_PREFIX}${pluginId}`;

const pluginIdFromCheckpointSimStateKey = (key: string): string | undefined =>
  key.startsWith(PLUGIN_CHECKPOINT_SIM_STATE_PREFIX)
    ? key.slice(PLUGIN_CHECKPOINT_SIM_STATE_PREFIX.length)
    : undefined;

export class PlaytestRoom implements DurableObject {
  private storageData: RoomStorage | null = null;
  private runtime: GameRuntimeApi | null = null;
  private behaviorRuntime: AuthoritativeBehaviorRuntimeClient | null = null;
  private pluginHost: PluginHostApi | null = null;
  private readonly socketByPlayerId = new Map<string, RoomSocketRecord>();
  private readonly inputQueueByPlayerId = new Map<string, QueuedInput<BundledRuntimeInput>>();
  private readonly inputByPlayerId = new Map<string, BundledRuntimeInput>();
  private inputEdgeFields: readonly string[] = [];
  private heldBooleanInputFields: readonly string[] = [];
  private readonly queuedInputTransport = createRuntimeInputEdgeTransport<BundledRuntimeInput>(
    () => this.inputEdgeFields as readonly RuntimeInputEdgeField<BundledRuntimeInput>[],
    {
      heldBooleanFields: () =>
        this.heldBooleanInputFields as readonly RuntimeInputEdgeField<BundledRuntimeInput>[],
    },
  );
  private readonly inputTransport = createRuntimeInputEdgeTransport<BundledRuntimeInput>(
    () => this.inputEdgeFields as readonly RuntimeInputEdgeField<BundledRuntimeInput>[],
    {
      heldBooleanFields: () =>
        this.heldBooleanInputFields as readonly RuntimeInputEdgeField<BundledRuntimeInput>[],
    },
  );
  private readonly pluginMessages: RuntimeMessage[] = [];
  private readonly pluginBinaryFrames: Uint8Array[] = [];
  private protocolBridge: BundledPluginProtocolBridge | null = null;
  private pendingMatchEnd: { readonly winnerPlayerId: string } | null = null;
  private latestReplayFrames: readonly Uint8Array[] = [];
  private pluginCheckpointByPluginId = new Map<string, JsonValue>();
  private nextInputOrder = 0;
  private tickAlarmScheduled = false;
  private smokeHibernationQuiescing = false;
  private legacyEnvelopeEnabled = false;
  private initializationPromise: Promise<void> | null = null;
  private initialized = false;
  private readonly deps: PlaytestRoomDeps;
  private constructionSequence: number;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
    deps: PlaytestRoomDeps = {},
  ) {
    this.deps = deps;
    this.constructionSequence = 0;
    this.initializationPromise = this.initialize();
    this.initializationPromise.catch(() => undefined);
  }

  private nowMs(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private nowIso(): string {
    return new Date(this.nowMs()).toISOString();
  }

  private isLiveSocket(socket: WebSocket): boolean {
    return socket.readyState === WebSocket.OPEN;
  }

  private async initialize(): Promise<void> {
    try {
      if (this.constructionSequence === 0) {
        this.constructionSequence = await this.nextConstructionSequence();
      }
      if (
        smokeControlEnabled() &&
        (smokeFailNextInitialization ||
          (await this.state.storage.get<boolean>(SMOKE_FAIL_NEXT_INITIALIZATION_KEY)) === true)
      ) {
        smokeFailNextInitialization = false;
        await this.state.storage.delete(SMOKE_FAIL_NEXT_INITIALIZATION_KEY);
        throw new Error('smoke controlled first room initialization failure');
      }
      await this.hydrateFromStorage();
      this.initialized = true;
    } catch (error) {
      this.tickAlarmScheduled = false;
      await this.stopRuntimeOnly();
      this.initialized = false;
      throw error;
    }
  }

  private async nextConstructionSequence(): Promise<number> {
    if (!smokeControlEnabled()) {
      nextRoomConstructionSequence += 1;
      return nextRoomConstructionSequence;
    }
    const previous = (await this.state.storage.get<number>(SMOKE_CONSTRUCTION_SEQUENCE_KEY)) ?? 0;
    const next = previous + 1;
    await this.state.storage.put(SMOKE_CONSTRUCTION_SEQUENCE_KEY, next);
    return next;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }
    if (this.initializationPromise === null) {
      this.initializationPromise = this.initialize();
      this.initializationPromise.catch(() => undefined);
    }
    try {
      await this.initializationPromise;
    } catch (error) {
      this.initializationPromise = null;
      throw error;
    }
  }

  private async hydrateFromStorage(): Promise<void> {
    const stored = await this.state.storage.get<PersistedRoomStorage>(STORAGE_KEY);
    if (!stored) {
      this.closeAcceptedSocketsWithoutStorage();
      return;
    }
    this.storageData = migrateRoomStorage(stored);
    if (stored.schemaVersion !== this.storageData.schemaVersion) {
      await this.state.storage.put(STORAGE_KEY, this.storageData);
    }
    this.protocolBridge = this.runtimeRegistrationForStorage(this.storageData).protocolBridge;
    this.rehydrateAcceptedSockets(this.storageData);
    if (shouldHydrateRuntime(this.storageData)) {
      await this.ensureRuntime();
      await this.scheduleNextAlarm();
    }
  }

  private rehydrateAcceptedSockets(storage: RoomStorage): void {
    this.socketByPlayerId.clear();
    const candidates = new Map<string, RoomSocketRecord>();
    for (const socket of this.state.getWebSockets()) {
      const attachment = parseRoomSocketAttachment(socket.deserializeAttachment());
      if (attachment === null) {
        socket.close(INVALID_HANDOFF_CLOSE_CODE, 'invalid socket attachment');
        continue;
      }
      if (storage.players[attachment.playerId] === undefined) {
        socket.close(INVALID_HANDOFF_CLOSE_CODE, 'stale socket attachment');
        continue;
      }
      if (socket.readyState === WebSocket.CLOSED) {
        continue;
      }
      if (socket.readyState === WebSocket.CONNECTING) {
        socket.accept();
      }
      const currentSocket = storage.currentSockets?.players[attachment.playerId];
      if (currentSocket !== undefined && currentSocket.socketId !== attachment.socketId) {
        socket.close(ROOM_REPLACED_CLOSE_CODE, 'player reconnected');
        continue;
      }
      const record = createRoomSocketRecord(attachment.playerId, socket, attachment.socketId);
      const existing = candidates.get(attachment.playerId);
      if (existing === undefined) {
        candidates.set(attachment.playerId, record);
        continue;
      }
      const recordOpen = this.isLiveSocket(record.socket);
      const existingOpen = this.isLiveSocket(existing.socket);
      const winner =
        recordOpen !== existingOpen
          ? recordOpen
            ? { keep: record, close: existing }
            : { keep: existing, close: record }
          : record.socketId.localeCompare(existing.socketId) > 0
            ? { keep: record, close: existing }
            : { keep: existing, close: record };
      winner.close.socket.close(ROOM_REPLACED_CLOSE_CODE, 'player reconnected');
      candidates.set(attachment.playerId, winner.keep);
    }
    for (const [playerId, record] of candidates) {
      this.socketByPlayerId.set(playerId, record);
    }
  }

  private closeAcceptedSocketsWithoutStorage(): void {
    this.socketByPlayerId.clear();
    for (const socket of this.state.getWebSockets()) {
      socket.close(INVALID_HANDOFF_CLOSE_CODE, 'stale socket attachment');
    }
  }

  private async writeCurrentSocket(playerId: string, socketId: string): Promise<void> {
    const storage = await this.readStorage();
    if (!storage || storage.players[playerId] === undefined) {
      return;
    }
    await this.writeStorage({
      ...storage,
      currentSockets: {
        players: {
          ...(storage.currentSockets ?? emptyRoomCurrentSocketState()).players,
          [playerId]: {
            playerId,
            socketId,
            connectedAt: this.nowIso(),
          },
        },
      },
    });
  }

  private async clearCurrentSocket(playerId: string, socketId: string): Promise<void> {
    const storage = await this.readStorage();
    if (!storage?.currentSockets?.players[playerId]) {
      return;
    }
    if (storage.currentSockets.players[playerId].socketId !== socketId) {
      return;
    }
    const players = { ...storage.currentSockets.players };
    delete players[playerId];
    await this.writeStorage({
      ...storage,
      currentSockets: { players },
    });
  }

  private async readStorage(): Promise<RoomStorage | null> {
    if (this.storageData) {
      return this.storageData;
    }
    const stored = await this.state.storage.get<PersistedRoomStorage>(STORAGE_KEY);
    if (!stored) {
      return null;
    }
    this.storageData = migrateRoomStorage(stored);
    if (stored.schemaVersion !== this.storageData.schemaVersion) {
      await this.state.storage.put(STORAGE_KEY, this.storageData);
    }
    return this.storageData;
  }

  private async writeStorage(next: RoomStorage): Promise<void> {
    this.storageData = next;
    await this.state.storage.put(STORAGE_KEY, next);
  }

  private emitPluginMessage(message: RuntimeMessage): void {
    this.pluginMessages.push(message);
  }

  private emitPluginFrame(frame: Uint8Array): void {
    if (this.pluginBinaryFrames.length >= MAX_OUTBOUND_FRAMES_PER_TICK) {
      this.pluginBinaryFrames.shift();
    }
    const copy = new Uint8Array(frame.byteLength);
    copy.set(frame);
    this.pluginBinaryFrames.push(copy);
    if (this.pendingMatchEnd === null && this.storageData?.lifecycle.phase === 'active') {
      const lifecycleFrame = this.protocolBridge?.decodeServerLifecycleFrame(copy);
      if (lifecycleFrame?.kind === 'game-over') {
        this.pendingMatchEnd = { winnerPlayerId: lifecycleFrame.winnerPlayerId };
      }
    }
  }

  private restorePluginCheckpoints(storage: RoomStorage | null): void {
    this.pluginCheckpointByPluginId = new Map();
    for (const [key, value] of Object.entries(storage?.simState ?? {})) {
      const pluginId = pluginIdFromCheckpointSimStateKey(key);
      if (pluginId !== undefined && pluginId.length > 0) {
        this.pluginCheckpointByPluginId.set(pluginId, value);
      }
    }
  }

  private getPluginCheckpoint(pluginId: string): JsonValue | undefined {
    return this.pluginCheckpointByPluginId.get(pluginId);
  }

  private setPluginCheckpoint(pluginId: string, checkpoint: JsonValue | undefined): void {
    if (pluginId.length === 0 || checkpoint === undefined) {
      this.pluginCheckpointByPluginId.delete(pluginId);
      return;
    }
    this.pluginCheckpointByPluginId.set(pluginId, checkpoint);
  }

  private simStateWithPluginCheckpoints(
    simState: RoomStorage['simState'],
  ): RoomStorage['simState'] {
    const next = { ...simState };
    for (const key of Object.keys(next)) {
      if (pluginIdFromCheckpointSimStateKey(key) !== undefined) {
        delete next[key];
      }
    }
    for (const [pluginId, checkpoint] of this.pluginCheckpointByPluginId) {
      next[pluginCheckpointSimStateKey(pluginId)] = checkpoint;
    }
    return next;
  }

  private runtimeRegistrations(): readonly BundledPluginRuntimeRegistration[] {
    const registrations = [
      defaultBundledPluginRuntimeRegistration,
      ...(this.deps.pluginRegistrations ?? []),
    ];
    return registrations.filter(
      (registration, index) =>
        registrations.findIndex((candidate) => candidate.id === registration.id) === index,
    );
  }

  private runtimeRegistrationForStorage(
    storage: RoomStorage | null,
  ): BundledPluginRuntimeRegistration {
    const pluginId = resolveBundledRuntimePluginId(storage?.mapPackage);
    const registration = this.runtimeRegistrations().find((candidate) => candidate.id === pluginId);
    if (registration === undefined) {
      throw new RoomLifecycleRejectedError(`no bundled runtime plugin for ${pluginId}`, 400);
    }
    return registration;
  }

  private setReplayFrames(frames: readonly Uint8Array[]): void {
    this.latestReplayFrames = frames.map((frame) => {
      const copy = new Uint8Array(frame.byteLength);
      copy.set(frame);
      return copy;
    });
  }

  private getInputForPlugin(playerId: string): BundledRuntimeInput | undefined {
    return this.inputByPlayerId.get(playerId);
  }

  private getPlayerIdsForPlugin(): readonly string[] {
    const players = Object.values(this.storageData?.players ?? {});
    return players
      .sort((left, right) => {
        const joinedDelta = Date.parse(left.joinedAt) - Date.parse(right.joinedAt);
        return joinedDelta || left.id.localeCompare(right.id);
      })
      .map((player) => player.id);
  }

  private buildSessionMetrics(storage: RoomStorage): PlaytestSummary['metrics'] {
    return toPlaytestSessionMetrics({
      storage,
      connectedClients: this.state.getWebSockets().length,
      queuedInputPlayers: this.inputQueueByPlayerId.size,
      pendingPluginFrames: this.pluginBinaryFrames.length,
      replayFrames: this.latestReplayFrames.length,
      transportClients: [...this.socketByPlayerId.values()].map(toClientTransportStats),
      generatedAt: this.nowIso(),
    });
  }

  private connectedPlayerIds(): readonly string[] {
    return [...this.socketByPlayerId.values()]
      .filter((record) => this.isLiveSocket(record.socket))
      .map((record) => record.playerId);
  }

  private buildLobbySummary(roomId: string, storage: RoomStorage): RoomLobbySummary {
    const readyGate = resolveRoomReadyGate(storage);
    return {
      roomId,
      mapId: storage.mapId,
      phase: storage.lifecycle.phase,
      lobby: storage.lobby,
      playerCount: Object.keys(storage.players).length,
      maxPlayers: resolveRoomPlayerCapacity(storage),
      minReadyPlayers: readyGate.minPlayers,
      canStart: readyGate.canStart,
      players: projectRoomPresence(storage, {
        connectedPlayerIds: this.connectedPlayerIds(),
        now: this.nowIso(),
      }),
    };
  }

  private async configureLobby(input: RoomLobbyConfigPayload): Promise<RoomStorage> {
    const storage = await this.readStorage();
    if (!storage) {
      throw new Error('room not initialized');
    }
    const next: RoomStorage = {
      ...storage,
      lobby: {
        ...storage.lobby,
        joinCode: input.joinCode,
        ...(input.visibility === undefined ? {} : { visibility: input.visibility }),
        ...(input.displayName === undefined ? {} : { title: input.displayName }),
        ...(input.createdByPlayerId === undefined
          ? {}
          : { createdByPlayerId: input.createdByPlayerId }),
      },
    };
    await this.writeStorage(next);
    return next;
  }

  private reconnectExpiresAt(now: string): string {
    return new Date(
      Date.parse(now) + roomReconnectWindowMs(this.env.ROOM_RECONNECT_WINDOW_SECONDS),
    ).toISOString();
  }

  private async setReady(input: RoomReadyPayload): Promise<{
    readonly storage: RoomStorage;
    readonly readyGate: ReturnType<typeof resolveRoomReadyGate>;
  }> {
    const storage = await this.readStorage();
    if (!storage) {
      throw new RoomLifecycleRejectedError('room not initialized', 404);
    }
    const result = setRoomPlayerReady(storage, input.playerId, input.ready, this.nowIso());
    await this.writeStorage(result.storage);
    if (result.storage.lifecycle.phase === 'countdown') {
      await this.scheduleNextAlarm();
    }
    return result;
  }

  private async startFromOwner(input: RoomOwnerActionPayload): Promise<{
    readonly storage: RoomStorage;
    readonly readyGate: ReturnType<typeof resolveRoomReadyGate>;
  }> {
    const storage = await this.readStorage();
    if (!storage) {
      throw new RoomLifecycleRejectedError('room not initialized', 404);
    }
    const result = startRoomFromOwner(storage, input.playerId, this.nowIso());
    await this.writeStorage(result.storage);
    await this.ensureRuntime();
    await this.scheduleNextAlarm();
    return result;
  }

  private async stopFromOwner(input: RoomOwnerActionPayload): Promise<RoomStorage> {
    const storage = await this.readStorage();
    if (!storage) {
      throw new RoomLifecycleRejectedError('room not initialized', 404);
    }
    const next = stopRoomFromOwner(storage, input.playerId, this.nowIso());
    await this.writeStorage(next);
    await this.stopRuntimeOnly();
    await this.state.storage.deleteAlarm();
    return next;
  }

  private async validateReconnect(playerId: string): Promise<RoomStorage> {
    const storage = await this.readStorage();
    if (!storage) {
      throw new RoomLifecycleRejectedError('room not initialized', 404);
    }
    const eligibility = resolveRoomReconnectEligibility(storage, playerId, this.nowIso());
    if (!eligibility.eligible) {
      throw new RoomLifecycleRejectedError(
        eligibility.reason ?? 'player is not eligible to reconnect',
        eligibility.reason === 'player seat is not reserved' ? 404 : 409,
      );
    }
    return storage;
  }

  private async ensureRuntime(): Promise<void> {
    if (this.runtime && this.pluginHost) {
      return;
    }
    const usingCustomPluginHost = this.deps.createPluginHost !== undefined;
    const storage = await this.readStorage();
    this.restorePluginCheckpoints(storage);
    const pluginId = resolveBundledRuntimePluginId(storage?.mapPackage);
    const registration = this.runtimeRegistrationForStorage(storage);
    this.protocolBridge = registration.protocolBridge;
    this.inputEdgeFields = registration.playtestInputEdgeFields ?? [];
    this.heldBooleanInputFields = registration.playtestHeldBooleanInputFields ?? [];
    const pluginHost =
      this.deps.createPluginHost?.((message) => this.emitPluginMessage(message)) ??
      makePluginHost({
        loader: createBundledPluginLoader({
          getPlayerIds: () => this.getPlayerIdsForPlugin(),
          getInput: (playerId) => this.getInputForPlugin(playerId),
          emitFrame: (frame) => this.emitPluginFrame(frame),
          setReplayFrames: (frames) => this.setReplayFrames(frames),
          getPluginCheckpoint: (checkpointPluginId) => this.getPluginCheckpoint(checkpointPluginId),
          setPluginCheckpoint: (checkpointPluginId, checkpoint) =>
            this.setPluginCheckpoint(checkpointPluginId, checkpoint),
          ...(storage?.seed === undefined ? {} : { seed: storage.seed }),
          ...(storage?.mapPackage === undefined ? {} : { mapPackage: storage.mapPackage }),
          ...(storage?.playerModelSelections === undefined
            ? {}
            : {
                getPlayerModelSelections: () => storage.playerModelSelections ?? [],
              }),
          pluginRegistrations: this.runtimeRegistrations(),
        }),
      });
    const runtime = this.deps.createRuntime?.() ?? makeGameRuntime();
    let runtimeInitialized = false;
    try {
      await Effect.runPromise(
        runtime.init({
          tickRate: TICK_HZ,
          pluginHost,
        }),
      );
      runtimeInitialized = true;
      if (!usingCustomPluginHost) {
        await Effect.runPromise(pluginHost.loadAndRegister(pluginId));
        await Effect.runPromise(pluginHost.dispatchInit());
      }
      this.legacyEnvelopeEnabled = usingCustomPluginHost;
      await Effect.runPromise(runtime.start());
      const restoredRuntimeTick =
        storage?.lifecycle.phase === 'active' && typeof storage.simState.lastTick === 'number'
          ? storage.simState.lastTick
          : 0;
      if (restoredRuntimeTick > 0) {
        await Effect.runPromise(runtime.restoreTick(restoredRuntimeTick));
        this.inputTransport.acknowledgePending(this.inputTransport.capturePendingAcknowledgement());
        this.inputByPlayerId.clear();
        this.pluginBinaryFrames.length = 0;
        this.pendingMatchEnd = null;
      }
      this.behaviorRuntime =
        this.deps.createBehaviorRuntime?.({
          ...(storage?.mapPackage === undefined ? {} : { mapPackage: storage.mapPackage }),
          ...(storage?.seed === undefined ? {} : { seed: storage.seed }),
          shellProjection: storage?.shellProjection ?? defaultShellProjection(),
        }) ??
        createWorkerdBehaviorRuntimeClient({
          ...(this.env.BEHAVIOR_RUNTIME === undefined
            ? {}
            : { binding: this.env.BEHAVIOR_RUNTIME }),
          ...(storage?.mapPackage === undefined ? {} : { mapPackage: storage.mapPackage }),
          ...(storage?.seed === undefined ? {} : { seed: storage.seed }),
          shellProjection: storage?.shellProjection ?? defaultShellProjection(),
        });
      this.runtime = runtime;
      this.pluginHost = pluginHost;
    } catch (error) {
      this.runtime = null;
      this.behaviorRuntime = null;
      this.pluginHost = null;
      this.legacyEnvelopeEnabled = false;
      if (runtimeInitialized) {
        await Effect.runPromise(runtime.stop()).catch(() => undefined);
      }
      throw error;
    }
  }

  private async stopRuntimeOnly(): Promise<void> {
    const runtime = this.runtime;
    this.runtime = null;
    this.behaviorRuntime = null;
    this.pluginHost = null;
    this.legacyEnvelopeEnabled = false;
    this.pluginBinaryFrames.length = 0;
    this.latestReplayFrames = [];
    if (runtime) {
      await Effect.runPromise(runtime.stop());
    }
  }

  private async restartRuntimeForPreActiveRosterChange(storage: RoomStorage): Promise<void> {
    if (!this.runtime || this.legacyEnvelopeEnabled || this.deps.createRuntime !== undefined) {
      return;
    }
    if (storage.lifecycle.phase === 'active') {
      return;
    }
    await this.stopRuntimeOnly();
  }

  private async syncRuntimeForActiveRosterAdmission(
    storage: RoomStorage,
    playerWasPresent: boolean,
  ): Promise<void> {
    if (
      playerWasPresent ||
      storage.lifecycle.phase !== 'active' ||
      this.legacyEnvelopeEnabled ||
      this.deps.createRuntime !== undefined
    ) {
      return;
    }
    await this.runSimulationTick();
  }

  async create(opts: RoomCreateOptions): Promise<RoomStorage> {
    await this.ensureInitialized();
    if (!isHandoffSigningKeyValid(this.env)) {
      throw new Error('handoff signing key is not configured');
    }
    const existing = await this.readStorage();
    if (existing) {
      if (opts.idempotencyKey !== undefined && existing.idempotencyKey === opts.idempotencyKey) {
        return existing;
      }
      if (existing.lifecycle.phase !== 'archived') {
        return existing;
      }
    }
    const seed = opts.seed ?? defaultSeed();
    const options = opts.options ?? {};
    validateRoomOptions(options);
    const created = emptyRoomStorage(
      opts.mapId,
      seed,
      options,
      opts.idempotencyKey,
      this.nowIso(),
      opts.mapPackage,
      opts.playerModelSelections,
      opts.shellProjection,
    );
    this.protocolBridge = this.runtimeRegistrationForStorage(created).protocolBridge;
    await this.writeStorage(created);
    return created;
  }

  async destroy(): Promise<void> {
    await this.ensureInitialized();
    const sockets = this.state.getWebSockets();
    for (const socket of sockets) {
      socket.close(1000, 'room destroyed');
    }
    this.socketByPlayerId.clear();
    if (this.runtime) {
      await Effect.runPromise(this.runtime.stop());
      this.runtime = null;
      this.pluginHost = null;
    }
    const existing = await this.readStorage();
    if (existing) {
      await this.writeStorage(archiveRoom(existing, this.nowIso(), 'room destroyed'));
    }
    await this.state.storage.deleteAlarm();
  }

  getPlayers(): Record<string, RoomPlayerRecord> {
    return { ...this.storageData?.players };
  }

  getClientTransportStats(playerId: string): ClientTransportStats | undefined {
    const record = this.socketByPlayerId.get(playerId);
    return record === undefined ? undefined : toClientTransportStats(record);
  }

  async addPlayer(
    playerId: string,
    sessionToken: string,
    playtestId: string,
    options: { readonly broadcast?: boolean } = {},
  ): Promise<void> {
    await this.ensureInitialized();
    const verified = await verifyHandoffToken(this.env, sessionToken, {
      playtestId,
      purpose: 'handoff',
    });
    if (!verified || verified.playerId !== playerId) {
      throw new Error('invalid handoff token');
    }
    const storage = await this.readStorage();
    if (!storage) {
      throw new Error('room not initialized');
    }
    const playerWasPresent = storage.players[playerId] !== undefined;
    const next = admitPlayerToRoom(storage, playerId, this.nowIso());
    await this.writeStorage(next);
    await this.restartRuntimeForPreActiveRosterChange(next);
    await this.ensureRuntime();
    await this.syncRuntimeForActiveRosterAdmission(next, playerWasPresent);
    await this.scheduleNextAlarm();
    if (options.broadcast !== false && this.legacyEnvelopeEnabled) {
      this.broadcast(new PlayerJoined({ playerId, displayName: Option.none() }));
    }
  }

  async removePlayer(playerId: string, reason: string): Promise<void> {
    await this.ensureInitialized();
    const storage = await this.readStorage();
    if (!storage || !storage.players[playerId]) {
      return;
    }
    const players = { ...storage.players };
    delete players[playerId];
    const readyPlayers = { ...storage.ready.players };
    delete readyPlayers[playerId];
    const reconnectSeats = { ...storage.reconnect.seats };
    delete reconnectSeats[playerId];
    const now = this.nowIso();
    const previousPresence = storage.presence.players[playerId];
    const removed: RoomStorage = {
      ...storage,
      players,
      ready: { players: readyPlayers },
      presence: {
        players: {
          ...storage.presence.players,
          [playerId]: {
            playerId,
            status: 'disconnected',
            lastSeenAt: now,
            ...(previousPresence?.connectedAt === undefined
              ? {}
              : { connectedAt: previousPresence.connectedAt }),
            disconnectedAt: now,
          },
        },
      },
      reconnect: { seats: reconnectSeats },
      emptySince: Object.keys(players).length === 0 ? now : null,
    };
    const next = finishRoomIfEmpty(removed, now, reason);
    await this.writeStorage(next);
    if (this.legacyEnvelopeEnabled) {
      this.broadcast(new PlayerLeft({ playerId, reason }));
    }
    const socket = this.socketByPlayerId.get(playerId)?.socket;
    if (socket && this.isLiveSocket(socket)) {
      socket.close(1000, reason);
    }
    this.socketByPlayerId.delete(playerId);
    if (Object.keys(players).length === 0) {
      await this.scheduleEmptyRoomCheck();
    }
  }

  private async disconnectPlayer(
    playerId: string,
    reason: string,
    close: { readonly code?: number; readonly reason?: string } = {},
  ): Promise<void> {
    const storage = await this.readStorage();
    if (!storage || !storage.players[playerId]) {
      return;
    }
    const now = this.nowIso();
    const next = markRoomPlayerDisconnected(storage, playerId, now, this.reconnectExpiresAt(now));
    await this.writeStorage(next);
    await this.scheduleReconnectExpiryCheck(next);
    const socket = this.socketByPlayerId.get(playerId)?.socket;
    socket?.close(close.code ?? 1000, close.reason ?? reason);
    this.socketByPlayerId.delete(playerId);
  }

  private async smokeDropParticipantSocket(playerId: string): Promise<{
    readonly socketId: string;
    readonly storage: RoomStorage;
  }> {
    const storage = await this.readStorage();
    if (!storage) {
      throw new RoomLifecycleRejectedError('room not initialized', 404);
    }
    if (storage.players[playerId] === undefined) {
      throw new RoomLifecycleRejectedError('player is not in the room', 404);
    }
    const record = this.socketByPlayerId.get(playerId);
    if (record === undefined || !this.isLiveSocket(record.socket)) {
      throw new RoomLifecycleRejectedError('player socket is not connected', 409);
    }
    await this.disconnectPlayer(playerId, SMOKE_TRANSPORT_LOSS_CLOSE_REASON, {
      code: SMOKE_TRANSPORT_LOSS_CLOSE_CODE,
      reason: SMOKE_TRANSPORT_LOSS_CLOSE_REASON,
    });
    const next = await this.readStorage();
    if (!next) {
      throw new RoomLifecycleRejectedError('room not initialized', 404);
    }
    return { socketId: record.socketId, storage: next };
  }

  private broadcast(message: RuntimeMessage): void {
    const frame = toArrayBuffer(encodeMessage(message));
    broadcastBinaryFrame(this.collectOpenSockets(), frame);
  }

  private collectOpenSockets(): readonly BinarySocket[] {
    return this.state.getWebSockets().map((socket) => ({
      readyState: socket.readyState,
      send: (data: ArrayBuffer) => {
        socket.send(data);
      },
    }));
  }

  private sendBinaryFrameToSocket(ws: WebSocket, frame: Uint8Array): void {
    if (!this.isLiveSocket(ws)) {
      return;
    }
    ws.send(toArrayBuffer(frame));
  }

  private sendSnapshotFrameToRecord(record: RoomSocketRecord, frame: Uint8Array): void {
    const tick = this.protocolBridge?.snapshotTickFromServerFrame(frame);
    if (tick === undefined) {
      this.sendBinaryFrameToSocket(record.socket, frame);
      return;
    }
    recordSnapshotProduced(record, tick);
    const decision = decideSnapshotOutbound(record, socketBufferedAmount(record.socket), tick);
    if (decision === 'close') {
      recordOutboundDropped(record);
      record.socket.close(ROOM_BACKPRESSURE_CLOSE_CODE, 'snapshot backpressure');
      return;
    }
    if (decision === 'drop') {
      recordOutboundDropped(record);
      return;
    }
    if (decision === 'resync') {
      recordOutboundDropped(record);
      if (this.latestReplayFrames.length === 0) {
        record.socket.close(ROOM_BACKPRESSURE_CLOSE_CODE, 'snapshot backpressure');
        return;
      }
      this.sendReplayFramesToSocket(record, true);
      return;
    }
    recordSnapshotSent(record, tick);
    this.sendBinaryFrameToSocket(record.socket, frame);
  }

  private closeLiveSocketsForTerminalResult(): void {
    const closedSocketIds = new Set<string>();
    for (const [playerId, record] of this.socketByPlayerId) {
      if (!this.isLiveSocket(record.socket) || closedSocketIds.has(record.socketId)) {
        this.socketByPlayerId.delete(playerId);
        continue;
      }
      closedSocketIds.add(record.socketId);
      record.socket.close(MATCH_ENDED_CLOSE_CODE, MATCH_ENDED_CLOSE_REASON);
      this.socketByPlayerId.delete(playerId);
    }
  }

  private sendReplayFramesToSocket(record: RoomSocketRecord, markAsResync = false): void {
    for (const frame of this.latestReplayFrames) {
      const tick = this.protocolBridge?.snapshotTickFromServerFrame(frame);
      if (tick !== undefined) {
        if (markAsResync) {
          recordSnapshotResyncSent(record, tick);
        } else {
          recordSnapshotSent(record, tick);
        }
      }
      this.sendBinaryFrameToSocket(record.socket, frame);
    }
  }

  private sendReplayFramesToCurrentSockets(): void {
    for (const record of this.socketByPlayerId.values()) {
      if (this.isLiveSocket(record.socket)) {
        this.sendReplayFramesToSocket(record);
      }
    }
  }

  private async acceptPlayerSocket(playerId: string, server: WebSocket): Promise<void> {
    await this.ensureInitialized();
    const previous = this.socketByPlayerId.get(playerId);
    const socketId = crypto.randomUUID();
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ playerId, socketId });
    await this.writeCurrentSocket(playerId, socketId);
    const record = createRoomSocketRecord(playerId, server, socketId);
    this.socketByPlayerId.set(playerId, record);
    this.sendReplayFramesToSocket(record);
    if (previous?.socket !== undefined && this.isLiveSocket(previous.socket)) {
      previous.socket.close(ROOM_REPLACED_CLOSE_CODE, 'player reconnected');
    }
  }

  private async scheduleNextAlarm(): Promise<void> {
    if (this.smokeHibernationQuiescing || this.tickAlarmScheduled) {
      return;
    }
    await this.state.storage.setAlarm(this.nowMs() + TICK_INTERVAL_MS);
    this.tickAlarmScheduled = true;
  }

  private async scheduleEmptyRoomCheck(): Promise<void> {
    if (this.smokeHibernationQuiescing) {
      return;
    }
    const idleMs = roomIdleTimeoutMs(this.env.ROOM_IDLE_TIMEOUT_SECONDS);
    await this.state.storage.setAlarm(this.nowMs() + idleMs);
  }

  private async scheduleAlarmAt(timestampMs: number): Promise<void> {
    if (this.smokeHibernationQuiescing) {
      return;
    }
    await this.state.storage.setAlarm(timestampMs);
    this.tickAlarmScheduled = true;
  }

  private nextReconnectExpiryMs(storage: RoomStorage): number | undefined {
    const expiries = Object.values(storage.reconnect.seats)
      .filter((seat) => storage.presence.players[seat.playerId]?.status === 'disconnected')
      .map((seat) => (seat.expiresAt === undefined ? Number.NaN : Date.parse(seat.expiresAt)))
      .filter(Number.isFinite);
    if (expiries.length === 0) {
      return undefined;
    }
    return Math.min(...expiries);
  }

  private async scheduleReconnectExpiryCheck(storage: RoomStorage): Promise<void> {
    const nextExpiryMs = this.nextReconnectExpiryMs(storage);
    if (nextExpiryMs === undefined) {
      return;
    }
    const currentAlarm = await this.state.storage.getAlarm();
    if (currentAlarm === null || nextExpiryMs < currentAlarm) {
      await this.scheduleAlarmAt(nextExpiryMs);
    }
  }

  async alarm(): Promise<void> {
    if (this.smokeHibernationQuiescing) {
      return;
    }
    await this.ensureInitialized();
    if (this.smokeHibernationQuiescing) {
      return;
    }
    this.tickAlarmScheduled = false;
    const storage = await this.readStorage();
    if (!storage) {
      return;
    }
    if (Object.keys(storage.players).length === 0 && storage.emptySince) {
      const idleMs = roomIdleTimeoutMs(this.env.ROOM_IDLE_TIMEOUT_SECONDS);
      const emptySinceMs = Date.parse(storage.emptySince);
      if (this.nowMs() - emptySinceMs >= idleMs) {
        await this.destroy();
        return;
      }
      await this.scheduleEmptyRoomCheck();
      return;
    }
    await this.disconnectStalePlayers();
    const latest = await this.readStorage();
    if (!latest) {
      return;
    }
    if (latest.pendingSimulationCommit) {
      const shouldContinue = await this.completeCommittedSimulationTick(latest);
      if (shouldContinue) {
        await this.scheduleNextAlarm();
      }
      return;
    }
    const lifecycleStep = advanceLifecycleForAlarm(latest, this.nowMs(), this.nowIso());
    if (lifecycleStep.changed) {
      await this.writeStorage(lifecycleStep.storage);
    }
    if (lifecycleStep.rescheduleAtMs !== undefined) {
      await this.scheduleAlarmAt(lifecycleStep.rescheduleAtMs);
      return;
    }
    if (lifecycleStep.runSimulation) {
      const shouldContinue = await this.runSimulationTick();
      if (shouldContinue) {
        await this.scheduleNextAlarm();
      }
      return;
    }
    await this.scheduleReconnectExpiryCheck(lifecycleStep.changed ? lifecycleStep.storage : latest);
  }

  private async disconnectStalePlayers(): Promise<void> {
    const storage = await this.readStorage();
    if (!storage) {
      return;
    }
    const nowMs = this.deps.now?.() ?? Date.now();
    for (const player of Object.values(storage.players)) {
      const presence = storage.presence.players[player.id];
      if (presence?.status === 'disconnected') {
        const eligibility = resolveRoomReconnectEligibility(storage, player.id, this.nowIso());
        if (!eligibility.eligible && eligibility.reason === 'reconnect seat expired') {
          await this.removePlayer(player.id, 'reconnect expired');
        }
        continue;
      }
      const lastHeartbeatMs = Date.parse(player.lastHeartbeatAt);
      if (nowMs - lastHeartbeatMs >= heartbeatTimeoutMs(this.env.HEARTBEAT_TIMEOUT_SECONDS)) {
        await this.disconnectPlayer(player.id, 'heartbeat timeout');
      }
    }
  }

  private buildSnapshotDiff(
    tick: number,
    playerCount: number,
  ): readonly Record<string, string | number | boolean | null>[] {
    return [{ tick, players: playerCount }];
  }

  private drainInputQueueForTick(): void {
    const inputs = [...this.inputQueueByPlayerId.values()];
    this.inputQueueByPlayerId.clear();
    if (inputs.length === 0) {
      return;
    }
    inputs.sort(
      (left, right) =>
        left.sortKey.tick - right.sortKey.tick ||
        left.playerId.localeCompare(right.playerId) ||
        left.sortKey.seq - right.sortKey.seq ||
        left.order - right.order,
    );
    for (const input of inputs) {
      this.inputByPlayerId.set(
        input.playerId,
        this.inputTransport.set(input.playerId, input.input),
      );
    }
    this.queuedInputTransport.acknowledgePending(
      this.queuedInputTransport.capturePendingAcknowledgement(),
    );
  }

  private enqueueInput(
    playerId: string,
    input: BundledRuntimeInput,
    sortKey: QueuedInput<BundledRuntimeInput>['sortKey'],
  ): void {
    const queued: QueuedInput<BundledRuntimeInput> = {
      playerId,
      input,
      sortKey,
      order: this.nextInputOrder,
    };
    this.nextInputOrder += 1;

    const existing = this.inputQueueByPlayerId.get(playerId);
    if (existing && compareQueuedInputs(queued, existing) < 0) {
      return;
    }
    const resolvedInput = this.queuedInputTransport.set(playerId, input);
    this.inputQueueByPlayerId.set(playerId, { ...queued, input: resolvedInput });
  }

  private clearQueuedInputs(): void {
    for (const playerId of this.inputQueueByPlayerId.keys()) {
      this.queuedInputTransport.delete(playerId);
    }
    this.inputQueueByPlayerId.clear();
  }

  private broadcastPluginFrames(): void {
    const records = [...this.socketByPlayerId.values()].filter((record) =>
      this.isLiveSocket(record.socket),
    );
    for (const frame of this.pluginBinaryFrames.splice(0)) {
      for (const record of records) {
        this.sendSnapshotFrameToRecord(record, frame);
      }
    }
  }

  private broadcastShellNavigationRequests(
    epoch: string,
    startSequence: number,
    requests: readonly { readonly type: 'navigate'; readonly targetScreenId: string }[],
  ): void {
    if (requests.length === 0) {
      return;
    }
    const records = [...this.socketByPlayerId.values()].filter((record) =>
      this.isLiveSocket(record.socket),
    );
    let sequence = startSequence;
    for (const request of requests) {
      const frame = encodeRoomShellNavigationServerFrame(epoch, sequence, request);
      sequence += 1;
      for (const record of records) {
        record.socket.send(frame);
      }
    }
  }

  private async runSimulationTick(): Promise<boolean> {
    const storage = await this.readStorage();
    if (!storage || !this.runtime || storage.lifecycle.phase !== 'active') {
      return false;
    }
    const isFirstActiveTick = storage.tick === 0;
    if (!this.legacyEnvelopeEnabled && isFirstActiveTick) {
      this.pluginBinaryFrames.length = 0;
    }
    this.drainInputQueueForTick();
    const inputAcknowledgement = this.inputTransport.capturePendingAcknowledgement();
    await Effect.runPromise(this.runtime.step(1));
    this.inputTransport.acknowledgePending(inputAcknowledgement);
    this.inputByPlayerId.clear();
    const tick = storage.tick + 1;
    const baseTick = tick % PERSIST_EVERY_N_TICKS === 0 ? tick : storage.baseTick;
    const diff = this.buildSnapshotDiff(tick, Object.keys(storage.players).length);
    const shouldPersist = tick % PERSIST_EVERY_N_TICKS === 0;
    const shellNavigationEpoch = storage.shellNavigationEpoch ?? storage.createdAt;
    const shellNavigationStartSequence = storage.nextShellNavigationSequence ?? 0;
    const tickStorage: RoomStorage = {
      ...storage,
      tick,
      baseTick,
      lastTickAt: this.nowIso(),
      shellNavigationEpoch,
      nextShellNavigationSequence: shellNavigationStartSequence,
      simState: {
        ...this.simStateWithPluginCheckpoints(storage.simState),
        lastTick: tick,
        playerCount: Object.keys(storage.players).length,
      },
      ...(shouldPersist ? { lastPersistedTick: tick } : {}),
      pendingSimulationCommit: {
        tick,
        shellNavigationEpoch,
        shellNavigationStartSequence,
      },
    };
    await this.writeStorage(tickStorage);
    return this.completeCommittedSimulationTick(tickStorage, {
      baseTick,
      diff,
      isFirstActiveTick,
    });
  }

  private async completeCommittedSimulationTick(
    storage: RoomStorage,
    options?: {
      readonly baseTick: number;
      readonly diff: readonly Record<string, string | number | boolean | null>[];
      readonly isFirstActiveTick: boolean;
    },
  ): Promise<boolean> {
    const pending = storage.pendingSimulationCommit;
    if (!pending || storage.lifecycle.phase !== 'active') {
      return false;
    }
    const tick = pending.tick;
    const baseTick = options?.baseTick ?? storage.baseTick;
    const diff = options?.diff ?? this.buildSnapshotDiff(tick, Object.keys(storage.players).length);
    const isFirstActiveTick = options?.isFirstActiveTick ?? tick === 1;
    let behaviorStepFailed = false;
    try {
      await this.behaviorRuntime?.step(tick);
    } catch {
      behaviorStepFailed = true;
    }
    const shellNavigationRequests = behaviorStepFailed
      ? []
      : (this.behaviorRuntime?.shellNavigationRequests ?? []);
    const committedStorage = { ...storage };
    Reflect.deleteProperty(committedStorage, 'pendingSimulationCommit');
    const behaviorStorage: RoomStorage = {
      ...committedStorage,
      shellNavigationEpoch: pending.shellNavigationEpoch,
      nextShellNavigationSequence:
        pending.shellNavigationStartSequence + shellNavigationRequests.length,
    };
    const matchEnd = this.pendingMatchEnd;
    this.pendingMatchEnd = null;
    const next =
      matchEnd === null
        ? behaviorStorage
        : {
            ...finishRoomFromMatchEnd(behaviorStorage, this.nowIso(), matchEnd.winnerPlayerId),
            lastPersistedTick: tick,
          };
    const terminal = next.lifecycle.phase === 'finished';
    if (
      terminal ||
      shellNavigationRequests.length > 0 ||
      pending.shellNavigationEpoch !== storage.shellNavigationEpoch ||
      behaviorStorage.nextShellNavigationSequence !== storage.nextShellNavigationSequence ||
      storage.pendingSimulationCommit !== undefined
    ) {
      await this.writeStorage(next);
    }
    if (this.legacyEnvelopeEnabled) {
      if (tick % PERSIST_EVERY_N_TICKS === 0) {
        this.broadcast(
          new SnapshotFull({
            players: Option.some([{ tick, players: Object.keys(storage.players).length }]),
            pickups: Option.none(),
            decoys: Option.none(),
            safeZone: Option.none(),
          }),
        );
      } else {
        this.broadcast(
          new SnapshotDelta({
            tick,
            baseTick,
            diff: Option.some([...diff]),
          }),
        );
      }
    }
    if (!this.legacyEnvelopeEnabled && isFirstActiveTick) {
      this.sendReplayFramesToCurrentSockets();
    }
    this.broadcastPluginFrames();
    this.broadcastShellNavigationRequests(
      pending.shellNavigationEpoch,
      pending.shellNavigationStartSequence,
      shellNavigationRequests,
    );
    if (this.pluginHost && this.legacyEnvelopeEnabled) {
      for (const message of this.pluginMessages.splice(0)) {
        this.broadcast(message);
      }
      this.broadcast(new Events({ events: Option.some([{ type: 'tick', tick }]) }));
    }
    if (terminal) {
      this.clearQueuedInputs();
      this.inputByPlayerId.clear();
      this.tickAlarmScheduled = false;
      await this.state.storage.deleteAlarm();
      this.closeLiveSocketsForTerminalResult();
    }
    return !terminal;
  }

  private async touchHeartbeat(playerId: string): Promise<void> {
    const storage = await this.readStorage();
    if (!storage || !storage.players[playerId]) {
      return;
    }
    const now = this.nowIso();
    const previousPresence = storage.presence.players[playerId];
    const next: RoomStorage = {
      ...storage,
      players: {
        ...storage.players,
        [playerId]: {
          ...storage.players[playerId],
          lastHeartbeatAt: now,
        },
      },
      presence: {
        players: {
          ...storage.presence.players,
          [playerId]: {
            playerId,
            status: 'connected',
            lastSeenAt: now,
            connectedAt: previousPresence?.connectedAt ?? now,
          },
        },
      },
    };
    await this.writeStorage(next);
  }

  private smokeRoomState(roomId: string): {
    readonly roomId: string;
    readonly constructionSequence: number;
    readonly tick: number;
    readonly acceptedSockets: readonly {
      readonly readyState: number;
      readonly open: boolean;
      readonly attachment: RoomSocketAttachment | null;
    }[];
    readonly connectedPlayers: readonly string[];
    readonly transportClients: readonly ClientTransportStats[];
    readonly playerState: Record<
      string,
      {
        readonly lastHeartbeatAt: string;
        readonly lastSeenAt: string | null;
        readonly presenceStatus: string | null;
      }
    >;
  } {
    const storage = this.storageData;
    return {
      roomId,
      constructionSequence: this.constructionSequence,
      tick: storage?.tick ?? 0,
      acceptedSockets: this.state.getWebSockets().map((socket) => ({
        readyState: socket.readyState,
        open: this.isLiveSocket(socket),
        attachment: parseRoomSocketAttachment(socket.deserializeAttachment()),
      })),
      connectedPlayers: [...this.connectedPlayerIds()].sort(),
      transportClients: [...this.socketByPlayerId.values()].map(toClientTransportStats),
      playerState: Object.fromEntries(
        Object.entries(storage?.players ?? {}).map(([playerId, player]) => {
          const presence = storage?.presence.players[playerId];
          return [
            playerId,
            {
              lastHeartbeatAt: player.lastHeartbeatAt,
              lastSeenAt: presence?.lastSeenAt ?? null,
              presenceStatus: presence?.status ?? null,
            },
          ];
        }),
      ),
    };
  }

  private async establishSmokeHibernationQuiescence(): Promise<number> {
    this.smokeHibernationQuiescing = true;
    this.tickAlarmScheduled = false;
    await this.stopRuntimeOnly();
    await this.state.storage.deleteAlarm();
    const acceptedSocketCount = this.state.getWebSockets().length;
    this.storageData = null;
    this.socketByPlayerId.clear();
    this.clearQueuedInputs();
    this.inputByPlayerId.clear();
    this.pluginMessages.length = 0;
    this.pluginBinaryFrames.length = 0;
    this.latestReplayFrames = [];
    this.protocolBridge = null;
    this.pendingMatchEnd = null;
    await this.state.storage.deleteAlarm();
    this.tickAlarmScheduled = false;
    return acceptedSocketCount;
  }

  private rejectWebSocket(
    server: WebSocket,
    client: WebSocket,
    code: number,
    message: string,
  ): Response {
    server.accept();
    setTimeout(() => {
      server.close(code, message);
    }, 25);
    return websocketUpgradeResponse(client);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const cf = request.cf as { readonly alarm?: boolean } | undefined;
    if (cf?.alarm === true) {
      await this.alarm();
      return Response.json({ ok: true, triggered: 'alarm' });
    }

    if (
      smokeControlEnabled() &&
      request.method === 'GET' &&
      url.pathname === '/__smoke/reconstruction'
    ) {
      const roomId = url.searchParams.get('roomId') ?? 'unknown';
      try {
        await this.ensureInitialized();
      } catch (error) {
        return Response.json(
          {
            roomId,
            constructionSequence: this.constructionSequence,
            error:
              error instanceof Error ? error.message : 'room reconstruction initialization failed',
          },
          { status: 500 },
        );
      }
      const storage = await this.readStorage();
      if (!storage) {
        return Response.json({ error: 'playtest not initialized' }, { status: 404 });
      }
      this.smokeHibernationQuiescing = false;
      if (shouldHydrateRuntime(storage)) {
        await this.ensureRuntime();
        await this.scheduleNextAlarm();
      }
      return Response.json({
        ...this.smokeRoomState(roomId),
      });
    }

    if (
      smokeControlEnabled() &&
      request.method === 'GET' &&
      url.pathname === '/__smoke/hibernation-state'
    ) {
      return Response.json(this.smokeRoomState(url.searchParams.get('roomId') ?? 'unknown'));
    }

    if (
      smokeControlEnabled() &&
      request.method === 'POST' &&
      url.pathname === '/__smoke/allow-hibernation'
    ) {
      const acceptedSocketCount = await this.establishSmokeHibernationQuiescence();
      return Response.json({
        roomId: url.searchParams.get('roomId') ?? 'unknown',
        constructionSequence: this.constructionSequence,
        acceptedSocketCount,
      });
    }

    if (
      smokeControlEnabled() &&
      request.method === 'POST' &&
      url.pathname === '/__smoke/fail-next-initialization'
    ) {
      smokeFailNextInitialization = true;
      await this.state.storage.put(SMOKE_FAIL_NEXT_INITIALIZATION_KEY, true);
      return Response.json({
        roomId: url.searchParams.get('roomId') ?? 'unknown',
        constructionSequence: this.constructionSequence,
      });
    }

    if (
      smokeControlEnabled() &&
      request.method === 'POST' &&
      url.pathname === '/__smoke/drop-participant-socket'
    ) {
      let input: SmokeDropParticipantSocketPayload;
      try {
        input = await parseSmokeDropParticipantSocketBody(request);
      } catch (error) {
        return Response.json(
          {
            error:
              error instanceof Error ? error.message : 'invalid drop participant socket request',
          },
          { status: 400 },
        );
      }
      try {
        const dropped = await this.smokeDropParticipantSocket(input.playerId);
        return Response.json({
          roomId: url.searchParams.get('roomId') ?? 'unknown',
          playerId: input.playerId,
          socketId: dropped.socketId,
          closeCode: SMOKE_TRANSPORT_LOSS_CLOSE_CODE,
          reconnectEligible: resolveRoomReconnectEligibility(
            dropped.storage,
            input.playerId,
            this.nowIso(),
          ).eligible,
          connectedPlayers: [...this.connectedPlayerIds()].sort(),
        });
      } catch (error) {
        if (error instanceof RoomLifecycleRejectedError) {
          return Response.json({ error: error.message }, { status: error.httpStatus });
        }
        return Response.json({ error: 'failed to drop participant socket' }, { status: 500 });
      }
    }

    await this.ensureInitialized();

    // Room creation is EXPLICIT (`/rooms/create` → `/create`): joining or
    // starting against an unknown room must never materialize one (hard cut).
    if (request.method === 'POST' && url.pathname === '/create') {
      if (!isHandoffSigningKeyValid(this.env)) {
        return Response.json({ error: 'room unavailable' }, { status: 503 });
      }
      const body = await request.text();
      // Boundary validation (M2 review, F1): reject malformed create bodies —
      // including a supplied mapPackage that does not decode as a
      // `RuntimeMapPackage` — with a structured 400 instead of storing them.
      let init: ReturnType<typeof parsePlaytestInitBody>;
      try {
        init = parsePlaytestInitBody(body);
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : 'invalid room create request' },
          { status: 400 },
        );
      }
      const created = await this.create({
        mapId: init.mapId,
        ...(init.seed === undefined ? {} : { seed: init.seed }),
        ...(init.options === undefined ? {} : { options: init.options }),
        ...(init.mapPackage === undefined ? {} : { mapPackage: init.mapPackage }),
        ...(init.shellProjection === undefined ? {} : { shellProjection: init.shellProjection }),
        ...(init.playerModelSelections === undefined
          ? {}
          : { playerModelSelections: init.playerModelSelections }),
        ...(init.options?.idempotencyKey === undefined ||
        typeof init.options.idempotencyKey !== 'string'
          ? {}
          : { idempotencyKey: init.options.idempotencyKey }),
      });
      return Response.json({
        ok: true,
        roomId: url.searchParams.get('roomId') ?? 'local',
        mapId: created.mapId,
      });
    }

    if (request.method === 'POST' && url.pathname === '/lobby/configure') {
      if (!isHandoffSigningKeyValid(this.env)) {
        return Response.json({ error: 'room unavailable' }, { status: 503 });
      }
      let config: RoomLobbyConfigPayload;
      try {
        config = await parseRoomLobbyConfigBody(request);
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : 'invalid lobby config request' },
          { status: 400 },
        );
      }
      try {
        const storage = await this.configureLobby(config);
        const roomId = url.searchParams.get('roomId') ?? 'local';
        return Response.json({ lobby: this.buildLobbySummary(roomId, storage) });
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : 'failed to configure lobby' },
          { status: 404 },
        );
      }
    }

    if (request.method === 'POST' && url.pathname === '/lobby/ready') {
      if (!isHandoffSigningKeyValid(this.env)) {
        return Response.json({ error: 'room unavailable' }, { status: 503 });
      }
      let input: RoomReadyPayload;
      try {
        input = await parseRoomReadyBody(request);
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : 'invalid ready request' },
          { status: 400 },
        );
      }
      try {
        const result = await this.setReady(input);
        const roomId = url.searchParams.get('roomId') ?? 'local';
        return Response.json({
          lobby: this.buildLobbySummary(roomId, result.storage),
          canStart: result.readyGate.canStart,
          ...(result.readyGate.reason === undefined ? {} : { reason: result.readyGate.reason }),
        });
      } catch (error) {
        if (error instanceof RoomLifecycleRejectedError) {
          return Response.json({ error: error.message }, { status: error.httpStatus });
        }
        return Response.json({ error: 'failed to update ready state' }, { status: 500 });
      }
    }

    if (request.method === 'POST' && url.pathname === '/lobby/start') {
      if (!isHandoffSigningKeyValid(this.env)) {
        return Response.json({ error: 'room unavailable' }, { status: 503 });
      }
      let input: RoomOwnerActionPayload;
      try {
        input = await parseRoomOwnerActionBody(request);
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : 'invalid start request' },
          { status: 400 },
        );
      }
      try {
        const result = await this.startFromOwner(input);
        const roomId = url.searchParams.get('roomId') ?? 'local';
        return Response.json({
          lobby: this.buildLobbySummary(roomId, result.storage),
          started: result.storage.lifecycle.phase === 'active',
          ...(result.readyGate.reason === undefined ? {} : { reason: result.readyGate.reason }),
        });
      } catch (error) {
        if (error instanceof RoomLifecycleRejectedError) {
          return Response.json({ error: error.message }, { status: error.httpStatus });
        }
        return Response.json({ error: 'failed to start room' }, { status: 500 });
      }
    }

    if (request.method === 'POST' && url.pathname === '/room/stop') {
      if (!isHandoffSigningKeyValid(this.env)) {
        return Response.json({ error: 'room unavailable' }, { status: 503 });
      }
      let input: RoomOwnerActionPayload;
      try {
        input = await parseRoomOwnerActionBody(request);
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : 'invalid stop request' },
          { status: 400 },
        );
      }
      try {
        const storage = await this.stopFromOwner(input);
        const roomId = url.searchParams.get('roomId') ?? 'local';
        return Response.json({
          roomId,
          stopped: storage.lifecycle.phase === 'finished',
          lobby: this.buildLobbySummary(roomId, storage),
          results: storage.results,
        });
      } catch (error) {
        if (error instanceof RoomLifecycleRejectedError) {
          return Response.json({ error: error.message }, { status: error.httpStatus });
        }
        return Response.json({ error: 'failed to stop room' }, { status: 500 });
      }
    }

    if (request.method === 'POST' && url.pathname === '/players/reserve') {
      if (!isHandoffSigningKeyValid(this.env)) {
        return Response.json({ error: 'room unavailable' }, { status: 503 });
      }
      let reservationRequest: RoomPlayerReservationPayload;
      try {
        reservationRequest = await parseRoomPlayerReservationBody(request);
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : 'invalid reservation request' },
          { status: 400 },
        );
      }
      const storage = await this.readStorage();
      if (!storage) {
        return Response.json({ error: 'playtest not initialized' }, { status: 404 });
      }
      try {
        const reservation = reserveRoomPlayer(
          storage,
          reservationRequest.playerId,
          this.nowIso(),
          reservationRequest.displayName === undefined
            ? {}
            : { displayName: reservationRequest.displayName },
        );
        const playerWasPresent = storage.players[reservation.playerId] !== undefined;
        await this.writeStorage(reservation.storage);
        await this.restartRuntimeForPreActiveRosterChange(reservation.storage);
        await this.ensureRuntime();
        await this.syncRuntimeForActiveRosterAdmission(reservation.storage, playerWasPresent);
        await this.scheduleNextAlarm();
        return Response.json({ playerId: reservation.playerId });
      } catch (error) {
        if (error instanceof RoomAdmissionRejectedError) {
          return Response.json({ error: error.message }, { status: error.httpStatus });
        }
        return Response.json({ error: 'failed to reserve player' }, { status: 500 });
      }
    }

    if (request.method === 'POST' && url.pathname === '/players/reconnect') {
      if (!isHandoffSigningKeyValid(this.env)) {
        return Response.json({ error: 'room unavailable' }, { status: 503 });
      }
      let input: { readonly playerId: string };
      try {
        const parsed = await parseRoomPlayerReservationBody(request);
        if (parsed.playerId === undefined) {
          throw new Error('playerId is required');
        }
        input = { playerId: parsed.playerId };
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : 'invalid reconnect request' },
          { status: 400 },
        );
      }
      try {
        const storage = await this.validateReconnect(input.playerId);
        const roomId = url.searchParams.get('roomId') ?? 'local';
        return Response.json({
          playerId: input.playerId,
          lobby: this.buildLobbySummary(roomId, storage),
        });
      } catch (error) {
        if (error instanceof RoomLifecycleRejectedError) {
          return Response.json({ error: error.message }, { status: error.httpStatus });
        }
        return Response.json({ error: 'failed to reconnect player' }, { status: 500 });
      }
    }

    if (request.method === 'GET' && url.pathname === '/lobby/summary') {
      const storage = await this.readStorage();
      if (!storage) {
        return Response.json({ error: 'playtest not initialized' }, { status: 404 });
      }
      const roomId = url.searchParams.get('roomId') ?? 'unknown';
      return Response.json({ lobby: this.buildLobbySummary(roomId, storage) });
    }

    if (request.method === 'GET' && url.pathname === '/results') {
      const storage = await this.readStorage();
      if (!storage) {
        return Response.json({ error: 'playtest not initialized' }, { status: 404 });
      }
      const roomId = url.searchParams.get('roomId') ?? 'unknown';
      return Response.json({ roomId, results: storage.results });
    }

    if (request.method === 'GET' && url.pathname === '/diagnostics') {
      const storage = await this.readStorage();
      if (!storage) {
        return Response.json({ error: 'playtest not initialized' }, { status: 404 });
      }
      const roomId = url.searchParams.get('roomId') ?? 'unknown';
      const lobby = this.buildLobbySummary(roomId, storage);
      return Response.json({
        diagnostics: {
          roomId,
          phase: storage.lifecycle.phase,
          ...(storage.lobby.createdByPlayerId === undefined
            ? {}
            : { ownerPlayerId: storage.lobby.createdByPlayerId }),
          playerCount: lobby.playerCount,
          readyPlayerCount: lobby.players.filter((player) => player.ready).length,
          connectedPlayerCount: lobby.players.filter((player) => player.status === 'connected')
            .length,
          reconnectEligiblePlayerCount: lobby.players.filter((player) => player.reconnectEligible)
            .length,
          generatedAt: this.nowIso(),
          issues: lobby.lobby.createdByPlayerId === undefined ? ['missing owner'] : [],
        },
      });
    }

    if (request.method === 'GET' && url.pathname === '/metrics') {
      const storage = await this.readStorage();
      if (!storage) {
        return Response.json({ error: 'playtest not initialized' }, { status: 404 });
      }
      const roomId = url.searchParams.get('roomId') ?? 'unknown';
      return Response.json({ roomId, metrics: this.buildSessionMetrics(storage) });
    }

    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      if (!isHandoffSigningKeyValid(this.env)) {
        return new Response('room unavailable', { status: 503 });
      }
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      const playtestId = url.searchParams.get('playtestId') ?? url.searchParams.get('roomId') ?? '';
      const token = url.searchParams.get('token') ?? '';
      const playerId = url.searchParams.get('playerId') ?? '';
      if (!token || !playerId || !playtestId) {
        return this.rejectWebSocket(
          server,
          client,
          INVALID_HANDOFF_CLOSE_CODE,
          'missing handoff credentials',
        );
      }
      try {
        await this.addPlayer(playerId, token, playtestId, { broadcast: false });
      } catch (error) {
        if (error instanceof RoomAdmissionRejectedError) {
          return this.rejectWebSocket(server, client, error.closeCode, error.message);
        }
        return this.rejectWebSocket(
          server,
          client,
          INVALID_HANDOFF_CLOSE_CODE,
          'invalid handoff token',
        );
      }
      await this.acceptPlayerSocket(playerId, server);
      if (this.legacyEnvelopeEnabled) {
        this.broadcast(new PlayerJoined({ playerId, displayName: Option.none() }));
      }
      return websocketUpgradeResponse(client);
    }

    if (request.method === 'GET') {
      const storage = await this.readStorage();
      if (!storage) {
        return Response.json({ error: 'playtest not initialized' }, { status: 404 });
      }
      const playtestId =
        url.searchParams.get('playtestId') ?? url.searchParams.get('roomId') ?? 'unknown';
      const meta: PlaytestRoomMeta = {
        mapId: storage.mapId,
        createdAt: storage.createdAt,
        lastTickAt: storage.lastTickAt,
        ...(storage.seed === undefined ? {} : { seed: storage.seed }),
      };
      return Response.json(toPlaytestSummary(playtestId, meta, this.buildSessionMetrics(storage)));
    }

    if (request.method === 'POST' && url.pathname === '/destroy') {
      await this.destroy();
      return Response.json({ ok: true });
    }

    return new Response('not found', { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (this.smokeHibernationQuiescing) {
      this.smokeHibernationQuiescing = false;
    }
    await this.ensureInitialized();
    if (this.smokeHibernationQuiescing) {
      return;
    }
    const attachment = parseRoomSocketAttachment(ws.deserializeAttachment());
    if (attachment === null) {
      ws.close(INVALID_HANDOFF_CLOSE_CODE, 'missing player attachment');
      return;
    }
    const playerId = attachment.playerId;
    const current = this.socketByPlayerId.get(playerId);
    if (!current || current.socket !== ws || current.socketId !== attachment.socketId) {
      return;
    }
    if (typeof message === 'string') {
      const frame = decodeRoomShellClientFrame(message);
      if (frame !== undefined) {
        await this.touchHeartbeat(playerId);
        this.behaviorRuntime?.emitShellEvent(frame.payload);
      }
      return;
    }
    const bytes = new Uint8Array(message);
    const shellFrame = decodeRoomShellClientFrame(new TextDecoder().decode(bytes));
    if (shellFrame !== undefined) {
      await this.touchHeartbeat(playerId);
      this.behaviorRuntime?.emitShellEvent(shellFrame.payload);
      return;
    }
    const storage = await this.readStorage();
    const protocolBridge =
      this.protocolBridge ?? this.runtimeRegistrationForStorage(storage).protocolBridge;
    this.protocolBridge = protocolBridge;
    const ack = protocolBridge.decodeSnapshotAckFrame(bytes);
    if (ack !== undefined) {
      await this.touchHeartbeat(playerId);
      const result = applySnapshotAck(current, ack, this.nowMs());
      if (result.kind === 'accepted') {
        return;
      }
      this.sendBinaryFrameToSocket(
        ws,
        protocolBridge.encodeTransportErrorFrame(
          'stale_snapshot_ack',
          result.kind === 'future'
            ? 'snapshot ack is ahead of sent state'
            : 'snapshot ack is stale',
        ),
      );
      if (result.kind === 'future' || current.staleAckCount >= MAX_STALE_SNAPSHOT_ACKS) {
        ws.close(ROOM_INVALID_ACK_CLOSE_CODE, 'invalid snapshot ack');
      }
      return;
    }
    const decoded = protocolBridge.decodeClientFrame(bytes);
    if (decoded.kind === 'rejected') {
      this.sendBinaryFrameToSocket(ws, decoded.frame);
      ws.close(decoded.closeCode, decoded.closeReason);
      return;
    }
    await this.touchHeartbeat(playerId);
    if (decoded.frame.kind === 'heartbeat') {
      return;
    }
    if (decoded.frame.kind === 'input') {
      if (
        storage === null ||
        storage.lifecycle.phase === 'finished' ||
        storage.lifecycle.phase === 'archived'
      ) {
        return;
      }
      this.enqueueInput(playerId, decoded.frame.input, decoded.frame.sortKey);
      return;
    }
  }

  async webSocketClose(ws: WebSocket, code = 1000, reason = ''): Promise<void> {
    const attachment = parseRoomSocketAttachment(ws.deserializeAttachment());
    if (attachment === null) {
      return;
    }
    if (this.smokeHibernationQuiescing) {
      return;
    }
    await this.ensureInitialized();
    if (this.smokeHibernationQuiescing) {
      return;
    }
    const playerId = attachment.playerId;
    if (code === MATCH_ENDED_CLOSE_CODE) {
      const current = this.socketByPlayerId.get(playerId);
      if (current?.socket === ws && current.socketId === attachment.socketId) {
        this.socketByPlayerId.delete(playerId);
      }
      return;
    }
    ws.close(code, reason || 'disconnect');
    const storage = await this.readStorage();
    if (storage?.lifecycle.phase === 'finished' || storage?.lifecycle.phase === 'archived') {
      return;
    }
    const current = this.socketByPlayerId.get(playerId);
    if (current !== undefined) {
      if (current.socket !== ws || current.socketId !== attachment.socketId) {
        return;
      }
    } else {
      const currentSocket = storage?.currentSockets?.players[playerId];
      if (currentSocket === undefined || currentSocket.socketId !== attachment.socketId) {
        return;
      }
    }
    await this.clearCurrentSocket(playerId, attachment.socketId);
    await this.disconnectPlayer(playerId, reason || 'disconnect', {
      code,
      reason: reason || 'disconnect',
    });
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    if (this.smokeHibernationQuiescing) {
      return;
    }
    await this.ensureInitialized();
    await this.webSocketClose(ws);
  }
}

export const roomSummaryFromStorage = (
  playtestId: string,
  storage: RoomStorage,
  connectedClients: number,
): PlaytestSummary => {
  const meta = createRoomMeta(storage.mapId, storage.seed);
  return toPlaytestSummary(
    playtestId,
    { ...meta, lastTickAt: storage.lastTickAt, createdAt: storage.createdAt },
    toPlaytestSessionMetrics({ storage, connectedClients }),
  );
};

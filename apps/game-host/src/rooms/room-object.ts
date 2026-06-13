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
  bundledPlugin,
  createBundledPluginLoader,
  createBundledPluginProtocolBridge,
  type BundledPluginProtocolBridge,
  type BundledRuntimeInput,
} from '../bundled-plugin-loader.js';
import {
  broadcastBinaryFrame,
  createRoomMeta,
  parsePlaytestInitBody,
  toPlaytestSessionMetrics,
  toPlaytestSummary,
  type BinarySocket,
} from '../room.js';
import type { Env, PlaytestRoomMeta, PlaytestSummary, RoomLobbySummary } from '../types.js';
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
  finishRoomIfEmpty,
  createRoomJoinCode,
  markRoomPlayerDisconnected,
  projectRoomPresence,
  reserveRoomPlayer,
  resolveRoomPlayerCapacity,
  resolveRoomReadyGate,
  resolveRoomReconnectEligibility,
  setRoomPlayerReady,
  shouldHydrateRuntime,
  validateRoomOptions,
} from './room-lifecycle.js';
import {
  STORAGE_KEY,
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
  decodeSnapshotAckFrame,
  decideSnapshotOutbound,
  encodeTransportErrorFrame,
  recordOutboundDropped,
  recordSnapshotProduced,
  recordSnapshotResyncSent,
  recordSnapshotSent,
  snapshotTickFromServerFrame,
  socketBufferedAmount,
  toClientTransportStats,
  type ClientTransportStats,
  type QueuedInput,
  type RoomSocketRecord,
} from './room-transport.js';
import type { JsonObject } from '@tileborne/core';

export interface RoomCreateOptions {
  readonly mapId: string;
  readonly seed?: string | number;
  readonly options?: Record<string, string | number | boolean | null>;
  /** Encoded `RuntimeMapPackage` wire JSON the room runtime boots from (ADR-0030). */
  readonly mapPackage?: JsonObject;
  readonly playerModelSelections?: readonly RoomPlayerModelSelection[];
  readonly idempotencyKey?: string;
}

export interface PlaytestRoomDeps {
  readonly now?: () => number;
  readonly createRuntime?: () => GameRuntimeApi;
  readonly createPluginHost?: (emit: (message: RuntimeMessage) => void) => PluginHostApi;
}

interface RoomSocketAttachment {
  readonly playerId?: string;
  readonly socketId?: string;
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

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
};

const defaultSeed = (): string | number => crypto.randomUUID();

export { MAX_QUEUED_INPUTS_PER_PLAYER } from './room-transport.js';

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

const websocketUpgradeResponse = (client: WebSocket): Response => {
  try {
    return new Response(null, { status: 101, webSocket: client });
  } catch {
    return new Response(null, { status: 200, webSocket: client });
  }
};

export class PlaytestRoom implements DurableObject {
  private storageData: RoomStorage | null = null;
  private runtime: GameRuntimeApi | null = null;
  private pluginHost: PluginHostApi | null = null;
  private readonly socketByPlayerId = new Map<string, RoomSocketRecord>();
  private readonly inputQueueByPlayerId = new Map<string, QueuedInput<BundledRuntimeInput>>();
  private readonly inputByPlayerId = new Map<string, BundledRuntimeInput>();
  private readonly pluginMessages: RuntimeMessage[] = [];
  private readonly pluginBinaryFrames: Uint8Array[] = [];
  private readonly protocolBridge: BundledPluginProtocolBridge;
  private latestReplayFrames: readonly Uint8Array[] = [];
  private nextInputOrder = 0;
  private tickAlarmScheduled = false;
  private legacyEnvelopeEnabled = false;
  private readonly deps: PlaytestRoomDeps;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
    deps: PlaytestRoomDeps = {},
  ) {
    this.deps = deps;
    this.protocolBridge = createBundledPluginProtocolBridge();
    void this.hydrateFromStorage();
  }

  private nowMs(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private nowIso(): string {
    return new Date(this.nowMs()).toISOString();
  }

  private async hydrateFromStorage(): Promise<void> {
    const stored = await this.state.storage.get<PersistedRoomStorage>(STORAGE_KEY);
    if (!stored) {
      return;
    }
    this.storageData = migrateRoomStorage(stored);
    if (stored.schemaVersion !== this.storageData.schemaVersion) {
      await this.state.storage.put(STORAGE_KEY, this.storageData);
    }
    if (shouldHydrateRuntime(this.storageData)) {
      await this.ensureRuntime();
      await this.scheduleNextAlarm();
    }
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
      .filter((record) => record.socket.readyState === WebSocket.OPEN)
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
    const pluginHost =
      this.deps.createPluginHost?.((message) => this.emitPluginMessage(message)) ??
      makePluginHost({
        loader: createBundledPluginLoader({
          getPlayerIds: () => this.getPlayerIdsForPlugin(),
          getInput: (playerId) => this.getInputForPlugin(playerId),
          emitFrame: (frame) => this.emitPluginFrame(frame),
          setReplayFrames: (frames) => this.setReplayFrames(frames),
          ...(storage?.seed === undefined ? {} : { seed: storage.seed }),
          ...(storage?.mapPackage === undefined ? {} : { mapPackage: storage.mapPackage }),
          ...(storage?.playerModelSelections === undefined
            ? {}
            : {
                getPlayerModelSelections: () => storage.playerModelSelections ?? [],
              }),
        }),
      });
    const runtime = this.deps.createRuntime?.() ?? makeGameRuntime();
    await Effect.runPromise(
      runtime.init({
        tickRate: TICK_HZ,
        pluginHost,
      }),
    );
    if (!usingCustomPluginHost) {
      await Effect.runPromise(pluginHost.loadAndRegister(bundledPlugin.id));
      await Effect.runPromise(pluginHost.dispatchInit());
    }
    this.legacyEnvelopeEnabled = usingCustomPluginHost;
    await Effect.runPromise(runtime.start());
    this.runtime = runtime;
    this.pluginHost = pluginHost;
  }

  private async stopRuntimeOnly(): Promise<void> {
    if (!this.runtime) {
      return;
    }
    await Effect.runPromise(this.runtime.stop());
    this.runtime = null;
    this.pluginHost = null;
    this.pluginBinaryFrames.length = 0;
    this.latestReplayFrames = [];
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
    );
    await this.writeStorage(created);
    return created;
  }

  async destroy(): Promise<void> {
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
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.close(1000, reason);
    }
    this.socketByPlayerId.delete(playerId);
    if (Object.keys(players).length === 0) {
      await this.scheduleEmptyRoomCheck();
    }
  }

  private async disconnectPlayer(playerId: string, reason: string): Promise<void> {
    const storage = await this.readStorage();
    if (!storage || !storage.players[playerId]) {
      return;
    }
    const now = this.nowIso();
    const next = markRoomPlayerDisconnected(
      storage,
      playerId,
      now,
      this.reconnectExpiresAt(now),
    );
    await this.writeStorage(next);
    await this.scheduleReconnectExpiryCheck(next);
    const socket = this.socketByPlayerId.get(playerId)?.socket;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.close(1000, reason);
    }
    this.socketByPlayerId.delete(playerId);
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
    if (ws.readyState !== WebSocket.OPEN) {
      return;
    }
    ws.send(toArrayBuffer(frame));
  }

  private sendSnapshotFrameToRecord(record: RoomSocketRecord, frame: Uint8Array): void {
    const tick = snapshotTickFromServerFrame(frame);
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

  private sendReplayFramesToSocket(record: RoomSocketRecord, markAsResync = false): void {
    for (const frame of this.latestReplayFrames) {
      const tick = snapshotTickFromServerFrame(frame);
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

  private acceptPlayerSocket(playerId: string, server: WebSocket): void {
    const previous = this.socketByPlayerId.get(playerId);
    const socketId = crypto.randomUUID();
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ playerId, socketId });
    const record = createRoomSocketRecord(playerId, server, socketId);
    this.socketByPlayerId.set(playerId, record);
    this.sendReplayFramesToSocket(record);
    if (previous?.socket !== undefined && previous.socket.readyState === WebSocket.OPEN) {
      previous.socket.close(ROOM_REPLACED_CLOSE_CODE, 'player reconnected');
    }
  }

  private async scheduleNextAlarm(): Promise<void> {
    if (this.tickAlarmScheduled) {
      return;
    }
    this.tickAlarmScheduled = true;
    await this.state.storage.setAlarm(this.nowMs() + TICK_INTERVAL_MS);
  }

  private async scheduleEmptyRoomCheck(): Promise<void> {
    const idleMs = roomIdleTimeoutMs(this.env.ROOM_IDLE_TIMEOUT_SECONDS);
    await this.state.storage.setAlarm(this.nowMs() + idleMs);
  }

  private async scheduleAlarmAt(timestampMs: number): Promise<void> {
    this.tickAlarmScheduled = true;
    await this.state.storage.setAlarm(timestampMs);
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
    const lifecycleStep = advanceLifecycleForAlarm(latest, this.nowMs(), this.nowIso());
    if (lifecycleStep.changed) {
      await this.writeStorage(lifecycleStep.storage);
    }
    if (lifecycleStep.rescheduleAtMs !== undefined) {
      await this.scheduleAlarmAt(lifecycleStep.rescheduleAtMs);
      return;
    }
    if (lifecycleStep.runSimulation) {
      await this.runSimulationTick();
      await this.scheduleNextAlarm();
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
    this.inputByPlayerId.clear();
    const inputs = [...this.inputQueueByPlayerId.values()];
    this.inputQueueByPlayerId.clear();
    inputs.sort(
      (left, right) =>
        left.sortKey.tick - right.sortKey.tick ||
        left.playerId.localeCompare(right.playerId) ||
        left.sortKey.seq - right.sortKey.seq ||
        left.order - right.order,
    );
    for (const input of inputs) {
      this.inputByPlayerId.set(input.playerId, input.input);
    }
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
    if (!existing || compareQueuedInputs(queued, existing) >= 0) {
      this.inputQueueByPlayerId.set(playerId, queued);
    }
  }

  private broadcastPluginFrames(): void {
    const records = [...this.socketByPlayerId.values()].filter(
      (record) => record.socket.readyState === WebSocket.OPEN,
    );
    for (const frame of this.pluginBinaryFrames.splice(0)) {
      for (const record of records) {
        this.sendSnapshotFrameToRecord(record, frame);
      }
    }
  }

  private async runSimulationTick(): Promise<void> {
    const storage = await this.readStorage();
    if (!storage || !this.runtime || storage.lifecycle.phase !== 'active') {
      return;
    }
    this.drainInputQueueForTick();
    try {
      await Effect.runPromise(this.runtime.step(1));
    } finally {
      this.inputByPlayerId.clear();
    }
    const tick = storage.tick + 1;
    const baseTick = tick % PERSIST_EVERY_N_TICKS === 0 ? tick : storage.baseTick;
    const diff = this.buildSnapshotDiff(tick, Object.keys(storage.players).length);
    const shouldPersist = tick % PERSIST_EVERY_N_TICKS === 0;
    const next: RoomStorage = {
      ...storage,
      tick,
      baseTick,
      lastTickAt: this.nowIso(),
      simState: {
        ...storage.simState,
        lastTick: tick,
        playerCount: Object.keys(storage.players).length,
      },
      ...(shouldPersist ? { lastPersistedTick: tick } : {}),
    };
    if (shouldPersist) {
      await this.writeStorage(next);
    } else {
      this.storageData = next;
      await this.state.storage.put(STORAGE_KEY, next);
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
    this.broadcastPluginFrames();
    if (this.pluginHost && this.legacyEnvelopeEnabled) {
      for (const message of this.pluginMessages.splice(0)) {
        this.broadcast(message);
      }
      this.broadcast(new Events({ events: Option.some([{ type: 'tick', tick }]) }));
    }
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
        return Response.json({ playerId: input.playerId, lobby: this.buildLobbySummary(roomId, storage) });
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
      this.acceptPlayerSocket(playerId, server);
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
    const attachment = ws.deserializeAttachment() as RoomSocketAttachment | null;
    const playerId = attachment?.playerId;
    if (!playerId) {
      ws.close(INVALID_HANDOFF_CLOSE_CODE, 'missing player attachment');
      return;
    }
    const current = this.socketByPlayerId.get(playerId);
    if (!current || current.socket !== ws || current.socketId !== attachment.socketId) {
      return;
    }
    if (typeof message === 'string') {
      return;
    }
    const bytes = new Uint8Array(message);
    const ack = decodeSnapshotAckFrame(bytes);
    if (ack !== undefined) {
      await this.touchHeartbeat(playerId);
      const result = applySnapshotAck(current, ack, this.nowMs());
      if (result.kind === 'accepted') {
        return;
      }
      this.sendBinaryFrameToSocket(
        ws,
        encodeTransportErrorFrame(
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
    const decoded = this.protocolBridge.decodeClientFrame(bytes);
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
      this.enqueueInput(playerId, decoded.frame.input, decoded.frame.sortKey);
      return;
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const attachment = ws.deserializeAttachment() as RoomSocketAttachment | null;
    const playerId = attachment?.playerId;
    if (!playerId) {
      return;
    }
    const current = this.socketByPlayerId.get(playerId);
    if (!current || current.socket !== ws || current.socketId !== attachment.socketId) {
      return;
    }
    await this.disconnectPlayer(playerId, 'disconnect');
  }

  async webSocketError(ws: WebSocket): Promise<void> {
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

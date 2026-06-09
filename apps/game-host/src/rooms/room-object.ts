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
import type { Env, PlaytestRoomMeta, PlaytestSummary } from '../types.js';
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
  roomIdleTimeoutMs,
} from './room-config.js';
import {
  RoomAdmissionRejectedError,
  admitPlayerToRoom,
  advanceLifecycleForAlarm,
  archiveRoom,
  finishRoomIfEmpty,
  reserveRoomPlayer,
  shouldHydrateRuntime,
  validateRoomOptions,
} from './room-lifecycle.js';
import {
  STORAGE_KEY,
  emptyRoomStorage,
  migrateRoomStorage,
  type PersistedRoomStorage,
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
  readonly runtimeArtifact?: JsonObject;
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
}

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
};

const defaultSeed = (): string | number => crypto.randomUUID();

export { MAX_QUEUED_INPUTS_PER_PLAYER } from './room-transport.js';

const parseRoomPlayerReservationBody = async (request: Request): Promise<string | undefined> => {
  const text = await request.text();
  if (text.trim().length === 0) {
    return undefined;
  }
  let body: RoomPlayerReservationRequest;
  try {
    body = JSON.parse(text) as RoomPlayerReservationRequest;
  } catch {
    throw new Error('reservation body must be valid JSON');
  }
  if (body.playerId === undefined) {
    return undefined;
  }
  if (typeof body.playerId !== 'string' || body.playerId.length === 0) {
    throw new Error('playerId must be a non-empty string');
  }
  return body.playerId;
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
          ...(storage?.runtimeArtifact === undefined
            ? {}
            : { runtimeArtifact: storage.runtimeArtifact }),
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
      opts.runtimeArtifact,
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
    const verified = await verifyHandoffToken(this.env, sessionToken, { playtestId });
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
    const removed: RoomStorage = {
      ...storage,
      players,
      emptySince: Object.keys(players).length === 0 ? this.nowIso() : null,
    };
    const next = finishRoomIfEmpty(removed, this.nowIso(), reason);
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
    }
  }

  private async disconnectStalePlayers(): Promise<void> {
    const storage = await this.readStorage();
    if (!storage) {
      return;
    }
    const nowMs = this.deps.now?.() ?? Date.now();
    for (const player of Object.values(storage.players)) {
      const lastHeartbeatMs = Date.parse(player.lastHeartbeatAt);
      if (nowMs - lastHeartbeatMs >= heartbeatTimeoutMs(this.env.HEARTBEAT_TIMEOUT_SECONDS)) {
        await this.removePlayer(player.id, 'heartbeat timeout');
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
    const next: RoomStorage = {
      ...storage,
      players: {
        ...storage.players,
        [playerId]: {
          ...storage.players[playerId],
          lastHeartbeatAt: this.nowIso(),
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

    if (
      request.method === 'POST' &&
      (url.pathname === '/create' || url.pathname === '/playtest/init')
    ) {
      if (!isHandoffSigningKeyValid(this.env)) {
        return Response.json({ error: 'room unavailable' }, { status: 503 });
      }
      const body = await request.text();
      const init = parsePlaytestInitBody(body);
      const created = await this.create({
        mapId: init.mapId,
        ...(init.seed === undefined ? {} : { seed: init.seed }),
        ...(init.options === undefined ? {} : { options: init.options }),
        ...(init.runtimeArtifact === undefined ? {} : { runtimeArtifact: init.runtimeArtifact }),
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

    if (request.method === 'POST' && url.pathname === '/players/reserve') {
      if (!isHandoffSigningKeyValid(this.env)) {
        return Response.json({ error: 'room unavailable' }, { status: 503 });
      }
      let requestedPlayerId: string | undefined;
      try {
        requestedPlayerId = await parseRoomPlayerReservationBody(request);
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
        const reservation = reserveRoomPlayer(storage, requestedPlayerId, this.nowIso());
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
    this.socketByPlayerId.delete(playerId);
    await this.removePlayer(playerId, 'disconnect');
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

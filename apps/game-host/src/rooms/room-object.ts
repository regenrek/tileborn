import { Effect, Option } from "effect";

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
} from "@tileborne/runtime/worker";

import {
  bundledPlugin,
  createBundledPluginLoader,
  createBundledPluginProtocolBridge,
  type BundledPluginProtocolBridge,
  type BundledRuntimeInput,
} from "../bundled-plugin-loader.js";
import {
  broadcastBinaryFrame,
  createRoomMeta,
  parsePlaytestInitBody,
  toPlaytestSummary,
  type BinarySocket,
} from "../room.js";
import type { Env, PlaytestRoomMeta, PlaytestSummary } from "../types.js";
import { isHandoffSigningKeyValid, verifyHandoffToken } from "./handoff-token.js";
import {
  INVALID_HANDOFF_CLOSE_CODE,
  PERSIST_EVERY_N_TICKS,
  TICK_HZ,
  TICK_INTERVAL_MS,
  heartbeatTimeoutMs,
  roomIdleTimeoutMs,
} from "./room-config.js";
import {
  STORAGE_KEY,
  emptyRoomStorage,
  migrateRoomStorage,
  type RoomPlayerRecord,
  type RoomStorage,
} from "./storage-schema.js";

export interface RoomCreateOptions {
  readonly mapId: string;
  readonly seed?: string | number;
  readonly options?: Record<string, string | number | boolean | null>;
  readonly idempotencyKey?: string;
}

export interface PlaytestRoomDeps {
  readonly now?: () => number;
  readonly createRuntime?: () => GameRuntimeApi;
  readonly createPluginHost?: (emit: (message: RuntimeMessage) => void) => PluginHostApi;
}

interface QueuedInput {
  readonly playerId: string;
  readonly input: BundledRuntimeInput;
  readonly sortKey: {
    readonly tick: number;
    readonly seq: number;
  };
  readonly order: number;
}

export const MAX_QUEUED_INPUTS_PER_PLAYER = 1;

const compareQueuedInputs = (left: QueuedInput, right: QueuedInput): number =>
  left.sortKey.tick - right.sortKey.tick ||
  left.sortKey.seq - right.sortKey.seq ||
  left.order - right.order;

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
};

const defaultSeed = (): string | number => crypto.randomUUID();

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
  private readonly socketByPlayerId = new Map<string, WebSocket>();
  private readonly inputQueueByPlayerId = new Map<string, QueuedInput>();
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
    const stored = await this.state.storage.get<RoomStorage>(STORAGE_KEY);
    if (!stored) {
      return;
    }
    this.storageData = migrateRoomStorage(stored);
    if (this.storageData.status === "running" || this.storageData.status === "lobby") {
      await this.ensureRuntime();
      await this.scheduleNextAlarm();
    }
  }

  private async readStorage(): Promise<RoomStorage | null> {
    if (this.storageData) {
      return this.storageData;
    }
    const stored = await this.state.storage.get<RoomStorage>(STORAGE_KEY);
    if (!stored) {
      return null;
    }
    this.storageData = migrateRoomStorage(stored);
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
          getInput: (playerId) => this.getInputForPlugin(playerId),
          emitFrame: (frame) => this.emitPluginFrame(frame),
          setReplayFrames: (frames) => this.setReplayFrames(frames),
          ...(storage?.seed === undefined ? {} : { seed: storage.seed }),
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

  async create(opts: RoomCreateOptions): Promise<RoomStorage> {
    if (!isHandoffSigningKeyValid(this.env)) {
      throw new Error("handoff signing key is not configured");
    }
    const existing = await this.readStorage();
    if (existing) {
      if (
        opts.idempotencyKey !== undefined &&
        existing.idempotencyKey === opts.idempotencyKey
      ) {
        return existing;
      }
      if (existing.status !== "archived") {
        return existing;
      }
    }
    const seed = opts.seed ?? defaultSeed();
    const options = opts.options ?? {};
    const created = emptyRoomStorage(opts.mapId, seed, options, opts.idempotencyKey);
    await this.writeStorage(created);
    await this.ensureRuntime();
    return created;
  }

  async destroy(): Promise<void> {
    const sockets = this.state.getWebSockets();
    for (const socket of sockets) {
      socket.close(1000, "room destroyed");
    }
    this.socketByPlayerId.clear();
    if (this.runtime) {
      await Effect.runPromise(this.runtime.stop());
      this.runtime = null;
      this.pluginHost = null;
    }
    const existing = await this.readStorage();
    if (existing) {
      await this.writeStorage({ ...existing, status: "archived", emptySince: this.nowIso() });
    }
    await this.state.storage.deleteAlarm();
  }

  getPlayers(): Record<string, RoomPlayerRecord> {
    return { ...this.storageData?.players };
  }

  async addPlayer(
    playerId: string,
    sessionToken: string,
    playtestId: string,
    options: { readonly broadcast?: boolean } = {},
  ): Promise<void> {
    const verified = await verifyHandoffToken(this.env, sessionToken, { playtestId });
    if (!verified || verified.playerId !== playerId) {
      throw new Error("invalid handoff token");
    }
    const storage = await this.readStorage();
    if (!storage) {
      throw new Error("room not initialized");
    }
    const now = this.nowIso();
    const players = {
      ...storage.players,
      [playerId]: {
        id: playerId,
        joinedAt: now,
        lastHeartbeatAt: now,
      },
    };
    const next: RoomStorage = {
      ...storage,
      players,
      emptySince: null,
      status: storage.status === "lobby" ? "running" : storage.status,
    };
    await this.writeStorage(next);
    await this.ensureRuntime();
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
    const playerCount = Object.keys(players).length;
    const next: RoomStorage = {
      ...storage,
      players,
      emptySince: playerCount === 0 ? this.nowIso() : null,
      status: playerCount === 0 && storage.status === "running" ? "finished" : storage.status,
    };
    await this.writeStorage(next);
    if (this.legacyEnvelopeEnabled) {
      this.broadcast(new PlayerLeft({ playerId, reason }));
    }
    const socket = this.socketByPlayerId.get(playerId);
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.close(1000, reason);
    }
    this.socketByPlayerId.delete(playerId);
    if (playerCount === 0) {
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

  private sendReplayFramesToSocket(ws: WebSocket): void {
    for (const frame of this.latestReplayFrames) {
      this.sendBinaryFrameToSocket(ws, frame);
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
    if (storage.status === "running" || storage.status === "lobby") {
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
        await this.removePlayer(player.id, "heartbeat timeout");
      }
    }
  }

  private buildSnapshotDiff(tick: number, playerCount: number): readonly Record<string, string | number | boolean | null>[] {
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

  private enqueueInput(playerId: string, input: BundledRuntimeInput, sortKey: QueuedInput["sortKey"]): void {
    const queued: QueuedInput = {
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
    const sockets = this.collectOpenSockets();
    for (const frame of this.pluginBinaryFrames.splice(0)) {
      broadcastBinaryFrame(sockets, toArrayBuffer(frame));
    }
  }

  private async runSimulationTick(): Promise<void> {
    const storage = await this.readStorage();
    if (!storage || !this.runtime) {
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
      simState: { ...storage.simState, lastTick: tick, playerCount: Object.keys(storage.players).length },
      status: "running",
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
      this.broadcast(new Events({ events: Option.some([{ type: "tick", tick }]) }));
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

  private rejectWebSocket(_server: WebSocket, client: WebSocket, code: number, message: string): Response {
    setTimeout(() => {
      client.close(code, message);
    }, 25);
    return websocketUpgradeResponse(client);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const cf = request.cf as { readonly alarm?: boolean } | undefined;
    if (cf?.alarm === true) {
      await this.alarm();
      return Response.json({ ok: true, triggered: "alarm" });
    }

    if (request.method === "POST" && (url.pathname === "/create" || url.pathname === "/playtest/init")) {
      if (!isHandoffSigningKeyValid(this.env)) {
        return Response.json({ error: "room unavailable" }, { status: 503 });
      }
      const body = await request.text();
      const init = parsePlaytestInitBody(body);
      const created = await this.create({
        mapId: init.mapId,
        ...(init.seed === undefined ? {} : { seed: init.seed }),
        ...(init.options === undefined ? {} : { options: init.options }),
        ...(init.options?.idempotencyKey === undefined || typeof init.options.idempotencyKey !== "string"
          ? {}
          : { idempotencyKey: init.options.idempotencyKey }),
      });
      return Response.json({ ok: true, roomId: url.searchParams.get("roomId") ?? "local", mapId: created.mapId });
    }

    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      if (!isHandoffSigningKeyValid(this.env)) {
        return new Response("room unavailable", { status: 503 });
      }
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      const playtestId = url.searchParams.get("playtestId") ?? url.searchParams.get("roomId") ?? "";
      const token = url.searchParams.get("token") ?? "";
      const playerId = url.searchParams.get("playerId") ?? "";
      if (!token || !playerId || !playtestId) {
        return this.rejectWebSocket(server, client, INVALID_HANDOFF_CLOSE_CODE, "missing handoff credentials");
      }
      try {
        await this.addPlayer(playerId, token, playtestId, { broadcast: false });
      } catch {
        return this.rejectWebSocket(server, client, INVALID_HANDOFF_CLOSE_CODE, "invalid handoff token");
      }
      this.state.acceptWebSocket(server);
      server.serializeAttachment({ playerId });
      this.socketByPlayerId.set(playerId, server);
      this.sendReplayFramesToSocket(server);
      if (this.legacyEnvelopeEnabled) {
        this.broadcast(new PlayerJoined({ playerId, displayName: Option.none() }));
      }
      return websocketUpgradeResponse(client);
    }

    if (request.method === "GET") {
      const storage = await this.readStorage();
      if (!storage) {
        return Response.json({ error: "playtest not initialized" }, { status: 404 });
      }
      const playtestId = url.searchParams.get("playtestId") ?? url.searchParams.get("roomId") ?? "unknown";
      const meta: PlaytestRoomMeta = {
        mapId: storage.mapId,
        createdAt: storage.createdAt,
        lastTickAt: storage.lastTickAt,
        ...(storage.seed === undefined ? {} : { seed: storage.seed }),
      };
      return Response.json(toPlaytestSummary(playtestId, meta, this.state.getWebSockets().length));
    }

    if (request.method === "POST" && url.pathname === "/destroy") {
      await this.destroy();
      return Response.json({ ok: true });
    }

    return new Response("not found", { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const attachment = ws.deserializeAttachment() as { readonly playerId?: string } | null;
    const playerId = attachment?.playerId;
    if (!playerId) {
      ws.close(INVALID_HANDOFF_CLOSE_CODE, "missing player attachment");
      return;
    }
    if (typeof message === "string") {
      return;
    }
    const decoded = this.protocolBridge.decodeClientFrame(new Uint8Array(message));
    if (decoded.kind === "rejected") {
      this.sendBinaryFrameToSocket(ws, decoded.frame);
      ws.close(decoded.closeCode, decoded.closeReason);
      return;
    }
    await this.touchHeartbeat(playerId);
    if (decoded.frame.kind === "heartbeat") {
      return;
    }
    if (decoded.frame.kind === "input") {
      this.enqueueInput(playerId, decoded.frame.input, decoded.frame.sortKey);
      return;
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const attachment = ws.deserializeAttachment() as { readonly playerId?: string } | null;
    const playerId = attachment?.playerId;
    if (!playerId) {
      return;
    }
    this.socketByPlayerId.delete(playerId);
    await this.removePlayer(playerId, "disconnect");
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }
}

export const roomSummaryFromStorage = (playtestId: string, storage: RoomStorage, connectedClients: number): PlaytestSummary => {
  const meta = createRoomMeta(storage.mapId, storage.seed);
  return toPlaytestSummary(playtestId, { ...meta, lastTickAt: storage.lastTickAt, createdAt: storage.createdAt }, connectedClients);
};

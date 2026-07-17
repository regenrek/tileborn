import { RuntimeMapPackage, type JsonObject } from '@tileborne/core';
import { Result, Schema } from 'effect';

import type { PlaytestRoomMeta, PlaytestSummary } from './types.js';
import type { RoomPlayerModelSelection, RoomStorage } from './rooms/storage-schema.js';
import type { ClientTransportStats } from './rooms/room-transport.js';

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const decodeMapPackageWire = Schema.decodeUnknownResult(RuntimeMapPackage);

const isPlayerModelSelection = (value: unknown): value is RoomPlayerModelSelection =>
  isJsonObject(value) &&
  typeof value.playerId === 'string' &&
  value.playerId.length > 0 &&
  typeof value.modelId === 'string' &&
  value.modelId.length > 0;

export const parsePlaytestInitBody = (
  body: string,
): {
  mapId: string;
  seed?: string | number;
  options?: Record<string, string | number | boolean | null>;
  mapPackage?: JsonObject;
  playerModelSelections?: readonly RoomPlayerModelSelection[];
} => {
  const parsed = JSON.parse(body) as {
    readonly mapId?: string;
    readonly seed?: string | number;
    readonly options?: Record<string, string | number | boolean | null>;
    readonly mapPackage?: unknown;
    readonly playerModelSelections?: unknown;
  };
  if (typeof parsed.mapId !== 'string' || parsed.mapId.length === 0) {
    throw new Error('mapId is required');
  }
  if (parsed.mapPackage !== undefined) {
    // Boundary validation (M2 review, F1): a supplied package must decode as
    // a full `RuntimeMapPackage` before the room stores it. The ORIGINAL wire
    // JSON is what gets stored/forwarded — never a re-encode.
    if (!isJsonObject(parsed.mapPackage)) {
      throw new Error('mapPackage must be a JSON object');
    }
    const decoded = decodeMapPackageWire(parsed.mapPackage);
    if (Result.isFailure(decoded)) {
      throw new Error(`mapPackage is not a valid RuntimeMapPackage: ${String(decoded.failure)}`);
    }
  }
  if (
    parsed.playerModelSelections !== undefined &&
    !(
      Array.isArray(parsed.playerModelSelections) &&
      parsed.playerModelSelections.every(isPlayerModelSelection)
    )
  ) {
    throw new Error('playerModelSelections must be an array of { playerId, modelId }');
  }
  return {
    mapId: parsed.mapId,
    ...(parsed.seed === undefined ? {} : { seed: parsed.seed }),
    ...(parsed.options === undefined ? {} : { options: parsed.options }),
    ...(parsed.mapPackage === undefined ? {} : { mapPackage: parsed.mapPackage }),
    ...(parsed.playerModelSelections === undefined
      ? {}
      : {
          playerModelSelections:
            parsed.playerModelSelections as readonly RoomPlayerModelSelection[],
        }),
  };
};

export const createRoomMeta = (mapId: string, seed?: string | number): PlaytestRoomMeta => ({
  mapId,
  createdAt: new Date().toISOString(),
  lastTickAt: null,
  ...(seed === undefined ? {} : { seed }),
});

interface PlaytestSessionMetricsInput {
  readonly storage: RoomStorage;
  readonly connectedClients: number;
  readonly queuedInputPlayers?: number;
  readonly pendingPluginFrames?: number;
  readonly replayFrames?: number;
  readonly transportClients?: readonly ClientTransportStats[];
  readonly generatedAt?: string;
}

const sum = (values: readonly number[]): number =>
  values.reduce((total, value) => total + value, 0);

export const toPlaytestSessionMetrics = ({
  storage,
  connectedClients,
  queuedInputPlayers = 0,
  pendingPluginFrames = 0,
  replayFrames = 0,
  transportClients = [],
  generatedAt = new Date().toISOString(),
}: PlaytestSessionMetricsInput): PlaytestSummary['metrics'] => {
  const clients = [...transportClients].sort((left, right) =>
    left.playerId.localeCompare(right.playerId),
  );
  const pendingLagTicks = clients.map((client) => client.pendingSnapshotLagTicks);
  return {
    lifecyclePhase: storage.lifecycle.phase,
    tick: storage.tick,
    baseTick: storage.baseTick,
    lastPersistedTick: storage.lastPersistedTick,
    playerCount: Object.keys(storage.players).length,
    connectedClients,
    queuedInputPlayers,
    queuedInputs: queuedInputPlayers,
    pendingPluginFrames,
    replayFrames,
    generatedAt,
    transport: {
      trackedClients: clients.length,
      maxPendingSnapshotLagTicks: pendingLagTicks.length === 0 ? 0 : Math.max(...pendingLagTicks),
      totalDroppedOutboundFrames: sum(clients.map((client) => client.droppedOutboundFrames)),
      totalResyncs: sum(clients.map((client) => client.resyncCount)),
      totalStaleSnapshotAcks: sum(clients.map((client) => client.staleAckCount)),
    },
  };
};

export const toPlaytestSummary = (
  playtestId: string,
  meta: PlaytestRoomMeta,
  metrics: PlaytestSummary['metrics'],
): PlaytestSummary => ({
  playtestId,
  mapId: meta.mapId,
  createdAt: meta.createdAt,
  lastTickAt: meta.lastTickAt,
  connectedClients: metrics.connectedClients,
  metrics,
});

export interface BinarySocket {
  readonly readyState: number;
  send(data: ArrayBuffer): void;
}

const WEBSOCKET_OPEN = 1;

export const broadcastBinaryFrame = (
  sockets: readonly BinarySocket[],
  message: ArrayBuffer,
): void => {
  for (const socket of sockets) {
    if (socket.readyState === WEBSOCKET_OPEN) {
      socket.send(message);
    }
  }
};

export { PlaytestRoom } from './rooms/room-object.js';

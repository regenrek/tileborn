import type { PlaytestRoomMeta, PlaytestSummary } from "./types.js";

export const parsePlaytestInitBody = (body: string): { mapId: string; seed?: string | number; options?: Record<string, string | number | boolean | null> } => {
  const parsed = JSON.parse(body) as {
    readonly mapId?: string;
    readonly seed?: string | number;
    readonly options?: Record<string, string | number | boolean | null>;
  };
  if (typeof parsed.mapId !== "string" || parsed.mapId.length === 0) {
    throw new Error("mapId is required");
  }
  return {
    mapId: parsed.mapId,
    ...(parsed.seed === undefined ? {} : { seed: parsed.seed }),
    ...(parsed.options === undefined ? {} : { options: parsed.options }),
  };
};

export const createRoomMeta = (mapId: string, seed?: string | number): PlaytestRoomMeta => ({
  mapId,
  createdAt: new Date().toISOString(),
  lastTickAt: null,
  ...(seed === undefined ? {} : { seed }),
});

export const toPlaytestSummary = (playtestId: string, meta: PlaytestRoomMeta, connectedClients: number): PlaytestSummary => ({
  playtestId,
  mapId: meta.mapId,
  createdAt: meta.createdAt,
  lastTickAt: meta.lastTickAt,
  connectedClients,
});

export interface BinarySocket {
  readonly readyState: number;
  send(data: ArrayBuffer): void;
}

const WEBSOCKET_OPEN = 1;

export const broadcastBinaryFrame = (sockets: readonly BinarySocket[], message: ArrayBuffer): void => {
  for (const socket of sockets) {
    if (socket.readyState === WEBSOCKET_OPEN) {
      socket.send(message);
    }
  }
};

export { PlaytestRoom } from "./rooms/room-object.js";

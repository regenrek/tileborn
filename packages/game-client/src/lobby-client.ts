import type { JsonObject } from "@tileborne/core";

export type RoomLifecyclePhase = "lobby" | "countdown" | "active" | "finished" | "archived";
export type RoomLobbyVisibility = "private" | "public";
export type RoomPlayerPresenceStatus = "connected" | "disconnected";

export interface RoomPlayerModelSelection {
  readonly playerId: string;
  readonly modelId: string;
}

export interface RoomLobbyState {
  readonly visibility: RoomLobbyVisibility;
  readonly joinCode?: string;
  readonly title?: string;
  readonly createdByPlayerId?: string;
}

export interface RoomPresenceProjection {
  readonly playerId: string;
  readonly status: RoomPlayerPresenceStatus;
  readonly ready: boolean;
  readonly reconnectEligible: boolean;
  readonly lastSeenAt: string | null;
  readonly displayName?: string;
  readonly connectedAt?: string;
  readonly disconnectedAt?: string;
}

export interface RoomLobbySummary {
  readonly roomId: string;
  readonly mapId: string;
  readonly phase: RoomLifecyclePhase;
  readonly lobby: RoomLobbyState;
  readonly playerCount: number;
  readonly maxPlayers: number;
  readonly minReadyPlayers: number;
  readonly canStart: boolean;
  readonly players: readonly RoomPresenceProjection[];
}

export interface LobbyCreateRequest {
  readonly mapId: string;
  readonly seed?: string | number;
  readonly options?: Record<string, string | number | boolean | null>;
  readonly mapPackage?: JsonObject;
  readonly playerModelSelections?: readonly RoomPlayerModelSelection[];
  readonly displayName?: string;
  readonly visibility?: RoomLobbyVisibility;
  readonly reserveCreator?: boolean;
  readonly playerId?: string;
  readonly playerDisplayName?: string;
}

export interface LobbyCreateResponse {
  readonly roomId: string;
  readonly wsUrl: string;
  readonly joinCode: string;
  readonly joinUrl: string;
  readonly playerId?: string;
  readonly handoffToken?: string;
  readonly reconnectToken?: string;
  readonly lobby: RoomLobbySummary;
}

export interface LobbyJoinRequest {
  readonly joinCode: string;
  readonly displayName?: string;
  readonly playerId?: string;
}

export interface LobbyJoinResponse {
  readonly roomId: string;
  readonly playerId: string;
  readonly wsUrl: string;
  readonly handoffToken: string;
  readonly reconnectToken?: string;
  readonly lobby: RoomLobbySummary;
}

export interface LobbyReadyRequest {
  readonly playerId: string;
  readonly ready: boolean;
  readonly reconnectToken?: string;
}

export interface LobbyReadyResponse {
  readonly lobby: RoomLobbySummary;
  readonly canStart: boolean;
  readonly reason?: string;
}

export interface RoomReconnectRequest {
  readonly roomId: string;
  readonly playerId: string;
  readonly reconnectToken: string;
}

export interface RoomReconnectResponse {
  readonly roomId: string;
  readonly playerId: string;
  readonly wsUrl: string;
  readonly handoffToken: string;
  readonly reconnectToken?: string;
  readonly lobby: RoomLobbySummary;
}

export type LobbyFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface GameHostLobbyClientOptions {
  readonly baseUrl?: string;
  readonly fetch?: LobbyFetch;
}

export interface GameHostLobbyClient {
  readonly createLobby: (request: LobbyCreateRequest) => Promise<LobbyCreateResponse>;
  readonly joinLobby: (request: LobbyJoinRequest) => Promise<LobbyJoinResponse>;
  readonly getLobbyByCode: (joinCode: string) => Promise<RoomLobbySummary>;
  readonly getLobby: (roomId: string) => Promise<RoomLobbySummary>;
  readonly setReady: (roomId: string, request: LobbyReadyRequest) => Promise<LobbyReadyResponse>;
  readonly reconnect: (request: RoomReconnectRequest) => Promise<RoomReconnectResponse>;
}

export class LobbyClientError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "LobbyClientError";
    this.status = status;
  }
}

export const normalizeHostBaseUrl = (baseUrl: string): string => baseUrl.replace(/\/+$/, "");

export const toLobbyWebSocketUrl = (url: string): string =>
  url.replace(/^http:\/\//i, "ws://").replace(/^https:\/\//i, "wss://");

const readErrorMessage = async (response: Response, fallback: string): Promise<string> => {
  try {
    const body = (await response.json()) as { readonly error?: unknown };
    return typeof body.error === "string" && body.error.length > 0 ? body.error : fallback;
  } catch {
    return fallback;
  }
};

const requestJson = async <ResponseBody>(
  fetchImpl: LobbyFetch,
  baseUrl: string,
  path: string,
  init?: RequestInit,
): Promise<ResponseBody> => {
  const response = await fetchImpl(`${baseUrl}${path}`, init);
  if (!response.ok) {
    throw new LobbyClientError(
      await readErrorMessage(response, `Lobby request failed: HTTP ${response.status}`),
      response.status,
    );
  }
  return (await response.json()) as ResponseBody;
};

const jsonPost = <Body>(body: Body): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const normalizeCreateResponse = (response: LobbyCreateResponse): LobbyCreateResponse => ({
  ...response,
  wsUrl: toLobbyWebSocketUrl(response.wsUrl),
});

const normalizeJoinResponse = (response: LobbyJoinResponse): LobbyJoinResponse => ({
  ...response,
  wsUrl: toLobbyWebSocketUrl(response.wsUrl),
});

const normalizeReconnectResponse = (response: RoomReconnectResponse): RoomReconnectResponse => ({
  ...response,
  wsUrl: toLobbyWebSocketUrl(response.wsUrl),
});

export const createGameHostLobbyClient = (
  options: GameHostLobbyClientOptions = {},
): GameHostLobbyClient => {
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const baseUrl = normalizeHostBaseUrl(options.baseUrl ?? globalThis.location?.origin ?? "");

  return {
    createLobby: async (request) =>
      normalizeCreateResponse(
        await requestJson<LobbyCreateResponse>(
          fetchImpl,
          baseUrl,
          "/lobbies/create",
          jsonPost(request),
        ),
      ),
    joinLobby: async (request) =>
      normalizeJoinResponse(
        await requestJson<LobbyJoinResponse>(
          fetchImpl,
          baseUrl,
          "/lobbies/join",
          jsonPost(request),
        ),
      ),
    getLobbyByCode: (joinCode) =>
      requestJson<RoomLobbySummary>(
        fetchImpl,
        baseUrl,
        `/lobbies/code/${encodeURIComponent(joinCode)}`,
      ),
    getLobby: (roomId) =>
      requestJson<RoomLobbySummary>(fetchImpl, baseUrl, `/lobbies/${encodeURIComponent(roomId)}`),
    setReady: (roomId, request) =>
      requestJson<LobbyReadyResponse>(
        fetchImpl,
        baseUrl,
        `/lobbies/${encodeURIComponent(roomId)}/ready`,
        jsonPost(request),
      ),
    reconnect: async (request) =>
      normalizeReconnectResponse(
        await requestJson<RoomReconnectResponse>(
          fetchImpl,
          baseUrl,
          "/rooms/reconnect",
          jsonPost(request),
        ),
      ),
  };
};

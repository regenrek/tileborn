import type {
  MultiplayerGameShellProjection as GameShellProjection,
  MultiplayerLobbyCreateRequest as LobbyCreateRequest,
  MultiplayerLobbyCreateResponse as LobbyCreateResponse,
  MultiplayerLobbyJoinRequest as LobbyJoinRequest,
  MultiplayerLobbyJoinResponse as LobbyJoinResponse,
  MultiplayerLobbyStartRequest as LobbyStartRequest,
  MultiplayerLobbyStartResponse as LobbyStartResponse,
  MultiplayerLobbyReadyRequest as LobbyReadyRequest,
  MultiplayerLobbyReadyResponse as LobbyReadyResponse,
  MultiplayerRoomDiagnosticsResponse as RoomDiagnosticsResponse,
  MultiplayerRoomLifecyclePhase as RoomLifecyclePhase,
  MultiplayerRoomLobbyState as RoomLobbyState,
  MultiplayerRoomLobbySummary as RoomLobbySummary,
  MultiplayerRoomLobbyVisibility as RoomLobbyVisibility,
  MultiplayerRoomMetricsResponse as RoomMetricsResponse,
  MultiplayerRoomPlayerRole as RoomPlayerRole,
  MultiplayerRoomPlayerModelSelection as RoomPlayerModelSelection,
  MultiplayerRoomPlayerPresenceStatus as RoomPlayerPresenceStatus,
  MultiplayerRoomPresenceProjection as RoomPresenceProjection,
  MultiplayerRoomReconnectRequest as RoomReconnectRequest,
  MultiplayerRoomReconnectResponse as RoomReconnectResponse,
  MultiplayerRoomResultsResponse as RoomResultsResponse,
  MultiplayerRoomStopRequest as RoomStopRequest,
  MultiplayerRoomStopResponse as RoomStopResponse,
} from '@tileborne/ipc-contracts/contracts/multiplayer';

export type {
  GameShellProjection,
  LobbyCreateRequest,
  LobbyCreateResponse,
  LobbyJoinRequest,
  LobbyJoinResponse,
  LobbyStartRequest,
  LobbyStartResponse,
  LobbyReadyRequest,
  LobbyReadyResponse,
  RoomDiagnosticsResponse,
  RoomLifecyclePhase,
  RoomLobbyState,
  RoomLobbySummary,
  RoomLobbyVisibility,
  RoomMetricsResponse,
  RoomPlayerRole,
  RoomPlayerModelSelection,
  RoomPlayerPresenceStatus,
  RoomPresenceProjection,
  RoomReconnectRequest,
  RoomReconnectResponse,
  RoomResultsResponse,
  RoomStopRequest,
  RoomStopResponse,
};

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
  readonly start: (roomId: string, request: LobbyStartRequest) => Promise<LobbyStartResponse>;
  readonly stop: (roomId: string, request: RoomStopRequest) => Promise<RoomStopResponse>;
  readonly reconnect: (request: RoomReconnectRequest) => Promise<RoomReconnectResponse>;
  readonly getResults: (roomId: string) => Promise<RoomResultsResponse>;
  readonly getDiagnostics: (roomId: string) => Promise<RoomDiagnosticsResponse>;
  readonly getMetrics: (roomId: string) => Promise<RoomMetricsResponse>;
}

export class LobbyClientError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'LobbyClientError';
    this.status = status;
  }
}

export const normalizeHostBaseUrl = (baseUrl: string): string => baseUrl.replace(/\/+$/, '');

export const toLobbyWebSocketUrl = (url: string): string =>
  url.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://');

const readErrorMessage = async (response: Response, fallback: string): Promise<string> => {
  try {
    const body = (await response.json()) as { readonly error?: unknown };
    return typeof body.error === 'string' && body.error.length > 0 ? body.error : fallback;
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
  method: 'POST',
  headers: { 'content-type': 'application/json' },
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
  const baseUrl = normalizeHostBaseUrl(options.baseUrl ?? globalThis.location?.origin ?? '');

  return {
    createLobby: async (request) =>
      normalizeCreateResponse(
        await requestJson<LobbyCreateResponse>(
          fetchImpl,
          baseUrl,
          '/lobbies/create',
          jsonPost(request),
        ),
      ),
    joinLobby: async (request) =>
      normalizeJoinResponse(
        await requestJson<LobbyJoinResponse>(
          fetchImpl,
          baseUrl,
          '/lobbies/join',
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
    start: (roomId, request) =>
      requestJson<LobbyStartResponse>(
        fetchImpl,
        baseUrl,
        `/lobbies/${encodeURIComponent(roomId)}/start`,
        jsonPost(request),
      ),
    stop: (roomId, request) =>
      requestJson<RoomStopResponse>(
        fetchImpl,
        baseUrl,
        `/rooms/${encodeURIComponent(roomId)}/stop`,
        jsonPost(request),
      ),
    reconnect: async (request) =>
      normalizeReconnectResponse(
        await requestJson<RoomReconnectResponse>(
          fetchImpl,
          baseUrl,
          '/rooms/reconnect',
          jsonPost(request),
        ),
      ),
    getResults: (roomId) =>
      requestJson<RoomResultsResponse>(
        fetchImpl,
        baseUrl,
        `/rooms/${encodeURIComponent(roomId)}/results`,
      ),
    getDiagnostics: (roomId) =>
      requestJson<RoomDiagnosticsResponse>(
        fetchImpl,
        baseUrl,
        `/rooms/${encodeURIComponent(roomId)}/diagnostics`,
      ),
    getMetrics: (roomId) =>
      requestJson<RoomMetricsResponse>(
        fetchImpl,
        baseUrl,
        `/rooms/${encodeURIComponent(roomId)}/metrics`,
      ),
  };
};

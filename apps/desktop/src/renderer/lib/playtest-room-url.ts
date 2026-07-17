import {
  createGameHostLobbyClient,
  type LobbyCreateRequest,
  type RoomLobbySummary,
} from '@tileborne/game-client';

const PLAYTEST_DEEPLINK_PREFIX = 'tileborne://playtest/';

export interface ParsedPlaytestRoomRef {
  readonly baseUrl: string;
  readonly roomId: string;
}

export interface LocalMultiplayerRoomReady {
  readonly baseUrl: string;
  readonly roomId: string;
  readonly roomUrl: string;
  readonly wsUrl: string;
  readonly deeplink: string;
  readonly joinCode?: string;
  readonly joinUrl?: string;
}

export const buildPlaytestDeeplink = (roomId: string): string =>
  `${PLAYTEST_DEEPLINK_PREFIX}${roomId}`;

export const buildRoomUrl = (baseUrl: string, roomId: string): string =>
  `${baseUrl.replace(/\/$/, '')}/rooms/${roomId}`;

export const toWebSocketUrl = (connectUrl: string): string =>
  connectUrl.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://');

export const parsePlaytestRoomInput = (
  input: string,
  fallbackBaseUrl?: string,
): ParsedPlaytestRoomRef | null => {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.startsWith(PLAYTEST_DEEPLINK_PREFIX)) {
    const roomId = trimmed.slice(PLAYTEST_DEEPLINK_PREFIX.length).split(/[/?#]/)[0]?.trim();
    if (!roomId || !fallbackBaseUrl) {
      return null;
    }
    return { baseUrl: fallbackBaseUrl.replace(/\/$/, ''), roomId };
  }

  try {
    const url = new URL(trimmed);
    const roomMatch = url.pathname.match(/\/rooms\/([^/]+)/);
    if (roomMatch?.[1]) {
      return {
        baseUrl: `${url.protocol}//${url.host}`,
        roomId: roomMatch[1],
      };
    }
    const playtestMatch = url.pathname.match(/\/playtest\/([^/]+)/);
    if (playtestMatch?.[1]) {
      return {
        baseUrl: `${url.protocol}//${url.host}`,
        roomId: playtestMatch[1],
      };
    }
  } catch {
    return null;
  }

  return null;
};

export interface LocalRoomPlayerModelSelection {
  readonly playerId: string;
  readonly modelId: string;
}

export const createLocalMultiplayerRoom = async (
  baseUrl: string,
  mapId: string,
  options: {
    /** Encoded `RuntimeMapPackage` wire JSON the room runtime boots from. */
    readonly mapPackage?: LobbyCreateRequest['mapPackage'];
    readonly playerModelSelections?: readonly LocalRoomPlayerModelSelection[];
    readonly maxPlayers?: number;
  } = {},
): Promise<LocalMultiplayerRoomReady> => {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
  const lobbyClient = createGameHostLobbyClient({ baseUrl: normalizedBaseUrl });
  const roomOptions =
    options.maxPlayers === undefined
      ? undefined
      : {
          maxPlayers: options.maxPlayers,
        };
  const created = await lobbyClient.createLobby({
    mapId,
    visibility: 'private',
    ...(options.mapPackage === undefined ? {} : { mapPackage: options.mapPackage }),
    ...(options.playerModelSelections === undefined || options.playerModelSelections.length === 0
      ? {}
      : { playerModelSelections: options.playerModelSelections }),
    ...(roomOptions === undefined ? {} : { options: roomOptions }),
  });
  return {
    baseUrl: normalizedBaseUrl,
    roomId: created.roomId,
    roomUrl: buildRoomUrl(baseUrl, created.roomId),
    wsUrl: created.wsUrl,
    deeplink: buildPlaytestDeeplink(created.roomId),
    joinCode: created.joinCode,
    joinUrl: created.joinUrl,
  };
};

export interface PlaytestJoinSession {
  readonly wsUrl: string;
  readonly playerId: string;
  readonly handoffToken: string;
  readonly reconnectToken?: string;
}

export interface LocalMultiplayerParticipantSession extends PlaytestJoinSession {
  readonly baseUrl: string;
  readonly roomId: string;
}

export interface LocalMultiplayerPlayerResult {
  readonly playerId: string;
  readonly outcome?: string;
  readonly placement?: number;
  readonly score?: number;
}

export interface LocalMultiplayerRoomResults {
  readonly completedAt: string;
  readonly reason?: string;
  readonly players: readonly LocalMultiplayerPlayerResult[];
}

const REQUEST_TIMEOUT_MS = 3_000;

const fetchWithTimeout = async (
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const abort = (): void => controller.abort();
  init.signal?.addEventListener('abort', abort, { once: true });
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener('abort', abort);
  }
};

export const getLocalMultiplayerLobby = (
  baseUrl: string,
  roomId: string,
  signal?: AbortSignal,
): Promise<RoomLobbySummary> =>
  createGameHostLobbyClient({
    baseUrl,
    fetch: (input, init) =>
      fetchWithTimeout(input, { ...init, ...(signal === undefined ? {} : { signal }) }),
  }).getLobby(roomId);

export const setLocalMultiplayerReady = async (
  session: LocalMultiplayerParticipantSession,
  ready: boolean,
  signal?: AbortSignal,
): Promise<RoomLobbySummary> => {
  const response = await createGameHostLobbyClient({
    baseUrl: session.baseUrl,
    fetch: (input, init) =>
      fetchWithTimeout(input, { ...init, ...(signal === undefined ? {} : { signal }) }),
  }).setReady(session.roomId, {
    playerId: session.playerId,
    ready,
    ...(session.reconnectToken === undefined ? {} : { reconnectToken: session.reconnectToken }),
  });
  return response.lobby;
};

export const getLocalMultiplayerResults = async (
  baseUrl: string,
  roomId: string,
  signal?: AbortSignal,
): Promise<LocalMultiplayerRoomResults | null> => {
  const response = await fetchWithTimeout(
    `${baseUrl.replace(/\/$/, '')}/rooms/${encodeURIComponent(roomId)}/results`,
    signal === undefined ? {} : { signal },
  );
  if (!response.ok) {
    throw new Error(`Playtest results failed: HTTP ${response.status}`);
  }
  const body = (await response.json()) as {
    readonly results: LocalMultiplayerRoomResults | null;
  };
  return body.results;
};

export const startPlaytestJoinSession = async (
  baseUrl: string,
  mapId: string,
  roomId: string,
): Promise<PlaytestJoinSession> => {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/playtest/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mapId,
      options: { idempotencyKey: roomId },
    }),
  });
  if (!response.ok) {
    throw new Error(`Playtest join failed: HTTP ${response.status}`);
  }
  const started = (await response.json()) as {
    readonly wsUrl: string;
    readonly playerId: string;
    readonly handoffToken: string;
    readonly reconnectToken?: string;
  };
  return {
    wsUrl: toWebSocketUrl(started.wsUrl),
    playerId: started.playerId,
    handoffToken: started.handoffToken,
    ...(started.reconnectToken === undefined ? {} : { reconnectToken: started.reconnectToken }),
  };
};

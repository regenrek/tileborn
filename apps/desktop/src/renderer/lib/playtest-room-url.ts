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
    readonly mapPackage?: unknown;
    readonly playerModelSelections?: readonly LocalRoomPlayerModelSelection[];
    readonly maxPlayers?: number;
  } = {},
): Promise<LocalMultiplayerRoomReady> => {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/rooms/create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      mapId,
      ...(options.mapPackage === undefined ? {} : { mapPackage: options.mapPackage }),
      ...(options.playerModelSelections === undefined || options.playerModelSelections.length === 0
        ? {}
        : { playerModelSelections: options.playerModelSelections }),
      options: {
        ...(options.maxPlayers ? { maxPlayers: options.maxPlayers } : {}),
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`Room create failed: HTTP ${response.status}`);
  }
  const created = (await response.json()) as { readonly roomId: string; readonly wsUrl: string };
  const wsUrl = toWebSocketUrl(created.wsUrl);
  return {
    baseUrl: baseUrl.replace(/\/$/, ''),
    roomId: created.roomId,
    roomUrl: buildRoomUrl(baseUrl, created.roomId),
    wsUrl,
    deeplink: buildPlaytestDeeplink(created.roomId),
  };
};

export interface PlaytestJoinSession {
  readonly wsUrl: string;
  readonly playerId: string;
}

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
  };
  return {
    wsUrl: toWebSocketUrl(started.wsUrl),
    playerId: started.playerId,
  };
};

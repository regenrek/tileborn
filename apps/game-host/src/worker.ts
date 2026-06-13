import { Hono } from 'hono';
import type { JsonObject } from '@tileborne/core';

import {
  mintHandoffToken,
  isHandoffSigningKeyValid,
  verifyHandoffToken,
} from './rooms/handoff-token.js';
import type {
  BundledManifest,
  BundledMapPackage,
  Env,
  LobbyCreateRequest,
  LobbyCreateResponse,
  LobbyJoinRequest,
  LobbyJoinResponse,
  LobbyReadyRequest,
  LobbyReadyResponse,
  PlaytestStartRequest,
  PlaytestStartResponse,
  RoomCreateRequest,
  RoomCreateResponse,
  RoomLobbySummary,
  RoomPlayerModelSelection,
  RoomPlayerReservationResponse,
  RoomReconnectRequest,
  RoomReconnectResponse,
  RoomResultsResponse,
} from './types.js';
import { toDiscoverSummary, workerBuildId, workerVersion } from './types.js';
import { runtimeManifest } from './.generated/runtime-manifest.js';
import { bundledMapPackages } from './.generated/bundled-map-packages.js';
import { PlaytestRoom } from './room.js';
import { createRoomJoinCode, isRoomJoinCode, normalizeRoomJoinCode } from './rooms/room-lifecycle.js';

export type WorkerBindings = Env;

const HANDOFF_TTL_SECONDS = 300;
const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LOBBY_ROOM_ID_PREFIX = 'lobby-';
const MAX_JOIN_CODE_CREATE_ATTEMPTS = 8;
const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-allow-headers': 'content-type,authorization',
} as const;

const withCorsHeaders = (response: Response): Response => {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

const authorizeWebSocketUpgrade = async (
  env: Env,
  roomId: string,
  token: string | null,
  playerId: string | null,
): Promise<Response | null> => {
  if (!isHandoffSigningKeyValid(env)) {
    return new Response('room unavailable', { status: 503 });
  }
  if (!token || !playerId) {
    return new Response('missing handoff credentials', { status: 401 });
  }
  const verified = await verifyHandoffToken(env, token, {
    playtestId: roomId,
    purpose: 'handoff',
  });
  if (!verified || verified.playerId !== playerId) {
    return new Response('invalid handoff token', { status: 401 });
  }
  return null;
};

/**
 * Serve the shipped game-client static bundle via the optional `ASSETS`
 * binding (ADR-0022 decision #3). Falls back to `index.html` for SPA
 * navigations so client-side routing works. Returns 404 when no assets binding
 * is configured (e.g. playtest-only deployments).
 */
const serveStaticAsset = async (env: Env, request: Request): Promise<Response> => {
  if (env.ASSETS === undefined) {
    return new Response('not found', { status: 404 });
  }
  const response = await env.ASSETS.fetch(request);
  if (response.status !== 404) {
    return response;
  }
  const acceptsHtml = request.headers.get('Accept')?.includes('text/html') ?? false;
  if (request.method === 'GET' && acceptsHtml) {
    const url = new URL(request.url);
    url.pathname = '/index.html';
    return env.ASSETS.fetch(new Request(url.toString(), { headers: request.headers }));
  }
  return response;
};

const buildConnectUrl = (
  origin: string,
  roomId: string,
  playerId: string,
  token: string,
  legacyPlaytest: boolean,
): string => {
  const path = legacyPlaytest ? `/playtest/${roomId}/ws` : `/rooms/${roomId}/connect`;
  const params = new URLSearchParams({
    token,
    playerId,
    ...(legacyPlaytest ? { playtestId: roomId } : { roomId }),
  });
  return `${origin}${path}?${params.toString()}`;
};

const readJsonError = async (response: Response, fallback: string): Promise<string> => {
  try {
    const body = (await response.json()) as { readonly error?: unknown };
    return typeof body.error === 'string' && body.error.length > 0 ? body.error : fallback;
  } catch {
    return fallback;
  }
};

const readJsonRequest = async (request: Request): Promise<unknown> => {
  try {
    return await request.json();
  } catch {
    throw new Error('request body must be valid JSON');
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requiredString = (body: Record<string, unknown>, key: string): string => {
  const value = body[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${key} is required`);
  }
  return value;
};

const optionalNonEmptyString = (
  body: Record<string, unknown>,
  key: string,
): string | undefined => {
  const value = body[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value;
};

const optionalBoolean = (body: Record<string, unknown>, key: string): boolean | undefined => {
  const value = body[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    throw new Error(`${key} must be a boolean`);
  }
  return value;
};

const isRoomOptionValue = (value: unknown): value is string | number | boolean | null =>
  value === null ||
  typeof value === 'string' ||
  typeof value === 'number' ||
  typeof value === 'boolean';

const parseRoomOptions = (
  value: unknown,
): Record<string, string | number | boolean | null> | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error('options must be a JSON object');
  }
  if (!Object.values(value).every(isRoomOptionValue)) {
    throw new Error('options values must be strings, numbers, booleans, or null');
  }
  return value as Record<string, string | number | boolean | null>;
};

const parseLobbyCreateRequest = async (request: Request): Promise<LobbyCreateRequest> => {
  const parsed = await readJsonRequest(request);
  if (!isRecord(parsed)) {
    throw new Error('request body must be a JSON object');
  }
  const mapId = requiredString(parsed, 'mapId');
  const seed = parsed.seed;
  if (seed !== undefined && typeof seed !== 'string' && typeof seed !== 'number') {
    throw new Error('seed must be a string or number');
  }
  const options = parseRoomOptions(parsed.options);
  const visibility = parsed.visibility;
  if (visibility !== undefined && visibility !== 'private' && visibility !== 'public') {
    throw new Error('visibility must be private or public');
  }
  const reserveCreator = optionalBoolean(parsed, 'reserveCreator');
  const displayName = optionalNonEmptyString(parsed, 'displayName');
  const playerId = optionalNonEmptyString(parsed, 'playerId');
  const playerDisplayName = optionalNonEmptyString(parsed, 'playerDisplayName');
  if (parsed.mapPackage !== undefined && !isRecord(parsed.mapPackage)) {
    throw new Error('mapPackage must be a JSON object');
  }
  const requestBody: LobbyCreateRequest = {
    mapId,
    ...(seed === undefined ? {} : { seed }),
    ...(options === undefined ? {} : { options }),
    ...(parsed.mapPackage === undefined ? {} : { mapPackage: parsed.mapPackage as JsonObject }),
    ...(parsed.playerModelSelections === undefined
      ? {}
      : { playerModelSelections: parsed.playerModelSelections as readonly RoomPlayerModelSelection[] }),
    ...(displayName === undefined ? {} : { displayName }),
    ...(visibility === undefined ? {} : { visibility }),
    ...(reserveCreator === undefined ? {} : { reserveCreator }),
    ...(playerId === undefined ? {} : { playerId }),
    ...(playerDisplayName === undefined ? {} : { playerDisplayName }),
  };
  return requestBody;
};

const parseLobbyJoinRequest = async (request: Request): Promise<LobbyJoinRequest> => {
  const parsed = await readJsonRequest(request);
  if (!isRecord(parsed)) {
    throw new Error('request body must be a JSON object');
  }
  const joinCode = requiredString(parsed, 'joinCode');
  if (!isRoomJoinCode(joinCode)) {
    throw new Error('joinCode is invalid');
  }
  const displayName = optionalNonEmptyString(parsed, 'displayName');
  const playerId = optionalNonEmptyString(parsed, 'playerId');
  return {
    joinCode: createRoomJoinCode(joinCode),
    ...(displayName === undefined ? {} : { displayName }),
    ...(playerId === undefined ? {} : { playerId }),
  };
};

const parseLobbyReadyRequest = async (request: Request): Promise<LobbyReadyRequest> => {
  const parsed = await readJsonRequest(request);
  if (!isRecord(parsed)) {
    throw new Error('request body must be a JSON object');
  }
  const playerId = requiredString(parsed, 'playerId');
  const ready = parsed.ready;
  if (typeof ready !== 'boolean') {
    throw new Error('ready must be a boolean');
  }
  const reconnectToken = optionalNonEmptyString(parsed, 'reconnectToken');
  return { playerId, ready, ...(reconnectToken === undefined ? {} : { reconnectToken }) };
};

const parseRoomReconnectRequest = async (request: Request): Promise<RoomReconnectRequest> => {
  const parsed = await readJsonRequest(request);
  if (!isRecord(parsed)) {
    throw new Error('request body must be a JSON object');
  }
  return {
    roomId: requiredString(parsed, 'roomId'),
    playerId: requiredString(parsed, 'playerId'),
    reconnectToken: requiredString(parsed, 'reconnectToken'),
  };
};

const createRandomJoinCode = (): string => {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => JOIN_CODE_ALPHABET[byte % JOIN_CODE_ALPHABET.length]).join('');
};

const roomIdFromJoinCode = (joinCode: string): string =>
  `${LOBBY_ROOM_ID_PREFIX}${normalizeRoomJoinCode(joinCode)}`;

const buildBareRoomConnectUrl = (origin: string, roomId: string): string =>
  `${origin}/rooms/${roomId}/connect`;

const buildJoinUrl = (origin: string, joinCode: string): string =>
  `${origin}/lobbies/join?code=${encodeURIComponent(joinCode)}`;

const mintWebSocketHandoffToken = (
  env: Env,
  input: { readonly roomId: string; readonly playerId: string },
): Promise<string> =>
  mintHandoffToken(env, {
    playtestId: input.roomId,
    playerId: input.playerId,
    purpose: 'handoff',
    ttlSeconds: HANDOFF_TTL_SECONDS,
  });

const mintReconnectCredential = (
  env: Env,
  input: { readonly roomId: string; readonly playerId: string },
): Promise<string> =>
  mintHandoffToken(env, {
    playtestId: input.roomId,
    playerId: input.playerId,
    purpose: 'reconnect',
  });

const readBearerToken = (headers: Headers): string | undefined => {
  const header = headers.get('authorization');
  if (header === null) {
    return undefined;
  }
  const [scheme, value] = header.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== 'bearer' || value === undefined || value.length === 0) {
    return undefined;
  }
  return value;
};

const lobbySummaryFromResponse = async (response: Response): Promise<RoomLobbySummary | null> => {
  if (!response.ok) {
    return null;
  }
  const body = (await response.json()) as { readonly lobby?: RoomLobbySummary };
  return body.lobby ?? null;
};

const fetchLobbySummary = async (
  env: Env,
  roomId: string,
): Promise<{ readonly response: Response; readonly lobby: RoomLobbySummary | null }> => {
  const stub = env.PLAYTEST_ROOM.get(env.PLAYTEST_ROOM.idFromName(roomId));
  const response = await stub.fetch(
    new Request(`https://playtest-room/lobby/summary?roomId=${encodeURIComponent(roomId)}`),
  );
  return { response, lobby: await lobbySummaryFromResponse(response.clone()) };
};

const reserveLobbyPlayer = async (
  env: Env,
  roomId: string,
  input: { readonly playerId?: string; readonly displayName?: string },
): Promise<Response> => {
  const stub = env.PLAYTEST_ROOM.get(env.PLAYTEST_ROOM.idFromName(roomId));
  return stub.fetch(
    new Request('https://playtest-room/players/reserve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...(input.playerId === undefined ? {} : { playerId: input.playerId }),
        ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
      }),
    }),
  );
};

const setLobbyReady = async (
  env: Env,
  roomId: string,
  input: LobbyReadyRequest,
): Promise<Response> => {
  const stub = env.PLAYTEST_ROOM.get(env.PLAYTEST_ROOM.idFromName(roomId));
  return stub.fetch(
    new Request(`https://playtest-room/lobby/ready?roomId=${encodeURIComponent(roomId)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    }),
  );
};

const validateRoomReconnect = async (
  env: Env,
  roomId: string,
  playerId: string,
): Promise<Response> => {
  const stub = env.PLAYTEST_ROOM.get(env.PLAYTEST_ROOM.idFromName(roomId));
  return stub.fetch(
    new Request(`https://playtest-room/players/reconnect?roomId=${encodeURIComponent(roomId)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ playerId }),
    }),
  );
};

const fetchRoomResults = async (env: Env, roomId: string): Promise<Response> => {
  const stub = env.PLAYTEST_ROOM.get(env.PLAYTEST_ROOM.idFromName(roomId));
  return stub.fetch(
    new Request(`https://playtest-room/results?roomId=${encodeURIComponent(roomId)}`),
  );
};

/**
 * Resolve the `RuntimeMapPackage` a packageless `/rooms/create` boots from
 * (M5 S1): an exact bundled `mapId` match wins; a single-map build is the
 * implicit default for any requested `mapId`; ambiguous or empty builds are a
 * structured 400 instead of deferring the failure to room start.
 */
const resolveBundledMapPackage = (
  mapId: string,
  bundled: readonly BundledMapPackage[],
): { readonly mapPackage: BundledMapPackage } | { readonly error: string } => {
  const exact = bundled.find((candidate) => candidate.mapId === mapId);
  if (exact !== undefined) {
    return { mapPackage: exact };
  }
  if (bundled.length === 1) {
    return { mapPackage: bundled[0]! };
  }
  if (bundled.length === 0) {
    return { error: 'no map package bundled in this build; supply mapPackage in the request body' };
  }
  return {
    error: `no bundled map package for mapId ${mapId}; bundled maps: ${bundled
      .map((candidate) => candidate.mapId)
      .join(', ')}`,
  };
};

export const createWorkerApp = (
  manifest: BundledManifest = runtimeManifest,
  mapPackages: readonly BundledMapPackage[] = bundledMapPackages,
): Hono<{ Bindings: Env }> => {
  const app = new Hono<{ Bindings: Env }>();

  app.use('*', async (context, next) => {
    const isWebSocketUpgrade =
      context.req.raw.headers.get('Upgrade')?.toLowerCase() === 'websocket';
    if (context.req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    await next();
    if (isWebSocketUpgrade) {
      return;
    }
    context.res = withCorsHeaders(context.res);
  });

  app.get('/health', (context) => {
    if (!isHandoffSigningKeyValid(context.env)) {
      return context.json({ status: 'unavailable', reason: 'HANDOFF_SIGNING_KEY invalid' }, 503);
    }
    return context.json({
      status: 'ok',
      version: workerVersion(),
      buildId: workerBuildId(),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/discover', (context) => context.json(toDiscoverSummary(manifest)));

  app.post('/rooms/create', async (context) => {
    if (!isHandoffSigningKeyValid(context.env)) {
      return context.json({ error: 'room service unavailable' }, 503);
    }
    const body = (await context.req.json()) as RoomCreateRequest;
    if (typeof body.mapId !== 'string' || body.mapId.length === 0) {
      return context.json({ error: 'mapId is required' }, 400);
    }
    let mapPackage = body.mapPackage;
    if (mapPackage === undefined) {
      const resolved = resolveBundledMapPackage(body.mapId, mapPackages);
      if ('error' in resolved) {
        return context.json({ error: resolved.error }, 400);
      }
      mapPackage = resolved.mapPackage.mapPackage;
    }
    const idempotencyKey =
      body.options?.idempotencyKey !== undefined && typeof body.options.idempotencyKey === 'string'
        ? body.options.idempotencyKey
        : crypto.randomUUID();
    const roomId = idempotencyKey;
    const stub = context.env.PLAYTEST_ROOM.get(context.env.PLAYTEST_ROOM.idFromName(roomId));
    const initResponse = await stub.fetch(
      new Request(`https://playtest-room/create?roomId=${encodeURIComponent(roomId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mapId: body.mapId,
          ...(body.seed === undefined ? {} : { seed: body.seed }),
          ...(body.options === undefined ? {} : { options: body.options }),
          mapPackage,
          ...(body.playerModelSelections === undefined
            ? {}
            : { playerModelSelections: body.playerModelSelections }),
        }),
      }),
    );
    if (!initResponse.ok) {
      // Surface the room's boundary validation failures (e.g. a malformed
      // mapPackage) as a structured 400 instead of a generic 500.
      if (initResponse.status === 400) {
        const error = await readJsonError(initResponse, 'invalid room create request');
        return context.json({ error }, 400);
      }
      return context.json({ error: 'failed to initialize room' }, 500);
    }
    const requestUrl = new URL(context.req.url);
    const wsUrl = `${requestUrl.origin}/rooms/${roomId}/connect`;
    const payload: RoomCreateResponse = { roomId, wsUrl };
    return context.json(payload, 201);
  });

  app.post('/lobbies/create', async (context) => {
    if (!isHandoffSigningKeyValid(context.env)) {
      return context.json({ error: 'room service unavailable' }, 503);
    }
    let body: LobbyCreateRequest;
    try {
      body = await parseLobbyCreateRequest(context.req.raw);
    } catch (error) {
      return context.json(
        { error: error instanceof Error ? error.message : 'invalid lobby create request' },
        400,
      );
    }

    let mapPackage = body.mapPackage;
    if (mapPackage === undefined) {
      const resolved = resolveBundledMapPackage(body.mapId, mapPackages);
      if ('error' in resolved) {
        return context.json({ error: resolved.error }, 400);
      }
      mapPackage = resolved.mapPackage.mapPackage;
    }

    const requestUrl = new URL(context.req.url);
    for (let attempt = 0; attempt < MAX_JOIN_CODE_CREATE_ATTEMPTS; attempt += 1) {
      const joinCode = createRoomJoinCode(createRandomJoinCode());
      const roomId = roomIdFromJoinCode(joinCode);
      const existing = await fetchLobbySummary(context.env, roomId);
      if (existing.response.status !== 404) {
        if (!existing.response.ok) {
          return context.json({ error: 'failed to create lobby' }, 500);
        }
        continue;
      }

      const stub = context.env.PLAYTEST_ROOM.get(context.env.PLAYTEST_ROOM.idFromName(roomId));
      const initResponse = await stub.fetch(
        new Request(`https://playtest-room/create?roomId=${encodeURIComponent(roomId)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            mapId: body.mapId,
            ...(body.seed === undefined ? {} : { seed: body.seed }),
            ...(body.options === undefined ? {} : { options: body.options }),
            mapPackage,
            ...(body.playerModelSelections === undefined
              ? {}
              : { playerModelSelections: body.playerModelSelections }),
          }),
        }),
      );
      if (!initResponse.ok) {
        if (initResponse.status === 400) {
          const error = await readJsonError(initResponse, 'invalid lobby create request');
          return context.json({ error }, 400);
        }
        return context.json({ error: 'failed to initialize lobby' }, 500);
      }

      const configureLobby = async (createdByPlayerId?: string): Promise<Response> =>
        stub.fetch(
          new Request(
            `https://playtest-room/lobby/configure?roomId=${encodeURIComponent(roomId)}`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                joinCode,
                ...(body.visibility === undefined ? {} : { visibility: body.visibility }),
                ...(body.displayName === undefined ? {} : { displayName: body.displayName }),
                ...(createdByPlayerId === undefined ? {} : { createdByPlayerId }),
              }),
            },
          ),
        );

      const initialConfigureResponse = await configureLobby(body.playerId);
      if (!initialConfigureResponse.ok) {
        const error = await readJsonError(initialConfigureResponse, 'failed to configure lobby');
        return context.json({ error }, initialConfigureResponse.status === 400 ? 400 : 500);
      }

      const shouldReserveCreator =
        body.reserveCreator === true ||
        body.playerId !== undefined ||
        body.playerDisplayName !== undefined;
      let playerId: string | undefined;
      let handoffToken: string | undefined;
      let reconnectToken: string | undefined;
      if (shouldReserveCreator) {
        const reserveResponse = await reserveLobbyPlayer(context.env, roomId, {
          ...(body.playerId === undefined ? {} : { playerId: body.playerId }),
          ...(body.playerDisplayName === undefined ? {} : { displayName: body.playerDisplayName }),
        });
        if (!reserveResponse.ok) {
          const error = await readJsonError(reserveResponse, 'failed to reserve player');
          if (reserveResponse.status === 400) {
            return context.json({ error }, 400);
          }
          if (reserveResponse.status === 409) {
            return context.json({ error }, 409);
          }
          return context.json({ error }, 500);
        }
        const reservation = (await reserveResponse.json()) as RoomPlayerReservationResponse;
        if (typeof reservation.playerId !== 'string' || reservation.playerId.length === 0) {
          return context.json({ error: 'failed to reserve player' }, 500);
        }
        playerId = reservation.playerId;
        handoffToken = await mintWebSocketHandoffToken(context.env, { roomId, playerId });
        reconnectToken = await mintReconnectCredential(context.env, { roomId, playerId });
        if (body.playerId === undefined) {
          const creatorConfigureResponse = await configureLobby(playerId);
          if (!creatorConfigureResponse.ok) {
            const error = await readJsonError(creatorConfigureResponse, 'failed to configure lobby');
            return context.json({ error }, creatorConfigureResponse.status === 400 ? 400 : 500);
          }
        }
      }

      const summary = await fetchLobbySummary(context.env, roomId);
      if (!summary.response.ok || summary.lobby === null) {
        return context.json({ error: 'failed to read lobby summary' }, 500);
      }

      const payload: LobbyCreateResponse = {
        roomId,
        wsUrl:
          playerId === undefined || handoffToken === undefined
            ? buildBareRoomConnectUrl(requestUrl.origin, roomId)
            : buildConnectUrl(requestUrl.origin, roomId, playerId, handoffToken, false),
        joinCode,
        joinUrl: buildJoinUrl(requestUrl.origin, joinCode),
        ...(playerId === undefined ? {} : { playerId }),
        ...(handoffToken === undefined ? {} : { handoffToken }),
        ...(reconnectToken === undefined ? {} : { reconnectToken }),
        lobby: summary.lobby,
      };
      return context.json(payload, 201);
    }

    return context.json({ error: 'failed to allocate join code' }, 409);
  });

  app.post('/lobbies/join', async (context) => {
    if (!isHandoffSigningKeyValid(context.env)) {
      return context.json({ error: 'room service unavailable' }, 503);
    }
    let body: LobbyJoinRequest;
    try {
      body = await parseLobbyJoinRequest(context.req.raw);
    } catch (error) {
      return context.json(
        { error: error instanceof Error ? error.message : 'invalid lobby join request' },
        400,
      );
    }

    const joinCode = createRoomJoinCode(body.joinCode);
    const roomId = roomIdFromJoinCode(joinCode);
    const existing = await fetchLobbySummary(context.env, roomId);
    if (existing.response.status === 404) {
      return context.json({ error: 'join code not found' }, 404);
    }
    if (!existing.response.ok) {
      return context.json({ error: 'failed to join lobby' }, 500);
    }

    const reserveResponse = await reserveLobbyPlayer(context.env, roomId, {
      ...(body.playerId === undefined ? {} : { playerId: body.playerId }),
      ...(body.displayName === undefined ? {} : { displayName: body.displayName }),
    });
    if (!reserveResponse.ok) {
      const error = await readJsonError(reserveResponse, 'failed to reserve player');
      if (reserveResponse.status === 400) {
        return context.json({ error }, 400);
      }
      if (reserveResponse.status === 409) {
        return context.json({ error }, 409);
      }
      return context.json({ error }, 500);
    }
    const reservation = (await reserveResponse.json()) as RoomPlayerReservationResponse;
    if (typeof reservation.playerId !== 'string' || reservation.playerId.length === 0) {
      return context.json({ error: 'failed to reserve player' }, 500);
    }
    const playerId = reservation.playerId;
    const handoffToken = await mintWebSocketHandoffToken(context.env, { roomId, playerId });
    const reconnectToken = await mintReconnectCredential(context.env, { roomId, playerId });
    const summary = await fetchLobbySummary(context.env, roomId);
    if (!summary.response.ok || summary.lobby === null) {
      return context.json({ error: 'failed to read lobby summary' }, 500);
    }
    const requestUrl = new URL(context.req.url);
    const payload: LobbyJoinResponse = {
      roomId,
      playerId,
      wsUrl: buildConnectUrl(requestUrl.origin, roomId, playerId, handoffToken, false),
      handoffToken,
      reconnectToken,
      lobby: summary.lobby,
    };
    return context.json(payload, 201);
  });

  app.post('/lobbies/:id/ready', async (context) => {
    if (!isHandoffSigningKeyValid(context.env)) {
      return context.json({ error: 'room service unavailable' }, 503);
    }
    const roomId = context.req.param('id');
    if (roomId.length === 0) {
      return context.json({ error: 'roomId is required' }, 400);
    }
    let body: LobbyReadyRequest;
    try {
      body = await parseLobbyReadyRequest(context.req.raw);
    } catch (error) {
      return context.json(
        { error: error instanceof Error ? error.message : 'invalid ready request' },
        400,
      );
    }
    const readyToken = body.reconnectToken ?? readBearerToken(context.req.raw.headers);
    if (readyToken === undefined) {
      return context.json({ error: 'missing ready token' }, 401);
    }
    const verified = await verifyHandoffToken(context.env, readyToken, {
      playtestId: roomId,
      purpose: 'reconnect',
    });
    if (!verified || verified.playerId !== body.playerId) {
      return context.json({ error: 'invalid ready token' }, 401);
    }
    const readyResponse = await setLobbyReady(context.env, roomId, {
      playerId: body.playerId,
      ready: body.ready,
    });
    if (!readyResponse.ok) {
      const error = await readJsonError(readyResponse, 'failed to update ready state');
      if (readyResponse.status === 400) {
        return context.json({ error }, 400);
      }
      if (readyResponse.status === 404) {
        return context.json({ error }, 404);
      }
      if (readyResponse.status === 409) {
        return context.json({ error }, 409);
      }
      return context.json({ error }, 500);
    }
    const payload = (await readyResponse.json()) as LobbyReadyResponse;
    return context.json(payload);
  });

  app.get('/lobbies/code/:code', async (context) => {
    if (!isHandoffSigningKeyValid(context.env)) {
      return context.json({ error: 'room service unavailable' }, 503);
    }
    const code = context.req.param('code');
    if (!isRoomJoinCode(code)) {
      return context.json({ error: 'joinCode is invalid' }, 400);
    }
    const roomId = roomIdFromJoinCode(code);
    const summary = await fetchLobbySummary(context.env, roomId);
    if (summary.response.status === 404) {
      return context.json({ error: 'join code not found' }, 404);
    }
    if (!summary.response.ok || summary.lobby === null) {
      return context.json({ error: 'failed to read lobby summary' }, 500);
    }
    return context.json(summary.lobby);
  });

  app.get('/lobbies/:id', async (context) => {
    if (!isHandoffSigningKeyValid(context.env)) {
      return context.json({ error: 'room service unavailable' }, 503);
    }
    const roomId = context.req.param('id');
    if (roomId.length === 0) {
      return context.json({ error: 'roomId is required' }, 400);
    }
    const summary = await fetchLobbySummary(context.env, roomId);
    if (summary.response.status === 404) {
      return context.json({ error: 'lobby not found' }, 404);
    }
    if (!summary.response.ok || summary.lobby === null) {
      return context.json({ error: 'failed to read lobby summary' }, 500);
    }
    return context.json(summary.lobby);
  });

  app.post('/rooms/reconnect', async (context) => {
    if (!isHandoffSigningKeyValid(context.env)) {
      return context.json({ error: 'room service unavailable' }, 503);
    }
    let body: RoomReconnectRequest;
    try {
      body = await parseRoomReconnectRequest(context.req.raw);
    } catch (error) {
      return context.json(
        { error: error instanceof Error ? error.message : 'invalid reconnect request' },
        400,
      );
    }
    const verified = await verifyHandoffToken(context.env, body.reconnectToken, {
      playtestId: body.roomId,
      purpose: 'reconnect',
    });
    if (!verified || verified.playerId !== body.playerId) {
      return context.json({ error: 'invalid reconnect token' }, 401);
    }
    const reconnectResponse = await validateRoomReconnect(context.env, body.roomId, body.playerId);
    if (!reconnectResponse.ok) {
      const error = await readJsonError(reconnectResponse, 'failed to reconnect player');
      if (reconnectResponse.status === 404) {
        return context.json({ error }, 404);
      }
      if (reconnectResponse.status === 409) {
        return context.json({ error }, 409);
      }
      return context.json({ error }, 500);
    }
    const reconnectBody = (await reconnectResponse.json()) as {
      readonly lobby: RoomLobbySummary;
    };
    const handoffToken = await mintWebSocketHandoffToken(context.env, {
      roomId: body.roomId,
      playerId: body.playerId,
    });
    const reconnectToken = await mintReconnectCredential(context.env, {
      roomId: body.roomId,
      playerId: body.playerId,
    });
    const requestUrl = new URL(context.req.url);
    const payload: RoomReconnectResponse = {
      roomId: body.roomId,
      playerId: body.playerId,
      wsUrl: buildConnectUrl(requestUrl.origin, body.roomId, body.playerId, handoffToken, false),
      handoffToken,
      reconnectToken,
      lobby: reconnectBody.lobby,
    };
    return context.json(payload);
  });

  app.get('/rooms/:id/results', async (context) => {
    if (!isHandoffSigningKeyValid(context.env)) {
      return context.json({ error: 'room service unavailable' }, 503);
    }
    const roomId = context.req.param('id');
    if (roomId.length === 0) {
      return context.json({ error: 'roomId is required' }, 400);
    }
    const resultsResponse = await fetchRoomResults(context.env, roomId);
    if (!resultsResponse.ok) {
      const error = await readJsonError(resultsResponse, 'failed to read room results');
      if (resultsResponse.status === 404) {
        return context.json({ error }, 404);
      }
      return context.json({ error }, 500);
    }
    const payload = (await resultsResponse.json()) as RoomResultsResponse;
    return context.json(payload);
  });

  app.get('/rooms/:id/connect', async (context) => {
    const roomId = context.req.param('id');
    const url = new URL(context.req.url);
    const authFailure = await authorizeWebSocketUpgrade(
      context.env,
      roomId,
      url.searchParams.get('token'),
      url.searchParams.get('playerId'),
    );
    if (authFailure) {
      return authFailure;
    }
    const stub = context.env.PLAYTEST_ROOM.get(context.env.PLAYTEST_ROOM.idFromName(roomId));
    url.searchParams.set('roomId', roomId);
    return stub.fetch(new Request(url.toString(), { headers: context.req.raw.headers }));
  });

  app.post('/playtest/start', async (context) => {
    if (!isHandoffSigningKeyValid(context.env)) {
      return context.json({ error: 'room service unavailable' }, 503);
    }
    const body = (await context.req.json()) as PlaytestStartRequest;
    if (typeof body.mapId !== 'string' || body.mapId.length === 0) {
      return context.json({ error: 'mapId is required' }, 400);
    }
    const idempotencyKey =
      body.options?.idempotencyKey !== undefined && typeof body.options.idempotencyKey === 'string'
        ? body.options.idempotencyKey
        : undefined;
    const playtestId = idempotencyKey ?? crypto.randomUUID();
    const requestedPlayerId = body.playerId === undefined ? undefined : body.playerId;
    if (
      requestedPlayerId !== undefined &&
      (typeof requestedPlayerId !== 'string' || requestedPlayerId.length === 0)
    ) {
      return context.json({ error: 'playerId must be a non-empty string' }, 400);
    }
    const stub = context.env.PLAYTEST_ROOM.get(context.env.PLAYTEST_ROOM.idFromName(playtestId));
    // Joining never creates a room (hard cut): the room must already exist
    // via the explicit `/rooms/create` route, otherwise the join is a 404.
    const summaryResponse = await stub.fetch(
      new Request(`https://playtest-room/?playtestId=${encodeURIComponent(playtestId)}`),
    );
    if (summaryResponse.status === 404) {
      return context.json({ error: 'playtest not found' }, 404);
    }
    if (!summaryResponse.ok) {
      return context.json({ error: 'failed to join playtest room' }, 500);
    }
    const reserveResponse = await stub.fetch(
      new Request('https://playtest-room/players/reserve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          requestedPlayerId === undefined ? {} : { playerId: requestedPlayerId },
        ),
      }),
    );
    if (!reserveResponse.ok) {
      const error = await readJsonError(reserveResponse, 'failed to reserve player');
      if (reserveResponse.status === 400) {
        return context.json({ error }, 400);
      }
      if (reserveResponse.status === 409) {
        return context.json({ error }, 409);
      }
      return context.json({ error }, 500);
    }
    const reservation = (await reserveResponse.json()) as RoomPlayerReservationResponse;
    if (typeof reservation.playerId !== 'string' || reservation.playerId.length === 0) {
      return context.json({ error: 'failed to reserve player' }, 500);
    }
    const playerId = reservation.playerId;
    const handoffToken = await mintWebSocketHandoffToken(context.env, {
      roomId: playtestId,
      playerId,
    });
    const reconnectToken = await mintReconnectCredential(context.env, {
      roomId: playtestId,
      playerId,
    });
    const requestUrl = new URL(context.req.url);
    const wsUrl = buildConnectUrl(requestUrl.origin, playtestId, playerId, handoffToken, true);
    const payload: PlaytestStartResponse = {
      playtestId,
      wsUrl,
      handoffToken,
      reconnectToken,
      playerId,
    };
    return context.json(payload, 201);
  });

  app.get('/playtest/:id', async (context) => {
    const playtestId = context.req.param('id');
    const stub = context.env.PLAYTEST_ROOM.get(context.env.PLAYTEST_ROOM.idFromName(playtestId));
    const summaryResponse = await stub.fetch(
      new Request(`https://playtest-room/?playtestId=${encodeURIComponent(playtestId)}`),
    );
    if (summaryResponse.status === 404) {
      return context.json({ error: 'playtest not found' }, 404);
    }
    return summaryResponse;
  });

  app.get('/playtest/:id/ws', async (context) => {
    const playtestId = context.req.param('id');
    const url = new URL(context.req.url);
    const authFailure = await authorizeWebSocketUpgrade(
      context.env,
      playtestId,
      url.searchParams.get('token'),
      url.searchParams.get('playerId'),
    );
    if (authFailure) {
      return authFailure;
    }
    const stub = context.env.PLAYTEST_ROOM.get(context.env.PLAYTEST_ROOM.idFromName(playtestId));
    url.searchParams.set('playtestId', playtestId);
    return stub.fetch(new Request(url.toString(), { headers: context.req.raw.headers }));
  });

  // Anything not matched by an API/WS route falls through to the shipped
  // game-client static assets (served by the `ASSETS` binding when present).
  app.notFound((context) => serveStaticAsset(context.env, context.req.raw));

  return app;
};

const app = createWorkerApp();

export default {
  fetch: app.fetch,
};

export { PlaytestRoom };

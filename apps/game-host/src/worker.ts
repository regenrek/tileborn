import { Hono } from "hono";

import { mintHandoffToken, isHandoffSigningKeyValid, verifyHandoffToken } from "./rooms/handoff-token.js";
import type {
  BundledManifest,
  Env,
  PlaytestStartRequest,
  PlaytestStartResponse,
  RoomCreateRequest,
  RoomCreateResponse,
} from "./types.js";
import { toDiscoverSummary, workerBuildId, workerVersion } from "./types.js";
import { runtimeManifest } from "./.generated/runtime-manifest.js";
import { PlaytestRoom } from "./room.js";

export type WorkerBindings = Env;

const initPath = "/playtest/init";
const HANDOFF_TTL_SECONDS = 300;
const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type,authorization",
} as const;

const authorizeWebSocketUpgrade = async (
  env: Env,
  roomId: string,
  token: string | null,
  playerId: string | null,
): Promise<Response | null> => {
  if (!isHandoffSigningKeyValid(env)) {
    return new Response("room unavailable", { status: 503 });
  }
  if (!token || !playerId) {
    return new Response("missing handoff credentials", { status: 401 });
  }
  const verified = await verifyHandoffToken(env, token, { playtestId: roomId });
  if (!verified || verified.playerId !== playerId) {
    return new Response("invalid handoff token", { status: 401 });
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
    return new Response("not found", { status: 404 });
  }
  const response = await env.ASSETS.fetch(request);
  if (response.status !== 404) {
    return response;
  }
  const acceptsHtml = request.headers.get("Accept")?.includes("text/html") ?? false;
  if (request.method === "GET" && acceptsHtml) {
    const url = new URL(request.url);
    url.pathname = "/index.html";
    return env.ASSETS.fetch(new Request(url.toString(), { headers: request.headers }));
  }
  return response;
};

const buildConnectUrl = (origin: string, roomId: string, playerId: string, token: string, legacyPlaytest: boolean): string => {
  const path = legacyPlaytest ? `/playtest/${roomId}/ws` : `/rooms/${roomId}/connect`;
  const params = new URLSearchParams({
    token,
    playerId,
    ...(legacyPlaytest ? { playtestId: roomId } : { roomId }),
  });
  return `${origin}${path}?${params.toString()}`;
};

export const createWorkerApp = (manifest: BundledManifest = runtimeManifest): Hono<{ Bindings: Env }> => {
  const app = new Hono<{ Bindings: Env }>();

  app.use("*", async (context, next) => {
    const isWebSocketUpgrade = context.req.raw.headers.get("Upgrade")?.toLowerCase() === "websocket";
    if (context.req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    await next();
    if (isWebSocketUpgrade) {
      return;
    }
    for (const [key, value] of Object.entries(corsHeaders)) {
      context.res.headers.set(key, value);
    }
  });

  app.get("/health", (context) => {
    if (!isHandoffSigningKeyValid(context.env)) {
      return context.json({ status: "unavailable", reason: "HANDOFF_SIGNING_KEY invalid" }, 503);
    }
    return context.json({
      status: "ok",
      version: workerVersion(),
      buildId: workerBuildId(),
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/discover", (context) => context.json(toDiscoverSummary(manifest)));

  app.post("/rooms/create", async (context) => {
    if (!isHandoffSigningKeyValid(context.env)) {
      return context.json({ error: "room service unavailable" }, 503);
    }
    const body = (await context.req.json()) as RoomCreateRequest;
    if (typeof body.mapId !== "string" || body.mapId.length === 0) {
      return context.json({ error: "mapId is required" }, 400);
    }
    const idempotencyKey =
      body.options?.idempotencyKey !== undefined && typeof body.options.idempotencyKey === "string"
        ? body.options.idempotencyKey
        : crypto.randomUUID();
    const roomId = idempotencyKey;
    const stub = context.env.PLAYTEST_ROOM.get(context.env.PLAYTEST_ROOM.idFromName(roomId));
    const initResponse = await stub.fetch(
      new Request(`https://playtest-room/create?roomId=${encodeURIComponent(roomId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mapId: body.mapId,
          ...(body.seed === undefined ? {} : { seed: body.seed }),
          ...(body.options === undefined ? {} : { options: body.options }),
        }),
      }),
    );
    if (!initResponse.ok) {
      return context.json({ error: "failed to initialize room" }, 500);
    }
    const requestUrl = new URL(context.req.url);
    const wsUrl = `${requestUrl.origin}/rooms/${roomId}/connect`;
    const payload: RoomCreateResponse = { roomId, wsUrl };
    return context.json(payload, 201);
  });

  app.get("/rooms/:id/connect", async (context) => {
    const roomId = context.req.param("id");
    const url = new URL(context.req.url);
    const authFailure = await authorizeWebSocketUpgrade(
      context.env,
      roomId,
      url.searchParams.get("token"),
      url.searchParams.get("playerId"),
    );
    if (authFailure) {
      return authFailure;
    }
    const stub = context.env.PLAYTEST_ROOM.get(context.env.PLAYTEST_ROOM.idFromName(roomId));
    url.searchParams.set("roomId", roomId);
    return stub.fetch(new Request(url.toString(), { headers: context.req.raw.headers }));
  });

  app.post("/playtest/start", async (context) => {
    if (!isHandoffSigningKeyValid(context.env)) {
      return context.json({ error: "room service unavailable" }, 503);
    }
    const body = (await context.req.json()) as PlaytestStartRequest;
    if (typeof body.mapId !== "string" || body.mapId.length === 0) {
      return context.json({ error: "mapId is required" }, 400);
    }
    const idempotencyKey =
      body.options?.idempotencyKey !== undefined && typeof body.options.idempotencyKey === "string"
        ? body.options.idempotencyKey
        : undefined;
    const playtestId = idempotencyKey ?? crypto.randomUUID();
    const playerId = typeof body.playerId === "string" && body.playerId.length > 0 ? body.playerId : crypto.randomUUID();
    const stub = context.env.PLAYTEST_ROOM.get(context.env.PLAYTEST_ROOM.idFromName(playtestId));
    const initResponse = await stub.fetch(
      new Request(`https://playtest-room${initPath}?roomId=${encodeURIComponent(playtestId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mapId: body.mapId,
          ...(body.seed === undefined ? {} : { seed: body.seed }),
          ...(body.options === undefined ? {} : { options: body.options }),
        }),
      }),
    );
    if (!initResponse.ok) {
      return context.json({ error: "failed to initialize playtest room" }, 500);
    }
    const handoffToken = await mintHandoffToken(context.env, {
      playtestId,
      playerId,
      ttlSeconds: HANDOFF_TTL_SECONDS,
    });
    const requestUrl = new URL(context.req.url);
    const wsUrl = buildConnectUrl(requestUrl.origin, playtestId, playerId, handoffToken, true);
    const payload: PlaytestStartResponse = { playtestId, wsUrl, handoffToken, playerId };
    return context.json(payload, 201);
  });

  app.get("/playtest/:id", async (context) => {
    const playtestId = context.req.param("id");
    const stub = context.env.PLAYTEST_ROOM.get(context.env.PLAYTEST_ROOM.idFromName(playtestId));
    const summaryResponse = await stub.fetch(
      new Request(`https://playtest-room/?playtestId=${encodeURIComponent(playtestId)}`),
    );
    if (summaryResponse.status === 404) {
      return context.json({ error: "playtest not found" }, 404);
    }
    return summaryResponse;
  });

  app.get("/playtest/:id/ws", async (context) => {
    const playtestId = context.req.param("id");
    const url = new URL(context.req.url);
    const authFailure = await authorizeWebSocketUpgrade(
      context.env,
      playtestId,
      url.searchParams.get("token"),
      url.searchParams.get("playerId"),
    );
    if (authFailure) {
      return authFailure;
    }
    const stub = context.env.PLAYTEST_ROOM.get(context.env.PLAYTEST_ROOM.idFromName(playtestId));
    url.searchParams.set("playtestId", playtestId);
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

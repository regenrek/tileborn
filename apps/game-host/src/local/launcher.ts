import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Miniflare, type Json, type WebSocket as MiniflareWebSocket } from "miniflare";

import { MIN_HANDOFF_SIGNING_KEY_LENGTH } from "../rooms/room-config.js";
import {
  LocalBehaviorWorkerdSupervisor,
  type BehaviorRuntimeProcessEvent,
} from "./behavior-workerd-supervisor.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;

type MiniflareFetchInit = NonNullable<Parameters<Miniflare["dispatchFetch"]>[1]>;
type MiniflareFetchResponse = Awaited<ReturnType<Miniflare["dispatchFetch"]>>;

export interface CreateLocalGameHostOptions {
  readonly port?: number;
  readonly signingKey?: string;
  readonly workerPath?: string;
  readonly behaviorWorkerPath?: string;
  readonly behaviorMaxWallTimeMs?: number;
  readonly behaviorMaxStartupTimeMs?: number;
  readonly behaviorMaxColdStartupTimeMs?: number;
  readonly behaviorMaxDisposeTimeMs?: number;
  readonly observeBehaviorProcess?: (event: BehaviorRuntimeProcessEvent) => void;
  readonly bindings?: Record<string, Json>;
  readonly includeSigningKey?: boolean;
}

export interface LocalGameHost {
  readonly baseUrl: string;
  readonly signingKey: string;
  readonly stop: () => Promise<void>;
  readonly fetch: (
    input: string | URL,
    init?: MiniflareFetchInit,
  ) => Promise<MiniflareFetchResponse>;
  readonly websocketConnect: (
    wsUrl: string,
    hooks?: { readonly beforeAccept?: (socket: MiniflareWebSocket) => void },
  ) => Promise<MiniflareWebSocket>;
  readonly triggerRoomAlarm: (roomId: string) => Promise<void>;
}

export const generateHandoffSigningKey = (): string => randomBytes(32).toString("base64url");

export const resolveBundledGameHostWorkerPath = (): string =>
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "dist", "worker.js");

export const resolveBundledBehaviorWorkerPath = (): string =>
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "dist", "behavior-worker.js");

const assertSigningKey = (signingKey: string): void => {
  if (signingKey.length < MIN_HANDOFF_SIGNING_KEY_LENGTH) {
    throw new Error(`signingKey must be at least ${MIN_HANDOFF_SIGNING_KEY_LENGTH} characters`);
  }
};

export const createLocalGameHost = async (
  options: CreateLocalGameHostOptions = {},
): Promise<LocalGameHost> => {
  const host = DEFAULT_HOST;
  const port = options.port ?? DEFAULT_PORT;
  const includeSigningKey = options.includeSigningKey ?? true;
  const signingKey = includeSigningKey ? (options.signingKey ?? generateHandoffSigningKey()) : "";
  if (includeSigningKey) {
    assertSigningKey(signingKey);
  }
  const workerPath = options.workerPath ?? resolveBundledGameHostWorkerPath();
  const behaviorWorkerPath =
    options.behaviorWorkerPath ?? path.join(path.dirname(workerPath), "behavior-worker.js");
  const behaviorSupervisor = new LocalBehaviorWorkerdSupervisor({
    workerPath: behaviorWorkerPath,
    ...(options.behaviorMaxWallTimeMs === undefined
      ? {}
      : { maxWallTimeMs: options.behaviorMaxWallTimeMs }),
    ...(options.behaviorMaxStartupTimeMs === undefined
      ? {}
      : { maxStartupTimeMs: options.behaviorMaxStartupTimeMs }),
    ...(options.behaviorMaxColdStartupTimeMs === undefined
      ? {}
      : { maxColdStartupTimeMs: options.behaviorMaxColdStartupTimeMs }),
    ...(options.behaviorMaxDisposeTimeMs === undefined
      ? {}
      : { maxDisposeTimeMs: options.behaviorMaxDisposeTimeMs }),
    ...(options.observeBehaviorProcess === undefined
      ? {}
      : { observeProcess: options.observeBehaviorProcess }),
  });
  const baseUrl = `http://${host}:${port}`;

  const mf = new Miniflare({
    host,
    port,
    modules: true,
    scriptPath: workerPath,
    modulesRoot: path.dirname(workerPath),
    compatibilityDate: "2024-12-01",
    compatibilityFlags: ["nodejs_compat"],
    bindings: {
      ...(includeSigningKey ? { HANDOFF_SIGNING_KEY: signingKey } : {}),
      ROOM_IDLE_TIMEOUT_SECONDS: 60,
      ...options.bindings,
    },
    durableObjects: {
      PLAYTEST_ROOM: "PlaytestRoom",
    },
    serviceBindings: {
      BEHAVIOR_RUNTIME: (request: Request) => behaviorSupervisor.fetch(request),
    },
    durableObjectsPersist: false,
  });

  try {
    await Promise.all([
      mf.ready,
      ...(existsSync(behaviorWorkerPath) ? [behaviorSupervisor.warmup()] : []),
    ]);
  } catch (error) {
    await Promise.allSettled([behaviorSupervisor.dispose(), mf.dispose()]);
    throw error;
  }

  const fetch = (
    input: string | URL,
    init?: MiniflareFetchInit,
  ): Promise<MiniflareFetchResponse> => {
    const target =
      typeof input === "string" && input.startsWith("http")
        ? input
        : new URL(input.toString(), baseUrl).toString();
    return mf.dispatchFetch(target, init);
  };

  const websocketConnect = async (
    wsUrl: string,
    hooks?: { readonly beforeAccept?: (socket: MiniflareWebSocket) => void },
  ): Promise<MiniflareWebSocket> => {
    const target = new URL(wsUrl, baseUrl);
    const origin = `${target.protocol}//${target.host}`;
    const response = await mf.dispatchFetch(target.toString(), {
      headers: {
        Upgrade: "websocket",
        Connection: "Upgrade",
        Origin: origin,
      },
    });
    const webSocket = response.webSocket;
    if (!webSocket) {
      throw new Error(`WebSocket upgrade failed for ${target}: status ${response.status}`);
    }
    hooks?.beforeAccept?.(webSocket);
    webSocket.accept();
    return webSocket;
  };

  const triggerRoomAlarm = async (roomId: string): Promise<void> => {
    const namespace = await mf.getDurableObjectNamespace("PLAYTEST_ROOM");
    const id = namespace.idFromName(roomId);
    const stub = namespace.get(id);
    const response = await stub.fetch("http://playtest-room/alarm", { cf: { alarm: true } });
    if (!response.ok) {
      throw new Error(`alarm trigger failed for room ${roomId}: ${response.status}`);
    }
  };

  return {
    baseUrl,
    signingKey,
    stop: async () => {
      await behaviorSupervisor.dispose();
      await mf.dispose();
    },
    fetch,
    websocketConnect,
    triggerRoomAlarm,
  };
};

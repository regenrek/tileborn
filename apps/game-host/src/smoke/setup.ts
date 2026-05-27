import path from "node:path";
import { fileURLToPath } from "node:url";

import type { WebSocket as MiniflareWebSocket } from "miniflare";

import { createLocalGameHost, type LocalGameHost } from "../local/launcher.js";
import { smokeDistDir } from "./build-worker.js";
import { SMOKE_SIGNING_KEY } from "./wire-helpers.js";

export interface BootMiniflareOptions {
  readonly workerPath?: string;
  readonly bindings?: Record<string, import("miniflare").Json>;
  readonly heartbeatTimeoutSeconds?: number;
  readonly includeSigningKey?: boolean;
}

type MiniflareFetchInit = NonNullable<Parameters<LocalGameHost["fetch"]>[1]>;
type MiniflareFetchResponse = Awaited<ReturnType<LocalGameHost["fetch"]>>;

export interface MiniflareHarness {
  readonly fetch: (input: string | URL, init?: MiniflareFetchInit) => Promise<MiniflareFetchResponse>;
  readonly mfDispose: () => Promise<void>;
  readonly websocketConnect: (
    wsUrl: string,
    hooks?: { readonly beforeAccept?: (socket: MiniflareWebSocket) => void },
  ) => Promise<MiniflareWebSocket>;
  readonly triggerRoomAlarm: (roomId: string) => Promise<void>;
  readonly connectAndWaitForClose: (
    wsUrl: string,
    expectedCode: number,
    timeoutMs: number,
  ) => Promise<{ readonly code: number; readonly reason: string }>;
}

const defaultWorkerPath = path.join(smokeDistDir, "worker.js");

export const bootMiniflare = async (opts: BootMiniflareOptions = {}): Promise<MiniflareHarness> => {
  const workerPath = opts.workerPath ?? defaultWorkerPath;
  const includeSigningKey = opts.includeSigningKey ?? true;
  const host = await createLocalGameHost({
    workerPath,
    includeSigningKey,
    ...(includeSigningKey ? { signingKey: SMOKE_SIGNING_KEY } : {}),
    bindings: {
      ...(opts.heartbeatTimeoutSeconds === undefined
        ? {}
        : { HEARTBEAT_TIMEOUT_SECONDS: String(opts.heartbeatTimeoutSeconds) }),
      ...opts.bindings,
    },
  });

  const { fetch, stop, websocketConnect, triggerRoomAlarm } = host;

  return {
    fetch,
    mfDispose: stop,
    websocketConnect,
    triggerRoomAlarm,
    connectAndWaitForClose: async (wsUrl: string, expectedCode: number, timeoutMs: number) =>
      new Promise<{ readonly code: number; readonly reason: string }>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`timed out waiting for WebSocket close code ${expectedCode}`));
        }, timeoutMs);
        void websocketConnect(wsUrl, {
          beforeAccept: (socket) => {
            socket.addEventListener("close", (event) => {
              clearTimeout(timer);
              resolve({ code: event.code, reason: event.reason });
            });
          },
        }).catch(reject);
      }),
  };
};

export const smokePaths = {
  distDir: smokeDistDir,
  workerPath: defaultWorkerPath,
  repoRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.."),
};

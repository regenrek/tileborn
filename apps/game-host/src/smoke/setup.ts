import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { WebSocket as MiniflareWebSocket } from 'miniflare';

import {
  createLocalGameHost,
  type LocalGameHost,
  type RoomReconstructionPayload,
} from '../local/launcher.js';
import { smokeDistDir } from './build-worker.js';
import { SMOKE_SIGNING_KEY } from './wire-helpers.js';

export interface BootMiniflareOptions {
  readonly workerPath?: string;
  readonly bindings?: Record<string, import('miniflare').Json>;
  readonly heartbeatTimeoutSeconds?: number;
  readonly includeSigningKey?: boolean;
}

type MiniflareFetchInit = NonNullable<Parameters<LocalGameHost['fetch']>[1]>;
type MiniflareFetchResponse = Awaited<ReturnType<LocalGameHost['fetch']>>;

export interface MiniflareHarness {
  readonly baseUrl: string;
  readonly fetch: (
    input: string | URL,
    init?: MiniflareFetchInit,
  ) => Promise<MiniflareFetchResponse>;
  readonly mfDispose: () => Promise<void>;
  readonly websocketConnect: (
    wsUrl: string,
    hooks?: { readonly beforeAccept?: (socket: MiniflareWebSocket) => void },
  ) => Promise<MiniflareWebSocket>;
  readonly triggerRoomAlarm: (roomId: string) => Promise<void>;
  readonly forceRoomReconstruction: (
    roomId: string,
    previousConstructionSequence: number,
    wakeRehydratedSockets?: () => void,
  ) => Promise<RoomReconstructionPayload>;
  readonly connectAndWaitForClose: (
    wsUrl: string,
    expectedCode: number,
    timeoutMs: number,
  ) => Promise<{ readonly code: number; readonly reason: string; readonly wasClean: boolean }>;
}

const defaultWorkerPath = path.join(smokeDistDir, 'worker.js');

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

  const { baseUrl, fetch, stop, websocketConnect, triggerRoomAlarm, forceRoomReconstruction } =
    host;

  return {
    baseUrl,
    fetch,
    mfDispose: stop,
    websocketConnect,
    triggerRoomAlarm,
    forceRoomReconstruction,
    connectAndWaitForClose: async (wsUrl: string, expectedCode: number, timeoutMs: number) =>
      new Promise<{ readonly code: number; readonly reason: string; readonly wasClean: boolean }>(
        (resolve, reject) => {
          const timer = setTimeout(() => {
            reject(new Error(`timed out waiting for WebSocket close code ${expectedCode}`));
          }, timeoutMs);
          void websocketConnect(wsUrl, {
            beforeAccept: (socket) => {
              socket.addEventListener('close', (event) => {
                clearTimeout(timer);
                resolve({ code: event.code, reason: event.reason, wasClean: event.wasClean });
              });
            },
          }).catch(reject);
        },
      ),
  };
};

export const smokePaths = {
  distDir: smokeDistDir,
  workerPath: defaultWorkerPath,
  repoRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..'),
};

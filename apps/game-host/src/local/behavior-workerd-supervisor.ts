import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import {
  decodeWorkerdBehaviorResponse,
  type WorkerdBehaviorFailureResponse,
} from '../behavior/workerd/protocol.js';
import {
  nodeProcessTreePlatform,
  terminateProcessTree,
  waitForProcessTreeExit,
  type ProcessTreePlatformAdapter,
} from './process-tree.js';

const DEFAULT_DISPOSE_TIME_MS = 1_000;
const DEFAULT_STARTUP_TIME_MS = 20_000;
const DEFAULT_COLD_STARTUP_TIME_MS = 30_000;
const FORCE_KILL_EXIT_TIME_MS = 1_000;

// Anchor external runtime resolution to this module, not the caller's cwd.
// In the packaged Electron CJS chunk this becomes Resources/app/.vite/build,
// so the sidecar can only resolve the closure deployed under app/node_modules.
const runtimeRequire = createRequire(import.meta.url);
const resolveRuntimeModuleUrl = (specifier: string): string =>
  pathToFileURL(runtimeRequire.resolve(specifier)).href;

const failureResponse = (failure: Omit<WorkerdBehaviorFailureResponse, 'ok'>): Response =>
  new Response(
    JSON.stringify({
      ok: false,
      ...failure,
    }),
    { status: 503, headers: { 'content-type': 'application/json' } },
  );

interface SerializedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: readonly number[];
}

interface SerializedResponse {
  readonly status: number;
  readonly statusText: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: readonly number[];
}

type SidecarRequest =
  | { readonly type: 'fetch'; readonly id: number; readonly request: SerializedRequest }
  | { readonly type: 'dispose' };

type SidecarResponse =
  | { readonly type: 'ready' }
  | { readonly type: 'response'; readonly id: number; readonly response: SerializedResponse }
  | { readonly type: 'error'; readonly id?: number; readonly message: string };

export interface LocalBehaviorRuntimeInstance {
  readonly ready: Promise<void>;
  readonly processId?: number;
  readonly exited: Promise<void>;
  dispatch(request: Request): Promise<Response>;
  dispose(): Promise<void>;
  forceKill(): Promise<void>;
}

export interface BehaviorRuntimeProcessEvent {
  readonly processId: number;
  readonly phase: 'spawned' | 'exited';
}

export interface LocalBehaviorWorkerdSupervisorOptions {
  readonly workerPath: string;
  readonly maxWallTimeMs?: number;
  readonly maxStartupTimeMs?: number;
  readonly maxColdStartupTimeMs?: number;
  readonly maxDisposeTimeMs?: number;
  /** Runtime seam used by deadline regressions; production always uses the process sidecar. */
  readonly createRuntime?: (workerPath: string) => LocalBehaviorRuntimeInstance;
  /** Observability seam for proving that every spawned sidecar process group exits. */
  readonly observeProcess?: (event: BehaviorRuntimeProcessEvent) => void;
  readonly processTreePlatform?: ProcessTreePlatformAdapter;
}

const sidecarSource = String.raw`
import { spawn } from 'node:child_process';
import path from 'node:path';

const workerPath = process.env.TILEBORNE_BEHAVIOR_WORKER_PATH;
if (!workerPath) throw new Error('TILEBORNE_BEHAVIOR_WORKER_PATH is required');
const miniflareUrl = process.env.TILEBORNE_MINIFLARE_URL;
if (!miniflareUrl) throw new Error('TILEBORNE_MINIFLARE_URL is required');
const { Miniflare } = await import(miniflareUrl);

const runtime = new Miniflare({
  host: '127.0.0.1',
  port: 0,
  modules: true,
  scriptPath: workerPath,
  modulesRoot: path.dirname(workerPath),
  compatibilityDate: '2024-12-01',
});

const send = (message) => {
  if (process.connected) process.send(message);
};

runtime.ready.then(
  () => send({ type: 'ready' }),
  (error) => send({ type: 'error', message: error instanceof Error ? error.message : String(error) }),
);

process.on('message', (message) => {
  if (message?.type === 'fetch') {
    void (async () => {
      try {
        const body = message.request.body === undefined
          ? undefined
          : Uint8Array.from(message.request.body);
        const response = await runtime.dispatchFetch(message.request.url, {
          method: message.request.method,
          headers: message.request.headers,
          ...(body === undefined ? {} : { body }),
        });
        send({
          type: 'response',
          id: message.id,
          response: {
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers),
            body: Array.from(new Uint8Array(await response.arrayBuffer())),
          },
        });
      } catch (error) {
        send({
          type: 'error',
          id: message.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    })();
    return;
  }
  if (message?.type === 'dispose') {
    void runtime.dispose().finally(() => process.exit(0));
  }
});

// A detached sidecar must never outlive its owner. Killing our process group
// also terminates Miniflare's workerd grandchild if the parent disappears.
process.on('disconnect', () => {
  if (process.platform === 'win32') {
    const killer = spawn(
      'taskkill.exe',
      ['/PID', String(process.pid), '/T', '/F'],
      { shell: false, detached: true, windowsHide: true, stdio: 'ignore' },
    );
    killer.unref();
  } else {
    process.kill(-process.pid, 'SIGKILL');
  }
});
`;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isStringRecord = (value: unknown): value is Readonly<Record<string, string>> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every((entry) => typeof entry === 'string');

const decodeSidecarResponse = (value: unknown): SidecarResponse | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Readonly<Record<string, unknown>>;
  if (candidate.type === 'ready') return { type: 'ready' };
  if (
    candidate.type === 'error' &&
    typeof candidate.message === 'string' &&
    (candidate.id === undefined ||
      (Number.isSafeInteger(candidate.id) && (candidate.id as number) > 0))
  ) {
    return {
      type: 'error',
      message: candidate.message,
      ...(candidate.id === undefined ? {} : { id: candidate.id as number }),
    };
  }
  if (
    candidate.type !== 'response' ||
    !Number.isSafeInteger(candidate.id) ||
    (candidate.id as number) <= 0 ||
    typeof candidate.response !== 'object' ||
    candidate.response === null ||
    Array.isArray(candidate.response)
  ) {
    return undefined;
  }
  const response = candidate.response as Readonly<Record<string, unknown>>;
  if (
    !Number.isInteger(response.status) ||
    (response.status as number) < 100 ||
    (response.status as number) > 599 ||
    typeof response.statusText !== 'string' ||
    !isStringRecord(response.headers) ||
    !Array.isArray(response.body) ||
    !response.body.every(
      (byte) => Number.isInteger(byte) && (byte as number) >= 0 && (byte as number) <= 255,
    )
  ) {
    return undefined;
  }
  return {
    type: 'response',
    id: candidate.id as number,
    response: {
      status: response.status as number,
      statusText: response.statusText,
      headers: response.headers,
      body: response.body as readonly number[],
    },
  };
};

class SidecarBehaviorRuntime implements LocalBehaviorRuntimeInstance {
  readonly #child: ChildProcess;
  readonly #pending = new Map<
    number,
    { readonly resolve: (response: Response) => void; readonly reject: (error: Error) => void }
  >();
  readonly #observeProcess: ((event: BehaviorRuntimeProcessEvent) => void) | undefined;
  readonly #processTreePlatform: ProcessTreePlatformAdapter;
  readonly ready: Promise<void>;
  readonly processId: number;
  readonly exited: Promise<void>;
  #nextRequestId = 1;
  #settled = false;
  #stderr = '';

  constructor(
    workerPath: string,
    observeProcess?: (event: BehaviorRuntimeProcessEvent) => void,
    processTreePlatform: ProcessTreePlatformAdapter = nodeProcessTreePlatform,
  ) {
    let resolveReady: () => void = () => undefined;
    let rejectReady: (error: Error) => void = () => undefined;
    this.ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    this.#observeProcess = observeProcess;
    this.#processTreePlatform = processTreePlatform;
    this.#child = spawn(
      process.execPath,
      ['--input-type=module', '--eval', sidecarSource, '--', 'tileborne-behavior-sidecar'],
      {
        cwd: process.cwd(),
        detached: process.platform !== 'win32',
        env: {
          ...process.env,
          ...(process.versions.electron === undefined ? {} : { ELECTRON_RUN_AS_NODE: '1' }),
          TILEBORNE_BEHAVIOR_WORKER_PATH: workerPath,
          TILEBORNE_MINIFLARE_URL: resolveRuntimeModuleUrl('miniflare'),
        },
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      },
    );
    if (this.#child.pid === undefined) throw new Error('behavior sidecar did not expose a pid');
    this.processId = this.#child.pid;
    this.#observeProcess?.({ processId: this.processId, phase: 'spawned' });
    this.#child.stderr?.on('data', (chunk: Buffer | string) => {
      this.#stderr = `${this.#stderr}${String(chunk)}`.slice(-4_096);
    });
    this.exited = new Promise<void>((resolve) => {
      this.#child.once('exit', () => {
        this.#settled = true;
        const detail = this.#stderr.trim();
        const error = new Error(
          detail.length === 0 ? 'behavior sidecar exited' : `behavior sidecar exited: ${detail}`,
        );
        rejectReady(error);
        for (const pending of this.#pending.values()) pending.reject(error);
        this.#pending.clear();
        void waitForProcessTreeExit(this.processId, this.#processTreePlatform).then(() => {
          this.#observeProcess?.({ processId: this.processId, phase: 'exited' });
          resolve();
        });
      });
    });
    this.#child.once('error', (error) => rejectReady(error));
    this.#child.on('message', (candidate: unknown) => {
      const message = decodeSidecarResponse(candidate);
      if (message === undefined) {
        const error = new Error('invalid behavior sidecar IPC response envelope');
        rejectReady(error);
        for (const pending of this.#pending.values()) pending.reject(error);
        this.#pending.clear();
        return;
      }
      if (message.type === 'ready') {
        resolveReady();
        return;
      }
      if (message.type === 'response') {
        const pending = this.#pending.get(message.id);
        if (pending === undefined) return;
        this.#pending.delete(message.id);
        pending.resolve(
          new Response(Uint8Array.from(message.response.body), {
            status: message.response.status,
            statusText: message.response.statusText,
            headers: message.response.headers,
          }),
        );
        return;
      }
      if (message.type === 'error') {
        const error = new Error(message.message);
        if (message.id === undefined) {
          rejectReady(error);
          return;
        }
        const pending = this.#pending.get(message.id);
        this.#pending.delete(message.id);
        pending?.reject(error);
      }
    });
  }

  async dispatch(request: Request): Promise<Response> {
    if (this.#settled || !this.#child.connected) throw new Error('behavior sidecar is unavailable');
    const body = request.body === null ? undefined : new Uint8Array(await request.arrayBuffer());
    const id = this.#nextRequestId++;
    const result = new Promise<Response>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
    });
    const message: SidecarRequest = {
      type: 'fetch',
      id,
      request: {
        url: request.url,
        method: request.method,
        headers: Object.fromEntries(request.headers),
        ...(body === undefined ? {} : { body: Array.from(body) }),
      },
    };
    this.#send(message, id);
    return result;
  }

  async dispose(): Promise<void> {
    if (this.#settled) return;
    this.#send({ type: 'dispose' });
    await this.exited;
  }

  async forceKill(): Promise<void> {
    if (this.#settled) return;
    await terminateProcessTree(this.processId, this.#processTreePlatform);
  }

  #send(message: SidecarRequest, requestId?: number): void {
    this.#child.send(message, (error) => {
      if (error === null || error === undefined || requestId === undefined) return;
      const pending = this.#pending.get(requestId);
      this.#pending.delete(requestId);
      pending?.reject(error);
    });
  }
}

interface RuntimeSlot {
  readonly runtime: LocalBehaviorRuntimeInstance;
  readonly cold: boolean;
}

/**
 * Owns a dedicated, independently killable process group for local behavior
 * execution. Restart cleanup is never on the request critical path: a wedged
 * process is detached immediately and a clean sidecar restores the snapshot
 * carried by the next RPC request. Each retirement has a finite upper bound of
 * maxDisposeTimeMs + three FORCE_KILL_EXIT_TIME_MS windows: initial kill,
 * process-tree exit observation, and the fallback kill attempt.
 */
export class LocalBehaviorWorkerdSupervisor {
  readonly #workerPath: string;
  readonly #maxWallTimeMs: number;
  readonly #maxStartupTimeMs: number;
  readonly #maxColdStartupTimeMs: number;
  readonly #maxDisposeTimeMs: number;
  readonly #createRuntime: (workerPath: string) => LocalBehaviorRuntimeInstance;
  readonly #retirements = new Set<Promise<void>>();
  readonly #retirementErrors: unknown[] = [];
  #instance: RuntimeSlot | undefined;
  #disposed = false;
  #disposePromise: Promise<void> | undefined;
  #bootCount = 0;

  constructor(options: LocalBehaviorWorkerdSupervisorOptions) {
    this.#workerPath = options.workerPath;
    this.#maxWallTimeMs = options.maxWallTimeMs ?? 250;
    this.#maxStartupTimeMs = options.maxStartupTimeMs ?? DEFAULT_STARTUP_TIME_MS;
    this.#maxColdStartupTimeMs =
      options.maxColdStartupTimeMs ?? DEFAULT_COLD_STARTUP_TIME_MS;
    this.#maxDisposeTimeMs = options.maxDisposeTimeMs ?? DEFAULT_DISPOSE_TIME_MS;
    this.#createRuntime =
      options.createRuntime ??
      ((workerPath) =>
        new SidecarBehaviorRuntime(
          workerPath,
          options.observeProcess,
          options.processTreePlatform,
        ));
  }

  /** Complete the one cold boot before gameplay starts. */
  async warmup(): Promise<void> {
    if (this.#disposed) throw new Error('behavior workerd supervisor is disposed');
    const ready = await this.#awaitReady(this.#getInstance());
    if (ready instanceof Response) {
      const failure = (await ready.json()) as WorkerdBehaviorFailureResponse;
      throw new Error(`${failure.code}: ${failure.message}`);
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (this.#disposed) {
      return failureResponse({
        code: 'TBRUNTIME3204',
        message: 'behavior workerd supervisor is disposed',
        retryable: false,
        stage: 'ipc',
      });
    }
    const instance = this.#getInstance();
    const ready = await this.#awaitReady(instance);
    if (ready instanceof Response) return ready;
    const response = await this.#withTimeout(
      instance.runtime.dispatch(request),
      instance,
      this.#maxWallTimeMs,
      {
        code: 'TBRUNTIME3204',
        message: `behavior workerd exceeded the hard ${this.#maxWallTimeMs}ms wall-time budget`,
        retryable: false,
        stage: 'dispatch',
      },
    );
    if (!(response instanceof Response)) {
      this.#scheduleRestart(instance);
      return failureResponse({
        code: 'TBRUNTIME3205',
        message: 'behavior workerd returned no dispatch response',
        retryable: true,
        stage: 'response-validation',
      });
    }
    const decoded = decodeWorkerdBehaviorResponse(
      await response.clone().json().catch(() => undefined),
    );
    if (decoded.ok) return response;
    this.#scheduleRestart(instance);
    return failureResponse({
      code: decoded.code,
      message: decoded.message,
      retryable: true,
      stage: 'response-validation',
    });
  }

  #awaitReady(instance: RuntimeSlot): Promise<Response | void> {
    const budgetMs = instance.cold ? this.#maxColdStartupTimeMs : this.#maxStartupTimeMs;
    return this.#withTimeout(instance.runtime.ready, instance, budgetMs, {
      code: 'TBRUNTIME3204',
      message: `behavior workerd exceeded the hard ${budgetMs}ms ${instance.cold ? 'cold ' : ''}startup budget`,
      retryable: true,
      stage: 'startup',
    });
  }

  async #withTimeout<T extends void | Response>(
    operation: Promise<T>,
    instance: RuntimeSlot,
    budgetMs: number,
    failure: Omit<WorkerdBehaviorFailureResponse, 'ok'>,
  ): Promise<Response | T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<Response>((resolve) => {
          timeout = setTimeout(() => {
            this.#scheduleRestart(instance);
            resolve(failureResponse(failure));
          }, budgetMs);
        }),
      ]);
    } catch (error) {
      this.#scheduleRestart(instance);
      return failureResponse({
        code: 'TBRUNTIME3204',
        message: `behavior workerd failed and was replaced: ${errorMessage(error)}`,
        ...(failure.retryable === undefined ? {} : { retryable: failure.retryable }),
        ...(failure.stage === undefined ? {} : { stage: failure.stage }),
      });
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }

  dispose(): Promise<void> {
    this.#disposePromise ??= this.#disposeAll();
    return this.#disposePromise;
  }

  async #disposeAll(): Promise<void> {
    this.#disposed = true;
    const pending = this.#instance;
    this.#instance = undefined;
    if (pending !== undefined) this.#startRetirement(pending);
    while (this.#retirements.size > 0) {
      await Promise.all(this.#retirements);
    }
    if (this.#retirementErrors.length > 0) {
      throw new AggregateError(
        this.#retirementErrors,
        'one or more behavior sidecar process groups failed bounded shutdown',
      );
    }
  }

  #getInstance(): RuntimeSlot {
    if (this.#disposed) throw new Error('behavior workerd supervisor is disposed');
    this.#instance ??= {
      runtime: this.#createRuntime(this.#workerPath),
      cold: this.#bootCount++ === 0,
    };
    return this.#instance;
  }

  #scheduleRestart(instance: RuntimeSlot): void {
    if (this.#instance !== instance) return;
    // Detach first. New fetches can boot a replacement without observing or
    // awaiting cleanup of the stale process.
    this.#instance = undefined;
    this.#startRetirement(instance);
  }

  #startRetirement(instance: RuntimeSlot): void {
    const retirement = this.#retire(instance).catch((error: unknown) => {
      this.#retirementErrors.push(error);
    });
    this.#retirements.add(retirement);
    void retirement.finally(() => this.#retirements.delete(retirement));
  }

  async #retire(instance: RuntimeSlot): Promise<void> {
    let disposeDeadline: ReturnType<typeof setTimeout> | undefined;
    const disposeTimedOut = new Promise<boolean>((resolve) => {
      disposeDeadline = setTimeout(() => resolve(true), this.#maxDisposeTimeMs);
    });
    let timedOut: boolean;
    try {
      timedOut = await Promise.race([
        Promise.resolve()
          .then(async () => await instance.runtime.dispose())
          .then(
            () => false,
            () => false,
          ),
        disposeTimedOut,
      ]);
    } finally {
      if (disposeDeadline !== undefined) clearTimeout(disposeDeadline);
    }
    if (!timedOut) return;

    const killed = await this.#forceKillWithinDeadline(instance.runtime);
    if (!killed) {
      throw new Error(
        `behavior sidecar process-tree termination exceeded ${FORCE_KILL_EXIT_TIME_MS}ms`,
      );
    }
    let exitDeadline: ReturnType<typeof setTimeout> | undefined;
    let exited: boolean;
    try {
      exited = await Promise.race([
        instance.runtime.exited.then(() => true),
        new Promise<boolean>((resolve) => {
          exitDeadline = setTimeout(() => resolve(false), FORCE_KILL_EXIT_TIME_MS);
        }),
      ]);
    } finally {
      if (exitDeadline !== undefined) clearTimeout(exitDeadline);
    }
    if (!exited) {
      const retryKilled = await this.#forceKillWithinDeadline(instance.runtime);
      if (!retryKilled) {
        throw new Error(
          `behavior sidecar process tree did not exit within ${FORCE_KILL_EXIT_TIME_MS}ms and fallback termination exceeded ${FORCE_KILL_EXIT_TIME_MS}ms; the process tree may still be alive`,
        );
      }
      throw new Error(
        `behavior sidecar process tree did not exit within ${FORCE_KILL_EXIT_TIME_MS}ms after termination`,
      );
    }
  }

  async #forceKillWithinDeadline(runtime: LocalBehaviorRuntimeInstance): Promise<boolean> {
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        runtime.forceKill().then(() => true),
        new Promise<boolean>((resolve) => {
          deadline = setTimeout(() => resolve(false), FORCE_KILL_EXIT_TIME_MS);
        }),
      ]);
    } finally {
      if (deadline !== undefined) clearTimeout(deadline);
    }
  }
}

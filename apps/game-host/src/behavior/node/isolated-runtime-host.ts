import { existsSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

import type { BehaviorId } from '@tileborne/core';
import {
  BehaviorWorkerSupervisor,
  type BehaviorRuntimeBudgets,
  type BehaviorSchedulerSnapshot,
  type BehaviorWorkerLike,
  type BehaviorWorkerRequest,
  type BehaviorWorkerResponse,
  type RuntimeBehaviorArtifactIdentity,
} from '@tileborne/runtime/behavior';

export type IsolatedBehaviorArtifact = RuntimeBehaviorArtifactIdentity & {
  readonly code: string;
};

export interface NodeBehaviorRuntimeHostOptions {
  readonly maxWallTimeMs?: number;
  readonly maxStartupTimeMs?: number;
  readonly maxOldGenerationSizeMb?: number;
  readonly maxYoungGenerationSizeMb?: number;
  readonly stackSizeMb?: number;
  readonly budgets?: Partial<BehaviorRuntimeBudgets>;
  readonly capabilities?: ReadonlyArray<string>;
  readonly seed?: string;
  readonly ticksPerSecond?: number;
  readonly workerUrl?: URL;
}

type WorkerListener = (event: MessageEvent | ErrorEvent) => void;

class NodeWorkerAdapter implements BehaviorWorkerLike {
  readonly #worker: Worker;
  readonly #messageListeners = new Map<WorkerListener, (value: unknown) => void>();
  readonly #errorListeners = new Map<WorkerListener, (error: Error) => void>();
  #terminated = false;

  constructor(worker: Worker) {
    this.#worker = worker;
    worker.on('exit', (code) => {
      if (code === 0 || this.#terminated) return;
      for (const listener of this.#errorListeners.values()) {
        listener(new Error(`behavior worker exited with code ${code}`));
      }
    });
  }

  postMessage(message: unknown): void {
    this.#worker.postMessage(message);
  }

  async terminate(): Promise<void> {
    this.#terminated = true;
    await this.#worker.terminate();
  }

  addEventListener(type: 'message' | 'error', listener: WorkerListener): void {
    if (type === 'message') {
      const wrapped = (value: unknown): void => listener({ data: value } as MessageEvent);
      this.#messageListeners.set(listener, wrapped);
      this.#worker.on('message', wrapped);
      return;
    }
    const wrapped = (error: Error): void => listener({ message: error.message } as ErrorEvent);
    this.#errorListeners.set(listener, wrapped);
    this.#worker.on('error', wrapped);
  }

  removeEventListener(type: 'message' | 'error', listener: WorkerListener): void {
    if (type === 'message') {
      const wrapped = this.#messageListeners.get(listener);
      if (wrapped) this.#worker.off('message', wrapped);
      this.#messageListeners.delete(listener);
      return;
    }
    const wrapped = this.#errorListeners.get(listener);
    if (wrapped) this.#worker.off('error', wrapped);
    this.#errorListeners.delete(listener);
  }
}

const workerEntryUrl = (): URL => {
  const adjacent = new URL('./node-worker-entry.js', import.meta.url);
  // Electron's Vite build embeds this worker as a data URL. Only filesystem
  // URLs can be probed with fileURLToPath; Worker accepts the embedded URL
  // directly and keeps the packaged desktop runtime checkout-independent.
  if (adjacent.protocol !== 'file:') return adjacent;
  return existsSync(fileURLToPath(adjacent))
    ? adjacent
    : new URL('../../../dist/behavior/node/node-worker-entry.js', import.meta.url);
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export class NodeIsolatedBehaviorRuntimeHost {
  readonly #supervisor: BehaviorWorkerSupervisor;
  readonly #maxStartupTimeMs: number;
  readonly #lastKnownGood = new Map<BehaviorId, IsolatedBehaviorArtifact>();
  #lastSnapshot: BehaviorSchedulerSnapshot = { tick: 0, states: [] };
  #requiresRestore = false;
  #requestSequence = 0;
  #tail: Promise<void> = Promise.resolve();

  constructor(options: NodeBehaviorRuntimeHostOptions = {}) {
    const url = options.workerUrl ?? workerEntryUrl();
    // Loading includes cold worker bootstrap. Keep that budget separate from
    // the much tighter per-dispatch wall-time limit so a busy host cannot
    // misclassify a valid last-known-good module as runaway user code.
    this.#maxStartupTimeMs = options.maxStartupTimeMs ?? 10_000;
    const makeWorker = (): BehaviorWorkerLike =>
      new NodeWorkerAdapter(
        new Worker(url, {
          execArgv: ['--experimental-vm-modules'],
          resourceLimits: {
            maxOldGenerationSizeMb: options.maxOldGenerationSizeMb ?? 32,
            maxYoungGenerationSizeMb: options.maxYoungGenerationSizeMb ?? 8,
            stackSizeMb: options.stackSizeMb ?? 4,
          },
          workerData: {
            ...(options.budgets ? { budgets: options.budgets } : {}),
            ...(options.capabilities ? { capabilities: options.capabilities } : {}),
            ...(options.seed ? { seed: options.seed } : {}),
            ...(options.ticksPerSecond ? { ticksPerSecond: options.ticksPerSecond } : {}),
          },
        }),
      );
    this.#supervisor = new BehaviorWorkerSupervisor(makeWorker, options.maxWallTimeMs ?? 250);
  }

  load(module: IsolatedBehaviorArtifact): Promise<BehaviorWorkerResponse> {
    return this.#exclusive(async () => {
      const response = await this.#request('load', { artifact: module, code: module.code });
      if (response.ok) this.#lastKnownGood.set(module.behaviorId, module);
      return response;
    });
  }

  hotReload(module: IsolatedBehaviorArtifact): Promise<BehaviorWorkerResponse> {
    return this.#exclusive(async () => {
      const response = await this.#request('hot-reload', { artifact: module, code: module.code });
      if (response.ok) this.#lastKnownGood.set(module.behaviorId, module);
      return response;
    });
  }

  dispatch(input: {
    readonly eventId: string;
    readonly event: Readonly<Record<string, unknown>>;
    readonly targetBehaviorId?: BehaviorId;
  }): Promise<BehaviorWorkerResponse> {
    return this.#exclusive(() => this.#request('dispatch', input));
  }

  advanceTo(tick: number): Promise<BehaviorWorkerResponse> {
    return this.#exclusive(() => this.#request('advance', { tick }));
  }

  cancel(behaviorId: BehaviorId): Promise<BehaviorWorkerResponse> {
    return this.#exclusive(() => this.#request('cancel', { behaviorId }));
  }

  dispose(): Promise<void> {
    return this.#exclusive(() => this.#supervisor.dispose());
  }

  #exclusive<Value>(operation: () => Promise<Value>): Promise<Value> {
    const result = this.#tail.then(operation, operation);
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async #request(
    operation: BehaviorWorkerRequest['operation'],
    payload: unknown,
  ): Promise<BehaviorWorkerResponse> {
    if (this.#requiresRestore) await this.#restoreLastKnownGood();
    const response = await this.#supervisor.request({
      requestId: `behavior-request-${this.#requestSequence++}`,
      operation,
      payload,
      ...(operation === 'load' || operation === 'hot-reload'
        ? { timeoutMs: this.#maxStartupTimeMs }
        : {}),
    });
    if (response.ok) this.#captureSnapshot(response.value);
    else if (
      response.diagnostic.code === 'TBRUNTIME3101' ||
      response.diagnostic.code === 'TBRUNTIME3102'
    ) {
      this.#requiresRestore = true;
    }
    return response;
  }

  async #restoreLastKnownGood(): Promise<void> {
    const snapshot = this.#lastSnapshot;
    for (const module of [...this.#lastKnownGood.values()].sort((left, right) =>
      String(left.behaviorId).localeCompare(String(right.behaviorId)),
    )) {
      const response = await this.#supervisor.request({
        requestId: `behavior-restore-module-${this.#requestSequence++}`,
        operation: 'load',
        payload: { artifact: module, code: module.code },
        timeoutMs: this.#maxStartupTimeMs,
      });
      if (!response.ok) {
        throw new Error(`failed to restore ${module.behaviorId}: ${response.diagnostic.message}`);
      }
    }
    const restored = await this.#supervisor.request({
      requestId: `behavior-restore-state-${this.#requestSequence++}`,
      operation: 'restore-state',
      payload: snapshot,
      timeoutMs: this.#maxStartupTimeMs,
    });
    if (!restored.ok)
      throw new Error(`failed to restore behavior state: ${restored.diagnostic.message}`);
    this.#captureSnapshot(restored.value);
    this.#requiresRestore = false;
  }

  #captureSnapshot(value: unknown): void {
    if (!isRecord(value) || !isRecord(value.snapshot)) return;
    const snapshot = value.snapshot;
    if (!Number.isSafeInteger(snapshot.tick) || !Array.isArray(snapshot.states)) return;
    this.#lastSnapshot = snapshot as unknown as BehaviorSchedulerSnapshot;
  }
}

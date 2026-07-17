import type { BehaviorRuntimeDiagnostic } from './types.js';

export interface BehaviorWorkerLike {
  postMessage(message: unknown): void;
  terminate(): void | Promise<void>;
  addEventListener(
    type: 'message' | 'error',
    listener: (event: MessageEvent | ErrorEvent) => void,
  ): void;
  removeEventListener(
    type: 'message' | 'error',
    listener: (event: MessageEvent | ErrorEvent) => void,
  ): void;
}

export interface BehaviorWorkerRequest {
  readonly requestId: string;
  readonly timeoutMs?: number;
  readonly operation:
    | 'load'
    | 'dispatch'
    | 'advance'
    | 'hot-reload'
    | 'cancel'
    | 'snapshot'
    | 'restore-state';
  readonly payload: unknown;
}

export type BehaviorWorkerResponse =
  | { readonly requestId: string; readonly ok: true; readonly value: unknown }
  | {
      readonly requestId: string;
      readonly ok: false;
      readonly diagnostic: BehaviorRuntimeDiagnostic;
    };

/**
 * The outer host owns hard CPU/wall-time isolation. A synchronous infinite loop
 * inside gameplay code can only be stopped by terminating its dedicated worker.
 */
export class BehaviorWorkerSupervisor {
  readonly #factory: () => BehaviorWorkerLike;
  readonly #maxWallTimeMs: number;
  #worker: BehaviorWorkerLike;

  constructor(factory: () => BehaviorWorkerLike, maxWallTimeMs = 25) {
    this.#factory = factory;
    this.#maxWallTimeMs = maxWallTimeMs;
    this.#worker = factory();
  }

  async request(request: BehaviorWorkerRequest): Promise<BehaviorWorkerResponse> {
    return await new Promise((resolve) => {
      let settled = false;
      const finish = (response: BehaviorWorkerResponse): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.#worker.removeEventListener('message', onMessage);
        this.#worker.removeEventListener('error', onError);
        resolve(response);
      };
      const onMessage = (event: MessageEvent | ErrorEvent): void => {
        if (!('data' in event)) return;
        const response = event.data as BehaviorWorkerResponse;
        if (response.requestId === request.requestId) finish(response);
      };
      const onError = (event: MessageEvent | ErrorEvent): void => {
        const message = 'message' in event ? event.message : 'behavior worker failed';
        const failedWorker = this.#worker;
        failedWorker.removeEventListener('message', onMessage);
        failedWorker.removeEventListener('error', onError);
        void failedWorker.terminate();
        this.#worker = this.#factory();
        finish({
          requestId: request.requestId,
          ok: false,
          diagnostic: {
            code: 'TBRUNTIME3102',
            severity: 'error',
            message,
            suggestion:
              'Inspect the mapped gameplay source; last-known-good modules/state will be restored in the replacement worker.',
          },
        });
      };
      const wallTimeMs = request.timeoutMs ?? this.#maxWallTimeMs;
      const timeout = setTimeout(() => {
        const timedOutWorker = this.#worker;
        timedOutWorker.removeEventListener('message', onMessage);
        timedOutWorker.removeEventListener('error', onError);
        void timedOutWorker.terminate();
        this.#worker = this.#factory();
        finish({
          requestId: request.requestId,
          ok: false,
          diagnostic: {
            code: 'TBRUNTIME3101',
            severity: 'error',
            message: `Behavior worker exceeded the hard ${wallTimeMs}ms wall-time budget and was terminated.`,
            suggestion:
              'Remove unbounded synchronous work; last-known-good modules/state will be restored in the replacement worker.',
          },
        });
      }, wallTimeMs);
      this.#worker.addEventListener('message', onMessage);
      this.#worker.addEventListener('error', onError);
      this.#worker.postMessage(request);
    });
  }

  async dispose(): Promise<void> {
    await this.#worker.terminate();
  }
}

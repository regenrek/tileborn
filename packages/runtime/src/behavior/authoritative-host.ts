import type { BehaviorId } from '@tileborne/core';

import { loadBehaviorModuleNamespace } from './loader.js';
import {
  DeterministicBehaviorScheduler,
  type BehaviorRuntimeBudgets,
  type BehaviorSchedulerOptions,
} from './scheduler.js';
import type {
  BehaviorExecutionTrace,
  BehaviorRuntimeDiagnostic,
  BehaviorSchedulerSnapshot,
  RuntimeBehaviorArtifactIdentity,
} from './types.js';

/** A statically imported compiled module owned by an authoritative game worker. */
export interface PackagedBehaviorModule {
  readonly artifact: RuntimeBehaviorArtifactIdentity;
  readonly code: string;
  readonly namespace: Readonly<Record<string, unknown>>;
}

export interface AuthoritativeBehaviorRuntimeHostOptions extends Pick<
  BehaviorSchedulerOptions,
  'seed' | 'ticksPerSecond' | 'capabilities' | 'queries' | 'now' | 'onDiagnostic' | 'onCommand'
> {
  readonly budgets?: Partial<BehaviorRuntimeBudgets>;
}

/**
 * Platform-neutral behavior executor for an already isolated authoritative game worker.
 * Platform adapters must place this host inside an isolate that does not own
 * the authoritative room. Node uses worker_threads; workerd uses a dedicated
 * service-bound worker.
 */
export class AuthoritativeBehaviorRuntimeHost {
  readonly #scheduler: DeterministicBehaviorScheduler;

  constructor(options: AuthoritativeBehaviorRuntimeHostOptions = {}) {
    this.#scheduler = new DeterministicBehaviorScheduler(options);
  }

  get diagnostics(): ReadonlyArray<BehaviorRuntimeDiagnostic> {
    return this.#scheduler.diagnostics;
  }

  get snapshot(): BehaviorSchedulerSnapshot {
    return this.#scheduler.snapshot();
  }

  restore(snapshot: BehaviorSchedulerSnapshot): boolean {
    return this.#scheduler.restore(snapshot);
  }

  load(packaged: PackagedBehaviorModule): boolean {
    const result = loadBehaviorModuleNamespace({
      artifact: packaged.artifact,
      code: packaged.code,
      namespace: packaged.namespace,
    });
    return result.ok && this.#scheduler.register(result.loaded);
  }

  loadAll(modules: ReadonlyArray<PackagedBehaviorModule>): boolean {
    return [...modules]
      .sort((left, right) =>
        String(left.artifact.behaviorId).localeCompare(String(right.artifact.behaviorId)),
      )
      .every((module) => this.load(module));
  }

  dispatch(
    eventId: string,
    event: Readonly<Record<string, unknown>>,
    targetBehaviorId?: BehaviorId,
  ): Promise<ReadonlyArray<BehaviorExecutionTrace>> {
    return this.#scheduler.dispatch(eventId, event, {
      ...(targetBehaviorId === undefined ? {} : { targetBehaviorId }),
    });
  }

  async advanceTo(tick: number): Promise<ReadonlyArray<BehaviorExecutionTrace>> {
    return await this.#scheduler.advanceTo(tick);
  }

  async step(tick: number): Promise<ReadonlyArray<BehaviorExecutionTrace>> {
    const timerTraces = await this.advanceTo(tick);
    const eventTraces = await this.dispatch('runtime.tick', { tick });
    return [...timerTraces, ...eventTraces];
  }

  cancel(behaviorId: BehaviorId): void {
    this.#scheduler.cancelBehavior(behaviorId);
  }
}

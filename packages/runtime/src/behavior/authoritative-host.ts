import type { BehaviorId } from '@tileborne/core';

import { loadBehaviorModuleNamespace } from './loader.js';
import {
  DeterministicBehaviorScheduler,
  type BehaviorRuntimeBudgets,
  type BehaviorSchedulerOptions,
} from './scheduler.js';
import {
  dispatchRuntimeShellAction,
  runtimeShellActionById,
  SHELL_BEHAVIOR_EVENT_ENTRY_ID,
  SHELL_BEHAVIOR_INVOKE_ACTION_ENTRY_ID,
  type RuntimeShellNavigationRequest,
} from '../shell/events.js';
import type { RuntimeGameShellProjection } from '../shell/authoring.js';
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
  readonly shell?: {
    readonly projection: RuntimeGameShellProjection;
    readonly onNavigation?: (request: RuntimeShellNavigationRequest) => void;
  };
}

/**
 * Platform-neutral behavior executor for an already isolated authoritative game worker.
 * Platform adapters must place this host inside an isolate that does not own
 * the authoritative room. Node uses worker_threads; workerd uses a dedicated
 * service-bound worker.
 */
export class AuthoritativeBehaviorRuntimeHost {
  readonly #scheduler: DeterministicBehaviorScheduler;
  readonly #shellNavigationRequests: RuntimeShellNavigationRequest[] = [];
  readonly #shellDiagnostics: BehaviorRuntimeDiagnostic[] = [];

  constructor(options: AuthoritativeBehaviorRuntimeHostOptions = {}) {
    this.#scheduler = new DeterministicBehaviorScheduler({
      ...options,
      onCommand: (command, trace) => {
        if (command.kind === SHELL_BEHAVIOR_INVOKE_ACTION_ENTRY_ID && options.shell !== undefined) {
          const args = command.payload.arguments;
          const candidate = Array.isArray(args) ? args[0] : command.payload;
          const actionId =
            typeof candidate === 'object' &&
            candidate !== null &&
            !Array.isArray(candidate) &&
            typeof (candidate as Record<string, unknown>).actionId === 'string'
              ? String((candidate as Record<string, unknown>).actionId)
              : undefined;
          if (actionId === undefined) {
            this.#shellDiagnostics.push({
              code: 'TBRUNTIME3020',
              severity: 'error',
              behaviorId: trace.behaviorId,
              eventId: trace.eventId,
              message: 'shell.invoke-action requires an actionId string payload.',
              suggestion:
                'Emit shell.invoke-action with { actionId } from a registered Game Shell action.',
              details: { command: command.kind },
            });
          } else if (runtimeShellActionById(options.shell.projection, actionId) === undefined) {
            this.#shellDiagnostics.push({
              code: 'TBRUNTIME3021',
              severity: 'error',
              behaviorId: trace.behaviorId,
              eventId: trace.eventId,
              message: `shell.invoke-action references unknown Game Shell action ${JSON.stringify(actionId)}.`,
              suggestion:
                'Choose an action id declared by the packaged Game Shell projection before invoking it.',
              details: { actionId },
            });
          } else {
            const request = dispatchRuntimeShellAction(options.shell.projection, actionId, {
              emitShellEvent: (event, payload) => {
                this.#scheduler.enqueue(SHELL_BEHAVIOR_EVENT_ENTRY_ID, { event, ...payload });
              },
            });
            if (request !== undefined) {
              this.#shellNavigationRequests.push(request);
              options.shell.onNavigation?.(request);
            }
          }
        }
        options.onCommand?.(command, trace);
      },
    });
  }

  get diagnostics(): ReadonlyArray<BehaviorRuntimeDiagnostic> {
    return [...this.#scheduler.diagnostics, ...this.#shellDiagnostics];
  }

  get snapshot(): BehaviorSchedulerSnapshot {
    return this.#scheduler.snapshot();
  }

  get shellNavigationRequests(): ReadonlyArray<RuntimeShellNavigationRequest> {
    return [...this.#shellNavigationRequests];
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
    if (!result.ok) {
      this.#shellDiagnostics.push(result.diagnostic);
      return false;
    }
    return this.#scheduler.register(result.loaded);
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

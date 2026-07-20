import type {
  GameShellActionDefinition,
  GameShellRegisteredEvent,
  RuntimeGameShellProjection,
} from './authoring.js';

export const SHELL_BEHAVIOR_EVENT_ENTRY_ID = 'shell.event' as const;
export const SHELL_BEHAVIOR_INVOKE_ACTION_ENTRY_ID = 'shell.invoke-action' as const;
export const SHELL_BEHAVIOR_EMIT_EVENT_ENTRY_ID = 'shell.emit-event' as const;

export interface RuntimeShellBehaviorEventPayload {
  readonly event: GameShellRegisteredEvent;
  readonly screenId: string;
  readonly actionId?: string | undefined;
  readonly targetScreenId?: string | undefined;
}

export interface RuntimeShellInvokeActionPayload {
  readonly actionId: string;
}

export type RuntimeShellEmitEventPayload = RuntimeShellBehaviorEventPayload;

export interface RuntimeShellBehaviorBridge {
  readonly emitBehaviorEvent: (
    entryId: typeof SHELL_BEHAVIOR_EVENT_ENTRY_ID,
    payload: RuntimeShellBehaviorEventPayload,
  ) => unknown;
}

export interface RuntimeShellEventDispatcher {
  readonly emitShellEvent: (
    event: GameShellRegisteredEvent,
    payload: {
      readonly screenId: string;
      readonly actionId?: string | undefined;
      readonly targetScreenId?: string | undefined;
    },
  ) => unknown;
}

export const shellBehaviorEventDispatcher = (
  bridge: RuntimeShellBehaviorBridge,
): RuntimeShellEventDispatcher => ({
  emitShellEvent: (event, payload) =>
    bridge.emitBehaviorEvent(SHELL_BEHAVIOR_EVENT_ENTRY_ID, { event, ...payload }),
});

export interface RuntimeShellNavigationRequest {
  readonly type: 'navigate';
  readonly targetScreenId: string;
}

export const runtimeShellActionById = (
  projection: RuntimeGameShellProjection,
  actionId: string,
): { readonly screenId: string; readonly action: GameShellActionDefinition } | undefined => {
  for (const screen of projection.screens) {
    const action = screen.actions.find((entry) => entry.id === actionId);
    if (action !== undefined) return { screenId: screen.id, action };
  }
  return undefined;
};

export const dispatchRuntimeShellAction = (
  projection: RuntimeGameShellProjection,
  actionId: string,
  dispatcher?: RuntimeShellEventDispatcher | undefined,
): RuntimeShellNavigationRequest | undefined => {
  const entry = runtimeShellActionById(projection, actionId);
  if (entry === undefined) return undefined;
  dispatcher?.emitShellEvent('shell.action.invoked', {
    screenId: entry.screenId,
    actionId,
    targetScreenId: entry.action.targetScreenId,
  });
  if (entry.action.type === 'emit-event' && entry.action.event !== undefined) {
    dispatcher?.emitShellEvent(entry.action.event, { screenId: entry.screenId, actionId });
  }
  if (entry.action.type === 'navigate' && entry.action.targetScreenId !== undefined) {
    dispatcher?.emitShellEvent('shell.navigation.requested', {
      screenId: entry.screenId,
      actionId,
      targetScreenId: entry.action.targetScreenId,
    });
    return { type: 'navigate', targetScreenId: entry.action.targetScreenId };
  }
  return undefined;
};

export const dispatchRuntimeShellBehaviorAction = (
  projection: RuntimeGameShellProjection,
  actionId: string,
  bridge: RuntimeShellBehaviorBridge,
): RuntimeShellNavigationRequest | undefined =>
  dispatchRuntimeShellAction(projection, actionId, shellBehaviorEventDispatcher(bridge));

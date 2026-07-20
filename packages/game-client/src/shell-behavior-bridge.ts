import type {
  RuntimeShellBehaviorEventPayload,
  RuntimeShellNavigationRequest,
} from '@tileborne/runtime';

import type { MenuEvent, MenuState } from './state/menu-machine.js';

export interface SequencedRuntimeShellNavigationRequest {
  readonly epoch: string;
  readonly sequence: number;
  readonly sourceEvent?: RuntimeShellBehaviorEventPayload | undefined;
  readonly request: RuntimeShellNavigationRequest;
}

export interface RuntimeShellBehaviorBridge {
  readonly shellNavigationRequests?:
    | ReadonlyArray<SequencedRuntimeShellNavigationRequest>
    | undefined;
  emitShellEvent(event: RuntimeShellBehaviorEventPayload): void;
}

export const shellScreenIdForMenuState = (state: MenuState): string | undefined => {
  switch (state.phase) {
    case 'boot':
      return 'title';
    case 'menu':
      return state.screen === 'settings' ? 'settings' : 'main-menu';
    case 'lobby':
    case 'matchmaking':
      return 'loading';
    case 'in-match':
      return state.paused ? 'pause' : undefined;
    case 'results':
      return 'results';
    case 'error':
      return undefined;
  }
};

export const shellEnteredEventForScreen = (
  screenId: string,
): RuntimeShellBehaviorEventPayload['event'] | undefined => {
  switch (screenId) {
    case 'title':
      return 'shell.title.entered';
    case 'main-menu':
      return 'shell.menu.entered';
    case 'loading':
      return 'shell.loading.entered';
    case 'pause':
      return 'shell.pause.entered';
    case 'settings':
      return 'shell.settings.entered';
    case 'results':
      return 'shell.results.entered';
    default:
      return undefined;
  }
};

export const shellActionEventForMenuEvent = (
  state: MenuState,
  event: MenuEvent,
): RuntimeShellBehaviorEventPayload | undefined => {
  const screenId = shellScreenIdForMenuState(state);
  if (screenId === undefined) return undefined;
  if (event.type === 'PLAY') {
    return {
      event: 'shell.action.invoked',
      screenId,
      actionId: 'menu.single',
      targetScreenId: 'loading',
    };
  }
  if (event.type === 'OPEN_SETTINGS') {
    return {
      event: 'shell.action.invoked',
      screenId,
      actionId: `${screenId}.settings`,
      targetScreenId: 'settings',
    };
  }
  if (event.type === 'MATCH_START') {
    return { event: 'shell.action.invoked', screenId, actionId: 'menu.start-match' };
  }
  if (event.type === 'MATCH_END') {
    return {
      event: 'shell.action.invoked',
      screenId,
      actionId: 'match.end',
      targetScreenId: 'results',
    };
  }
  if (event.type === 'RESUME') {
    return { event: 'shell.action.invoked', screenId, actionId: 'pause.resume' };
  }
  if (event.type === 'TO_MENU') {
    return {
      event: 'shell.action.invoked',
      screenId,
      actionId: `${screenId}.menu`,
      targetScreenId: 'main-menu',
    };
  }
  return undefined;
};

export const menuEventForShellNavigationRequest = (
  state: MenuState,
  request: RuntimeShellNavigationRequest,
): MenuEvent | undefined => {
  switch (request.targetScreenId) {
    case 'title':
    case 'main-menu':
      return state.phase === 'menu'
        ? {
            type: 'NAVIGATE_SHELL_SCREEN',
            screenId: request.targetScreenId,
            menuScreen: 'main',
            replaceHistory: true,
          }
        : { type: 'TO_MENU' };
    case 'settings':
      return {
        type: 'NAVIGATE_SHELL_SCREEN',
        screenId: request.targetScreenId,
        menuScreen: 'settings',
      };
    case 'loading':
      return state.phase === 'menu' ? { type: 'PLAY' } : undefined;
    case 'pause':
      return state.phase === 'in-match' && !state.paused ? { type: 'PAUSE' } : undefined;
    case 'results':
      return state.phase === 'in-match' ? { type: 'MATCH_END' } : undefined;
    default:
      return undefined;
  }
};

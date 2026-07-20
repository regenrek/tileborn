/**
 * Pure, framework-agnostic menu state machine for the generic game-client
 * shell (ADR-0022). Models the flow:
 *
 *   boot -> menu(main) -> lobby -> matchmaking -> in-match -> results -> menu
 *
 * with an Esc `paused` overlay over `in-match`. The reducer is total: unknown
 * transitions return the input state unchanged so the UI can dispatch freely.
 * No React, no brand/plugin names — the shell wraps this with a hook.
 */

export type MenuPhase =
  | 'boot'
  | 'menu'
  | 'lobby'
  | 'matchmaking'
  | 'in-match'
  | 'results'
  | 'error';

/** Active screen while `phase === "menu"`. */
export type MenuScreen = 'main' | 'settings' | 'credits';

/** Settings dialog tabs (brand-neutral baseline; plugins add more via slots). */
export type SettingsTab = 'graphics' | 'audio' | 'controls' | 'accessibility';

export const SETTINGS_TABS: readonly SettingsTab[] = [
  'graphics',
  'audio',
  'controls',
  'accessibility',
];

export interface MenuError {
  readonly title: string;
  readonly message: string;
}

export interface MenuState {
  readonly phase: MenuPhase;
  /** Sub-screen while in the `menu` phase. */
  readonly screen: MenuScreen;
  /** Active authored shell screen id, when a runtime projection is mounted. */
  readonly shellScreenId: string | undefined;
  /** Canonical authored shell navigation stack for Back/Esc. */
  readonly shellScreenHistory: readonly string[];
  /** Esc pause overlay flag, only meaningful while `phase === "in-match"`. */
  readonly paused: boolean;
  readonly settingsTab: SettingsTab;
  readonly error: MenuError | undefined;
}

export type MenuEvent =
  | { readonly type: 'BOOT_COMPLETE' }
  | { readonly type: 'BOOT_FAILED'; readonly error: MenuError }
  | { readonly type: 'OPEN_SETTINGS' }
  | { readonly type: 'OPEN_CREDITS' }
  | { readonly type: 'BACK' }
  | { readonly type: 'PLAY' }
  | { readonly type: 'MATCHMAKING_START' }
  | { readonly type: 'MATCH_START' }
  | { readonly type: 'PAUSE' }
  | { readonly type: 'RESUME' }
  | { readonly type: 'MATCH_END' }
  | { readonly type: 'PLAY_AGAIN' }
  | { readonly type: 'TO_MENU' }
  | { readonly type: 'SET_SHELL_ENTRY'; readonly screenId: string | undefined }
  | {
      readonly type: 'SET_SHELL_SCREEN';
      readonly screenId: string | undefined;
      readonly pushHistory?: boolean | undefined;
    }
  | {
      readonly type: 'NAVIGATE_SHELL_SCREEN';
      readonly screenId: string | undefined;
      readonly menuScreen?: MenuScreen | undefined;
      readonly replaceHistory?: boolean | undefined;
    }
  | { readonly type: 'SET_SETTINGS_TAB'; readonly tab: SettingsTab }
  | { readonly type: 'ERROR'; readonly error: MenuError }
  | { readonly type: 'DISMISS_ERROR' };

export const initialMenuState: MenuState = {
  phase: 'boot',
  screen: 'main',
  shellScreenId: undefined,
  shellScreenHistory: [],
  paused: false,
  settingsTab: 'graphics',
  error: undefined,
};

const toMenuMain = (state: MenuState): MenuState => ({
  ...state,
  phase: 'menu',
  screen: 'main',
  shellScreenHistory: [],
  paused: false,
  error: undefined,
});

const setShellScreen = (
  state: MenuState,
  screenId: string | undefined,
  pushHistory = false,
): MenuState => {
  if (state.shellScreenId === screenId) return state;
  return {
    ...state,
    shellScreenId: screenId,
    shellScreenHistory:
      pushHistory && state.shellScreenId !== undefined
        ? [...state.shellScreenHistory, state.shellScreenId]
        : state.shellScreenHistory,
  };
};

const backThroughShellHistory = (state: MenuState): MenuState | undefined => {
  const previous = state.shellScreenHistory.at(-1);
  if (previous === undefined) return undefined;
  return {
    ...state,
    phase: 'menu',
    screen: previous === 'settings' ? 'settings' : 'main',
    paused: false,
    shellScreenId: previous,
    shellScreenHistory: state.shellScreenHistory.slice(0, -1),
  };
};

export const menuReducer = (state: MenuState, event: MenuEvent): MenuState => {
  // Global transitions available from any phase.
  switch (event.type) {
    case 'ERROR':
      return { ...state, phase: 'error', paused: false, error: event.error };
    case 'SET_SETTINGS_TAB':
      return { ...state, settingsTab: event.tab };
    case 'SET_SHELL_ENTRY':
      return { ...state, shellScreenId: event.screenId, shellScreenHistory: [] };
    case 'SET_SHELL_SCREEN':
      return setShellScreen(state, event.screenId, event.pushHistory === true);
    case 'NAVIGATE_SHELL_SCREEN':
      return {
        ...state,
        phase: 'menu',
        screen: event.menuScreen ?? 'main',
        paused: false,
        shellScreenId: event.screenId,
        shellScreenHistory:
          event.replaceHistory === true
            ? []
            : state.shellScreenId !== undefined && state.shellScreenId !== event.screenId
              ? [...state.shellScreenHistory, state.shellScreenId]
              : state.shellScreenHistory,
      };
    default:
      break;
  }

  switch (state.phase) {
    case 'boot': {
      if (event.type === 'BOOT_COMPLETE') {
        return toMenuMain(state);
      }
      if (event.type === 'BOOT_FAILED') {
        return { ...state, phase: 'error', error: event.error };
      }
      return state;
    }

    case 'menu': {
      switch (event.type) {
        case 'OPEN_SETTINGS':
          return { ...state, screen: 'settings' };
        case 'OPEN_CREDITS':
          return { ...state, screen: 'credits' };
        case 'BACK':
          return (
            backThroughShellHistory(state) ??
            (state.screen === 'main' ? state : { ...state, screen: 'main' })
          );
        case 'PLAY':
          return state.screen === 'main' ? { ...state, phase: 'lobby' } : state;
        default:
          return state;
      }
    }

    case 'lobby': {
      switch (event.type) {
        case 'MATCHMAKING_START':
          return { ...state, phase: 'matchmaking' };
        case 'MATCH_START':
          return { ...state, phase: 'in-match', paused: false };
        case 'BACK':
          return toMenuMain(state);
        default:
          return state;
      }
    }

    case 'matchmaking': {
      switch (event.type) {
        case 'MATCH_START':
          return { ...state, phase: 'in-match', paused: false };
        case 'BACK':
          return { ...state, phase: 'lobby' };
        default:
          return state;
      }
    }

    case 'in-match': {
      switch (event.type) {
        case 'PAUSE':
          return { ...state, paused: true };
        case 'RESUME':
        case 'BACK':
          return { ...state, paused: false };
        case 'MATCH_END':
          return { ...state, phase: 'results', paused: false };
        case 'TO_MENU':
          return toMenuMain(state);
        default:
          return state;
      }
    }

    case 'results': {
      switch (event.type) {
        case 'PLAY_AGAIN':
          return { ...state, phase: 'lobby' };
        case 'TO_MENU':
        case 'BACK':
          return toMenuMain(state);
        default:
          return state;
      }
    }

    case 'error': {
      if (event.type === 'DISMISS_ERROR') {
        return toMenuMain(state);
      }
      return state;
    }

    default:
      return state;
  }
};

/** Whether the Esc pause overlay can be toggled in the current state. */
export const canPause = (state: MenuState): boolean => state.phase === 'in-match';

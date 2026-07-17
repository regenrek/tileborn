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
  | { readonly type: 'SET_SETTINGS_TAB'; readonly tab: SettingsTab }
  | { readonly type: 'ERROR'; readonly error: MenuError }
  | { readonly type: 'DISMISS_ERROR' };

export const initialMenuState: MenuState = {
  phase: 'boot',
  screen: 'main',
  paused: false,
  settingsTab: 'graphics',
  error: undefined,
};

const toMenuMain = (state: MenuState): MenuState => ({
  ...state,
  phase: 'menu',
  screen: 'main',
  paused: false,
  error: undefined,
});

export const menuReducer = (state: MenuState, event: MenuEvent): MenuState => {
  // Global transitions available from any phase.
  switch (event.type) {
    case 'ERROR':
      return { ...state, phase: 'error', paused: false, error: event.error };
    case 'SET_SETTINGS_TAB':
      return { ...state, settingsTab: event.tab };
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
          return state.screen === 'main' ? state : { ...state, screen: 'main' };
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

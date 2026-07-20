import type { BrandConfig, HudLayout } from '@tileborne/core';
import { dispatchRuntimeAudioEvent, type RuntimeGameShellProjection } from '@tileborne/runtime';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';

import { defaultBrandConfig } from '../config/default-brand.js';
import type { MenuSectionRegistration } from '../contributions/menu-registry.js';
import { HudOverlay, type HudInsets } from '../hud/hud-overlay.js';
import type { HudMetrics } from '../hud/hud-state.js';
import type { HudWidgetRegistration } from '../hud/hud-widget-registry.js';
import { initialMenuState, type MenuEvent, type MenuState } from '../state/menu-machine.js';
import { useMenuMachine } from '../state/use-menu-machine.js';
import { brandThemeVars } from '../theming/brand-theme.js';
import { useRuntimeAudio } from '../audio/use-runtime-audio.js';
import { MenuShell, type RuntimeLobbyRenderProps } from './menu-shell.js';
import type { AudioTabConfig } from './audio-tab.js';
import type { ControlsTabConfig } from './controls-tab.js';
import type { MatchResults } from './results-screen.js';
import { dispatchGameplayLifecycleAudioEvents } from '../audio/gameplay-lifecycle-audio.js';
import {
  menuEventForShellNavigationRequest,
  shellActionEventForMenuEvent,
  shellEnteredEventForScreen,
  shellScreenIdForMenuState,
  type RuntimeShellBehaviorBridge,
} from '../shell-behavior-bridge.js';

declare global {
  interface Window {
    __tileborneShellDebug?: {
      runtimeDispatches?: ShellRuntimeDispatchDebug[];
      projectionActions?: ShellProjectionActionDebug[];
      renderLobbyCount?: number;
      onPlayCount?: number;
      bridgeEvents?: ShellBridgeEventDebug[];
    };
  }
}

interface ShellRuntimeDispatchDebug {
  readonly eventType: string;
  readonly phase: MenuState['phase'];
  readonly screen: MenuState['screen'];
  readonly shellScreenId?: string | undefined;
}

interface ShellProjectionActionDebug {
  readonly actionId: string;
  readonly actionType: string;
  readonly screenId: string;
  readonly phase: MenuState['phase'];
  readonly screen: MenuState['screen'];
  readonly shellScreenId?: string | undefined;
}

interface ShellBridgeEventDebug {
  readonly event: string;
  readonly screenId: string;
  readonly actionId?: string | undefined;
  readonly phase: MenuState['phase'];
  readonly screen: MenuState['screen'];
  readonly shellScreenId?: string | undefined;
}

const appendRuntimeDispatchDebug = (value: ShellRuntimeDispatchDebug): void => {
  if (typeof window === 'undefined' || window.__tileborneShellDebug === undefined) return;
  const debug = window.__tileborneShellDebug;
  const entries = debug.runtimeDispatches ?? [];
  entries.push(value);
  debug.runtimeDispatches = entries.slice(-20);
};

const appendProjectionActionDebug = (value: ShellProjectionActionDebug): void => {
  if (typeof window === 'undefined' || window.__tileborneShellDebug === undefined) return;
  const debug = window.__tileborneShellDebug;
  const entries = debug.projectionActions ?? [];
  entries.push(value);
  debug.projectionActions = entries.slice(-20);
};

const appendBridgeEventDebug = (value: ShellBridgeEventDebug): void => {
  if (typeof window === 'undefined' || window.__tileborneShellDebug === undefined) return;
  const debug = window.__tileborneShellDebug;
  const entries = debug.bridgeEvents ?? [];
  entries.push(value);
  debug.bridgeEvents = entries.slice(-20);
};

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const focusableElements = (root: HTMLElement): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      !element.hasAttribute('disabled') &&
      element.getAttribute('aria-hidden') !== 'true' &&
      !element.hidden,
  );

const focusByDelta = (root: HTMLElement, delta: 1 | -1): void => {
  const elements = focusableElements(root);
  if (elements.length === 0) return;
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
  const currentIndex = active === undefined ? -1 : elements.indexOf(active);
  const nextIndex =
    currentIndex === -1
      ? delta === 1
        ? 0
        : elements.length - 1
      : (currentIndex + delta + elements.length) % elements.length;
  elements[nextIndex]?.focus();
};

const focusFirstElement = (root: HTMLElement): void => {
  const active = document.activeElement;
  if (active instanceof HTMLElement && root.contains(active)) return;
  focusableElements(root)[0]?.focus();
};

const activateFocusedElement = (root: HTMLElement): void => {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !root.contains(active)) {
    focusFirstElement(root);
    return;
  }
  active.click();
};

const gamepadAxisPressed = (value: number | undefined, direction: 1 | -1): boolean =>
  direction === 1 ? (value ?? 0) > 0.5 : (value ?? 0) < -0.5;

const shellProjectionThemeVars = (
  projection: RuntimeGameShellProjection | undefined,
): Record<`--${string}`, string> => {
  if (projection === undefined) return {};
  return {
    '--tb-menu-surface': projection.tokens.panelColor,
    '--tb-menu-accent': projection.tokens.accentColor,
    '--tb-menu-focus': projection.tokens.focusColor,
    '--tb-menu-text': projection.tokens.textColor,
    '--foreground': projection.tokens.textColor,
    '--primary': projection.tokens.accentColor,
    '--ring': projection.tokens.focusColor,
  };
};

interface GamepadActionState {
  readonly direction?: { readonly action: 'next' | 'previous'; readonly at: number } | undefined;
  readonly activatePressed: boolean;
  readonly backPressed: boolean;
}

export interface RuntimeRootProps {
  /** Brand overlay; defaults to the neutral "Tileborne Game" brand. */
  readonly brand?: BrandConfig;
  /** Plugin + brand menu section registrations (executable React, bundled). */
  readonly sections?: readonly MenuSectionRegistration[];
  /** The Pixi/runtime canvas surface, rendered underneath the menu chrome. */
  readonly canvas?: ReactNode;
  /** End-of-match results for the results screen. */
  readonly results?: MatchResults;
  /** Boot driver. Resolves -> menu; rejects -> error panel. Defaults to instant. */
  readonly onBoot?: () => Promise<void>;
  /** Side-effect hook fired when the player starts a match flow (menu -> lobby). */
  readonly onPlay?: () => void;
  /** Side-effect hook fired when the shell enters the authoritative match runtime. */
  readonly onMatchStart?: () => void;
  /** Side-effect hook fired when the shell leaves the authoritative match runtime for results. */
  readonly onMatchEnd?: () => void;
  /** Side-effect hook fired when results retry requests a new playtest/match session. */
  readonly onPlayAgain?: () => void;
  /** Side-effect hook fired when authored shell navigation exits back to editor/menu. */
  readonly onExitToMenu?: () => void;
  /** Quit handler (close app / return to launcher). Hides the Quit button when omitted. */
  readonly onQuit?: () => void;
  /** Initial state override (testing / deep links). */
  readonly initialState?: MenuState;
  /** 0..1 boot progress for the splash. */
  readonly bootProgress?: number;
  /**
   * Controls-tab keybind remap editor wiring (ADR-0024). The app supplies the
   * active mode's default `InputMap`, control scheme, and a persistence store;
   * the Settings → Controls tab then renders a live remap editor. Omit to keep
   * the static Controls blurb.
   */
  readonly controls?: ControlsTabConfig;
  /** Runtime mixer settings shown in Settings -> Audio. */
  readonly audio?: AudioTabConfig;
  /** Optional app-owned lobby surface that reuses the shell state machine. */
  readonly renderLobby?: ((props: RuntimeLobbyRenderProps) => ReactNode) | undefined;
  /**
   * In-match HUD wiring (ADR-0027). The app supplies the live HUD metrics
   * stream, the effective `HudLayout` (plugin default ⊕ user overlay), custom
   * widget registrations for plugin-declared kinds, and optional render-area
   * insets. The HUD chassis mounts over the canvas during `in-match` whenever
   * metrics are present; the pause scrim layers above it.
   */
  readonly hudMetrics?: HudMetrics;
  readonly hudLayout?: HudLayout;
  readonly hudWidgets?: readonly HudWidgetRegistration[];
  readonly hudInsets?: HudInsets;
  /** Optional behavior-runtime shell bridge for production shell event/navigation integration. */
  readonly shellBridge?: RuntimeShellBehaviorBridge | undefined;
  /** Canonical authored shell projection rendered by this owner. */
  readonly shellProjection?: RuntimeGameShellProjection | undefined;
  /** Base URL for packaged shell assets referenced by the projection. */
  readonly shellAssetUrlBase?: string | undefined;
  /** Optional surface-specific resolver for projection assets. */
  readonly shellAssetUrlResolver?:
    | ((asset: RuntimeGameShellProjection['assets'][number]) => string | undefined)
    | undefined;
}

/**
 * Top-level React shell for the shipped game client (ADR-0022). Mounts over the
 * Pixi canvas, themes via {@link brandThemeVars}, drives the menu state machine,
 * and wires global Esc handling. `@tileborne/runtime` stays React-free; this
 * package is the React home.
 */
export function RuntimeRoot({
  brand = defaultBrandConfig,
  sections = [],
  canvas,
  results,
  onBoot,
  onPlay,
  onMatchStart,
  onMatchEnd,
  onPlayAgain,
  onExitToMenu,
  onQuit,
  initialState = initialMenuState,
  bootProgress,
  controls,
  audio,
  renderLobby,
  hudMetrics,
  hudLayout,
  hudWidgets,
  hudInsets,
  shellBridge,
  shellProjection,
  shellAssetUrlBase,
  shellAssetUrlResolver,
}: RuntimeRootProps): ReactElement {
  const { state, dispatch } = useMenuMachine(initialState);
  useRuntimeAudio(audio);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dispatchedGameplayAudioKeysRef = useRef(new Set<string>());
  const lastShellEnteredKeyRef = useRef<string | undefined>(undefined);
  const processedShellNavigationSequencesRef = useRef(new Set<string>());
  const [gamepadPollingEnabled, setGamepadPollingEnabled] = useState(() =>
    Array.from(navigator.getGamepads?.() ?? []).some((entry) => entry !== null && entry.connected),
  );
  const gamepadActionStateRef = useRef<GamepadActionState>({
    activatePressed: false,
    backPressed: false,
  });

  const dispatchWithEffects = useCallback(
    (event: MenuEvent) => {
      appendRuntimeDispatchDebug({
        eventType: event.type,
        phase: state.phase,
        screen: state.screen,
        shellScreenId: state.shellScreenId,
      });
      if (event.type === 'PLAY') {
        if (typeof window !== 'undefined' && window.__tileborneShellDebug !== undefined) {
          window.__tileborneShellDebug.onPlayCount =
            (window.__tileborneShellDebug.onPlayCount ?? 0) + 1;
        }
        onPlay?.();
      }
      if (event.type === 'MATCH_START') {
        onMatchStart?.();
      }
      if (event.type === 'MATCH_END') {
        onMatchEnd?.();
      }
      if (event.type === 'PLAY_AGAIN') {
        onPlayAgain?.();
      }
      if (event.type === 'TO_MENU') {
        onExitToMenu?.();
      }
      if (shellProjection === undefined) {
        const shellEvent = shellActionEventForMenuEvent(state, event);
        if (shellEvent !== undefined) {
          shellBridge?.emitShellEvent(shellEvent);
        }
      }
      dispatch(event);
    },
    [
      dispatch,
      onExitToMenu,
      onMatchEnd,
      onMatchStart,
      onPlay,
      onPlayAgain,
      shellBridge,
      shellProjection,
      state,
    ],
  );

  const emitProjectionScreenEntered = useCallback(
    (screen: RuntimeGameShellProjection['screens'][number]) => {
      const event = shellEnteredEventForScreen(screen.stableId);
      if (event !== undefined) {
        shellBridge?.emitShellEvent({ event, screenId: screen.id });
      }
    },
    [shellBridge],
  );

  const emitProjectionAction = useCallback(
    (
      screen: RuntimeGameShellProjection['screens'][number],
      action: RuntimeGameShellProjection['screens'][number]['actions'][number],
    ) => {
      appendProjectionActionDebug({
        actionId: action.id,
        actionType: action.type,
        screenId: screen.id,
        phase: state.phase,
        screen: state.screen,
        shellScreenId: state.shellScreenId,
      });
      if (action.type === 'navigate') {
        return;
      }
      shellBridge?.emitShellEvent({
        event: 'shell.action.invoked',
        screenId: screen.id,
        actionId: action.id,
        ...(action.targetScreenId === undefined ? {} : { targetScreenId: action.targetScreenId }),
      });
      if (action.type === 'emit-event' && action.event !== undefined) {
        shellBridge?.emitShellEvent({
          event: action.event,
          screenId: screen.id,
          actionId: action.id,
        });
      }
      appendBridgeEventDebug({
        event: 'shell.action.invoked',
        screenId: screen.id,
        actionId: action.id,
        phase: state.phase,
        screen: state.screen,
        shellScreenId: state.shellScreenId,
      });
    },
    [shellBridge, state],
  );

  useEffect(() => {
    if (shellProjection !== undefined) return;
    const screenId = shellScreenIdForMenuState(state);
    if (screenId === undefined) return;
    const event = shellEnteredEventForScreen(screenId);
    if (event === undefined) return;
    const key = `${screenId}:${event}`;
    if (lastShellEnteredKeyRef.current === key) return;
    lastShellEnteredKeyRef.current = key;
    shellBridge?.emitShellEvent({ event, screenId });
  }, [shellBridge, shellProjection, state]);

  useEffect(() => {
    const requests = shellBridge?.shellNavigationRequests ?? [];
    for (const entry of requests) {
      const navigationId = `${entry.epoch}:${entry.sequence}`;
      if (processedShellNavigationSequencesRef.current.has(navigationId)) continue;
      processedShellNavigationSequencesRef.current.add(navigationId);
      if (entry.sourceEvent !== undefined && entry.sourceEvent.event !== 'shell.action.invoked') {
        continue;
      }
      if (entry.sourceEvent?.actionId?.endsWith('.retry') === true) {
        continue;
      }
      const event = menuEventForShellNavigationRequest(state, entry.request);
      if (event !== undefined) dispatch(event);
    }
  }, [dispatch, shellBridge?.shellNavigationRequests, state]);

  // Boot on mount when starting from the boot phase. We deliberately avoid a
  // cross-render "already booted" ref: under React StrictMode the effect runs
  // mount→cleanup→mount, and a persistent guard would let the first (cancelled)
  // run win and leave us stuck on the splash. The `cancelled` flag scopes each
  // invocation; the last surviving invocation dispatches BOOT_COMPLETE. Boot is
  // expected to be idempotent.
  useEffect(() => {
    if (state.phase !== 'boot') {
      return;
    }
    let cancelled = false;
    const boot = onBoot ?? (() => Promise.resolve());
    void boot().then(
      () => {
        if (!cancelled) {
          dispatch({ type: 'BOOT_COMPLETE' });
        }
      },
      (cause: unknown) => {
        if (!cancelled) {
          dispatch({
            type: 'BOOT_FAILED',
            error: {
              title: 'Failed to start',
              message: cause instanceof Error ? cause.message : 'The game failed to boot.',
            },
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
    // Intentionally run once on mount; boot is guarded by bootedRef.
  }, []);

  useEffect(() => {
    const engine = window.__tileborneRuntimeAudio;
    const cues = audio?.cues ?? [];
    if (engine === undefined || cues.length === 0) return;
    if (state.phase === 'menu' && state.screen === 'main') {
      dispatchRuntimeAudioEvent(engine, cues, 'shell.menuMusic');
    } else if (state.phase === 'lobby' || state.phase === 'matchmaking') {
      dispatchRuntimeAudioEvent(engine, cues, 'shell.loadingMusic');
    } else if (state.phase === 'in-match' && state.paused) {
      dispatchRuntimeAudioEvent(engine, cues, 'shell.pauseMusic');
    } else if (state.phase === 'in-match') {
      dispatchRuntimeAudioEvent(engine, cues, 'match.start');
    } else if (state.phase === 'results') {
      dispatchRuntimeAudioEvent(engine, cues, 'shell.resultsMusic');
      const hasAuthoritativeMatchEnd = hudMetrics?.hud?.gameplayEvents.some(
        (event) =>
          event._tag === 'MatchPhaseChanged' &&
          (event.phase === 'finished' || event.phase === 'game-over'),
      );
      if (hasAuthoritativeMatchEnd !== true) {
        dispatchRuntimeAudioEvent(engine, cues, 'match.end');
      }
    }
  }, [audio?.cues, hudMetrics?.hud?.gameplayEvents, state.phase, state.screen, state.paused]);

  useEffect(() => {
    dispatchGameplayLifecycleAudioEvents({
      engine: window.__tileborneRuntimeAudio,
      cues: audio?.cues ?? [],
      events: hudMetrics?.hud?.gameplayEvents ?? [],
      seenKeys: dispatchedGameplayAudioKeysRef.current,
    });
  }, [audio?.cues, hudMetrics?.hud?.gameplayEvents]);

  useEffect(() => {
    if (state.phase !== 'in-match' || hudMetrics?.hud?.gameOver === undefined) {
      return;
    }
    dispatchWithEffects({ type: 'MATCH_END' });
  }, [dispatchWithEffects, hudMetrics?.hud?.gameOver, state.phase]);

  // Global Esc: pause/resume in-match, otherwise step back through menus.
  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const frame = window.requestAnimationFrame(() => focusFirstElement(root));
    return () => window.cancelAnimationFrame(frame);
  }, [state.phase, state.screen, state.paused, state.settingsTab]);

  useEffect(() => {
    const onGamepadConnected = (event: GamepadEvent) => {
      const root = rootRef.current;
      if (root === null) return;
      root.dataset.inputDevice = 'gamepad';
      root.setAttribute('aria-description', `Gamepad ${event.gamepad.index + 1} connected`);
      focusFirstElement(root);
      setGamepadPollingEnabled(true);
    };
    window.addEventListener('gamepadconnected', onGamepadConnected);
    const onGamepadDisconnected = () => {
      const root = rootRef.current;
      if (root !== null) {
        delete root.dataset.inputDevice;
        root.removeAttribute('aria-description');
      }
      gamepadActionStateRef.current = { activatePressed: false, backPressed: false };
      setGamepadPollingEnabled(
        Array.from(navigator.getGamepads?.() ?? []).some(
          (entry) => entry !== null && entry.connected,
        ),
      );
    };
    window.addEventListener('gamepaddisconnected', onGamepadDisconnected);
    return () => {
      window.removeEventListener('gamepadconnected', onGamepadConnected);
      window.removeEventListener('gamepaddisconnected', onGamepadDisconnected);
    };
  }, []);

  useEffect(() => {
    if (!gamepadPollingEnabled) return undefined;
    let frame = 0;
    const dispatchBack = () => {
      if (state.phase === 'in-match') {
        dispatch({ type: state.paused ? 'RESUME' : 'PAUSE' });
      } else if (state.phase === 'menu' && state.screen !== 'main') {
        dispatch({ type: 'BACK' });
      } else if (
        state.phase === 'lobby' ||
        state.phase === 'matchmaking' ||
        state.phase === 'results'
      ) {
        dispatch({ type: 'BACK' });
      }
    };
    const shouldRunDirection = (action: 'next' | 'previous', now: number): boolean => {
      const prior = gamepadActionStateRef.current.direction;
      if (prior?.action !== action || now - prior.at >= 180) {
        gamepadActionStateRef.current = {
          ...gamepadActionStateRef.current,
          direction: { action, at: now },
        };
        return true;
      }
      return false;
    };
    const poll = () => {
      const root = rootRef.current;
      const gamepads = navigator.getGamepads?.() ?? [];
      const gamepad = Array.from(gamepads).find(
        (entry): entry is Gamepad => entry !== null && entry.connected,
      );
      if (root !== null && gamepad !== undefined) {
        root.dataset.inputDevice = 'gamepad';
        const target = document.activeElement;
        const editable =
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement ||
          (target instanceof HTMLElement && target.isContentEditable);
        const now = performance.now();
        const buttons = gamepad.buttons;
        const axes = gamepad.axes;
        const down = buttons[13]?.pressed === true || gamepadAxisPressed(axes[1], 1);
        const up = buttons[12]?.pressed === true || gamepadAxisPressed(axes[1], -1);
        const right = buttons[15]?.pressed === true || gamepadAxisPressed(axes[0], 1);
        const left = buttons[14]?.pressed === true || gamepadAxisPressed(axes[0], -1);
        const activate = buttons[0]?.pressed === true;
        const back = buttons[1]?.pressed === true || buttons[8]?.pressed === true;
        const actionState = gamepadActionStateRef.current;
        let handledActivate = false;
        let handledBack = false;
        if (!editable && (down || right) && shouldRunDirection('next', now)) focusByDelta(root, 1);
        else if (!editable && (up || left) && shouldRunDirection('previous', now))
          focusByDelta(root, -1);
        if (!editable && activate && !actionState.activatePressed) {
          activateFocusedElement(root);
          handledActivate = true;
        }
        if (!editable && back && !actionState.backPressed) {
          dispatchBack();
          handledBack = true;
        }
        gamepadActionStateRef.current = {
          direction:
            down || up || right || left ? gamepadActionStateRef.current.direction : undefined,
          activatePressed: activate
            ? actionState.activatePressed || handledActivate || editable
            : false,
          backPressed: back ? actionState.backPressed || handledBack || editable : false,
        };
        if (!down && !up && !right && !left && buttons.every((button) => !button.pressed)) {
          gamepadActionStateRef.current = { activatePressed: false, backPressed: false };
        }
      }
      frame = window.requestAnimationFrame(poll);
    };
    frame = window.requestAnimationFrame(poll);
    return () => window.cancelAnimationFrame(frame);
  }, [dispatch, gamepadPollingEnabled, state.phase, state.paused, state.screen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const root = rootRef.current;
      if (root === null) return;
      const target = event.target;
      const isEditable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable);
      if ((event.key === 'ArrowDown' || event.key === 'ArrowRight') && !isEditable) {
        event.preventDefault();
        focusByDelta(root, 1);
        return;
      }
      if ((event.key === 'ArrowUp' || event.key === 'ArrowLeft') && !isEditable) {
        event.preventDefault();
        focusByDelta(root, -1);
        return;
      }
      if (event.key !== 'Escape' && event.key !== 'Backspace' && event.key !== 'BrowserBack') {
        return;
      }
      if (isEditable && event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (state.phase === 'in-match') {
        dispatch({ type: state.paused ? 'RESUME' : 'PAUSE' });
      } else if (
        state.phase === 'menu' &&
        (state.screen !== 'main' || state.shellScreenHistory.length > 0)
      ) {
        dispatch({ type: 'BACK' });
      } else if (
        state.phase === 'lobby' ||
        state.phase === 'matchmaking' ||
        state.phase === 'results'
      ) {
        dispatch({ type: 'BACK' });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [state.phase, state.paused, state.screen, state.shellScreenHistory.length, dispatch]);

  const style = {
    ...brandThemeVars(brand),
    ...shellProjectionThemeVars(shellProjection),
  } as CSSProperties;

  return (
    <div
      ref={rootRef}
      className="tb-root"
      style={style}
      data-phase={state.phase}
      data-screen={state.screen}
      data-shell-screen-id={state.shellScreenId ?? ''}
      role="application"
      aria-label={`${brand.title} runtime shell`}
      aria-description="Use Tab or arrow keys to move focus. Escape or Back returns to the previous shell screen."
    >
      <div className="tb-canvas-layer" data-testid="canvas-layer">
        {canvas}
      </div>
      <div className="tb-overlay-layer">
        {state.phase === 'in-match' && hudMetrics !== undefined ? (
          <HudOverlay
            metrics={hudMetrics}
            layout={hudLayout}
            customWidgets={hudWidgets}
            hudInsets={hudInsets}
          />
        ) : null}
        <MenuShell
          state={state}
          dispatch={dispatchWithEffects}
          brand={brand}
          sections={sections}
          shellProjection={shellProjection}
          shellAssetUrlBase={shellAssetUrlBase}
          shellAssetUrlResolver={shellAssetUrlResolver}
          onProjectionAction={emitProjectionAction}
          onProjectionScreenEntered={emitProjectionScreenEntered}
          results={results}
          bootProgress={bootProgress}
          onQuit={onQuit}
          renderLobby={renderLobby}
          {...(controls ? { controls } : {})}
          {...(audio ? { audio } : {})}
        />
      </div>
    </div>
  );
}

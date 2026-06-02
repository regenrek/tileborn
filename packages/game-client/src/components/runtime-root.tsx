import type { BrandConfig } from "@tileborne/core";
import { useCallback, useEffect, type CSSProperties, type ReactElement, type ReactNode } from "react";

import { defaultBrandConfig } from "../config/default-brand.js";
import type { MenuSectionRegistration } from "../contributions/menu-registry.js";
import {
  initialMenuState,
  type MenuEvent,
  type MenuState,
} from "../state/menu-machine.js";
import { useMenuMachine } from "../state/use-menu-machine.js";
import { brandThemeVars } from "../theming/brand-theme.js";
import { MenuShell } from "./menu-shell.js";
import type { MatchResults } from "./results-screen.js";

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
  /** Quit handler (close app / return to launcher). Hides the Quit button when omitted. */
  readonly onQuit?: () => void;
  /** Initial state override (testing / deep links). */
  readonly initialState?: MenuState;
  /** 0..1 boot progress for the splash. */
  readonly bootProgress?: number;
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
  onQuit,
  initialState = initialMenuState,
  bootProgress,
}: RuntimeRootProps): ReactElement {
  const { state, dispatch } = useMenuMachine(initialState);

  const dispatchWithEffects = useCallback(
    (event: MenuEvent) => {
      if (event.type === "PLAY") {
        onPlay?.();
      }
      dispatch(event);
    },
    [dispatch, onPlay],
  );

  // Boot on mount when starting from the boot phase. We deliberately avoid a
  // cross-render "already booted" ref: under React StrictMode the effect runs
  // mount→cleanup→mount, and a persistent guard would let the first (cancelled)
  // run win and leave us stuck on the splash. The `cancelled` flag scopes each
  // invocation; the last surviving invocation dispatches BOOT_COMPLETE. Boot is
  // expected to be idempotent.
  useEffect(() => {
    if (state.phase !== "boot") {
      return;
    }
    let cancelled = false;
    const boot = onBoot ?? (() => Promise.resolve());
    void boot().then(
      () => {
        if (!cancelled) {
          dispatch({ type: "BOOT_COMPLETE" });
        }
      },
      (cause: unknown) => {
        if (!cancelled) {
          dispatch({
            type: "BOOT_FAILED",
            error: {
              title: "Failed to start",
              message: cause instanceof Error ? cause.message : "The game failed to boot.",
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

  // Global Esc: pause/resume in-match, otherwise step back through menus.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      if (state.phase === "in-match") {
        dispatch({ type: state.paused ? "RESUME" : "PAUSE" });
      } else if (state.phase === "menu" && state.screen !== "main") {
        dispatch({ type: "BACK" });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [state.phase, state.paused, state.screen, dispatch]);

  const style = brandThemeVars(brand) as CSSProperties;

  return (
    <div className="tb-root" style={style} data-phase={state.phase} data-screen={state.screen}>
      <div className="tb-canvas-layer" data-testid="canvas-layer">
        {canvas}
      </div>
      <div className="tb-overlay-layer">
        <MenuShell
          state={state}
          dispatch={dispatchWithEffects}
          brand={brand}
          sections={sections}
          results={results}
          bootProgress={bootProgress}
          onQuit={onQuit}
        />
      </div>
    </div>
  );
}

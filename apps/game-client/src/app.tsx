import { CONTROL_SCHEMES, controlScheme } from "@tileborne/core";
import {
  createLocalStorageBindingsStore,
  defaultBrandConfig,
  RuntimeRoot,
  type ControlsTabConfig,
} from "@tileborne/game-client";
import { battleRoyaleDefaultInputMap } from "@tileborne/plugin-battle-royale";
import { battleRoyaleMenuSections } from "@tileborne/plugin-battle-royale/menu";
import { useMemo, type ReactElement } from "react";

/**
 * Brand-neutral game-client template app (ADR-0022 decision #3). Mounts the
 * generic shell with the neutral default brand and the battle-royale plugin's
 * menu sections. Products fork/overlay this entry: they pass their own
 * `BrandConfig` (from `branding/tokens.json`) and compose plugin sections with
 * their `menuExtensions` registrations.
 */
export function App(): ReactElement {
  // Settings → Controls keybind remap editor (ADR-0024): the active mode's
  // default input map (BR) + a localStorage-backed overlay store. The overlay is
  // persisted in the engine-owned `InputMap` shape under a shared key, so it is
  // the same durable remap the engine resolver applies at play time.
  const controls = useMemo<ControlsTabConfig>(
    () => ({
      inputMap: battleRoyaleDefaultInputMap(),
      scheme: controlScheme(CONTROL_SCHEMES.KeyboardMouse),
      store: createLocalStorageBindingsStore(),
    }),
    [],
  );

  return (
    <RuntimeRoot
      brand={defaultBrandConfig}
      sections={battleRoyaleMenuSections}
      controls={controls}
      // A real product wires NetworkClient/matchmaking here; the template keeps
      // the play flow driven by the menu state machine for the live walkthrough.
      onPlay={() => undefined}
      onQuit={() => window.close()}
      canvas={<div data-testid="game-canvas" style={{ width: "100%", height: "100%" }} />}
    />
  );
}

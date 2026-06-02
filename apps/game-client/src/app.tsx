import { defaultBrandConfig, RuntimeRoot } from "@tileborne/game-client";
import { battleRoyaleMenuSections } from "@tileborne/plugin-battle-royale/menu";
import type { ReactElement } from "react";

/**
 * Brand-neutral game-client template app (ADR-0022 decision #3). Mounts the
 * generic shell with the neutral default brand and the battle-royale plugin's
 * menu sections. Products fork/overlay this entry: they pass their own
 * `BrandConfig` (from `branding/tokens.json`) and compose plugin sections with
 * their `menuExtensions` registrations.
 */
export function App(): ReactElement {
  return (
    <RuntimeRoot
      brand={defaultBrandConfig}
      sections={battleRoyaleMenuSections}
      // A real product wires NetworkClient/matchmaking here; the template keeps
      // the play flow driven by the menu state machine for the live walkthrough.
      onPlay={() => undefined}
      onQuit={() => window.close()}
      canvas={<div data-testid="game-canvas" style={{ width: "100%", height: "100%" }} />}
    />
  );
}

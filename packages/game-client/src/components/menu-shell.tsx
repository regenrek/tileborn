import type { BrandConfig } from "@tileborne/core";
import { Button } from "@tileborne/ui";
import type { ReactElement, ReactNode } from "react";

import type { MenuSectionRegistration } from "../contributions/menu-registry.js";
import type { MenuEvent, MenuState, SettingsTab } from "../state/menu-machine.js";
import { BootSplash } from "./boot-splash.js";
import { ErrorPanel } from "./error-panel.js";
import { MainMenu } from "./main-menu.js";
import { PauseOverlay } from "./pause-overlay.js";
import { ResultsScreen, type MatchResults } from "./results-screen.js";
import { SettingsDialog } from "./settings-dialog.js";
import type { AudioTabConfig } from "./audio-tab.js";
import type { ControlsTabConfig } from "./controls-tab.js";

export interface RuntimeLobbyRenderProps {
  readonly matchmaking: boolean;
  readonly onFindMatch: () => void;
  readonly onStartMatch: () => void;
  readonly onBack: () => void;
}

export interface MenuShellProps {
  readonly state: MenuState;
  readonly dispatch: (event: MenuEvent) => void;
  readonly brand: BrandConfig;
  readonly sections: readonly MenuSectionRegistration[];
  readonly results?: MatchResults | undefined;
  readonly bootProgress?: number | undefined;
  readonly onQuit?: (() => void) | undefined;
  /** Controls-tab remap editor wiring (ADR-0024); see {@link SettingsDialog}. */
  readonly controls?: ControlsTabConfig | undefined;
  /** Audio-tab mixer settings wiring; see {@link SettingsDialog}. */
  readonly audio?: AudioTabConfig | undefined;
  readonly renderLobby?: ((props: RuntimeLobbyRenderProps) => ReactNode) | undefined;
}

function CreditsView({ brand, onBack }: { brand: BrandConfig; onBack: () => void }): ReactElement {
  return (
    <div className="tb-scrim">
      <div className="tb-panel" role="dialog" aria-label="Credits" data-testid="credits-view">
        <h2 className="tb-title">About {brand.title}</h2>
        <p className="tb-tagline">
          Built on the Tileborne runtime. This is a brand-neutral game client template.
        </p>
        <div className="tb-actions">
          <Button variant="outline" onClick={onBack} data-testid="credits-back">
            Back
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Renders the correct menu surface for the current state. The Pixi canvas is
 * rendered separately (underneath) by `RuntimeRoot`; this layer is the React
 * chrome (ADR-0022 boundary: React owns chrome, Pixi owns rendering).
 */
export function MenuShell({
  state,
  dispatch,
  brand,
  sections,
  results,
  bootProgress,
  onQuit,
  controls,
  audio,
  renderLobby,
}: MenuShellProps): ReactElement | null {
  const selectTab = (tab: SettingsTab) => dispatch({ type: "SET_SETTINGS_TAB", tab });

  switch (state.phase) {
    case "boot":
      return <BootSplash brand={brand} progress={bootProgress} />;

    case "error":
      return state.error ? (
        <ErrorPanel error={state.error} onDismiss={() => dispatch({ type: "DISMISS_ERROR" })} />
      ) : null;

    case "menu": {
      if (state.screen === "settings") {
        return (
          <SettingsDialog
            brand={brand}
            sections={sections}
            activeTab={state.settingsTab}
            onSelectTab={selectTab}
            onBack={() => dispatch({ type: "BACK" })}
            {...(controls ? { controls } : {})}
            {...(audio ? { audio } : {})}
          />
        );
      }
      if (state.screen === "credits") {
        return <CreditsView brand={brand} onBack={() => dispatch({ type: "BACK" })} />;
      }
      return (
        <MainMenu
          brand={brand}
          sections={sections}
          onPlay={() => dispatch({ type: "PLAY" })}
          onOpenSettings={() => dispatch({ type: "OPEN_SETTINGS" })}
          onOpenCredits={() => dispatch({ type: "OPEN_CREDITS" })}
          onQuit={onQuit}
        />
      );
    }

    case "lobby":
    case "matchmaking": {
      const matchmaking = state.phase === "matchmaking";
      if (renderLobby) {
        return (
          <>
            {renderLobby({
              matchmaking,
              onFindMatch: () => dispatch({ type: "MATCHMAKING_START" }),
              onStartMatch: () => dispatch({ type: "MATCH_START" }),
              onBack: () => dispatch({ type: "BACK" }),
            })}
          </>
        );
      }
      return (
        <div className="tb-scrim">
          <div className="tb-panel" data-testid="lobby">
            <h2 className="tb-title">{matchmaking ? "Finding a match…" : "Lobby"}</h2>
            <p className="tb-tagline">
              {matchmaking ? "Matchmaking in progress." : "Choose your loadout and ready up."}
            </p>
            <div className="tb-actions">
              {matchmaking ? null : (
                <Button
                  onClick={() => dispatch({ type: "MATCHMAKING_START" })}
                  data-testid="find-match"
                >
                  Find match
                </Button>
              )}
              <Button onClick={() => dispatch({ type: "MATCH_START" })} data-testid="start-match">
                Start match
              </Button>
              <Button
                variant="outline"
                onClick={() => dispatch({ type: "BACK" })}
                data-testid="lobby-back"
              >
                Back
              </Button>
            </div>
          </div>
        </div>
      );
    }

    case "in-match":
      return state.paused ? (
        <PauseOverlay
          brand={brand}
          sections={sections}
          onResume={() => dispatch({ type: "RESUME" })}
          onOpenSettings={() => dispatch({ type: "OPEN_SETTINGS" })}
          onQuitToMenu={() => dispatch({ type: "TO_MENU" })}
        />
      ) : (
        // In-match: HUD is contributed; the chassis only shows a minimal stub +
        // ends the match. Real HUD widgets mount via hudWidgets contributions.
        <div className="tb-hud-stub" data-testid="in-match">
          <span>In match — press Esc to pause</span>
          <div className="tb-actions" style={{ marginTop: "0.5rem" }}>
            <Button size="sm" onClick={() => dispatch({ type: "MATCH_END" })} data-testid="end-match">
              End match
            </Button>
          </div>
        </div>
      );

    case "results":
      return (
        <ResultsScreen
          brand={brand}
          sections={sections}
          results={results}
          onPlayAgain={() => dispatch({ type: "PLAY_AGAIN" })}
          onBackToMenu={() => dispatch({ type: "TO_MENU" })}
        />
      );

    default:
      return null;
  }
}

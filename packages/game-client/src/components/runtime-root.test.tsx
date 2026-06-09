import { CORE_HUD_WIDGETS, HudLayout } from "@tileborne/core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import type { MenuSectionRegistration } from "../contributions/menu-registry.js";
import { initialMenuState } from "../state/menu-machine.js";
import { RuntimeRoot } from "./runtime-root.js";

describe("RuntimeRoot", () => {
  it("boots into the main menu then walks play -> match -> results -> menu", async () => {
    const user = userEvent.setup();
    render(<RuntimeRoot onQuit={() => undefined} />);

    // boot splash -> main menu
    expect(screen.getByTestId("boot-splash")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("main-menu")).toBeInTheDocument());
    expect(screen.getByText("Tileborne Game")).toBeInTheDocument();

    await user.click(screen.getByTestId("play-button"));
    expect(screen.getByTestId("lobby")).toBeInTheDocument();

    await user.click(screen.getByTestId("start-match"));
    expect(screen.getByTestId("in-match")).toBeInTheDocument();

    await user.click(screen.getByTestId("end-match"));
    expect(screen.getByTestId("results-screen")).toBeInTheDocument();

    await user.click(screen.getByTestId("results-back"));
    expect(screen.getByTestId("main-menu")).toBeInTheDocument();
  });

  it("opens settings, switches tabs, and goes back", async () => {
    const user = userEvent.setup();
    render(<RuntimeRoot />);
    await waitFor(() => expect(screen.getByTestId("main-menu")).toBeInTheDocument());

    await user.click(screen.getByTestId("settings-button"));
    expect(screen.getByTestId("settings-dialog")).toBeInTheDocument();

    await user.click(screen.getByTestId("settings-tab-accessibility"));
    expect(screen.getByTestId("settings-tab-body").textContent).toMatch(/colorblind/i);

    await user.click(screen.getByTestId("settings-back"));
    expect(screen.getByTestId("main-menu")).toBeInTheDocument();
  });

  it("renders contributed sections into named slots and lets them drive the shell", async () => {
    const user = userEvent.setup();
    const sections: MenuSectionRegistration[] = [
      {
        id: "br-lobby",
        slot: "main.primaryActions",
        order: 10,
        source: "plugin",
        Component: ({ onPlay }) => (
          <button type="button" data-testid="section-play" onClick={onPlay}>
            Quick play
          </button>
        ),
      },
    ];
    render(<RuntimeRoot sections={sections} />);
    await waitFor(() => expect(screen.getByTestId("main-menu")).toBeInTheDocument());

    const section = screen.getByTestId("section-play");
    expect(section).toBeInTheDocument();
    await user.click(section);
    expect(screen.getByTestId("lobby")).toBeInTheDocument();
  });

  it("surfaces a boot failure in the error panel", async () => {
    const user = userEvent.setup();
    render(<RuntimeRoot onBoot={() => Promise.reject(new Error("atlas missing"))} />);
    await waitFor(() => expect(screen.getByTestId("error-panel")).toBeInTheDocument());
    expect(screen.getByText("atlas missing")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /back to menu/i }));
    expect(screen.getByTestId("main-menu")).toBeInTheDocument();
  });

  it("mounts the HUD chassis with custom plugin widgets while in-match", () => {
    const inMatch = { ...initialMenuState, phase: "in-match" as const };
    render(
      <RuntimeRoot
        initialState={inMatch}
        hudMetrics={{
          playerCount: 3,
          tickCount: 50,
          hud: { totalPlayers: 8, recentEvents: [] },
        }}
        hudLayout={Schema.decodeUnknownSync(HudLayout)({
          id: "test.runtime-hud",
          widgets: [
            { id: "alive", kind: CORE_HUD_WIDGETS.AliveCount, anchor: "top-right", order: 0, enabled: true },
            { id: "mana", kind: "arena.manaBar", anchor: "bottom-left", order: 0, enabled: true },
          ],
        })}
        hudWidgets={[
          {
            kind: "arena.manaBar",
            source: "plugin",
            Component: () => <div data-testid="arena-mana-bar">MP 12</div>,
          },
        ]}
      />,
    );

    expect(screen.getByTestId("playtest-hud-overlay")).toBeInTheDocument();
    expect(screen.getByTestId("playtest-hud-alive-count").textContent).toBe("3 / 8 players alive");
    expect(screen.getByTestId("arena-mana-bar").textContent).toBe("MP 12");
    // The menu shell's in-match stub still renders alongside the HUD.
    expect(screen.getByTestId("in-match")).toBeInTheDocument();
  });

  it("does not mount the HUD outside of a match", () => {
    render(
      <RuntimeRoot
        initialState={{ ...initialMenuState, phase: "menu" as const }}
        hudMetrics={{ playerCount: 1, tickCount: 1 }}
      />,
    );
    expect(screen.queryByTestId("playtest-hud-overlay")).toBeNull();
  });
});

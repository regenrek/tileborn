import { CORE_HUD_WIDGETS, HudLayout } from "@tileborne/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Schema } from "effect";
import { useState, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

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

  it("renders live audio mixer settings and binds them to the runtime audio engine", async () => {
    const user = userEvent.setup();
    const setSettings = vi.fn();
    const setFocusState = vi.fn();
    const dispose = vi.fn();
    const engineFactory = vi.fn(() => ({
      playCue: vi.fn(),
      setSettings,
      setFocusState,
      snapshot: vi.fn(() => ({
        supported: true,
        focusState: "focused" as const,
        settings: {
          masterVolume: 0.8,
          muted: false,
          muteOnFocusLoss: true,
          busVolumes: {},
        },
        playCount: 0,
        audiblePlayCount: 0,
        unsupportedPlayCount: 0,
      })),
      dispose,
    }));
    function AudioHarness(): ReactElement {
      const [settings, setAudioSettings] = useState({
        masterVolume: 0.8,
        muted: false,
        muteOnFocusLoss: true,
        busVolumes: {},
      });
      return (
        <RuntimeRoot
          audio={{
            settings,
            buses: [
              {
                id: "battle-royale.sfx",
                label: "Battle Royale SFX",
                kind: "sfx",
                defaultVolume: 0.85,
              },
            ],
            cues: [
              {
                id: "battle-royale.weapon.fire",
                label: "Weapon fire",
                busId: "battle-royale.sfx",
                defaultVolume: 0.72,
              },
            ],
            engineFactory,
            onChange: setAudioSettings,
          }}
        />
      );
    }
    render(<AudioHarness />);
    await waitFor(() => expect(screen.getByTestId("main-menu")).toBeInTheDocument());
    expect(engineFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        buses: [expect.objectContaining({ id: "battle-royale.sfx" })],
        cues: [expect.objectContaining({ id: "battle-royale.weapon.fire" })],
      }),
    );

    await user.click(screen.getByTestId("settings-button"));
    await user.click(screen.getByTestId("settings-tab-audio"));

    expect(screen.getByTestId("audio-settings")).toBeInTheDocument();
    expect(screen.getByTestId("audio-master-volume")).toHaveValue("80");
    expect(screen.getByTestId("audio-bus-battle-royale.sfx")).toHaveValue("85");

    fireEvent.change(screen.getByTestId("audio-master-volume"), { target: { value: "55" } });
    await waitFor(() => {
      expect(setSettings).toHaveBeenLastCalledWith({
        masterVolume: 0.55,
        muted: false,
        muteOnFocusLoss: true,
        busVolumes: {},
      });
    });
    expect(engineFactory).toHaveBeenCalledTimes(1);
    expect(dispose).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId("audio-bus-battle-royale.sfx"), { target: { value: "40" } });
    await waitFor(() => {
      expect(setSettings).toHaveBeenLastCalledWith({
        masterVolume: 0.55,
        muted: false,
        muteOnFocusLoss: true,
        busVolumes: { "battle-royale.sfx": 0.4 },
      });
    });
    expect(engineFactory).toHaveBeenCalledTimes(1);
    expect(dispose).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("audio-muted"));
    await waitFor(() => {
      expect(setSettings).toHaveBeenLastCalledWith({
        masterVolume: 0.55,
        muted: true,
        muteOnFocusLoss: true,
        busVolumes: { "battle-royale.sfx": 0.4 },
      });
    });
    expect(engineFactory).toHaveBeenCalledTimes(1);
    expect(dispose).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("blur"));
    expect(setFocusState).toHaveBeenLastCalledWith("backgrounded");
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

  it("lets products replace the lobby surface while reusing shell navigation", async () => {
    const user = userEvent.setup();
    render(
      <RuntimeRoot
        renderLobby={({ onStartMatch, onBack }) => (
          <div data-testid="custom-lobby">
            <button type="button" data-testid="custom-start" onClick={onStartMatch}>
              Start
            </button>
            <button type="button" data-testid="custom-back" onClick={onBack}>
              Back
            </button>
          </div>
        )}
      />,
    );
    await waitFor(() => expect(screen.getByTestId("main-menu")).toBeInTheDocument());

    await user.click(screen.getByTestId("play-button"));
    expect(screen.getByTestId("custom-lobby")).toBeInTheDocument();
    await user.click(screen.getByTestId("custom-start"));
    expect(screen.getByTestId("in-match")).toBeInTheDocument();
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

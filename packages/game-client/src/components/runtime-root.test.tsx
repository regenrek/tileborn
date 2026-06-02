import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { MenuSectionRegistration } from "../contributions/menu-registry.js";
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
});

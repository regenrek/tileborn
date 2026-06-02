import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { App } from "./app.js";

describe("game-client template App", () => {
  it("boots into the neutral menu and surfaces the BR plugin sections", async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(screen.getByTestId("main-menu")).not.toBeNull());
    // Neutral brand title, not a product name.
    expect(screen.getByText("Tileborne Game")).not.toBeNull();
    // BR plugin contributed sections render into named slots.
    expect(screen.getByTestId("br-quick-play")).not.toBeNull();
    expect(screen.getByTestId("br-loadout")).not.toBeNull();
    expect(screen.getByTestId("br-private-room")).not.toBeNull();

    // BR quick-play drives the shell into the lobby.
    await user.click(screen.getByTestId("br-quick-play"));
    expect(screen.getByTestId("lobby")).not.toBeNull();

    await user.click(screen.getByTestId("start-match"));
    expect(screen.getByTestId("in-match")).not.toBeNull();
    await user.click(screen.getByTestId("end-match"));
    expect(screen.getByTestId("results-screen")).not.toBeNull();
  });

  it("shows the BR match-rules section inside settings", async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("main-menu")).not.toBeNull());
    await user.click(screen.getByTestId("settings-button"));
    expect(screen.getByTestId("br-match-rules")).not.toBeNull();
  });
});

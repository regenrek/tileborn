import { describe, expect, it } from "vitest";

import {
  canPause,
  initialMenuState,
  menuReducer,
  type MenuEvent,
  type MenuState,
} from "./menu-machine.js";

const run = (events: readonly MenuEvent[], from: MenuState = initialMenuState): MenuState =>
  events.reduce(menuReducer, from);

describe("menuReducer", () => {
  it("starts at the boot phase", () => {
    expect(initialMenuState.phase).toBe("boot");
  });

  it("walks the full boot -> menu -> play -> results -> menu flow", () => {
    let state = run([{ type: "BOOT_COMPLETE" }]);
    expect(state).toMatchObject({ phase: "menu", screen: "main" });

    state = run([{ type: "PLAY" }], state);
    expect(state.phase).toBe("lobby");

    state = run([{ type: "MATCHMAKING_START" }], state);
    expect(state.phase).toBe("matchmaking");

    state = run([{ type: "MATCH_START" }], state);
    expect(state.phase).toBe("in-match");

    state = run([{ type: "MATCH_END" }], state);
    expect(state.phase).toBe("results");

    state = run([{ type: "TO_MENU" }], state);
    expect(state).toMatchObject({ phase: "menu", screen: "main" });
  });

  it("supports starting a match directly from the lobby", () => {
    const state = run([{ type: "BOOT_COMPLETE" }, { type: "PLAY" }, { type: "MATCH_START" }]);
    expect(state.phase).toBe("in-match");
  });

  it("toggles the pause overlay only during in-match", () => {
    const inMatch = run([{ type: "BOOT_COMPLETE" }, { type: "PLAY" }, { type: "MATCH_START" }]);
    expect(canPause(inMatch)).toBe(true);
    const paused = menuReducer(inMatch, { type: "PAUSE" });
    expect(paused.paused).toBe(true);
    const resumed = menuReducer(paused, { type: "RESUME" });
    expect(resumed.paused).toBe(false);

    const menu = run([{ type: "BOOT_COMPLETE" }]);
    expect(canPause(menu)).toBe(false);
    expect(menuReducer(menu, { type: "PAUSE" }).paused).toBe(false);
  });

  it("returns to the menu from a pause overlay", () => {
    const paused = run([
      { type: "BOOT_COMPLETE" },
      { type: "PLAY" },
      { type: "MATCH_START" },
      { type: "PAUSE" },
    ]);
    const menu = menuReducer(paused, { type: "TO_MENU" });
    expect(menu).toMatchObject({ phase: "menu", screen: "main", paused: false });
  });

  it("navigates settings and credits sub-screens and back", () => {
    let state = run([{ type: "BOOT_COMPLETE" }, { type: "OPEN_SETTINGS" }]);
    expect(state.screen).toBe("settings");
    state = menuReducer(state, { type: "SET_SETTINGS_TAB", tab: "audio" });
    expect(state.settingsTab).toBe("audio");
    state = menuReducer(state, { type: "BACK" });
    expect(state.screen).toBe("main");

    state = menuReducer(state, { type: "OPEN_CREDITS" });
    expect(state.screen).toBe("credits");
    state = menuReducer(state, { type: "BACK" });
    expect(state.screen).toBe("main");
  });

  it("plays again from results back into the lobby", () => {
    const results = run([
      { type: "BOOT_COMPLETE" },
      { type: "PLAY" },
      { type: "MATCH_START" },
      { type: "MATCH_END" },
    ]);
    expect(menuReducer(results, { type: "PLAY_AGAIN" }).phase).toBe("lobby");
  });

  it("routes boot failures and runtime errors to the error phase", () => {
    const failed = menuReducer(initialMenuState, {
      type: "BOOT_FAILED",
      error: { title: "Boot failed", message: "asset load error" },
    });
    expect(failed.phase).toBe("error");
    expect(failed.error?.title).toBe("Boot failed");

    const inMatch = run([{ type: "BOOT_COMPLETE" }, { type: "PLAY" }, { type: "MATCH_START" }]);
    const errored = menuReducer(inMatch, {
      type: "ERROR",
      error: { title: "Disconnected", message: "lost connection" },
    });
    expect(errored.phase).toBe("error");
    expect(menuReducer(errored, { type: "DISMISS_ERROR" })).toMatchObject({ phase: "menu" });
  });

  it("ignores out-of-phase events without throwing", () => {
    const menu = run([{ type: "BOOT_COMPLETE" }]);
    expect(menuReducer(menu, { type: "MATCH_END" })).toEqual(menu);
    expect(menuReducer(initialMenuState, { type: "PLAY" })).toEqual(initialMenuState);
  });
});

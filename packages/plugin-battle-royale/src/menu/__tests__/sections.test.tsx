// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { battleRoyaleMenuSections } from "../index.js";
import {
  BattleRoyaleLoadoutSection,
  BattleRoyaleMatchRulesSection,
} from "../sections.js";

const noopProps = { onPlay: () => undefined, onBack: () => undefined, title: "Test Game" };

afterEach(() => {
  cleanup();
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe("battleRoyaleMenuSections", () => {
  it("registers neutral sections into the canonical named slots", () => {
    expect(battleRoyaleMenuSections.map((s) => [s.id, s.slot])).toEqual([
      ["br-lobby", "main.primaryActions"],
      ["br-loadout", "main.tabs"],
      ["br-private-room", "main.secondaryActions"],
      ["br-match-rules", "settings.tabs"],
    ]);
    expect(battleRoyaleMenuSections.every((s) => s.source === "plugin")).toBe(true);
    expect(battleRoyaleMenuSections.every((s) => typeof s.Component === "function")).toBe(true);
  });

  it("carries no brand/product literals in section ids", () => {
    const forbidden = /petwars|grassland|erw|\.pwmap/i;
    expect(battleRoyaleMenuSections.some((s) => forbidden.test(s.id))).toBe(false);
  });

  it("renders the match-rules summary", () => {
    render(<BattleRoyaleMatchRulesSection {...noopProps} />);
    expect(screen.queryByTestId("br-match-rules")).not.toBeNull();
    expect(screen.getByText(/Max players/i).textContent).toMatch(/Max players/i);
  });

  it("selects a loadout model on click (persistence covered by model-selection unit test)", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(<BattleRoyaleLoadoutSection {...noopProps} />);
    expect(screen.getByTestId("br-model-tank").getAttribute("aria-pressed")).toBe("false");
    await user.click(screen.getByTestId("br-model-tank"));
    expect(screen.getByTestId("br-model-tank").getAttribute("aria-pressed")).toBe("true");
  });
});

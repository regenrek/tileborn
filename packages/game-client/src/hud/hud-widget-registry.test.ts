import type { ComponentType } from "react";
import { describe, expect, it } from "vitest";

import type { HudWidgetProps } from "./hud-overlay.js";
import {
  findInvalidHudWidgetRegistrations,
  hudWidgetComponents,
  type HudWidgetRegistration,
} from "./hud-widget-registry.js";

const Noop = (() => null) as ComponentType<HudWidgetProps>;

const registration = (kind: string): HudWidgetRegistration => ({
  kind,
  source: "plugin",
  Component: Noop,
});

describe("findInvalidHudWidgetRegistrations", () => {
  it("accepts namespaced dotted kinds", () => {
    expect(
      findInvalidHudWidgetRegistrations([
        registration("arena.manaBar"),
        registration("myplugin.quest.Tracker"),
      ]),
    ).toEqual([]);
  });

  it("rejects the engine-reserved core namespace", () => {
    const violations = findInvalidHudWidgetRegistrations([
      registration("core.Minimap"),
      registration("core.somethingNew"),
    ]);
    expect(violations).toHaveLength(2);
    expect(violations[0]).toContain("reserved core kind");
  });

  it("rejects malformed kinds", () => {
    const violations = findInvalidHudWidgetRegistrations([
      registration("noNamespace"),
      registration("Upper.start"),
      registration("spaces in.kind"),
    ]);
    expect(violations).toHaveLength(3);
    for (const violation of violations) {
      expect(violation).toContain("malformed kind");
    }
  });

  it("reports duplicate kinds", () => {
    const violations = findInvalidHudWidgetRegistrations([
      registration("arena.manaBar"),
      registration("arena.manaBar"),
    ]);
    expect(violations).toEqual(['duplicate kind: "arena.manaBar" (2 registrations)']);
  });
});

describe("hudWidgetComponents", () => {
  it("maps kinds to components", () => {
    const components = hudWidgetComponents([registration("arena.manaBar")]);
    expect(components["arena.manaBar"]).toBe(Noop);
  });

  it("drops reserved core kinds defensively", () => {
    const components = hudWidgetComponents([registration("core.Minimap")]);
    expect(components["core.Minimap"]).toBeUndefined();
  });

  it("keeps the first registration on duplicate kinds", () => {
    const First = (() => null) as ComponentType<HudWidgetProps>;
    const Second = (() => null) as ComponentType<HudWidgetProps>;
    const components = hudWidgetComponents([
      { kind: "arena.manaBar", Component: First },
      { kind: "arena.manaBar", Component: Second },
    ]);
    expect(components["arena.manaBar"]).toBe(First);
  });
});

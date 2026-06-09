import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  CORE_HUD_WIDGET_KINDS,
  CORE_HUD_WIDGETS,
  HudLayout,
  standardHudLayout,
} from "./hud-layout.js";

describe("HudLayout schema", () => {
  it("decodes a plugin-supplied layout with offsets and custom kinds", () => {
    const layout = Schema.decodeUnknownSync(HudLayout)({
      id: "my-mode-hud",
      widgets: [
        {
          id: "mana",
          kind: "myMode.ManaBar",
          anchor: "bottom-right",
          order: 0,
          enabled: true,
          offset: { x: -8, y: -8 },
        },
        {
          id: "minimap",
          kind: CORE_HUD_WIDGETS.Minimap,
          anchor: "top-right",
          order: 0,
          enabled: false,
        },
      ],
    });
    expect(layout.widgets).toHaveLength(2);
    expect(layout.widgets[0]?.kind).toBe("myMode.ManaBar");
    expect(layout.widgets[1]?.enabled).toBe(false);
  });

  it("rejects unknown anchors", () => {
    expect(() =>
      Schema.decodeUnknownSync(HudLayout)({
        id: "bad",
        widgets: [
          { id: "w", kind: "core.Minimap", anchor: "somewhere", order: 0, enabled: true },
        ],
      }),
    ).toThrow();
  });

  it("round-trips through its encoded form", () => {
    const layout = standardHudLayout();
    const encoded = Schema.encodeUnknownSync(HudLayout)(layout);
    const decoded = Schema.decodeUnknownSync(HudLayout)(encoded);
    expect(decoded).toEqual(layout);
  });

  it("ships a standard layout covering every baseline widget kind exactly once", () => {
    const layout = standardHudLayout();
    const kinds = layout.widgets.map((widget) => widget.kind as string);
    expect([...kinds].sort()).toEqual([...CORE_HUD_WIDGET_KINDS].sort());
    expect(new Set(layout.widgets.map((widget) => widget.id as string)).size).toBe(
      layout.widgets.length,
    );
  });
});

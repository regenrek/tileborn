import { CORE_HUD_WIDGETS, HudLayout } from "@tileborne/core";
import { render, within } from "@testing-library/react";
import { Schema } from "effect";
import { describe, expect, it, vi } from "vitest";

import { HudOverlay } from "./hud-overlay.js";
import {
  formatAlivePlayersLabel,
  formatZoneStatusLabel,
  healthPercent,
  type HudMetrics,
} from "./hud-state.js";

const baseMetrics: HudMetrics = {
  playerCount: 2,
  tickCount: 120,
  hud: {
    totalPlayers: 4,
    localPlayer: {
      playerId: "player-1",
      displayName: "Player 1",
      health: 65,
      maxHealth: 100,
    },
    zoneStatus: {
      phase: "countdown",
      secondsRemaining: 42,
    },
    gameplayEvents: [],
  },
};

describe("hud-state helpers", () => {
  it("formats alive player and zone labels", () => {
    expect(formatAlivePlayersLabel(2, 4)).toBe("2 / 4 players alive");
    expect(formatZoneStatusLabel({ phase: "countdown", secondsRemaining: 42 })).toBe(
      "Zone shrinks in 42s",
    );
    expect(formatZoneStatusLabel({ phase: "shrinking" })).toBe("Zone shrinking");
    expect(formatZoneStatusLabel({ phase: "stable" })).toBe("Zone stable");
    expect(healthPercent(65, 100)).toBe(65);
  });
});

describe("HudOverlay", () => {
  it("renders the baseline widgets from runtime metrics", () => {
    const { container } = render(<HudOverlay metrics={baseMetrics} />);
    const view = within(container);

    expect(view.getByTestId("playtest-hud-alive-count").textContent).toBe("2 / 4 players alive");
    expect(view.getByTestId("playtest-hud-player-name").textContent).toBe("Player 1");
    expect(view.getByTestId("playtest-hud-zone-status").textContent).toBe("Zone shrinks in 42s");
  });

  it("renders widgets only at the anchors named by the HudLayout data", () => {
    const layout = Schema.decodeUnknownSync(HudLayout)({
      id: "test.layout",
      widgets: [
        {
          id: "alive",
          kind: CORE_HUD_WIDGETS.AliveCount,
          anchor: "bottom-left",
          order: 0,
          enabled: true,
        },
        {
          id: "zone",
          kind: CORE_HUD_WIDGETS.ZoneStatus,
          anchor: "top-center",
          order: 0,
          enabled: false,
        },
      ],
    });
    const { container } = render(<HudOverlay metrics={baseMetrics} layout={layout} />);
    const view = within(container);

    const alive = view.getByTestId("playtest-hud-alive-count");
    expect(alive.closest("[data-hud-anchor]")?.getAttribute("data-hud-anchor")).toBe("bottom-left");
    expect(view.queryByTestId("playtest-hud-zone-status")).toBeNull();
    expect(view.queryByTestId("playtest-hud-local-player")).toBeNull();
  });

  it("renders custom widget kinds via customWidgets registrations", () => {
    const layout = Schema.decodeUnknownSync(HudLayout)({
      id: "test.customWidget",
      widgets: [
        { id: "mana", kind: "arena.manaBar", anchor: "bottom-left", order: 0, enabled: true },
      ],
    });
    const { container } = render(
      <HudOverlay
        metrics={baseMetrics}
        layout={layout}
        customWidgets={[
          {
            kind: "arena.manaBar",
            source: "plugin",
            Component: ({ ctx }) => (
              <div data-testid="arena-mana-bar">MP {ctx.localPlayer?.health}</div>
            ),
          },
        ]}
      />,
    );
    const view = within(container);

    expect(view.getByTestId("arena-mana-bar").textContent).toBe("MP 65");
    const host = view.getByTestId("arena-mana-bar").closest("[data-hud-widget-kind]");
    expect(host?.getAttribute("data-hud-widget-kind")).toBe("arena.manaBar");
  });

  it("never lets customWidgets override engine core kinds", () => {
    const Fake = () => <div data-testid="fake-alive-count">hacked</div>;
    const { container } = render(
      <HudOverlay metrics={baseMetrics} customWidgets={[{ kind: CORE_HUD_WIDGETS.AliveCount, Component: Fake }]} />,
    );
    const view = within(container);

    expect(view.queryByTestId("fake-alive-count")).toBeNull();
    expect(view.getByTestId("playtest-hud-alive-count").textContent).toBe("2 / 4 players alive");
  });

  it("renders unregistered kinds as draggable placeholders in edit mode", () => {
    const layout = Schema.decodeUnknownSync(HudLayout)({
      id: "test.placeholder",
      widgets: [
        { id: "mana", kind: "arena.manaBar", anchor: "top-left", order: 0, enabled: true },
      ],
    });
    const { container } = render(
      <HudOverlay metrics={baseMetrics} layout={layout} editing onMoveWidget={vi.fn()} />,
    );
    const view = within(container);

    expect(view.getByTestId("hud-widget-placeholder").textContent).toBe("Mana Bar");
    const host = container.querySelector('[data-hud-widget-id="mana"]');
    expect(host?.getAttribute("draggable")).toBe("true");
  });

  it("skips unknown plugin widget kinds without breaking the chassis", () => {
    const layout = Schema.decodeUnknownSync(HudLayout)({
      id: "test.custom",
      widgets: [
        { id: "custom", kind: "myplugin.specialMeter", anchor: "top-left", order: 0, enabled: true },
        {
          id: "alive",
          kind: CORE_HUD_WIDGETS.AliveCount,
          anchor: "top-right",
          order: 0,
          enabled: true,
        },
      ],
    });
    const { container } = render(<HudOverlay metrics={baseMetrics} layout={layout} />);
    const view = within(container);

    expect(view.getByTestId("playtest-hud-alive-count")).toBeTruthy();
    expect(container.querySelector('[data-hud-widget-kind="myplugin.specialMeter"]')).toBeNull();
  });

  it("treats missing placement offsets as no offset", () => {
    const layout = {
      id: "legacy-project-layout",
      widgets: [
        {
          id: "alive",
          kind: CORE_HUD_WIDGETS.AliveCount,
          anchor: "top-right",
          order: 0,
          enabled: true,
        },
      ],
    } as unknown as HudLayout;
    const { container } = render(<HudOverlay metrics={baseMetrics} layout={layout} />);
    const view = within(container);

    expect(view.getByTestId("playtest-hud-alive-count").textContent).toBe("2 / 4 players alive");
    expect(container.querySelector('[data-hud-widget-id="alive"]')?.getAttribute("style")).toBe(
      null,
    );
  });

  it("accepts plain durable placement offsets before schema rehydration", () => {
    const layout = {
      id: "durable-project-layout",
      widgets: [
        {
          id: "alive",
          kind: CORE_HUD_WIDGETS.AliveCount,
          anchor: "top-right",
          order: 0,
          enabled: true,
          offset: { x: 6, y: -4 },
        },
      ],
    } as unknown as HudLayout;
    const { container } = render(<HudOverlay metrics={baseMetrics} layout={layout} />);

    expect(
      (container.querySelector('[data-hud-widget-id="alive"]') as HTMLElement).style.transform,
    ).toBe("translate(6px, -4px)");
  });

  it("exposes drop zones and notifies onMoveWidget while editing", () => {
    const onMoveWidget = vi.fn();
    const layout = Schema.decodeUnknownSync(HudLayout)({
      id: "test.edit",
      widgets: [
        {
          id: "alive",
          kind: CORE_HUD_WIDGETS.AliveCount,
          anchor: "top-left",
          order: 0,
          enabled: true,
        },
      ],
    });
    const { container } = render(
      <HudOverlay metrics={baseMetrics} layout={layout} editing onMoveWidget={onMoveWidget} />,
    );

    const dropZones = container.querySelectorAll("[data-hud-drop-zone]");
    expect(dropZones.length).toBe(9);
    const draggable = container.querySelector('[data-hud-widget-id="alive"]');
    expect(draggable?.getAttribute("draggable")).toBe("true");
  });
});

import { CORE_HUD_WIDGETS, HudLayout } from "@tileborne/core";
import { Schema } from "effect";

/**
 * Battle Royale's default in-match HUD layout as DATA (the typed
 * `RuntimeHudLayout` contribution slot — sibling of the ADR-0024 input-map
 * contribution).
 *
 * The engine owns the `@tileborne/core` `HudLayout` SHAPE and the HUD renderer
 * (anchor slots + widget components); BR owns WHICH widgets its mode shows and
 * WHERE they sit. A user overlay of the same shape is applied on top at
 * resolve time (`resolveEffectiveHudLayout`), so players can move / hide /
 * duplicate any widget without engine or plugin edits. This reproduces today's
 * BR HUD arrangement exactly.
 */

/** Contribution id for BR's default HUD layout registered via the typed slot. */
export const BR_HUD_LAYOUT_CONTRIBUTION_ID = "br-hud-layout";

/** Durable id of BR's default HUD layout. */
export const BR_HUD_LAYOUT_ID = "br-default-hud";

interface PlacementData {
  readonly id: string;
  readonly kind: string;
  readonly anchor: string;
  readonly order: number;
  readonly enabled: boolean;
}

const placement = (id: string, kind: string, anchor: string, order: number): PlacementData => ({
  id,
  kind,
  anchor,
  order,
  enabled: true,
});

/**
 * Build BR's default HUD layout as plain neutral DATA (the JSON shape declared
 * in the manifest's typed `hudLayouts` slot and decoded by
 * `@tileborne/plugin-api`'s `decodeHudLayout`). Keep this in sync with the
 * `tileborne-plugin.json` `runtime.hudLayouts` entry (the BR hud-layout test
 * asserts the manifest decodes to the same layout).
 */
export const buildBattleRoyaleHudLayoutData = (): {
  readonly id: string;
  readonly widgets: readonly PlacementData[];
} => ({
  id: BR_HUD_LAYOUT_ID,
  widgets: [
    placement("local-player", CORE_HUD_WIDGETS.LocalPlayerStatus, "top-left", 0),
    placement("team-roster", CORE_HUD_WIDGETS.TeamRoster, "top-left", 1),
    placement("alive-count", CORE_HUD_WIDGETS.AliveCount, "top-right", 0),
    placement("minimap", CORE_HUD_WIDGETS.Minimap, "top-right", 1),
    placement("scoreboard", CORE_HUD_WIDGETS.Scoreboard, "top-right", 2),
    placement("zone-status", CORE_HUD_WIDGETS.ZoneStatus, "bottom-center", 0),
    placement("pickup-prompt", CORE_HUD_WIDGETS.PickupPrompt, "bottom-center", 1),
    placement("weapon-panel", CORE_HUD_WIDGETS.WeaponPanel, "bottom-center", 2),
    placement("kill-feed", CORE_HUD_WIDGETS.KillFeed, "bottom-left", 0),
    placement("event-toast", CORE_HUD_WIDGETS.EventToast, "center", 0),
    placement("damage-indicator", CORE_HUD_WIDGETS.DamageIndicator, "center", 1),
  ],
});

/**
 * Decode BR's default {@link buildBattleRoyaleHudLayoutData} into a typed
 * `@tileborne/core` {@link HudLayout}. Self-contained (validates against the
 * core schema directly) so the renderer playtest host can build the effective
 * layout without reaching for the host registry. The user's HUD customisation
 * overlay is applied on top by the engine (`resolveEffectiveHudLayout`).
 */
export const battleRoyaleDefaultHudLayout = (): HudLayout =>
  Schema.decodeUnknownSync(HudLayout)(buildBattleRoyaleHudLayoutData());

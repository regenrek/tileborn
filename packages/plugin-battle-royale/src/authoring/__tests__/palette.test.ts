import { describe, expect, it } from "vitest";

import {
  BARRIER_KEY,
  DECOY_KEY,
  LOOT_CRATE_KEY,
  PLUGIN_ID,
  SHRINK_ZONE_ANCHOR_KEY,
  SPAWN_POINT_KEY,
  TRAP_KEY,
} from "../../constants.js";
import { BATTLE_ROYALE_PALETTE_ACTIONS } from "../palette.js";

describe("Battle Royale palette contribution", () => {
  it("registers spawn-point, shrink-anchor and loot-crate as sticky markers keyed on objectKind", () => {
    expect(BATTLE_ROYALE_PALETTE_ACTIONS.pluginId).toBe(PLUGIN_ID);
    // The palette brush carries the human object-kind KEY; the editor resolves it
    // to a catalog GameObjectTypeId at placement time.
    expect(BATTLE_ROYALE_PALETTE_ACTIONS.items.map((item) => item.objectKind)).toEqual([
      SPAWN_POINT_KEY,
      SHRINK_ZONE_ANCHOR_KEY,
      LOOT_CRATE_KEY,
      TRAP_KEY,
      DECOY_KEY,
      BARRIER_KEY,
    ]);
    for (const item of BATTLE_ROYALE_PALETTE_ACTIONS.items) {
      expect(item.placement).toBe("sticky");
      expect(item.icon).toBeTruthy();
    }
  });
});

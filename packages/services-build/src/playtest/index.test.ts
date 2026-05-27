import { describe, expect, it } from "vitest";

import {
  activeBattleRoyalePlaytestPluginIds,
  BATTLE_ROYALE_PLUGIN_ID,
} from "./index.js";

describe("playtest battle royale plugin selection", () => {
  it("starts playtest with the enabled battle royale plugin only", () => {
    expect(
      activeBattleRoyalePlaytestPluginIds([
        { id: BATTLE_ROYALE_PLUGIN_ID, enabled: true },
        { id: "@tileborne-plugins/other-runtime", enabled: true },
        { id: BATTLE_ROYALE_PLUGIN_ID, enabled: false },
      ]),
    ).toEqual([BATTLE_ROYALE_PLUGIN_ID]);
  });
});

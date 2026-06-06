import { describe, expect, it } from "vitest";

import { ArenaEntitySnapshot, ArenaSnapshot } from "../wire-codec.js";
import {
  ARENA_DUMMY_TEXTURE_ASSET_ID,
  ARENA_HIT_FLASH_TEXTURE_ASSET_ID,
  ARENA_MELEE_SWING_TEXTURE_ASSET_ID,
  ARENA_PLAYER_TEXTURE_ASSET_ID,
  projectArenaSnapshot,
} from "./arena-projector.js";

describe("arena projector", () => {
  it("maps an arena snapshot to renderable player, dummy, and health entities", () => {
    const entities = projectArenaSnapshot(
      new ArenaSnapshot({
        tick: 1,
        serverTimestampMs: 1,
        entities: [
          new ArenaEntitySnapshot({
            id: "player-1",
            kind: "player",
            x: 0,
            y: 0,
            health: 100,
            maxHealth: 100,
            headingDeg: 0,
            attacking: true,
            attackTick: 1,
          }),
          new ArenaEntitySnapshot({
            id: "dummy-1",
            kind: "dummy",
            x: 20,
            y: 0,
            health: 85,
            maxHealth: 100,
            headingDeg: 180,
            hitTick: 1,
          }),
        ],
      }),
    );

    expect(entities).not.toHaveLength(0);
    expect(entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "arena:player:player-1",
          assetId: ARENA_PLAYER_TEXTURE_ASSET_ID,
        }),
        expect.objectContaining({
          id: "arena:dummy:dummy-1",
          assetId: ARENA_DUMMY_TEXTURE_ASSET_ID,
        }),
        expect.objectContaining({
          id: "arena:health:dummy-1",
          scale: 0.85,
        }),
        expect.objectContaining({
          id: "arena:attack:player-1",
          assetId: ARENA_MELEE_SWING_TEXTURE_ASSET_ID,
        }),
        expect.objectContaining({
          id: "arena:hit:dummy-1",
          assetId: ARENA_HIT_FLASH_TEXTURE_ASSET_ID,
        }),
      ]),
    );
  });
});

import { describe, expect, it } from "vitest";

import {
  ArenaEntitySnapshot,
  ArenaSnapshot,
  decodeArenaServerMessage,
  encodeArenaServerMessage,
} from "./wire-codec.js";

describe("arena wire codec", () => {
  it("round-trips a snapshot frame through the arena codec", () => {
    const frame = new ArenaSnapshot({
      tick: 7,
      serverTimestampMs: 1234,
      entities: [
        new ArenaEntitySnapshot({
          id: "player-1",
          kind: "player",
          x: 1,
          y: 2,
          health: 100,
          maxHealth: 100,
          headingDeg: 0,
          attacking: true,
          attackTick: 7,
        }),
        new ArenaEntitySnapshot({
          id: "dummy-1",
          kind: "dummy",
          x: 20,
          y: 2,
          health: 85,
          maxHealth: 100,
          headingDeg: 180,
          hitTick: 7,
        }),
      ],
    });

    const decoded = decodeArenaServerMessage(encodeArenaServerMessage(frame));

    expect(decoded).toMatchObject({
      _tag: "ArenaSnapshot",
      tick: 7,
      serverTimestampMs: 1234,
      entities: [
        { id: "player-1", kind: "player", health: 100, attacking: true, attackTick: 7 },
        { id: "dummy-1", kind: "dummy", health: 85, hitTick: 7 },
      ],
    });
  });
});

import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  RuntimePlaytestInputRequest,
  RuntimePlaytestSnapshotResponse,
  RuntimeStartLocalHostResponse,
  RuntimeStopLocalHostResponse,
} from "./runtime.js";

const roundTrip = <A, I>(schema: Schema.Top, value: I) => {
  const codec = schema as Schema.Codec<A, I, never, never>;
  const decoded = Schema.decodeUnknownSync(codec)(value);
  expect(Schema.encodeSync(codec)(decoded)).toEqual(value);
};

describe("runtime IPC contracts", () => {
  it("round-trips start/stop local host responses", () => {
    roundTrip(RuntimeStartLocalHostResponse, {
      baseUrl: "http://127.0.0.1:8787",
      signingKey: "local-handoff-signing-key-32-bytes-x",
    });
    roundTrip(RuntimeStopLocalHostResponse, {});
  });

  it("round-trips playtest input and snapshot payloads", () => {
    roundTrip(RuntimePlaytestInputRequest, {
      sessionId: "playtest:550e8400-e29b-41d4-a716-446655440000",
      playerId: "player-1",
      tick: 12,
      seq: 3,
      dir: 0,
      shoot: false,
      aimDeg: 90,
      weaponSlot: 2,
    });
    roundTrip(RuntimePlaytestSnapshotResponse, {
      players: [{ playerId: "player-1", x: 10.5, y: 20.25 }],
    });
  });

  it("accepts playtest input without optional aim and weapon fields", () => {
    roundTrip(RuntimePlaytestInputRequest, {
      sessionId: "playtest:550e8400-e29b-41d4-a716-446655440000",
      tick: 13,
      seq: 4,
      dir: 6,
      shoot: true,
    });
  });

  it("accepts shoot-only playtest input without movement direction", () => {
    roundTrip(RuntimePlaytestInputRequest, {
      sessionId: "playtest:550e8400-e29b-41d4-a716-446655440000",
      tick: 14,
      seq: 5,
      shoot: true,
    });
  });
});

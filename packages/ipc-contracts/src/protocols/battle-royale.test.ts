import { Option, Schema } from "effect";
import { pack } from "msgpackr";
import { describe, expect, it } from "vitest";

import {
  BattleRoyaleMessage,
  DeltaSnapshot,
  GameOver,
  Heartbeat,
  PlayerInput,
  PlayerJoined,
  PlayerKilled,
  PlayerLeft,
  ProjectileSnapshot,
  ProjectileUpdate,
  WelcomeSnapshot,
  WireError,
  decodeMessage,
  encodeMessage,
  makePlayerId,
  makeProjectileId,
} from "./battle-royale.ts";

const player = (suffix: string) => makePlayerId(`player-${suffix}`);

const sampleMessages: readonly Schema.Schema.Type<typeof BattleRoyaleMessage>[] = [
  new PlayerInput({
    tick: 12,
    seq: 3,
    dir: Option.some(2),
    shoot: true,
    aimDeg: Option.some(90),
    weaponSlot: Option.some(2),
  }),
  new Heartbeat({
    tick: 12,
  }),
  new WelcomeSnapshot({
    tick: 0,
    serverTimestampMs: 1000,
    seed: "seed-1",
    players: [
      { id: player("1"), x: 10, y: 20, health: 100 },
      { id: player("2"), x: 30, y: 40, health: 80 },
    ],
    projectiles: [
      new ProjectileSnapshot({
        id: makeProjectileId("projectile-1"),
        ownerPlayerId: player("1"),
        weaponSlot: 0,
        x: 12,
        y: 24,
        vx: 1,
        vy: 0,
        rotation: 0,
        ttlMs: 300,
      }),
    ],
    zone: { cx: 64, cy: 64, radius: 128 },
  }),
  new DeltaSnapshot({
    tick: 5,
    serverTimestampMs: 1050,
    removed: [player("3")],
    updated: [
      {
        id: player("1"),
        x: Option.some(11),
        y: Option.none(),
        health: Option.some(95),
      },
    ],
    projectilesUpdated: [
      new ProjectileUpdate({
        id: makeProjectileId("projectile-1"),
        ownerPlayerId: Option.none(),
        weaponSlot: Option.none(),
        x: Option.some(14),
        y: Option.none(),
        vx: Option.none(),
        vy: Option.none(),
        rotation: Option.none(),
        ttlMs: Option.some(284),
      }),
    ],
    projectilesRemoved: [makeProjectileId("projectile-2")],
    zone: Option.some({ cx: 64, cy: 64, radius: 120 }),
  }),
  new PlayerJoined({
    id: player("4"),
  }),
  new PlayerLeft({
    id: player("4"),
  }),
  new PlayerKilled({
    killer: player("1"),
    victim: player("2"),
    tick: 42,
  }),
  new GameOver({
    winner: player("1"),
  }),
  new WireError({
    code: "invalid_input",
    message: "tick out of range",
  }),
];

describe("BattleRoyaleProtocol wire codec", () => {
  for (const message of sampleMessages) {
    it(`round-trips ${message._tag}`, () => {
      expect(decodeMessage(encodeMessage(message))).toEqual(message);
    });
  }

  it("keeps DeltaSnapshot with 16 player updates under 512 bytes", () => {
    const delta = new DeltaSnapshot({
      tick: 100,
      serverTimestampMs: 5_000,
      removed: [],
      updated: Array.from({ length: 16 }, (_, index) => ({
        id: makePlayerId(String(index)),
        x: Option.some(index * 2),
        y: Option.some(index * 3),
        health: Option.none(),
      })),
      projectilesUpdated: [],
      projectilesRemoved: [],
      zone: Option.none(),
    });

    const bytes = encodeMessage(delta);
    expect(bytes.byteLength).toBeLessThan(512);
  });

  it("decodes legacy PlayerInput frames without optional aim or weapon fields", () => {
    const decoded = decodeMessage(pack({ _tag: "PlayerInput", tick: 12, seq: 3, dir: 2, shoot: true }));

    expect(decoded).toBeInstanceOf(PlayerInput);
    expect(decoded).toMatchObject({
      tick: 12,
      seq: 3,
      dir: Option.some(2),
      shoot: true,
      aimDeg: Option.none(),
      weaponSlot: Option.none(),
    });
  });

  it("round-trips shoot-only PlayerInput without movement direction", () => {
    const input = new PlayerInput({
      tick: 13,
      seq: 4,
      dir: Option.none(),
      shoot: true,
      aimDeg: Option.none(),
      weaponSlot: Option.none(),
    });

    const decoded = decodeMessage(encodeMessage(input));

    expect(decoded).toEqual(input);
    expect(decoded).toMatchObject({
      dir: Option.none(),
      shoot: true,
    });
  });

  it("round-trips a per-player modelId on PlayerSnapshot", () => {
    const welcome = new WelcomeSnapshot({
      tick: 7,
      serverTimestampMs: 7,
      seed: "seed",
      players: [
        { id: player("1"), x: 10, y: 20, health: 100, modelId: "model:hero" },
        { id: player("2"), x: 30, y: 40, health: 100 },
      ],
      projectiles: [],
      zone: { cx: 0, cy: 0, radius: 100 },
    });
    const decoded = decodeMessage(encodeMessage(welcome)) as WelcomeSnapshot;
    expect(decoded.players[0]?.modelId).toBe("model:hero");
    expect(decoded.players[1]?.modelId).toBeUndefined();
  });

  it("decodes legacy snapshot frames by defaulting server timestamp from tick", () => {
    const welcome = decodeMessage(
      pack({
        _tag: "WelcomeSnapshot",
        tick: 42,
        seed: "seed-1",
        players: [],
        projectiles: [],
        zone: { cx: 0, cy: 0, radius: 100 },
      }),
    );
    const delta = decodeMessage(
      pack({
        _tag: "DeltaSnapshot",
        tick: 43,
        removed: [],
        updated: [],
        projectilesUpdated: [],
        projectilesRemoved: [],
      }),
    );

    expect(welcome).toMatchObject({ _tag: "WelcomeSnapshot", serverTimestampMs: 42 });
    expect(delta).toMatchObject({ _tag: "DeltaSnapshot", serverTimestampMs: 43 });
  });
});

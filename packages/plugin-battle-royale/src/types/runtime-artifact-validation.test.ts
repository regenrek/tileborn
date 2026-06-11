import {
  LOOT_CRATE_KIND,
  SHRINK_ZONE_ANCHOR_KIND,
  SPAWN_POINT_KIND,
} from "../constants.js";
import { describe, expect, it } from "vitest";

import { assertRuntimeBattleRoyaleArtifact } from "./runtime-artifact-validation.js";

const tileId = "tile:00000000-0000-4000-8000-000000000001";
const packId = "pack:00000000-0000-4000-8000-000000000002";
const clipIdAt = (index: number) => `clip:00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

const makeRuntimeArtifact = () => ({
  schemaVersion: 1,
  maxPlayers: 2,
  spawnPoints: [
    { x: 10, y: 20, team: "solo", weight: 1 },
    { x: 30, y: 40, team: "solo", weight: 2 },
  ],
  spawnAnchors: [
    { x: 10, y: 20, team: "solo", weight: 1 },
    { x: 30, y: 40, team: "solo", weight: 2 },
  ],
  shrinkSchedule: {
    centerX: 16,
    centerY: 16,
    startRadiusTiles: 16,
    endRadiusTiles: 4,
    shrinkIntervalMs: 30_000,
    damagePerSecond: 5,
  },
  lootTables: [{ itemKind: "rifle", tier: "rare", weight: 1 }],
  objectPlacements: [
    {
      objectId: "object:00000000-0000-4000-8000-000000000101",
      role: "spawn-point",
      kind: SPAWN_POINT_KIND,
      x: 10,
      y: 20,
      properties: { team: "solo", weight: 1 },
    },
    {
      objectId: "object:00000000-0000-4000-8000-000000000102",
      role: "shrink-zone-anchor",
      kind: SHRINK_ZONE_ANCHOR_KIND,
      x: 16,
      y: 16,
      properties: { initialRadiusTiles: 16, finalRadiusTiles: 4 },
    },
    {
      objectId: "object:00000000-0000-4000-8000-000000000103",
      role: "loot-crate",
      kind: LOOT_CRATE_KIND,
      x: 12,
      y: 18,
      properties: { itemKind: "rifle", tier: "rare", weight: 1 },
    },
  ],
  collision: {
    tileWidth: 16,
    tileHeight: 16,
    chunks: [{ x: 0, y: 0, width: 2, height: 1, tiles: [0, 1] }],
    tileIdByIndex: [null, tileId],
  },
  tilesetPack: {
    tilesets: [
      {
        tiles: [
          {
            id: tileId,
            collisionMask: { _tag: "bitmask", passable: 0, blocked: 15 },
          },
        ],
      },
    ],
  },
  battleRoyale: {
    damage: { playerHealth: 75 },
    projectile: { weaponSlotCount: 3, damage: 12 },
  },
  playerModels: [
    {
      id: "model:plain",
      label: "Plain",
      ref: {
        packId,
        kind: "sprite",
        refId: "placeable:plain",
        clipId: clipIdAt(0),
      },
      defaultClipId: clipIdAt(0),
      clips: {
        idle: clipIdAt(0),
        walk: clipIdAt(1),
        run: clipIdAt(2),
        shoot: clipIdAt(3),
        reload: clipIdAt(4),
        hit: clipIdAt(5),
        death: clipIdAt(6),
        dash: clipIdAt(7),
        pickup: clipIdAt(8),
      },
      anchor: { x: 0.5, y: 1 },
      hitbox: { x: 0.25, y: 0.1, width: 0.5, height: 0.85 },
    },
  ],
  defaultPlayerModelId: "model:plain",
});

describe("runtime artifact validation", () => {
  it("round-trips the plain installed-plugin artifact shape without SDK classes", () => {
    const serialized = JSON.parse(JSON.stringify(makeRuntimeArtifact())) as unknown;
    const artifact = assertRuntimeBattleRoyaleArtifact(serialized);

    expect(artifact.spawnAnchors).toHaveLength(2);
    expect(artifact.objectPlacements.map((placement) => placement.role)).toEqual([
      "spawn-point",
      "shrink-zone-anchor",
      "loot-crate",
    ]);
    expect(artifact.lootTables[0]).toEqual({ itemKind: "rifle", tier: "rare", weight: 1 });
    expect(artifact.collision?.chunks[0]?.tiles).toEqual([0, 1]);
    expect(artifact.tilesetPack?.tilesets[0]?.tiles[0]?.collisionMask).toEqual({
      _tag: "bitmask",
      passable: 0,
      blocked: 15,
    });
    expect(artifact.battleRoyale?.projectile?.weaponSlotCount).toBe(3);
    expect(artifact.defaultPlayerModelId).toBe("model:plain");
  });

  it("rejects semantic drift between placement role and canonical object kind", () => {
    const artifact = makeRuntimeArtifact();

    expect(() =>
      assertRuntimeBattleRoyaleArtifact({
        ...artifact,
        objectPlacements: [
          {
            ...artifact.objectPlacements[0],
            kind: LOOT_CRATE_KIND,
          },
        ],
      }),
    ).toThrow(/spawn placement kind/);
  });

  it("rejects editor-authored loot placements with missing item data", () => {
    const artifact = makeRuntimeArtifact();

    expect(() =>
      assertRuntimeBattleRoyaleArtifact({
        ...artifact,
        objectPlacements: [
          ...artifact.objectPlacements.slice(0, 2),
          {
            ...artifact.objectPlacements[2],
            properties: { itemKind: "", tier: "", weight: 0 },
          },
        ],
      }),
    ).toThrow(/loot placement item kind is required/);
  });
});

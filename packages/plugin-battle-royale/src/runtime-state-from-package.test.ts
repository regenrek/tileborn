import {
  GameObjectType,
  MapObject,
  RuntimeMapPackageVisuals,
  TileborneMap,
  gameObjectTypeIdForKey,
  makeTileborneMap,
} from "@tileborne/core";
import { Option, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  DECOY_KIND,
  LOOT_CRATE_KIND,
  PLUGIN_ID,
  SHRINK_ZONE_ANCHOR_KIND,
  SPAWN_POINT_KIND,
  TRAP_KIND,
  ZONE,
} from "./constants.js";
import { TEST_LAYER_ID, TEST_MAP_ID, TEST_OBJECT_IDS } from "./id-utils.js";
import { buildBattleRoyaleRuntimeState } from "./runtime-state-from-package.js";
import {
  buildTestMapPackage,
  shippedCatalogObjectTypes,
  toCatalogEntries,
} from "./test-map-package.js";
import { TEST_PLAYER_MODELS } from "./test-player-model.js";

const makeTestObject = (
  id: (typeof TEST_OBJECT_IDS)[number],
  kindKey: string,
  x: number,
  y: number,
  properties: MapObject["properties"] = {},
): MapObject =>
  new MapObject({
    id,
    kind: gameObjectTypeIdForKey(kindKey),
    x,
    y,
    width: Option.none(),
    height: Option.none(),
    layerId: TEST_LAYER_ID,
    properties,
  });

const makeFixtureMap = (): TileborneMap =>
  makeTileborneMap({
    id: TEST_MAP_ID,
    width: 32,
    height: 32,
    tileWidth: 32,
    tileHeight: 32,
    properties: { [PLUGIN_ID]: { maxPlayers: 8, zone: { damagePerSecOutside: 7 } } },
    objects: [
      makeTestObject(TEST_OBJECT_IDS[0], "spawn-point", 1, 1, { team: "alpha", weight: 2 }),
      makeTestObject(TEST_OBJECT_IDS[1], "spawn-point", 2, 2),
      makeTestObject(TEST_OBJECT_IDS[2], "spawn-point", 3, 3),
      makeTestObject(TEST_OBJECT_IDS[3], "spawn-point", 4, 4),
      makeTestObject(TEST_OBJECT_IDS[4], "shrink-zone-anchor", 16, 16, {
        initialRadiusTiles: 20,
        finalRadiusTiles: 3,
      }),
      makeTestObject(TEST_OBJECT_IDS[5], "loot-crate", 8, 8, {
        itemKind: "health-pack",
        tier: "common",
        weight: 3,
      }),
      makeTestObject(TEST_OBJECT_IDS[6], "trap", 10, 10, { radius: 50 }),
      makeTestObject(TEST_OBJECT_IDS[7], "decoy", 12, 12),
    ],
  });

describe("buildBattleRoyaleRuntimeState", () => {
  it("derives the full BR runtime state from the package sections", () => {
    const state = buildBattleRoyaleRuntimeState(buildTestMapPackage({ map: makeFixtureMap() }));

    expect(state.maxPlayers).toBe(8);
    expect(state.spawnPoints).toEqual([
      { x: 1, y: 1, team: "alpha", weight: 2 },
      { x: 2, y: 2, team: "solo", weight: 1 },
      { x: 3, y: 3, team: "solo", weight: 1 },
      { x: 4, y: 4, team: "solo", weight: 1 },
    ]);
    expect(state.spawnAnchors).toEqual(state.spawnPoints);
    expect(state.shrinkSchedule).toEqual({
      centerX: 16,
      centerY: 16,
      startRadiusTiles: 20,
      endRadiusTiles: 3,
      shrinkIntervalMs: ZONE.shrinkIntervalMs,
      damagePerSecond: ZONE.damagePerSecond,
    });
    expect(state.lootTables).toEqual([{ itemKind: "health-pack", tier: "common", weight: 1 }]);
    expect(state.objectPlacements.map((placement) => placement.role)).toEqual([
      "spawn-point",
      "spawn-point",
      "spawn-point",
      "spawn-point",
      "shrink-zone-anchor",
      "loot-crate",
      "trap",
      "decoy",
    ]);
    expect(state.objectPlacements.map((placement) => placement.kind)).toEqual([
      SPAWN_POINT_KIND,
      SPAWN_POINT_KIND,
      SPAWN_POINT_KIND,
      SPAWN_POINT_KIND,
      SHRINK_ZONE_ANCHOR_KIND,
      LOOT_CRATE_KIND,
      TRAP_KIND,
      DECOY_KIND,
    ]);
    expect(state.battleRoyale?.zone?.damagePerSecOutside).toBe(7);
    expect(state.playerModels).toEqual(TEST_PLAYER_MODELS);
    expect(state.defaultPlayerModelId).toBe(TEST_PLAYER_MODELS[0].id);
    expect(state.playerModelSelections).toEqual([]);
  });

  it("applies host-channel player-model selections into the runtime state", () => {
    const state = buildBattleRoyaleRuntimeState(buildTestMapPackage({ map: makeFixtureMap() }), {
      playerModelSelections: [
        { playerId: "player-1", modelId: TEST_PLAYER_MODELS[0].id },
      ],
    });

    expect(state.playerModelSelections).toEqual([
      { playerId: "player-1", modelId: TEST_PLAYER_MODELS[0].id },
    ]);
  });

  it("fails with a clear error when the BR modeData section is missing", () => {
    const encoded = buildTestMapPackage({ map: makeFixtureMap(), modeData: {} });

    expect(() => buildBattleRoyaleRuntimeState(encoded)).toThrow(
      new RegExp(`no modeData section for "${PLUGIN_ID}"`),
    );
  });

  it("derives the trap role from the hazard component, not the well-known type id", () => {
    const flameVent = Schema.decodeUnknownSync(GameObjectType)({
      id: String(gameObjectTypeIdForKey("flame-vent")),
      schemaVersion: 1,
      label: "Flame Vent",
      family: "hazard",
      components: [{ _tag: "hazard", data: {} }],
      instanceDefaults: {},
    });
    const map = makeTileborneMap({
      id: TEST_MAP_ID,
      width: 32,
      height: 32,
      tileWidth: 32,
      tileHeight: 32,
      objects: [
        makeTestObject(TEST_OBJECT_IDS[0], "spawn-point", 1, 1),
        makeTestObject(TEST_OBJECT_IDS[1], "flame-vent", 10, 10, { radius: 50 }),
      ],
    });
    const state = buildBattleRoyaleRuntimeState(
      buildTestMapPackage({
        map,
        catalog: toCatalogEntries([...shippedCatalogObjectTypes(), flameVent]),
      }),
    );

    const trap = state.objectPlacements.find((placement) => placement.role === "trap");
    expect(trap).toEqual({
      objectId: TEST_OBJECT_IDS[1],
      role: "trap",
      kind: TRAP_KIND,
      x: 10,
      y: 10,
      properties: { radius: 50, slowTicks: 60, stunTicks: 10, damageTicks: 60 },
    });
  });

  it("derives shrink-anchor and decoy roles by well-known type id with authored defaults", () => {
    const map = makeTileborneMap({
      id: TEST_MAP_ID,
      width: 32,
      height: 32,
      tileWidth: 32,
      tileHeight: 32,
      objects: [
        makeTestObject(TEST_OBJECT_IDS[0], "spawn-point", 1, 1),
        makeTestObject(TEST_OBJECT_IDS[1], "shrink-zone-anchor", 16, 16),
        makeTestObject(TEST_OBJECT_IDS[2], "decoy", 12, 12),
      ],
    });
    const state = buildBattleRoyaleRuntimeState(buildTestMapPackage({ map }));

    expect(state.objectPlacements).toContainEqual({
      objectId: TEST_OBJECT_IDS[1],
      role: "shrink-zone-anchor",
      kind: SHRINK_ZONE_ANCHOR_KIND,
      x: 16,
      y: 16,
      properties: { initialRadiusTiles: 16, finalRadiusTiles: 4 },
    });
    expect(state.objectPlacements).toContainEqual({
      objectId: TEST_OBJECT_IDS[2],
      role: "decoy",
      kind: DECOY_KIND,
      x: 12,
      y: 12,
      properties: { radius: 16, durationTicks: 140 },
    });
  });

  it("derives loot placements from the loot-source component on custom types", () => {
    const customCrate = Schema.decodeUnknownSync(GameObjectType)({
      ...JSON.parse(
        JSON.stringify(
          Schema.encodeSync(GameObjectType)(
            shippedCatalogObjectTypes().find(
              (objectType) => objectType.id === LOOT_CRATE_KIND,
            )!,
          ),
        ),
      ),
      id: String(gameObjectTypeIdForKey("custom-crate")),
      label: "Custom Crate",
    });
    const map = makeTileborneMap({
      id: TEST_MAP_ID,
      width: 32,
      height: 32,
      tileWidth: 32,
      tileHeight: 32,
      objects: [
        makeTestObject(TEST_OBJECT_IDS[0], "spawn-point", 1, 1),
        makeTestObject(TEST_OBJECT_IDS[1], "custom-crate", 8, 8, { weight: 2 }),
      ],
    });
    const state = buildBattleRoyaleRuntimeState(
      buildTestMapPackage({
        map,
        catalog: toCatalogEntries([...shippedCatalogObjectTypes(), customCrate]),
      }),
    );

    expect(state.objectPlacements).toContainEqual({
      objectId: TEST_OBJECT_IDS[1],
      role: "loot-crate",
      kind: LOOT_CRATE_KIND,
      x: 8,
      y: 8,
      properties: { itemKind: "supply-crate", tier: "common", weight: 2 },
    });
  });

  it("passes package visuals through without re-deriving them from the catalog", () => {
    const map = makeFixtureMap();
    const baked = new RuntimeMapPackageVisuals({
      playerModels: TEST_PLAYER_MODELS,
      overlayVisuals: [],
      weaponVisuals: [],
    });
    // The shipped catalog DOES carry weapon + overlay entities; an empty
    // baked section staying empty proves the package is the only source.
    const state = buildBattleRoyaleRuntimeState(buildTestMapPackage({ map, visuals: baked }));

    expect(state.weaponVisuals).toBeUndefined();
    expect(state.overlayVisuals).toBeUndefined();
    expect(state.playerModels).toEqual(TEST_PLAYER_MODELS);
    expect(state.defaultPlayerModelId).toBe(TEST_PLAYER_MODELS[0].id);
    expect(state.playerModelSelections).toEqual([]);
  });
});

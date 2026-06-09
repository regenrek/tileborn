import {
  AssetLibraryReference,
  CollisionFootprintComponent,
  CollisionFootprintPart,
  GameObjectType,
  MapObject,
  PlayerModelClipSet,
  PlayerModelRef,
  gameObjectTypeIdForKey,
  makeClipId,
  makePackId,
  makeTileborneMap,
} from "@tileborne/core";
import { Option } from "effect";
import { describe, expect, it } from "vitest";

import { INVENTORY, LOOT_CRATE_KIND, PROJECTILE, SHRINK_ZONE_ANCHOR_KIND, SPAWN_POINT_KIND } from "./constants.js";
import {
  ABILITY_STATE_COMPONENT,
  AIM_COMPONENT,
  AMMO_RESERVE_COMPONENT,
  ARMOR_COMPONENT,
  BREAKABLE_COMPONENT,
  COLLISION_BODY_COMPONENT,
  EQUIPPED_WEAPON_COMPONENT,
  HAZARD_COMPONENT,
  HITBOX_COMPONENT,
  INTERACTABLE_COMPONENT,
  INVENTORY_COMPONENT,
  LOOT_SOURCE_COMPONENT,
  MATCH_PHASE_COMPONENT,
  MUZZLE_COMPONENT,
  PICKUP_COMPONENT,
  PLAYER_COMPONENT,
  RELOAD_STATE_COMPONENT,
  RESPAWN_STATE_COMPONENT,
  SHIELD_COMPONENT,
  STATUS_EFFECTS_COMPONENT,
  TEAM_COMPONENT,
  VISION_BLOCKER_COMPONENT,
  type Player,
} from "./ecs/components.js";
import { exportArtifact } from "./export-artifact.js";
import { TEST_LAYER_ID, TEST_MAP_ID, TEST_OBJECT_IDS } from "./id-utils.js";
import { syncPlayerInputRuntimeComponents } from "./ecs/runtime-ecs.js";
import { createRuntimeAdapter } from "./runtime-adapter.js";
import { createTestPluginWorld } from "./test-plugin-world.js";

const clipIdAt = (index: number) => makeClipId(`550e8400-e29b-41d4-a716-44665544020${index}`);
const packId = makePackId("550e8400-e29b-41d4-a716-446655440299");

const playerModel = new PlayerModelRef({
  id: "model:runtime-ecs",
  label: "Runtime ECS",
  ref: new AssetLibraryReference({
    packId,
    kind: "sprite",
    refId: "placeable:runtime-ecs",
    clipId: clipIdAt(0),
  }),
  defaultClipId: clipIdAt(0),
  clips: new PlayerModelClipSet({
    idle: clipIdAt(0),
    walk: clipIdAt(1),
    run: clipIdAt(2),
    shoot: clipIdAt(3),
    reload: clipIdAt(4),
    hit: clipIdAt(5),
    death: clipIdAt(6),
    dash: clipIdAt(7),
    pickup: clipIdAt(8),
  }),
  anchor: { x: 0.5, y: 1 },
  hitbox: { x: 0.25, y: 0.1, width: 0.5, height: 0.85 },
  muzzle: { x: 0.75, y: 0.45 },
});

const makeObject = (
  id: (typeof TEST_OBJECT_IDS)[number],
  kind: string,
  x: number,
  y: number,
  properties: MapObject["properties"] = {},
): MapObject =>
  new MapObject({
    id,
    kind: gameObjectTypeIdForKey(kind),
    x,
    y,
    width: Option.none(),
    height: Option.none(),
    layerId: TEST_LAYER_ID,
    properties,
  });

const lootCrateType = (): GameObjectType =>
  new GameObjectType({
    id: LOOT_CRATE_KIND,
    schemaVersion: 1,
    label: "Loot Crate",
    family: "loot" as GameObjectType["family"],
    category: Option.none(),
    layerHint: Option.none(),
    components: [
      new CollisionFootprintComponent({
        source: "manual",
        reviewed: true,
        parts: [
          new CollisionFootprintPart({
            x: 0,
            y: 0,
            width: 24,
            height: 24,
            blocksMovement: true,
            blocksProjectiles: true,
            blocksVision: true,
          }),
        ],
      }),
    ],
    instanceDefaults: {},
  });

describe("Battle Royale runtime ECS", () => {
  it("initializes authoritative player, object, match, and collision components", () => {
    const lootObjectId = TEST_OBJECT_IDS[2];
    const artifact = exportArtifact(
      makeTileborneMap({
        id: TEST_MAP_ID,
        width: 32,
        height: 32,
        tileWidth: 32,
        tileHeight: 32,
        objects: [
          makeObject(TEST_OBJECT_IDS[0], SPAWN_POINT_KIND, 32, 48),
          makeObject(TEST_OBJECT_IDS[1], SHRINK_ZONE_ANCHOR_KIND, 160, 160),
          makeObject(lootObjectId, "loot-crate", 96, 64, {
            itemKind: "rifle",
            tier: "rare",
            weight: 2,
          }),
        ],
      }),
      { playerModels: [playerModel], objectTypes: [lootCrateType()] },
    );
    const world = createTestPluginWorld();

    const plugin = createRuntimeAdapter({ getArtifact: () => artifact });
    plugin.onInit?.({ pluginId: plugin.id }, world);

    const playerEntity = [...world.getComponent<Player>(PLAYER_COMPONENT).entries()].find(
      ([, player]) => player.playerId === "player-1",
    )?.[0];
    expect(playerEntity).toBeDefined();
    expect(world.getComponent(INVENTORY_COMPONENT).get(playerEntity!)).toEqual({
      itemIds: [],
      capacity: INVENTORY.capacity,
    });
    expect(world.getComponent(EQUIPPED_WEAPON_COMPONENT).get(playerEntity!)).toMatchObject({ slot: 1 });
    expect(world.getComponent(AMMO_RESERVE_COMPONENT).get(playerEntity!)).toMatchObject({
      stacks: [{ amount: PROJECTILE.initialAmmoReserve }],
    });
    expect(world.getComponent(RELOAD_STATE_COMPONENT).get(playerEntity!)).toEqual({
      active: false,
      weaponId: expect.any(String),
      remainingTicks: 0,
    });
    expect(world.getComponent(RESPAWN_STATE_COMPONENT).get(playerEntity!)).toEqual({ state: "alive" });
    expect(world.getComponent(TEAM_COMPONENT).get(playerEntity!)).toEqual({ team: "solo" });
    expect(world.getComponent(AIM_COMPONENT).get(playerEntity!)).toEqual({ deg: 0 });
    expect(world.getComponent(MUZZLE_COMPONENT).get(playerEntity!)).toBeDefined();
    expect(world.getComponent(HITBOX_COMPONENT).get(playerEntity!)).toBeDefined();
    expect(world.getComponent(SHIELD_COMPONENT).get(playerEntity!)).toEqual({ current: 0, max: 0 });
    expect(world.getComponent(ARMOR_COMPONENT).get(playerEntity!)).toEqual({ mitigation: 0, durability: 0 });
    expect(world.getComponent(ABILITY_STATE_COMPONENT).get(playerEntity!)).toEqual({
      charges: 0,
      cooldownTicks: 0,
      cooldowns: [],
    });
    expect(world.getComponent(STATUS_EFFECTS_COMPONENT).get(playerEntity!)).toEqual({ effects: [] });

    expect([...world.getComponent(MATCH_PHASE_COMPONENT).entries()].map(([, phase]) => phase)).toEqual([
      { phase: "active", tick: 0 },
    ]);
    expect([...world.getComponent(HAZARD_COMPONENT).entries()].map(([, hazard]) => hazard.enabled)).toEqual([true]);
    expect([...world.getComponent(LOOT_SOURCE_COMPONENT).entries()].map(([, source]) => source)).toEqual([
      { tableId: lootObjectId, tier: "rare", weight: 2, collected: false },
    ]);
    expect([...world.getComponent(PICKUP_COMPONENT).entries()].map(([, pickup]) => pickup)).toEqual([
      { itemKind: "rifle", tier: "rare", quantity: 1, available: true },
    ]);
    expect([...world.getComponent(INTERACTABLE_COMPONENT).entries()].map(([, entry]) => entry.action)).toContain(
      "pickup-loot",
    );
    expect([...world.getComponent(BREAKABLE_COMPONENT).entries()].map(([, entry]) => entry.destroyed)).toEqual([
      false,
    ]);
    expect([...world.getComponent(COLLISION_BODY_COMPONENT).entries()].map(([, body]) => body.objectId)).toContain(
      lootObjectId,
    );
    expect([...world.getComponent(VISION_BLOCKER_COMPONENT).entries()].map(([, body]) => body.objectId)).toEqual([
      lootObjectId,
    ]);
  });

  it("keeps player collision bodies in sync with alive state", () => {
    const artifact = exportArtifact(
      makeTileborneMap({
        id: TEST_MAP_ID,
        width: 32,
        height: 32,
        tileWidth: 32,
        tileHeight: 32,
        objects: [
          makeObject(TEST_OBJECT_IDS[0], SPAWN_POINT_KIND, 32, 48),
          makeObject(TEST_OBJECT_IDS[1], SHRINK_ZONE_ANCHOR_KIND, 160, 160),
        ],
      }),
      { playerModels: [playerModel] },
    );
    const world = createTestPluginWorld();
    const plugin = createRuntimeAdapter({ getArtifact: () => artifact });
    plugin.onInit?.({ pluginId: plugin.id }, world);

    const [playerEntity, player] = world.getComponent<Player>(PLAYER_COMPONENT).entries().next().value as [
      number,
      Player,
    ];
    const collisionBodies = world.getComponent(COLLISION_BODY_COMPONENT);
    expect(collisionBodies.get(playerEntity)?.blocksMovement).toBe(true);
    expect(collisionBodies.get(playerEntity)?.blocksProjectiles).toBe(true);

    world.getComponent<Player>(PLAYER_COMPONENT).set(playerEntity, { ...player, alive: 0 });
    syncPlayerInputRuntimeComponents(world, undefined, {
      playerHealth: 100,
      weaponId: "weapon:test",
      weaponSlotCount: 3,
      inventoryCapacity: INVENTORY.capacity,
      initialAmmoReserve: PROJECTILE.initialAmmoReserve,
      zoneDamagePerSecond: 5,
    });
    expect(collisionBodies.get(playerEntity)?.blocksMovement).toBe(false);
    expect(collisionBodies.get(playerEntity)?.blocksProjectiles).toBe(false);

    world.getComponent<Player>(PLAYER_COMPONENT).set(playerEntity, { ...player, alive: 1 });
    syncPlayerInputRuntimeComponents(world, undefined, {
      playerHealth: 100,
      weaponId: "weapon:test",
      weaponSlotCount: 3,
      inventoryCapacity: INVENTORY.capacity,
      initialAmmoReserve: PROJECTILE.initialAmmoReserve,
      zoneDamagePerSecond: 5,
    });
    expect(collisionBodies.get(playerEntity)?.blocksMovement).toBe(true);
    expect(collisionBodies.get(playerEntity)?.blocksProjectiles).toBe(true);
  });
});

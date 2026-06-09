import { describe, expect, it } from "vitest";

import { INVENTORY, LOOT_PICKUP_RADIUS } from "../constants.js";
import { createTestPluginWorld, type TestPluginWorld } from "../test-plugin-world.js";
import type { ExportedArtifact, LootTableEntry } from "../types/artifact.js";
import type { RuntimePlayerInput } from "../types/runtime-plugin.js";
import {
  AMMO_RESERVE_COMPONENT,
  BREAKABLE_COMPONENT,
  COLLISION_BODY_COMPONENT,
  INTERACTABLE_COMPONENT,
  INVENTORY_COMPONENT,
  LOOT_SOURCE_COMPONENT,
  PICKUP_COMPONENT,
  PICKUP_PROMPT_COMPONENT,
  PICKUP_TOAST_COMPONENT,
  PLAYER_COMPONENT,
  POSITION_COMPONENT,
  type AmmoReserve,
  type CollisionBody,
  type Inventory,
  type Pickup,
  type PickupPrompt,
  type PickupToast,
  type Player,
  type Position,
} from "./components.js";
import { buildRuntimeCollisionEnvironment } from "./collision.js";
import {
  createInventoryLootSystemState,
  rollLootEntry,
  runInventoryLootSystem,
} from "./inventory-loot-system.js";
import { registerBattleRoyaleRuntimeComponents } from "./runtime-ecs.js";

const WEAPON_ID = "weapon:test";

const artifactWithLoot = (lootTables: readonly LootTableEntry[]): ExportedArtifact =>
  ({
    schemaVersion: 1,
    maxPlayers: 2,
    spawnPoints: [{ x: 0, y: 0, team: "solo", weight: 1 }],
    spawnAnchors: [{ x: 0, y: 0, team: "solo", weight: 1 }],
    shrinkSchedule: {
      centerX: 0,
      centerY: 0,
      startRadiusTiles: 16,
      endRadiusTiles: 4,
      shrinkIntervalMs: 30_000,
      damagePerSecond: 5,
    },
    lootTables: [...lootTables],
    objectPlacements: [],
  }) as ExportedArtifact;

const input = (interact: boolean): RuntimePlayerInput => ({
  tick: 1,
  seq: 1,
  dir: 0,
  shoot: false,
  reload: false,
  interact,
  drop: false,
  abilities: [],
});

const inputWith = (overrides: Partial<RuntimePlayerInput>): RuntimePlayerInput => ({
  ...input(false),
  ...overrides,
});

const registerStores = (world: TestPluginWorld): void => {
  world.registerComponent<Position>(POSITION_COMPONENT);
  world.registerComponent<Player>(PLAYER_COMPONENT);
  registerBattleRoyaleRuntimeComponents(world);
};

const spawnPlayer = (
  world: TestPluginWorld,
  playerId: string,
  position: Position = { x: 0, y: 0 },
  health = 100,
): number => {
  const entity = world.createEntity();
  world.getComponent<Position>(POSITION_COMPONENT).set(entity, position);
  world.getComponent<Player>(PLAYER_COMPONENT).set(entity, {
    playerId,
    health,
    alive: 1,
    team: "solo",
  });
  world.getComponent<Inventory>(INVENTORY_COMPONENT).set(entity, {
    itemIds: [],
    capacity: INVENTORY.capacity,
  });
  world.getComponent<AmmoReserve>(AMMO_RESERVE_COMPONENT).set(entity, {
    stacks: [{ ammoKind: WEAPON_ID, amount: 1 }],
  });
  return entity;
};

const spawnPickup = (
  world: TestPluginWorld,
  position: Position,
  itemKind: string,
  tier = "common",
): number => {
  const entity = world.createEntity();
  world.getComponent<Position>(POSITION_COMPONENT).set(entity, position);
  world.getComponent<Pickup>(PICKUP_COMPONENT).set(entity, {
    itemKind,
    tier,
    quantity: 1,
    available: true,
  });
  world.getComponent(INTERACTABLE_COMPONENT).set(entity, {
    action: "pickup-loot",
    radius: LOOT_PICKUP_RADIUS,
    enabled: true,
  });
  return entity;
};

const runLootTick = (
  world: TestPluginWorld,
  artifact: ExportedArtifact,
  interact = false,
): void =>
  runInventoryLootSystem(
    world,
    {
      artifact,
      getPlayerInput: (playerId) => (playerId === "player-1" ? input(interact) : undefined),
      weaponId: WEAPON_ID,
      pickupRadius: LOOT_PICKUP_RADIUS,
      ammoPickupAmount: INVENTORY.ammoPickupAmount,
      healthPackAmount: INVENTORY.healthPackAmount,
      playerHealth: 100,
    },
    createInventoryLootSystemState(1),
  );

const reserveAmount = (world: TestPluginWorld, playerEntity: number): number =>
  world
    .getComponent<AmmoReserve>(AMMO_RESERVE_COMPONENT)
    .get(playerEntity)
    ?.stacks.find((stack) => stack.ammoKind === WEAPON_ID)?.amount ?? 0;

describe("inventory loot system", () => {
  it("prompts the nearest available pickup in range", () => {
    const world = createTestPluginWorld();
    registerStores(world);
    const player = spawnPlayer(world, "player-1");
    spawnPickup(world, { x: 1.25, y: 0 }, "ammo-box");
    const nearest = spawnPickup(world, { x: 0.5, y: 0 }, "health-pack");

    runLootTick(world, artifactWithLoot([{ itemKind: "ammo-box", tier: "common", weight: 1 }]));

    expect(world.getComponent<PickupPrompt>(PICKUP_PROMPT_COMPONENT).get(player)).toEqual({
      targetEntity: nearest,
      itemKind: "health-pack",
      tier: "common",
      distance: 0.5,
      action: "pickup-loot",
      available: true,
    });
  });

  it("collects ammo pickups into reserve and disables the source pickup", () => {
    const world = createTestPluginWorld();
    registerStores(world);
    const player = spawnPlayer(world, "player-1");
    const pickup = spawnPickup(world, { x: 0.25, y: 0 }, "ammo-box");

    runLootTick(world, artifactWithLoot([{ itemKind: "ammo-box", tier: "common", weight: 1 }]), true);

    expect(reserveAmount(world, player)).toBe(1 + INVENTORY.ammoPickupAmount);
    expect(world.getComponent<Pickup>(PICKUP_COMPONENT).get(pickup)).toMatchObject({
      available: false,
    });
    expect(world.getComponent<PickupPrompt>(PICKUP_PROMPT_COMPONENT).get(player)).toEqual({
      action: "pickup-loot",
      available: false,
    });
    expect(world.getComponent<PickupToast>(PICKUP_TOAST_COMPONENT).get(player)).toEqual({
      itemKind: "ammo-box",
      tier: "common",
      quantity: 1,
      tick: 1,
    });
  });

  it("collects only one pickup per held interact input sequence", () => {
    const world = createTestPluginWorld();
    registerStores(world);
    const player = spawnPlayer(world, "player-1");
    const first = spawnPickup(world, { x: 0.25, y: 0 }, "ammo-box");
    const second = spawnPickup(world, { x: 0.5, y: 0 }, "ammo-box");
    const state = createInventoryLootSystemState(1);
    const artifact = artifactWithLoot([{ itemKind: "ammo-box", tier: "common", weight: 1 }]);
    let currentInput = inputWith({ interact: true, tick: 7, seq: 1 });
    const run = (): void =>
      runInventoryLootSystem(
        world,
        {
          artifact,
          getPlayerInput: (playerId) => (playerId === "player-1" ? currentInput : undefined),
          weaponId: WEAPON_ID,
          pickupRadius: LOOT_PICKUP_RADIUS,
          ammoPickupAmount: INVENTORY.ammoPickupAmount,
          healthPackAmount: INVENTORY.healthPackAmount,
          playerHealth: 100,
        },
        state,
      );

    run();
    run();

    expect(reserveAmount(world, player)).toBe(1 + INVENTORY.ammoPickupAmount);
    expect(world.getComponent<Pickup>(PICKUP_COMPONENT).get(first)).toMatchObject({
      available: false,
    });
    expect(world.getComponent<Pickup>(PICKUP_COMPONENT).get(second)).toMatchObject({
      available: true,
    });

    currentInput = inputWith({ interact: true, tick: 8, seq: 2 });
    run();

    expect(reserveAmount(world, player)).toBe(1 + INVENTORY.ammoPickupAmount * 2);
    expect(world.getComponent<Pickup>(PICKUP_COMPONENT).get(second)).toMatchObject({
      available: false,
    });
  });

  it("allows pickup from the edge of a blocking loot crate collision body", () => {
    const world = createTestPluginWorld();
    registerStores(world);
    const player = spawnPlayer(world, "player-1", { x: 84, y: 96 });
    world.getComponent<CollisionBody>(COLLISION_BODY_COMPONENT).set(player, {
      x: 72,
      y: 84,
      width: 24,
      height: 24,
      blocksMovement: true,
      blocksProjectiles: true,
      blocksVision: false,
    });
    const crate = spawnPickup(world, { x: 96, y: 84 }, "supply-crate");
    world.getComponent(LOOT_SOURCE_COMPONENT).set(crate, {
      tableId: "object:edge-crate",
      tier: "common",
      weight: 1,
      collected: false,
    });
    world.getComponent<CollisionBody>(COLLISION_BODY_COMPONENT).set(crate, {
      objectId: "object:edge-crate",
      x: 96,
      y: 84,
      width: 32,
      height: 32,
      blocksMovement: true,
      blocksProjectiles: true,
      blocksVision: true,
    });
    const artifact = artifactWithLoot([{ itemKind: "ammo-box", tier: "common", weight: 1 }]);

    runLootTick(world, artifact);

    expect(world.getComponent<PickupPrompt>(PICKUP_PROMPT_COMPONENT).get(player)).toEqual({
      targetEntity: crate,
      itemKind: "supply-crate",
      tier: "common",
      distance: 0,
      action: "pickup-loot",
      available: true,
    });

    runLootTick(world, artifact, true);

    expect(reserveAmount(world, player)).toBe(1 + INVENTORY.ammoPickupAmount);
    expect(world.getComponent<Pickup>(PICKUP_COMPONENT).get(crate)).toMatchObject({
      available: false,
    });
    expect(world.getComponent<CollisionBody>(COLLISION_BODY_COMPONENT).get(crate)).toMatchObject({
      blocksMovement: false,
      blocksProjectiles: false,
      blocksVision: false,
    });
  });

  it("rolls source loot deterministically and grants health packs", () => {
    const world = createTestPluginWorld();
    registerStores(world);
    const player = spawnPlayer(world, "player-1", { x: 0, y: 0 }, 40);
    const pickup = spawnPickup(world, { x: 0.25, y: 0 }, "supply-crate");
    world.getComponent(LOOT_SOURCE_COMPONENT).set(pickup, {
      tableId: "object:loot-source",
      tier: "rare",
      weight: 1,
      collected: false,
    });
    const artifact = artifactWithLoot([
      { itemKind: "ammo-box", tier: "common", weight: 0 },
      { itemKind: "health-pack", tier: "common", weight: 1 },
    ]);

    runLootTick(world, artifact, true);

    expect(world.getComponent<Player>(PLAYER_COMPONENT).get(player)?.health).toBe(65);
    expect(world.getComponent(LOOT_SOURCE_COMPONENT).get(pickup)).toMatchObject({
      collected: true,
    });
    expect(rollLootEntry(artifact.lootTables, createInventoryLootSystemState(123).rng)).toEqual(
      rollLootEntry(artifact.lootTables, createInventoryLootSystemState(123).rng),
    );
  });

  it("drops the oldest inventory item when pickup overflow would exceed capacity", () => {
    const world = createTestPluginWorld();
    registerStores(world);
    const player = spawnPlayer(world, "player-1");
    world.getComponent<Inventory>(INVENTORY_COMPONENT).set(player, {
      itemIds: ["rifle:rare", "shield:common"],
      capacity: 2,
    });
    spawnPickup(world, { x: 0.25, y: 0 }, "scope", "rare");

    runLootTick(world, artifactWithLoot([{ itemKind: "scope", tier: "rare", weight: 1 }]), true);

    expect(world.getComponent<Inventory>(INVENTORY_COMPONENT).get(player)?.itemIds).toEqual([
      "shield:common",
      "scope:rare",
    ]);
    expect(
      [...world.getComponent<Pickup>(PICKUP_COMPONENT).entries()]
        .map(([, pickup]) => pickup)
        .filter((pickup) => pickup.available),
    ).toEqual([
      { itemKind: "rifle", tier: "rare", quantity: 1, available: true },
    ]);
  });

  it("drops one carried item per drop input sequence", () => {
    const world = createTestPluginWorld();
    registerStores(world);
    const player = spawnPlayer(world, "player-1");
    const state = createInventoryLootSystemState(1);
    world.getComponent<Inventory>(INVENTORY_COMPONENT).set(player, {
      itemIds: ["rifle:rare", "shield:common"],
      capacity: 2,
    });
    const dropInput = inputWith({ drop: true });

    for (let tick = 0; tick < 2; tick += 1) {
      runInventoryLootSystem(
        world,
        {
          artifact: artifactWithLoot([]),
          getPlayerInput: (playerId) => (playerId === "player-1" ? dropInput : undefined),
          weaponId: WEAPON_ID,
          pickupRadius: LOOT_PICKUP_RADIUS,
          playerHealth: 100,
        },
        state,
      );
    }

    expect(world.getComponent<Inventory>(INVENTORY_COMPONENT).get(player)?.itemIds).toEqual(["shield:common"]);
    expect(
      [...world.getComponent<Pickup>(PICKUP_COMPONENT).entries()]
        .map(([, pickup]) => pickup)
        .filter((pickup) => pickup.available),
    ).toEqual([{ itemKind: "rifle", tier: "rare", quantity: 1, available: true }]);
  });

  it("drops rolled loot from destroyed crates and removes their runtime collision", () => {
    const world = createTestPluginWorld();
    registerStores(world);
    spawnPlayer(world, "player-1", { x: 100, y: 100 });
    const crate = spawnPickup(world, { x: 0, y: 0 }, "supply-crate");
    world.getComponent(LOOT_SOURCE_COMPONENT).set(crate, {
      tableId: "object:crate-1",
      tier: "common",
      weight: 1,
      collected: false,
    });
    world.getComponent(BREAKABLE_COMPONENT).set(crate, {
      health: 0,
      maxHealth: 100,
      destroyed: false,
    });
    world.getComponent(COLLISION_BODY_COMPONENT).set(crate, {
      objectId: "object:crate-1",
      x: 0,
      y: 0,
      width: 24,
      height: 24,
      blocksMovement: true,
      blocksProjectiles: true,
      blocksVision: true,
    });

    runLootTick(world, artifactWithLoot([{ itemKind: "ammo-box", tier: "common", weight: 1 }]));

    expect(world.getComponent(BREAKABLE_COMPONENT).get(crate)).toMatchObject({
      destroyed: true,
    });
    expect(world.getComponent(LOOT_SOURCE_COMPONENT).get(crate)).toMatchObject({
      collected: true,
    });
    expect(world.getComponent<Pickup>(PICKUP_COMPONENT).get(crate)).toMatchObject({
      available: false,
    });
    expect(
      [...world.getComponent<Pickup>(PICKUP_COMPONENT).entries()]
        .map(([, pickup]) => pickup)
        .filter((pickup) => pickup.available),
    ).toEqual([
      { itemKind: "ammo-box", tier: "common", quantity: 1, available: true },
    ]);
    expect(world.getComponent(COLLISION_BODY_COMPONENT).get(crate)).toMatchObject({
      blocksMovement: false,
      blocksProjectiles: false,
      blocksVision: false,
    });
    expect(
      buildRuntimeCollisionEnvironment(world, undefined)?.rects.some(
        (rect) => rect.objectId === "object:crate-1",
      ) ?? false,
    ).toBe(false);
  });
});

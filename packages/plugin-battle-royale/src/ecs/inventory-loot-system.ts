import { createSeededRng, type SeededRng } from "@tileborne/simulation";

import { INVENTORY, LOOT_PICKUP_RADIUS } from "../constants.js";
import type { ExportedArtifact, LootTableEntry } from "../types/artifact.js";
import type { PluginWorld, RuntimePlayerInput } from "../types/runtime-plugin.js";
import {
  AMMO_RESERVE_COMPONENT,
  ARMOR_COMPONENT,
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
  type Armor,
  type Breakable,
  type CollisionBody,
  type Interactable,
  type Inventory,
  type LootSource,
  type Pickup,
  type PickupPrompt,
  type PickupToast,
  type Player,
  type Position,
} from "./components.js";

export interface InventoryLootSystemState {
  readonly rng: SeededRng;
  readonly consumedDropInputByPlayerId: Map<string, string>;
  readonly consumedInteractInputByPlayerId: Map<string, string>;
}

export interface InventoryLootSystemContext {
  readonly artifact: ExportedArtifact;
  readonly getPlayerInput?: (playerId: string) => RuntimePlayerInput | undefined;
  readonly weaponId: string;
  readonly pickupRadius?: number;
  readonly ammoPickupAmount?: number;
  readonly healthPackAmount?: number;
  readonly playerHealth: number;
}

interface PickupCandidate {
  readonly entity: number;
  readonly pickup: Pickup;
  readonly distance: number;
}

export const createInventoryLootSystemState = (seed = 0): InventoryLootSystemState => ({
  rng: createSeededRng(seed),
  consumedDropInputByPlayerId: new Map(),
  consumedInteractInputByPlayerId: new Map(),
});

const stackAmount = (reserve: AmmoReserve | undefined, ammoKind: string): number =>
  reserve?.stacks.find((stack) => stack.ammoKind === ammoKind)?.amount ?? 0;

const setStackAmount = (
  world: PluginWorld,
  entity: number,
  ammoKind: string,
  amount: number,
): void => {
  const reserves = world.getComponent<AmmoReserve>(AMMO_RESERVE_COMPONENT);
  const current = reserves.get(entity)?.stacks ?? [];
  const nextAmount = Math.max(0, Math.floor(amount));
  const stacks = current.some((stack) => stack.ammoKind === ammoKind)
    ? current.map((stack) => (stack.ammoKind === ammoKind ? { ...stack, amount: nextAmount } : stack))
    : [...current, { ammoKind, amount: nextAmount }];
  reserves.set(entity, { stacks });
};

const distance = (left: Position, right: Position): number =>
  Math.hypot(left.x - right.x, left.y - right.y);

const axisGap = (
  leftMin: number,
  leftMax: number,
  rightMin: number,
  rightMax: number,
): number => Math.max(0, leftMin - rightMax, rightMin - leftMax);

const bodyDistance = (left: CollisionBody, right: CollisionBody): number =>
  Math.hypot(
    axisGap(left.x, left.x + left.width, right.x, right.x + right.width),
    axisGap(left.y, left.y + left.height, right.y, right.y + right.height),
  );

const pointToBodyDistance = (point: Position, body: CollisionBody): number =>
  Math.hypot(
    axisGap(point.x, point.x, body.x, body.x + body.width),
    axisGap(point.y, point.y, body.y, body.y + body.height),
  );

const distanceToClosestBody = (
  bodies: Iterable<CollisionBody>,
  playerPosition: Position,
  playerBody: CollisionBody | undefined,
): number | undefined => {
  let closest: number | undefined;
  for (const body of bodies) {
    const next =
      playerBody === undefined
        ? pointToBodyDistance(playerPosition, body)
        : bodyDistance(playerBody, body);
    if (closest === undefined || next < closest) {
      closest = next;
    }
  }
  return closest;
};

export const rollLootEntry = (
  entries: readonly LootTableEntry[],
  rng: SeededRng,
): LootTableEntry => {
  if (entries.length === 0) {
    return { itemKind: "supply-crate", tier: "common", weight: 1 };
  }
  const totalWeight = entries.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0);
  if (totalWeight <= 0) {
    return entries[0]!;
  }
  const target = rng.nextFloat() * totalWeight;
  let cursor = 0;
  for (const entry of entries) {
    cursor += Math.max(0, entry.weight);
    if (target < cursor) {
      return entry;
    }
  }
  return entries[entries.length - 1]!;
};

const itemIdFor = (itemKind: string, tier: string): string => `${itemKind}:${tier}`;

const addInventoryItem = (
  world: PluginWorld,
  playerEntity: number,
  itemId: string,
): void => {
  const inventories = world.getComponent<Inventory>(INVENTORY_COMPONENT);
  const inventory = inventories.get(playerEntity);
  if (!inventory) {
    return;
  }
  const next = [...inventory.itemIds];
  if (next.length >= inventory.capacity) {
    dropInventoryItem(world, playerEntity, next[0]!);
    next.shift();
  }
  next.push(itemId);
  inventories.set(playerEntity, { ...inventory, itemIds: next });
};

export const dropInventoryItem = (
  world: PluginWorld,
  playerEntity: number,
  itemId: string,
): number | undefined => {
  const inventories = world.getComponent<Inventory>(INVENTORY_COMPONENT);
  const positions = world.getComponent<Position>(POSITION_COMPONENT);
  const inventory = inventories.get(playerEntity);
  const position = positions.get(playerEntity);
  if (!inventory || !position || !inventory.itemIds.includes(itemId)) {
    return undefined;
  }

  const dropIndex = inventory.itemIds.indexOf(itemId);
  const nextItems = inventory.itemIds.filter((_, index) => index !== dropIndex);
  inventories.set(playerEntity, { ...inventory, itemIds: nextItems });

  const [itemKind = itemId, tier = "common"] = itemId.split(":");
  const entity = world.createEntity();
  positions.set(entity, { ...position });
  world.getComponent<Pickup>(PICKUP_COMPONENT).set(entity, {
    itemKind,
    tier,
    quantity: 1,
    available: true,
  });
  world.getComponent<Interactable>(INTERACTABLE_COMPONENT).set(entity, {
    action: "pickup-loot",
    radius: LOOT_PICKUP_RADIUS,
    enabled: true,
  });
  return entity;
};

const consumeSequencedInput = (
  consumedByPlayerId: Map<string, string>,
  playerId: string,
  input: RuntimePlayerInput | undefined,
  active: boolean,
): boolean => {
  if (!active || input === undefined) {
    return false;
  }
  const inputKey = `${input.tick}:${input.seq}`;
  if (consumedByPlayerId.get(playerId) === inputKey) {
    return false;
  }
  consumedByPlayerId.set(playerId, inputKey);
  return true;
};

const consumeDropInput = (
  state: InventoryLootSystemState,
  playerId: string,
  input: RuntimePlayerInput | undefined,
): boolean => consumeSequencedInput(state.consumedDropInputByPlayerId, playerId, input, input?.drop === true);

const consumeInteractInput = (
  state: InventoryLootSystemState,
  playerId: string,
  input: RuntimePlayerInput | undefined,
): boolean =>
  consumeSequencedInput(state.consumedInteractInputByPlayerId, playerId, input, input?.interact === true);

const dropFirstInventoryItem = (world: PluginWorld, playerEntity: number): void => {
  const inventory = world.getComponent<Inventory>(INVENTORY_COMPONENT).get(playerEntity);
  const itemId = inventory?.itemIds[0];
  if (itemId !== undefined) {
    dropInventoryItem(world, playerEntity, itemId);
  }
};

const grantLoot = (
  world: PluginWorld,
  playerEntity: number,
  entry: LootTableEntry,
  ctx: InventoryLootSystemContext,
): void => {
  const players = world.getComponent<Player>(PLAYER_COMPONENT);
  const player = players.get(playerEntity);
  if (!player) {
    return;
  }

  switch (entry.itemKind) {
    case "ammo-box": {
      const reserves = world.getComponent<AmmoReserve>(AMMO_RESERVE_COMPONENT);
      const before = stackAmount(reserves.get(playerEntity), ctx.weaponId);
      setStackAmount(world, playerEntity, ctx.weaponId, before + (ctx.ammoPickupAmount ?? INVENTORY.ammoPickupAmount));
      return;
    }
    case "health-pack":
      players.set(playerEntity, {
        ...player,
        health: Math.min(ctx.playerHealth, player.health + (ctx.healthPackAmount ?? INVENTORY.healthPackAmount)),
      });
      return;
    case "armor-vest":
      world.getComponent<Armor>(ARMOR_COMPONENT).set(playerEntity, {
        mitigation: INVENTORY.armorMitigation,
        durability: INVENTORY.armorDurability,
      });
      return;
    default:
      addInventoryItem(world, playerEntity, itemIdFor(entry.itemKind, entry.tier));
  }
};

const nearestPickup = (
  world: PluginWorld,
  playerEntity: number,
  playerPosition: Position,
  radius: number,
): PickupCandidate | undefined => {
  const pickups = world.getComponent<Pickup>(PICKUP_COMPONENT);
  const positions = world.getComponent<Position>(POSITION_COMPONENT);
  const interactables = world.getComponent<Interactable>(INTERACTABLE_COMPONENT);
  const lootSources = world.getComponent<LootSource>(LOOT_SOURCE_COMPONENT);
  const collisionBodies = world.getComponent<CollisionBody>(COLLISION_BODY_COMPONENT);
  const playerBody = collisionBodies.get(playerEntity);
  let nearest: PickupCandidate | undefined;

  for (const [entity, pickup] of pickups.entries()) {
    const interactable = interactables.get(entity);
    const position = positions.get(entity);
    if (!pickup.available || !position || interactable?.enabled === false) {
      continue;
    }
    const source = lootSources.get(entity);
    const pickupDistance =
      (source === undefined
        ? distanceToClosestBody(
            collisionBodies.get(entity) === undefined ? [] : [collisionBodies.get(entity)!],
            playerPosition,
            playerBody,
          )
        : distanceToClosestBody(
            [...collisionBodies.entries()]
              .map(([, body]) => body)
              .filter((body) => body.objectId === source.tableId),
            playerPosition,
            playerBody,
          )) ?? distance(playerPosition, position);
    if (pickupDistance > Math.max(radius, interactable?.radius ?? radius)) {
      continue;
    }
    if (!nearest || pickupDistance < nearest.distance || (pickupDistance === nearest.distance && entity < nearest.entity)) {
      nearest = { entity, pickup, distance: pickupDistance };
    }
  }
  return nearest;
};

const setPrompt = (
  world: PluginWorld,
  playerEntity: number,
  candidate: PickupCandidate | undefined,
): void => {
  const prompts = world.getComponent<PickupPrompt>(PICKUP_PROMPT_COMPONENT);
  prompts.set(
    playerEntity,
    candidate
      ? {
          targetEntity: candidate.entity,
          itemKind: candidate.pickup.itemKind,
          tier: candidate.pickup.tier,
          distance: candidate.distance,
          action: "pickup-loot",
          available: true,
        }
      : { action: "pickup-loot", available: false },
  );
};

const disableCollisionForObject = (
  world: PluginWorld,
  source: LootSource,
): void => {
  const collisionBodies = world.getComponent<CollisionBody>(COLLISION_BODY_COMPONENT);
  for (const [entity, body] of collisionBodies.entries()) {
    if (body.objectId !== source.tableId) {
      continue;
    }
    collisionBodies.set(entity, {
      ...body,
      blocksMovement: false,
      blocksProjectiles: false,
      blocksVision: false,
    });
  }
};

const collectPickup = (
  world: PluginWorld,
  playerEntity: number,
  pickupEntity: number,
  ctx: InventoryLootSystemContext,
  state: InventoryLootSystemState,
  tick: number,
): void => {
  const pickups = world.getComponent<Pickup>(PICKUP_COMPONENT);
  const lootSources = world.getComponent<LootSource>(LOOT_SOURCE_COMPONENT);
  const interactables = world.getComponent<Interactable>(INTERACTABLE_COMPONENT);
  const breakables = world.getComponent<Breakable>(BREAKABLE_COMPONENT);
  const pickup = pickups.get(pickupEntity);
  if (!pickup?.available) {
    return;
  }
  const source = lootSources.get(pickupEntity);
  const entry = source
    ? rollLootEntry(ctx.artifact.lootTables, state.rng)
    : { itemKind: pickup.itemKind, tier: pickup.tier, weight: 1 };
  grantLoot(world, playerEntity, entry, ctx);
  world.getComponent<PickupToast>(PICKUP_TOAST_COMPONENT).set(playerEntity, {
    itemKind: entry.itemKind,
    tier: entry.tier,
    quantity: pickup.quantity,
    tick,
  });
  pickups.set(pickupEntity, { ...pickup, itemKind: entry.itemKind, tier: entry.tier, available: false });
  if (source) {
    lootSources.set(pickupEntity, { ...source, collected: true });
    disableCollisionForObject(world, source);
  }
  const interactable = interactables.get(pickupEntity);
  if (interactable) {
    interactables.set(pickupEntity, { ...interactable, enabled: false });
  }
  const breakable = breakables.get(pickupEntity);
  if (breakable) {
    breakables.set(pickupEntity, { ...breakable, health: 0, destroyed: true });
  }
};

const dropFromDestroyedCrates = (
  world: PluginWorld,
  ctx: InventoryLootSystemContext,
  state: InventoryLootSystemState,
): void => {
  const breakables = world.getComponent<Breakable>(BREAKABLE_COMPONENT);
  const lootSources = world.getComponent<LootSource>(LOOT_SOURCE_COMPONENT);
  const pickups = world.getComponent<Pickup>(PICKUP_COMPONENT);
  const interactables = world.getComponent<Interactable>(INTERACTABLE_COMPONENT);
  const positions = world.getComponent<Position>(POSITION_COMPONENT);

  for (const [entity, breakable] of breakables.entries()) {
    const source = lootSources.get(entity);
    const position = positions.get(entity);
    if (!source || !position || breakable.destroyed || breakable.health > 0) {
      continue;
    }
    const entry = rollLootEntry(ctx.artifact.lootTables, state.rng);
    const drop = world.createEntity();
    positions.set(drop, { ...position });
    world.getComponent<Pickup>(PICKUP_COMPONENT).set(drop, {
      itemKind: entry.itemKind,
      tier: entry.tier,
      quantity: 1,
      available: true,
    });
    world.getComponent<Interactable>(INTERACTABLE_COMPONENT).set(drop, {
      action: "pickup-loot",
      radius: ctx.pickupRadius ?? LOOT_PICKUP_RADIUS,
      enabled: true,
    });
    const pickup = pickups.get(entity);
    if (pickup) {
      pickups.set(entity, { ...pickup, available: false });
    }
    const interactable = interactables.get(entity);
    if (interactable) {
      interactables.set(entity, { ...interactable, enabled: false });
    }
    breakables.set(entity, { ...breakable, destroyed: true });
    lootSources.set(entity, { ...source, collected: true });
    disableCollisionForObject(world, source);
  }
};

export const runInventoryLootSystem = (
  world: PluginWorld,
  ctx: InventoryLootSystemContext,
  state: InventoryLootSystemState,
): void => {
  dropFromDestroyedCrates(world, ctx, state);

  const players = world.getComponent<Player>(PLAYER_COMPONENT);
  const positions = world.getComponent<Position>(POSITION_COMPONENT);
  const radius = ctx.pickupRadius ?? LOOT_PICKUP_RADIUS;

  for (const [entity, player] of players.entries()) {
    const position = positions.get(entity);
    if (player.alive !== 1 || !position) {
      setPrompt(world, entity, undefined);
      continue;
    }
    const candidate = nearestPickup(world, entity, position, radius);
    setPrompt(world, entity, candidate);
    const input = ctx.getPlayerInput?.(player.playerId);
    if (consumeDropInput(state, player.playerId, input)) {
      dropFirstInventoryItem(world, entity);
    }
    const interactPressed = consumeInteractInput(state, player.playerId, input);
    if (candidate && interactPressed && input !== undefined) {
      collectPickup(world, entity, candidate.entity, ctx, state, input.tick);
      setPrompt(world, entity, undefined);
    }
  }
};

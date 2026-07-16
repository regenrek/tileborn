import { makeLootTableId } from '@tileborne/core';
import {
  InventoryState,
  RuntimeLootTable,
  RuntimeLootTableEntry,
  aabbGapDistance,
  addAmmo,
  createSeededRng,
  dropItem,
  emptyAmmoReserve,
  grantItem,
  makeAmmoKind,
  makeCombatEntityId,
  makeInventoryItemId,
  resolvePickupCandidates,
  rollLootTable,
  type AabbLike,
  type AmmoReserve as NeutralAmmoReserve,
  type PickupSource,
  type PickupSpawned,
  type SeededRng,
} from '@tileborne/simulation';
import { Option } from 'effect';

import { INVENTORY, LOOT_PICKUP_RADIUS, PLUGIN_ID } from '../constants.js';
import { uuidFromSeed } from '../id-utils.js';
import type { ExportedArtifact, LootTableEntry } from '../types/artifact.js';
import type { PluginWorld, RuntimePlayerInput } from '../types/runtime-plugin.js';
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
} from './components.js';

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

// ---------------------------------------------------------------------------
// BR content ↔ neutral-shape adapters
// ---------------------------------------------------------------------------

/** Stable id for BR's single (anonymous) artifact loot table. */
const BR_LOOT_TABLE_ID = makeLootTableId(uuidFromSeed(PLUGIN_ID, 'artifact-loot-table'));

const itemIdFor = (itemKind: string, tier: string): string => `${itemKind}:${tier}`;

const toRuntimeLootTable = (entries: readonly LootTableEntry[]): RuntimeLootTable =>
  new RuntimeLootTable({
    id: BR_LOOT_TABLE_ID,
    entries: entries.map(
      (entry) =>
        new RuntimeLootTableEntry({
          item: makeInventoryItemId(itemIdFor(entry.itemKind, entry.tier)),
          // BR clamps negative weights to zero at roll time; bake the clamp
          // into the runtime table so the neutral roll sees the same totals.
          weight: Number.isFinite(entry.weight) ? Math.max(0, entry.weight) : 0,
          quantity: 1,
        }),
    ),
  });

/**
 * Roll BR's artifact loot table through the neutral `rollLootTable`. The
 * neutral roll consumes exactly one `nextFloat` when the total weight is
 * positive and none otherwise — the same entropy schedule the previous
 * bespoke roll used. What an empty roll means is BR content semantics kept
 * here: a degenerate (all-zero-weight) table falls back to its first entry,
 * an empty table to the supply-crate default.
 *
 * Parity note: on the floating-point edge where the accumulated cursor lands
 * a hair short of the target, the neutral roll resolves to the last entry
 * with a positive weight, where the bespoke roll returned the literal last
 * entry even when its weight was zero. The neutral behavior is accepted —
 * a zero-weight entry should never win a roll.
 */
export const rollLootEntry = (
  entries: readonly LootTableEntry[],
  rng: SeededRng,
): LootTableEntry => {
  const table = toRuntimeLootTable(entries);
  const rolled = rollLootTable(table, rng);
  if (Option.isSome(rolled)) {
    return entries[table.entries.indexOf(rolled.value)]!;
  }
  return entries[0] ?? { itemKind: 'supply-crate', tier: 'common', weight: 1 };
};

const toNeutralInventory = (inventory: Inventory): InventoryState =>
  new InventoryState({
    slots: inventory.itemIds.map((itemId) => makeInventoryItemId(itemId)),
    capacity: inventory.capacity,
  });

const toNeutralReserve = (reserve: AmmoReserve | undefined): NeutralAmmoReserve =>
  (reserve?.stacks ?? []).reduce(
    (folded, stack) => addAmmo(folded, makeAmmoKind(stack.ammoKind), stack.amount),
    emptyAmmoReserve(),
  );

const toBodyAabb = (body: CollisionBody): AabbLike => ({
  minX: body.x,
  minY: body.y,
  maxX: body.x + body.width,
  maxY: body.y + body.height,
});

/** A player without a collision body measures gaps from its point position. */
const toSeekerAabb = (playerPosition: Position, playerBody: CollisionBody | undefined): AabbLike =>
  playerBody === undefined
    ? {
        minX: playerPosition.x,
        minY: playerPosition.y,
        maxX: playerPosition.x,
        maxY: playerPosition.y,
      }
    : toBodyAabb(playerBody);

const gapToClosestBody = (
  bodies: Iterable<CollisionBody>,
  seeker: AabbLike,
): number | undefined => {
  let closest: number | undefined;
  for (const body of bodies) {
    const next = aabbGapDistance(seeker, toBodyAabb(body));
    if (closest === undefined || next < closest) {
      closest = next;
    }
  }
  return closest;
};

// ---------------------------------------------------------------------------
// Pickup spawning + inventory mutation (folding neutral result values)
// ---------------------------------------------------------------------------

const spawnPickupEntity = (world: PluginWorld, spawn: PickupSpawned): void => {
  const [itemKind = spawn.item, tier = 'common'] = spawn.item.split(':');
  const entity = world.createEntity();
  world.getComponent<Position>(POSITION_COMPONENT).set(entity, { x: spawn.x, y: spawn.y });
  world.getComponent<Pickup>(PICKUP_COMPONENT).set(entity, {
    itemKind,
    tier,
    quantity: 1,
    available: true,
  });
  world.getComponent<Interactable>(INTERACTABLE_COMPONENT).set(entity, {
    action: 'pickup-loot',
    radius: LOOT_PICKUP_RADIUS,
    enabled: true,
  });
};

const grantInventoryItem = (world: PluginWorld, playerEntity: number, itemId: string): void => {
  const inventories = world.getComponent<Inventory>(INVENTORY_COMPONENT);
  const inventory = inventories.get(playerEntity);
  if (!inventory) {
    return;
  }
  const position = world.getComponent<Position>(POSITION_COMPONENT).get(playerEntity);
  // Parity note: the previous bespoke capacity loop pushed past a
  // zero-capacity inventory; the neutral grant rejects it (eviction cannot
  // make room). BR ships `INVENTORY.capacity` = 5, so this has no practical
  // impact and the bug is deliberately not replicated.
  const granted = grantItem(toNeutralInventory(inventory), makeInventoryItemId(itemId), {
    policy: 'drop-oldest',
    ...(position === undefined ? {} : { dropAt: position }),
  });
  for (const result of granted.results) {
    if (result._tag === 'PickupSpawned') {
      spawnPickupEntity(world, result);
    }
  }
  inventories.set(playerEntity, { ...inventory, itemIds: [...granted.state.slots] });
};

const dropFirstInventoryItem = (world: PluginWorld, playerEntity: number): void => {
  const inventories = world.getComponent<Inventory>(INVENTORY_COMPONENT);
  const inventory = inventories.get(playerEntity);
  const position = world.getComponent<Position>(POSITION_COMPONENT).get(playerEntity);
  const itemId = inventory?.itemIds[0];
  if (!inventory || !position || itemId === undefined) {
    return;
  }
  const dropped = dropItem(toNeutralInventory(inventory), makeInventoryItemId(itemId), position);
  for (const result of dropped.results) {
    if (result._tag === 'PickupSpawned') {
      spawnPickupEntity(world, result);
    }
  }
  inventories.set(playerEntity, { ...inventory, itemIds: [...dropped.state.slots] });
};

// ---------------------------------------------------------------------------
// Sequenced input consumption
// ---------------------------------------------------------------------------

// BR's drop/interact inputs are edge-triggered booleans on the per-tick input
// frame, not commands carrying item ids, so the system keeps its `tick:seq`
// consume-once keying and calls the neutral grant/drop/roll/resolve functions
// directly rather than adopting `resolveInventoryCommands` (whose SwapCommand
// models slot *exchange*, while BR's swapSlot input is weapon *selection*).
// Because no monotonic `lastSequence` is adopted, the multiplayer client's
// seq reset on reconnect needs no special handling here: a replayed
// `tick:seq` key is simply consumed once again.
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
): boolean =>
  consumeSequencedInput(state.consumedDropInputByPlayerId, playerId, input, input?.drop === true);

const consumeInteractInput = (
  state: InventoryLootSystemState,
  playerId: string,
  input: RuntimePlayerInput | undefined,
): boolean =>
  consumeSequencedInput(
    state.consumedInteractInputByPlayerId,
    playerId,
    input,
    input?.interact === true,
  );

// ---------------------------------------------------------------------------
// Loot effects (BR item semantics stay plugin-side)
// ---------------------------------------------------------------------------

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
    case 'ammo-box': {
      const reserves = world.getComponent<AmmoReserve>(AMMO_RESERVE_COMPONENT);
      // The neutral reserve is canonical (kind-sorted, zero stacks pruned);
      // every BR reader (snapshot emitter, combat reload, HUD) reads per-kind
      // amounts only, so the representation change is unobservable.
      const reserve = addAmmo(
        toNeutralReserve(reserves.get(playerEntity)),
        makeAmmoKind(ctx.weaponId),
        ctx.ammoPickupAmount ?? INVENTORY.ammoPickupAmount,
      );
      reserves.set(playerEntity, {
        stacks: reserve.stacks.map((stack) => ({ ammoKind: stack.ammoKind, amount: stack.amount })),
      });
      return;
    }
    case 'health-pack':
      players.set(playerEntity, {
        ...player,
        health: Math.min(
          ctx.playerHealth,
          player.health + (ctx.healthPackAmount ?? INVENTORY.healthPackAmount),
        ),
      });
      return;
    case 'armor-vest':
      world.getComponent<Armor>(ARMOR_COMPONENT).set(playerEntity, {
        mitigation: INVENTORY.armorMitigation,
        durability: INVENTORY.armorDurability,
      });
      return;
    default:
      grantInventoryItem(world, playerEntity, itemIdFor(entry.itemKind, entry.tier));
  }
};

// ---------------------------------------------------------------------------
// Pickup candidate resolution (neutral resolver, BR gap metric)
// ---------------------------------------------------------------------------

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
  const seeker = toSeekerAabb(playerPosition, collisionBodies.get(playerEntity));

  const sources: PickupSource[] = [];
  for (const [entity, pickup] of pickups.entries()) {
    const interactable = interactables.get(entity);
    const position = positions.get(entity);
    if (!pickup.available || !position || interactable?.enabled === false) {
      continue;
    }
    // BR ranks pickups by AABB body-gap distance: against every collision
    // body of the backing loot object when the pickup has a loot source,
    // otherwise against the pickup's own body. Without any body the neutral
    // resolver's center metric applies.
    const source = lootSources.get(entity);
    const ownBody = collisionBodies.get(entity);
    const bodyGap =
      source === undefined
        ? gapToClosestBody(ownBody === undefined ? [] : [ownBody], seeker)
        : gapToClosestBody(
            [...collisionBodies.entries()]
              .map(([, body]) => body)
              .filter((body) => body.objectId === source.tableId),
            seeker,
          );
    sources.push({
      id: makeCombatEntityId(entity),
      position,
      ...(bodyGap === undefined ? {} : { distance: bodyGap }),
      ...(interactable === undefined ? {} : { radius: interactable.radius }),
    });
  }

  const candidate = resolvePickupCandidates(playerPosition, sources, radius)[0];
  if (candidate === undefined) {
    return undefined;
  }
  return {
    entity: candidate.id,
    pickup: pickups.get(candidate.id)!,
    distance: candidate.distance,
  };
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
          action: 'pickup-loot',
          available: true,
        }
      : { action: 'pickup-loot', available: false },
  );
};

const disableCollisionForObject = (world: PluginWorld, source: LootSource): void => {
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
  pickups.set(pickupEntity, {
    ...pickup,
    itemKind: entry.itemKind,
    tier: entry.tier,
    available: false,
  });
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
      action: 'pickup-loot',
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

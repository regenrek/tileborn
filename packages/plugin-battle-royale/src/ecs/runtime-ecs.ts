import { LOOT_PICKUP_RADIUS } from "../constants.js";
import type { ExportedArtifact, ObjectPlacement } from "../types/artifact.js";
import type { PluginWorld, RuntimePlayerInput } from "../types/runtime-plugin.js";
import {
  ABILITY_STATE_COMPONENT,
  AIM_COMPONENT,
  AMMO_RESERVE_COMPONENT,
  ARMOR_COMPONENT,
  BREAKABLE_COMPONENT,
  COLLISION_BODY_COMPONENT,
  DAMAGE_INDICATOR_COMPONENT,
  DEPLOYABLE_COMPONENT,
  EQUIPPED_WEAPON_COMPONENT,
  FACING_COMPONENT,
  HAZARD_COMPONENT,
  HITBOX_COMPONENT,
  INTERACTABLE_COMPONENT,
  INVENTORY_COMPONENT,
  LOOT_SOURCE_COMPONENT,
  MATCH_PHASE_COMPONENT,
  MUZZLE_COMPONENT,
  PICKUP_COMPONENT,
  PICKUP_PROMPT_COMPONENT,
  PICKUP_TOAST_COMPONENT,
  PLAYER_COMPONENT,
  POSITION_COMPONENT,
  RELOAD_STATE_COMPONENT,
  RESPAWN_STATE_COMPONENT,
  SHIELD_COMPONENT,
  STATUS_EFFECTS_COMPONENT,
  TEAM_COMPONENT,
  VISION_BLOCKER_COMPONENT,
  WEAPON_RUNTIME_STATE_COMPONENT,
  type AbilityState,
  type Aim,
  type AmmoReserve,
  type Armor,
  type Breakable,
  type CollisionBody,
  type DamageIndicator,
  type Deployable,
  type Direction8,
  type EquippedWeapon,
  type Facing,
  type Hazard,
  type Hitbox,
  type Interactable,
  type Inventory,
  type LootSource,
  type MatchPhase,
  type Muzzle,
  type Pickup,
  type PickupPrompt,
  type PickupToast,
  type Player,
  type Position,
  type ReloadState,
  type RespawnState,
  type Shield,
  type StatusEffects,
  type Team,
  type VisionBlocker,
  type WeaponRuntimeState,
} from "./components.js";
import {
  DEFAULT_PLAYER_PHYSICS,
  physicsForPlayer,
  type PlayerPhysicsProfile,
} from "./player-physics.js";

export interface RuntimeEcsOptions {
  readonly playerHealth: number;
  readonly weaponId: string;
  readonly weaponSlotCount: number;
  readonly magazineSize: number;
  readonly reloadTicks: number;
  readonly inventoryCapacity: number;
  readonly initialAmmoReserve: number;
  readonly zoneDamagePerSecond: number;
  readonly bodyByModelId?: ReadonlyMap<string, PlayerPhysicsProfile>;
  readonly defaultPlayerPhysics?: PlayerPhysicsProfile;
}

export const registerBattleRoyaleRuntimeComponents = (world: PluginWorld): void => {
  world.registerComponent<Inventory>(INVENTORY_COMPONENT);
  world.registerComponent<EquippedWeapon>(EQUIPPED_WEAPON_COMPONENT);
  world.registerComponent<AmmoReserve>(AMMO_RESERVE_COMPONENT);
  world.registerComponent<ReloadState>(RELOAD_STATE_COMPONENT);
  world.registerComponent<WeaponRuntimeState>(WEAPON_RUNTIME_STATE_COMPONENT);
  world.registerComponent<DamageIndicator>(DAMAGE_INDICATOR_COMPONENT);
  world.registerComponent<PickupToast>(PICKUP_TOAST_COMPONENT);
  world.registerComponent<Pickup>(PICKUP_COMPONENT);
  world.registerComponent<PickupPrompt>(PICKUP_PROMPT_COMPONENT);
  world.registerComponent<LootSource>(LOOT_SOURCE_COMPONENT);
  world.registerComponent<Interactable>(INTERACTABLE_COMPONENT);
  world.registerComponent<Breakable>(BREAKABLE_COMPONENT);
  world.registerComponent<Hazard>(HAZARD_COMPONENT);
  world.registerComponent<Deployable>(DEPLOYABLE_COMPONENT);
  world.registerComponent<AbilityState>(ABILITY_STATE_COMPONENT);
  world.registerComponent<StatusEffects>(STATUS_EFFECTS_COMPONENT);
  world.registerComponent<Shield>(SHIELD_COMPONENT);
  world.registerComponent<Armor>(ARMOR_COMPONENT);
  world.registerComponent<Hitbox>(HITBOX_COMPONENT);
  world.registerComponent<CollisionBody>(COLLISION_BODY_COMPONENT);
  world.registerComponent<VisionBlocker>(VISION_BLOCKER_COMPONENT);
  world.registerComponent<MatchPhase>(MATCH_PHASE_COMPONENT);
  world.registerComponent<Facing>(FACING_COMPONENT);
  world.registerComponent<Aim>(AIM_COMPONENT);
  world.registerComponent<Muzzle>(MUZZLE_COMPONENT);
  world.registerComponent<RespawnState>(RESPAWN_STATE_COMPONENT);
  world.registerComponent<Team>(TEAM_COMPONENT);
};

const isDirection8 = (dir: number | undefined): dir is Direction8 =>
  dir !== undefined && Number.isInteger(dir) && dir >= 0 && dir <= 7;

const isAimDeg = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value) && value >= 0 && value < 360;

const facingDeg = (facing: Facing | undefined): number => (facing?.dir ?? 0) * 45;

const bodyForPlayer = (
  player: Player,
  options: RuntimeEcsOptions,
): PlayerPhysicsProfile =>
  physicsForPlayer(
    player,
    options.bodyByModelId,
    options.defaultPlayerPhysics ?? DEFAULT_PLAYER_PHYSICS,
  );

const hitboxFromBody = (body: PlayerPhysicsProfile): Hitbox => ({
  x: body.offsetX - body.radius,
  y: body.offsetY - body.radius,
  width: body.radius * 2,
  height: body.radius * 2,
});

const muzzleFor = (
  position: Position | undefined,
  body: PlayerPhysicsProfile,
  aimDeg: number,
): Muzzle => {
  const radians = (aimDeg * Math.PI) / 180;
  return {
    x: (position?.x ?? 0) + body.offsetX + Math.cos(radians) * body.radius,
    y: (position?.y ?? 0) + body.offsetY + Math.sin(radians) * body.radius,
  };
};

const initializePlayerRuntimeComponents = (
  world: PluginWorld,
  options: RuntimeEcsOptions,
): void => {
  const players = world.getComponent<Player>(PLAYER_COMPONENT);
  const positions = world.getComponent<Position>(POSITION_COMPONENT);
  const inventories = world.getComponent<Inventory>(INVENTORY_COMPONENT);
  const equippedWeapons = world.getComponent<EquippedWeapon>(EQUIPPED_WEAPON_COMPONENT);
  const ammoReserves = world.getComponent<AmmoReserve>(AMMO_RESERVE_COMPONENT);
  const reloadStates = world.getComponent<ReloadState>(RELOAD_STATE_COMPONENT);
  const weaponRuntimeStates = world.getComponent<WeaponRuntimeState>(WEAPON_RUNTIME_STATE_COMPONENT);
  const abilityStates = world.getComponent<AbilityState>(ABILITY_STATE_COMPONENT);
  const statusEffects = world.getComponent<StatusEffects>(STATUS_EFFECTS_COMPONENT);
  const shields = world.getComponent<Shield>(SHIELD_COMPONENT);
  const armor = world.getComponent<Armor>(ARMOR_COMPONENT);
  const hitboxes = world.getComponent<Hitbox>(HITBOX_COMPONENT);
  const collisionBodies = world.getComponent<CollisionBody>(COLLISION_BODY_COMPONENT);
  const teams = world.getComponent<Team>(TEAM_COMPONENT);
  const facings = world.getComponent<Facing>(FACING_COMPONENT);
  const aims = world.getComponent<Aim>(AIM_COMPONENT);
  const muzzles = world.getComponent<Muzzle>(MUZZLE_COMPONENT);
  const respawns = world.getComponent<RespawnState>(RESPAWN_STATE_COMPONENT);

  for (const [entity, player] of players.entries()) {
    const body = bodyForPlayer(player, options);
    const position = positions.get(entity);
    const aim = aims.get(entity)?.deg ?? facingDeg(facings.get(entity));
    inventories.set(entity, { itemIds: [], capacity: options.inventoryCapacity });
    equippedWeapons.set(entity, { weaponId: options.weaponId, slot: 1 });
    ammoReserves.set(entity, {
      stacks: [{ ammoKind: options.weaponId, amount: options.initialAmmoReserve }],
    });
    reloadStates.set(entity, { active: false, weaponId: options.weaponId, remainingTicks: 0 });
    weaponRuntimeStates.set(entity, {
      weaponId: options.weaponId,
      slot: 1,
      ammoInMagazine: options.magazineSize,
      magazineSize: options.magazineSize,
      cooldownRemainingTicks: 0,
      reloadRemainingTicks: 0,
      reloadTotalTicks: options.reloadTicks,
    });
    abilityStates.set(entity, { charges: 0, cooldownTicks: 0, cooldowns: [] });
    statusEffects.set(entity, { effects: [] });
    shields.set(entity, { current: 0, max: 0 });
    armor.set(entity, { mitigation: 0, durability: 0 });
    hitboxes.set(entity, hitboxFromBody(body));
    collisionBodies.set(entity, {
      x: (position?.x ?? 0) + body.offsetX - body.radius,
      y: (position?.y ?? 0) + body.offsetY - body.radius,
      width: body.radius * 2,
      height: body.radius * 2,
      blocksMovement: player.alive === 1,
      blocksProjectiles: player.alive === 1,
      blocksVision: false,
    });
    teams.set(entity, { team: player.team });
    facings.set(entity, facings.get(entity) ?? { dir: 0 });
    aims.set(entity, { deg: aim });
    muzzles.set(entity, muzzleFor(position, body, aim));
    respawns.set(entity, { state: player.alive === 1 ? "alive" : "dead" });
  }
};

const comparePlacements = (left: ObjectPlacement, right: ObjectPlacement): number =>
  left.objectId.localeCompare(right.objectId);

const spawnRuntimeObjects = (
  world: PluginWorld,
  artifact: ExportedArtifact,
  options: RuntimeEcsOptions,
): void => {
  const positions = world.getComponent<Position>(POSITION_COMPONENT);
  const pickups = world.getComponent<Pickup>(PICKUP_COMPONENT);
  const lootSources = world.getComponent<LootSource>(LOOT_SOURCE_COMPONENT);
  const interactables = world.getComponent<Interactable>(INTERACTABLE_COMPONENT);
  const breakables = world.getComponent<Breakable>(BREAKABLE_COMPONENT);
  const hazards = world.getComponent<Hazard>(HAZARD_COMPONENT);
  const deployables = world.getComponent<Deployable>(DEPLOYABLE_COMPONENT);
  const collisionBodies = world.getComponent<CollisionBody>(COLLISION_BODY_COMPONENT);
  const visionBlockers = world.getComponent<VisionBlocker>(VISION_BLOCKER_COMPONENT);

  for (const placement of [...artifact.objectPlacements].sort(comparePlacements)) {
    const entity = world.createEntity();
    positions.set(entity, { x: placement.x, y: placement.y });
    if (placement.role === "loot-crate") {
      pickups.set(entity, {
        itemKind: placement.properties.itemKind,
        tier: placement.properties.tier,
        quantity: 1,
        available: true,
      });
      lootSources.set(entity, {
        tableId: placement.objectId,
        tier: placement.properties.tier,
        weight: placement.properties.weight,
        collected: false,
      });
      interactables.set(entity, {
        action: "pickup-loot",
        radius: LOOT_PICKUP_RADIUS,
        enabled: true,
      });
      breakables.set(entity, { health: 100, maxHealth: 100, destroyed: false });
    }
    if (placement.role === "shrink-zone-anchor") {
      hazards.set(entity, { damagePerSecond: options.zoneDamagePerSecond, enabled: true });
    }
    if (placement.role === "trap") {
      deployables.set(entity, {
        kind: "trap",
        ownerId: "environment",
        radius: placement.properties.radius,
        remainingTicks: Number.MAX_SAFE_INTEGER,
        armedTicks: 0,
        triggered: false,
      });
    }
    if (placement.role === "decoy") {
      deployables.set(entity, {
        kind: "decoy",
        ownerId: "environment",
        radius: placement.properties.radius,
        remainingTicks: placement.properties.durationTicks,
        armedTicks: 0,
        triggered: false,
      });
    }
  }

  for (const rect of [...(artifact.objectCollisionRects ?? [])].sort((left, right) =>
    left.objectId.localeCompare(right.objectId) || left.y - right.y || left.x - right.x,
  )) {
    const entity = world.createEntity();
    collisionBodies.set(entity, { ...rect });
    if (rect.blocksVision) {
      visionBlockers.set(entity, {
        objectId: rect.objectId,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      });
    }
  }
};

export const initializeBattleRoyaleRuntimeEcs = (
  world: PluginWorld,
  artifact: ExportedArtifact,
  options: RuntimeEcsOptions,
): void => {
  registerBattleRoyaleRuntimeComponents(world);
  initializePlayerRuntimeComponents(world, options);
  spawnRuntimeObjects(world, artifact, options);
};

export const syncPlayerInputRuntimeComponents = (
  world: PluginWorld,
  getPlayerInput: ((playerId: string) => RuntimePlayerInput | undefined) | undefined,
  options: RuntimeEcsOptions,
): void => {
  const players = world.getComponent<Player>(PLAYER_COMPONENT);
  const positions = world.getComponent<Position>(POSITION_COMPONENT);
  const facings = world.getComponent<Facing>(FACING_COMPONENT);
  const aims = world.getComponent<Aim>(AIM_COMPONENT);
  const muzzles = world.getComponent<Muzzle>(MUZZLE_COMPONENT);
  const collisionBodies = world.getComponent<CollisionBody>(COLLISION_BODY_COMPONENT);

  for (const [entity, player] of players.entries()) {
    const input = getPlayerInput?.(player.playerId);
    if (player.alive === 1 && isDirection8(input?.dir)) {
      facings.set(entity, { dir: input.dir });
    }
    const aim = player.alive === 1 && isAimDeg(input?.aimDeg) ? input.aimDeg : facingDeg(facings.get(entity));
    const body = bodyForPlayer(player, options);
    const position = positions.get(entity);
    if (player.alive === 1) {
      aims.set(entity, { deg: aim });
      muzzles.set(entity, muzzleFor(position, body, aim));
    }
    collisionBodies.set(entity, {
      x: (position?.x ?? 0) + body.offsetX - body.radius,
      y: (position?.y ?? 0) + body.offsetY - body.radius,
      width: body.radius * 2,
      height: body.radius * 2,
      blocksMovement: player.alive === 1,
      blocksProjectiles: player.alive === 1,
      blocksVision: false,
    });
  }
};

import * as BattleRoyaleProtocol from '@tileborne/ipc-contracts/protocols/battle-royale';
import { Option } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  ABILITY_STATE_COMPONENT,
  AMMO_RESERVE_COMPONENT,
  ARMOR_COMPONENT,
  BREAKABLE_COMPONENT,
  DAMAGE_INDICATOR_COMPONENT,
  EQUIPPED_WEAPON_COMPONENT,
  HAZARD_COMPONENT,
  INTERACTABLE_COMPONENT,
  INVENTORY_COMPONENT,
  LOOT_SOURCE_COMPONENT,
  PLAYER_COMPONENT,
  PLAYER_STATS_COMPONENT,
  POSITION_COMPONENT,
  PICKUP_COMPONENT,
  PICKUP_PROMPT_COMPONENT,
  PICKUP_TOAST_COMPONENT,
  RELOAD_STATE_COMPONENT,
  SHIELD_COMPONENT,
  STATUS_EFFECTS_COMPONENT,
  WEAPON_RUNTIME_STATE_COMPONENT,
  type AbilityState,
  type AmmoReserve,
  type Armor,
  type Breakable,
  type DamageIndicator,
  type EquippedWeapon,
  type Hazard,
  type Interactable,
  type Inventory,
  type LootSource,
  type Pickup,
  type PickupPrompt,
  type PickupToast,
  type Player,
  type PlayerStats,
  type Position,
  type ReloadState,
  type Shield,
  type StatusEffects,
  type WeaponRuntimeState,
} from '../ecs/components.js';
import { createTestPluginWorld } from '../test-plugin-world.js';

import { createBattleRoyaleSnapshotEmitter } from './snapshot-emitter.js';

describe('createBattleRoyaleSnapshotEmitter', () => {
  it('emits pickups, loot crates, hazards, and interactables as object snapshots', () => {
    const world = createTestPluginWorld();
    const players = world.registerComponent<Player>(PLAYER_COMPONENT);
    const positions = world.registerComponent<Position>(POSITION_COMPONENT);
    const pickups = world.registerComponent<Pickup>(PICKUP_COMPONENT);
    const lootSources = world.registerComponent<LootSource>(LOOT_SOURCE_COMPONENT);
    const interactables = world.registerComponent<Interactable>(INTERACTABLE_COMPONENT);
    const breakables = world.registerComponent<Breakable>(BREAKABLE_COMPONENT);
    const hazards = world.registerComponent<Hazard>(HAZARD_COMPONENT);

    const playerEntity = world.createEntity();
    players.set(playerEntity, { playerId: 'player-1', health: 100, alive: 1, team: 'solo' });
    positions.set(playerEntity, { x: 4, y: 8 });

    const crateEntity = world.createEntity();
    positions.set(crateEntity, { x: 40, y: 48 });
    pickups.set(crateEntity, { itemKind: 'rifle', tier: 'rare', quantity: 1, available: true });
    lootSources.set(crateEntity, {
      tableId: 'loot-crate-a',
      tier: 'rare',
      weight: 2,
      collected: false,
    });
    interactables.set(crateEntity, { action: 'pickup-loot', radius: 32, enabled: true });
    breakables.set(crateEntity, { health: 100, maxHealth: 100, destroyed: false });

    const hazardEntity = world.createEntity();
    positions.set(hazardEntity, { x: 64, y: 64 });
    hazards.set(hazardEntity, { damagePerSecond: 5, enabled: true });

    const emitter = createBattleRoyaleSnapshotEmitter('seed');
    const welcome = BattleRoyaleProtocol.decodeServerMessage(emitter.emitWelcome(world, 1));

    expect(welcome).toBeInstanceOf(BattleRoyaleProtocol.WelcomeSnapshot);
    expect((welcome as BattleRoyaleProtocol.WelcomeSnapshot).objects).toEqual([
      expect.objectContaining({
        id: BattleRoyaleProtocol.makeObjectId(String(crateEntity)),
        pickup: { itemKind: 'rifle', tier: 'rare', quantity: 1, available: true },
        lootSource: { tableId: 'loot-crate-a', tier: 'rare', weight: 2, collected: false },
        interactable: { action: 'pickup-loot', radius: 32, enabled: true },
        breakable: { health: 100, maxHealth: 100, destroyed: false },
      }),
      expect.objectContaining({
        id: BattleRoyaleProtocol.makeObjectId(String(hazardEntity)),
        hazard: { damagePerSecond: 5, enabled: true },
      }),
    ]);

    pickups.set(crateEntity, { itemKind: 'rifle', tier: 'rare', quantity: 1, available: false });
    lootSources.set(crateEntity, {
      tableId: 'loot-crate-a',
      tier: 'rare',
      weight: 2,
      collected: true,
    });
    interactables.set(crateEntity, { action: 'pickup-loot', radius: 32, enabled: false });
    breakables.set(crateEntity, { health: 0, maxHealth: 100, destroyed: true });
    world.destroyEntity(hazardEntity);

    const delta = BattleRoyaleProtocol.decodeServerMessage(emitter.emitDelta(world, 2));

    expect(delta).toBeInstanceOf(BattleRoyaleProtocol.DeltaSnapshot);
    expect((delta as BattleRoyaleProtocol.DeltaSnapshot).objectsUpdated).toEqual([
      expect.objectContaining({
        id: BattleRoyaleProtocol.makeObjectId(String(crateEntity)),
        pickup: { itemKind: 'rifle', tier: 'rare', quantity: 1, available: false },
        lootSource: { tableId: 'loot-crate-a', tier: 'rare', weight: 2, collected: true },
        interactable: { action: 'pickup-loot', radius: 32, enabled: false },
        breakable: { health: 0, maxHealth: 100, destroyed: true },
      }),
    ]);
    expect((delta as BattleRoyaleProtocol.DeltaSnapshot).objectsRemoved).toEqual([
      BattleRoyaleProtocol.makeObjectId(String(hazardEntity)),
    ]);
  });

  it('emits player HUD state from ECS components', () => {
    const world = createTestPluginWorld();
    const players = world.registerComponent<Player>(PLAYER_COMPONENT);
    const positions = world.registerComponent<Position>(POSITION_COMPONENT);
    const abilityStates = world.registerComponent<AbilityState>(ABILITY_STATE_COMPONENT);
    const armor = world.registerComponent<Armor>(ARMOR_COMPONENT);
    const damageIndicators = world.registerComponent<DamageIndicator>(DAMAGE_INDICATOR_COMPONENT);
    const equippedWeapons = world.registerComponent<EquippedWeapon>(EQUIPPED_WEAPON_COMPONENT);
    const inventories = world.registerComponent<Inventory>(INVENTORY_COMPONENT);
    const pickupPrompts = world.registerComponent<PickupPrompt>(PICKUP_PROMPT_COMPONENT);
    const pickupToasts = world.registerComponent<PickupToast>(PICKUP_TOAST_COMPONENT);
    const playerStats = world.registerComponent<PlayerStats>(PLAYER_STATS_COMPONENT);
    const reserves = world.registerComponent<AmmoReserve>(AMMO_RESERVE_COMPONENT);
    const reloadStates = world.registerComponent<ReloadState>(RELOAD_STATE_COMPONENT);
    const shields = world.registerComponent<Shield>(SHIELD_COMPONENT);
    const statuses = world.registerComponent<StatusEffects>(STATUS_EFFECTS_COMPONENT);
    const weaponRuntimeStates = world.registerComponent<WeaponRuntimeState>(
      WEAPON_RUNTIME_STATE_COMPONENT,
    );

    const playerEntity = world.createEntity();
    players.set(playerEntity, { playerId: 'player-1', health: 100, alive: 1, team: 'solo' });
    positions.set(playerEntity, { x: 4, y: 8 });
    abilityStates.set(playerEntity, {
      charges: 0,
      cooldownTicks: 0,
      cooldowns: [{ abilityId: 'dash', remainingTicks: 8 }],
    });
    armor.set(playerEntity, { mitigation: 0.25, durability: 80 });
    damageIndicators.set(playerEntity, { sourceId: 'player-2', angleDeg: 90, amount: 12, tick: 1 });
    equippedWeapons.set(playerEntity, { weaponId: 'weapon:primary', slot: 2 });
    inventories.set(playerEntity, { itemIds: ['health-pack'], capacity: 5 });
    pickupPrompts.set(playerEntity, {
      itemKind: 'ammo-box',
      tier: 'common',
      distance: 1.2,
      action: 'pickup-loot',
      available: true,
    });
    pickupToasts.set(playerEntity, { itemKind: 'ammo-box', tier: 'common', quantity: 1, tick: 1 });
    playerStats.set(playerEntity, { kills: 1, deaths: 0 });
    reserves.set(playerEntity, { stacks: [{ ammoKind: 'weapon:primary', amount: 6 }] });
    reloadStates.set(playerEntity, { active: true, weaponId: 'weapon:primary', remainingTicks: 4 });
    shields.set(playerEntity, { current: 20, max: 50 });
    statuses.set(playerEntity, {
      effects: [{ effectId: 'reveal', remainingTicks: 20, stacks: 1 }],
    });
    weaponRuntimeStates.set(playerEntity, {
      weaponId: 'weapon:primary',
      slot: 2,
      ammoInMagazine: 1,
      magazineSize: 3,
      cooldownRemainingTicks: 0,
      reloadRemainingTicks: 4,
      reloadTotalTicks: 12,
    });

    const emitter = createBattleRoyaleSnapshotEmitter('seed');
    const welcome = BattleRoyaleProtocol.decodeServerMessage(emitter.emitWelcome(world, 1));

    expect(welcome).toBeInstanceOf(BattleRoyaleProtocol.WelcomeSnapshot);
    expect((welcome as BattleRoyaleProtocol.WelcomeSnapshot).players[0]).toMatchObject({
      shield: 20,
      armor: { mitigation: 0.25, durability: 80 },
      weapon: {
        weaponId: 'weapon:primary',
        slot: 2,
        ammoInMagazine: 1,
        magazineSize: 3,
        reserveAmmo: 6,
        cooldownRemainingTicks: 0,
        reloadRemainingTicks: 4,
        reloadTotalTicks: 12,
      },
      inventory: { itemIds: ['health-pack'], capacity: 5 },
      pickupPrompt: {
        itemKind: 'ammo-box',
        tier: 'common',
        distance: 1.2,
        action: 'pickup-loot',
        available: true,
      },
      pickupToast: { itemKind: 'ammo-box', tier: 'common', quantity: 1, tick: 1 },
      damageIndicator: { sourceId: 'player-2', angleDeg: 90, amount: 12, tick: 1 },
      stats: { kills: 1, deaths: 0 },
      statusEffects: [{ effectId: 'reveal', remainingTicks: 20, stacks: 1 }],
      abilityCooldowns: [{ abilityId: 'dash', remainingTicks: 8 }],
    });

    shields.set(playerEntity, { current: 0, max: 50 });
    damageIndicators.set(playerEntity, { sourceId: 'zone', angleDeg: 0, amount: 5, tick: 2 });
    pickupToasts.set(playerEntity, { itemKind: 'health-pack', tier: 'rare', quantity: 1, tick: 2 });
    statuses.set(playerEntity, { effects: [] });
    weaponRuntimeStates.set(playerEntity, {
      weaponId: 'weapon:primary',
      slot: 2,
      ammoInMagazine: 0,
      magazineSize: 3,
      cooldownRemainingTicks: 0,
      reloadRemainingTicks: 0,
      reloadTotalTicks: 12,
    });

    const delta = BattleRoyaleProtocol.decodeServerMessage(emitter.emitDelta(world, 2));
    expect(delta).toBeInstanceOf(BattleRoyaleProtocol.DeltaSnapshot);
    const update = (delta as BattleRoyaleProtocol.DeltaSnapshot).updated[0];
    expect(update).toBeDefined();
    expect(Option.isSome(update!.shield) ? update!.shield.value : undefined).toBe(0);
    expect(Option.isSome(update!.statusEffects) ? update!.statusEffects.value : undefined).toEqual(
      [],
    );
    expect(Option.isSome(update!.weapon) ? update!.weapon.value : undefined).toEqual(
      expect.objectContaining({ ammoInMagazine: 0, reserveAmmo: 6 }),
    );
    expect(Option.isSome(update!.pickupToast) ? update!.pickupToast.value : undefined).toEqual({
      itemKind: 'health-pack',
      tier: 'rare',
      quantity: 1,
      tick: 2,
    });
    expect(
      Option.isSome(update!.damageIndicator) ? update!.damageIndicator.value : undefined,
    ).toEqual({
      sourceId: 'zone',
      angleDeg: 0,
      amount: 5,
      tick: 2,
    });
  });
});

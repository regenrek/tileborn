import { MOVEMENT, ZONE } from '../constants.js';

/**
 * Battle Royale's canonical world→HUD derivation (the HUD-state SSOT for the
 * single-player playtest host).
 *
 * Reads the plugin's OWN ECS components (Player, Zone, WeaponRuntimeState, …)
 * and projects them into the engine's neutral playtest HUD-state shape. The
 * desktop main-process host calls this through the runtime bundle export —
 * it owns only the wire-event tracker (kill feed, game-over) and never names
 * a Battle Royale component again. The zone phase math uses the plugin's real
 * `ZONE.schedule`/`MOVEMENT.tickRate` constants, so HUD countdowns can never
 * drift from the simulation.
 */

const PRIMARY_PLAYER_ID = 'player-1';
const DEFAULT_PLAYER_HEALTH = 100;

/** Minimal structural view of the host's plugin world (component access only). */
export interface HudComponentStore<T> {
  readonly get: (entity: number) => T | undefined;
  readonly entries: () => Iterable<[number, T]>;
}

export interface HudWorldView {
  readonly getComponent: <T extends object>(name: string) => HudComponentStore<T>;
}

interface ZoneComponent {
  readonly cx: number;
  readonly cy: number;
  readonly currentRadius: number;
  readonly targetRadius: number;
  readonly shrinkStartTick: number;
  readonly shrinkDurationTicks: number;
  readonly shrinkFromRadius: number;
  readonly damagePerSecOutside: number;
  readonly schedulePhaseIndex: number;
  readonly phaseStartTick: number;
}

interface PlayerComponent {
  readonly playerId: string;
  readonly health: number;
  readonly alive: 0 | 1;
  readonly team?: string;
}

interface PositionComponent {
  readonly x: number;
  readonly y: number;
}

interface ShieldComponent {
  readonly current: number;
  readonly max: number;
}

interface ArmorComponent {
  readonly mitigation: number;
  readonly durability: number;
}

interface WeaponRuntimeStateComponent {
  readonly weaponId: string;
  readonly slot: number;
  readonly ammoInMagazine: number;
  readonly magazineSize: number;
  readonly cooldownRemainingTicks: number;
  readonly reloadRemainingTicks: number;
  readonly reloadTotalTicks: number;
}

interface EquippedWeaponComponent {
  readonly weaponId: string;
  readonly slot: number;
}

interface AmmoReserveComponent {
  readonly stacks: readonly {
    readonly ammoKind: string;
    readonly amount: number;
  }[];
}

interface ReloadStateComponent {
  readonly active: boolean;
  readonly weaponId?: string;
  readonly remainingTicks: number;
}

interface InventoryComponent {
  readonly itemIds: readonly string[];
  readonly capacity: number;
}

interface PickupPromptComponent {
  readonly itemKind?: string;
  readonly tier?: string;
  readonly distance?: number;
  readonly action: 'pickup-loot';
  readonly available: boolean;
}

interface PickupToastComponent {
  readonly itemKind: string;
  readonly tier: string;
  readonly quantity: number;
  readonly tick: number;
}

interface DamageIndicatorComponent {
  readonly sourceId: string;
  readonly angleDeg: number;
  readonly amount: number;
  readonly tick: number;
}

interface PlayerStatsComponent {
  readonly kills: number;
  readonly deaths: number;
}

interface StatusEffectsComponent {
  readonly effects: readonly {
    readonly effectId: string;
    readonly remainingTicks: number;
    readonly stacks: number;
  }[];
}

interface AbilityStateComponent {
  readonly cooldowns?: readonly {
    readonly abilityId: string;
    readonly remainingTicks: number;
  }[];
}

interface PickupComponent {
  readonly itemKind: string;
  readonly tier: string;
  readonly quantity: number;
  readonly available: boolean;
}

interface LootSourceComponent {
  readonly tableId: string;
  readonly tier: string;
  readonly weight: number;
  readonly collected: boolean;
}

interface HazardComponent {
  readonly damagePerSecond: number;
  readonly enabled: boolean;
}

/** The world-derived HUD slice (events and game-over stay host-tracked). */
export interface PlaytestHudWorldState {
  readonly totalPlayers: number;
  readonly localPlayer?: {
    readonly playerId: string;
    readonly displayName: string;
    readonly team?: string;
    readonly health: number;
    readonly maxHealth: number;
    readonly position?: { readonly x: number; readonly y: number };
    readonly shield?: number;
    readonly armor?: { readonly mitigation: number; readonly durability: number };
    readonly weapon?: {
      readonly weaponId: string;
      readonly slot: number;
      readonly ammoInMagazine?: number;
      readonly magazineSize?: number;
      readonly reserveAmmo?: number;
      readonly cooldownRemainingTicks?: number;
      readonly reloadRemainingTicks?: number;
      readonly reloadTotalTicks?: number;
    };
    readonly inventory?: { readonly itemIds: readonly string[]; readonly capacity: number };
    readonly pickupPrompt?: {
      readonly itemKind?: string;
      readonly tier?: string;
      readonly distance?: number;
      readonly action: 'pickup-loot';
      readonly available: boolean;
    };
    readonly pickupToast?: {
      readonly itemKind: string;
      readonly tier: string;
      readonly quantity: number;
      readonly tick: number;
    };
    readonly damageIndicator?: {
      readonly sourceId: string;
      readonly angleDeg: number;
      readonly amount: number;
      readonly tick: number;
    };
    readonly stats?: { readonly kills: number; readonly deaths: number };
    readonly statusEffects?: readonly {
      readonly effectId: string;
      readonly remainingTicks: number;
      readonly stacks: number;
    }[];
    readonly abilityCooldowns?: readonly {
      readonly abilityId: string;
      readonly remainingTicks: number;
    }[];
  };
  readonly zoneStatus?: {
    readonly phase: 'stable' | 'countdown' | 'shrinking';
    readonly secondsRemaining?: number;
  };
  readonly scoreboard: readonly {
    readonly playerId: string;
    readonly displayName: string;
    readonly team?: string;
    readonly health: number;
    readonly alive: boolean;
    readonly kills: number;
    readonly deaths: number;
  }[];
  readonly minimap: {
    readonly zone?: { readonly cx: number; readonly cy: number; readonly radius: number };
    readonly players: readonly {
      readonly playerId: string;
      readonly x: number;
      readonly y: number;
      readonly local: boolean;
      readonly alive: boolean;
      readonly health: number;
    }[];
    readonly objects: readonly {
      readonly objectId: string;
      readonly x: number;
      readonly y: number;
      readonly kind: 'pickup' | 'loot' | 'hazard' | 'objective';
      readonly tier?: string;
      readonly available?: boolean;
    }[];
  };
}

type ZoneStatusState = NonNullable<PlaytestHudWorldState['zoneStatus']>;
type ScoreboardEntry = PlaytestHudWorldState['scoreboard'][number];
type MinimapPlayer = PlaytestHudWorldState['minimap']['players'][number];
type MinimapObject = PlaytestHudWorldState['minimap']['objects'][number];

const readOptionalComponent = <T extends object>(
  world: HudWorldView,
  name: string,
): HudComponentStore<T> | undefined => {
  try {
    return world.getComponent<T>(name);
  } catch {
    return undefined;
  }
};

export const formatPlayerDisplayName = (playerId: string): string => {
  const match = /^player-(\d+)$/.exec(playerId);
  if (match) {
    return `Player ${match[1]}`;
  }
  return playerId;
};

const reserveAmount = (
  reserve: AmmoReserveComponent | undefined,
  weaponId: string,
): number | undefined => reserve?.stacks.find((stack) => stack.ammoKind === weaponId)?.amount;

const readWeapon = (
  runtime: WeaponRuntimeStateComponent | undefined,
  equipped: EquippedWeaponComponent | undefined,
  reserve: AmmoReserveComponent | undefined,
  reload: ReloadStateComponent | undefined,
): NonNullable<NonNullable<PlaytestHudWorldState['localPlayer']>['weapon']> | undefined => {
  if (runtime !== undefined) {
    const reserveAmmo = reserveAmount(reserve, runtime.weaponId);
    return {
      weaponId: runtime.weaponId,
      slot: runtime.slot,
      ammoInMagazine: runtime.ammoInMagazine,
      magazineSize: runtime.magazineSize,
      ...(reserveAmmo === undefined ? {} : { reserveAmmo }),
      cooldownRemainingTicks: runtime.cooldownRemainingTicks,
      reloadRemainingTicks: runtime.reloadRemainingTicks,
      reloadTotalTicks: runtime.reloadTotalTicks,
    };
  }
  if (equipped === undefined) {
    return undefined;
  }
  const reserveAmmo = reserveAmount(reserve, equipped.weaponId);
  return {
    weaponId: equipped.weaponId,
    slot: equipped.slot,
    ...(reserveAmmo === undefined ? {} : { reserveAmmo }),
    ...(reload === undefined ? {} : { reloadRemainingTicks: reload.remainingTicks }),
  };
};

const computeZoneStatus = (zone: ZoneComponent, tick: number): ZoneStatusState => {
  if (zone.schedulePhaseIndex === 0) {
    const phaseDuration = ZONE.schedule.waitSec * MOVEMENT.tickRate;
    const elapsed = Math.max(0, tick - zone.phaseStartTick);
    const remainingTicks = Math.max(0, phaseDuration - elapsed);
    return {
      phase: 'countdown',
      secondsRemaining: Math.ceil(remainingTicks / MOVEMENT.tickRate),
    };
  }

  if (zone.shrinkStartTick >= 0) {
    const elapsed = tick - zone.shrinkStartTick;
    if (elapsed >= 0 && elapsed < zone.shrinkDurationTicks) {
      return { phase: 'shrinking' };
    }
  }

  return { phase: 'stable' };
};

const readZone = (world: HudWorldView): ZoneComponent | undefined => {
  try {
    const zones = world.getComponent<ZoneComponent>('Zone');
    for (const [, zone] of zones.entries()) {
      return zone;
    }
  } catch {
    return undefined;
  }
  return undefined;
};

const readPlayers = (
  world: HudWorldView,
): {
  readonly totalPlayers: number;
  readonly localPlayer?: PlaytestHudWorldState['localPlayer'];
  readonly scoreboard: readonly ScoreboardEntry[];
  readonly minimapPlayers: readonly MinimapPlayer[];
} => {
  try {
    const players = world.getComponent<PlayerComponent>('Player');
    const positions = readOptionalComponent<PositionComponent>(world, 'Position');
    const armor = readOptionalComponent<ArmorComponent>(world, 'Armor');
    const equippedWeapons = readOptionalComponent<EquippedWeaponComponent>(world, 'EquippedWeapon');
    const reserves = readOptionalComponent<AmmoReserveComponent>(world, 'AmmoReserve');
    const reloadStates = readOptionalComponent<ReloadStateComponent>(world, 'ReloadState');
    const weaponRuntimeStates = readOptionalComponent<WeaponRuntimeStateComponent>(
      world,
      'WeaponRuntimeState',
    );
    const damageIndicators = readOptionalComponent<DamageIndicatorComponent>(
      world,
      'DamageIndicator',
    );
    const inventories = readOptionalComponent<InventoryComponent>(world, 'Inventory');
    const pickupPrompts = readOptionalComponent<PickupPromptComponent>(world, 'PickupPrompt');
    const pickupToasts = readOptionalComponent<PickupToastComponent>(world, 'PickupToast');
    const playerStats = readOptionalComponent<PlayerStatsComponent>(world, 'PlayerStats');
    const shields = readOptionalComponent<ShieldComponent>(world, 'Shield');
    const statuses = readOptionalComponent<StatusEffectsComponent>(world, 'StatusEffects');
    const abilityStates = readOptionalComponent<AbilityStateComponent>(world, 'AbilityState');
    let totalPlayers = 0;
    let localPlayer: PlaytestHudWorldState['localPlayer'];
    const scoreboard: ScoreboardEntry[] = [];
    const minimapPlayers: MinimapPlayer[] = [];

    for (const [entity, player] of players.entries()) {
      totalPlayers += 1;
      const position = positions?.get(entity);
      const stats = playerStats?.get(entity) ?? { kills: 0, deaths: 0 };
      scoreboard.push({
        playerId: player.playerId,
        displayName: formatPlayerDisplayName(player.playerId),
        ...(player.team === undefined ? {} : { team: player.team }),
        health: player.health,
        alive: player.alive === 1,
        kills: stats.kills,
        deaths: stats.deaths,
      });
      if (position !== undefined) {
        minimapPlayers.push({
          playerId: player.playerId,
          x: position.x,
          y: position.y,
          local: player.playerId === PRIMARY_PLAYER_ID,
          alive: player.alive === 1,
          health: player.health,
        });
      }
      if (player.playerId === PRIMARY_PLAYER_ID) {
        const shield = shields?.get(entity);
        const statusEffects = statuses
          ?.get(entity)
          ?.effects.filter((effect) => effect.remainingTicks > 0)
          .map((effect) => ({
            effectId: effect.effectId,
            remainingTicks: effect.remainingTicks,
            stacks: effect.stacks,
          }));
        const abilityCooldowns = abilityStates
          ?.get(entity)
          ?.cooldowns?.filter((cooldown) => cooldown.remainingTicks > 0)
          .map((cooldown) => ({
            abilityId: cooldown.abilityId,
            remainingTicks: cooldown.remainingTicks,
          }));
        const playerArmor = armor?.get(entity);
        const weapon = readWeapon(
          weaponRuntimeStates?.get(entity),
          equippedWeapons?.get(entity),
          reserves?.get(entity),
          reloadStates?.get(entity),
        );
        const inventory = inventories?.get(entity);
        const prompt = pickupPrompts?.get(entity);
        const pickupToast = pickupToasts?.get(entity);
        const damageIndicator = damageIndicators?.get(entity);
        localPlayer = {
          playerId: player.playerId,
          displayName: formatPlayerDisplayName(player.playerId),
          ...(player.team === undefined ? {} : { team: player.team }),
          health: player.health,
          maxHealth: DEFAULT_PLAYER_HEALTH,
          ...(position === undefined ? {} : { position }),
          ...(shield !== undefined ? { shield: shield.current } : {}),
          ...(playerArmor === undefined ? {} : { armor: playerArmor }),
          ...(weapon === undefined ? {} : { weapon }),
          ...(inventory === undefined ? {} : { inventory }),
          ...(prompt === undefined
            ? {}
            : {
                pickupPrompt: {
                  ...(prompt.itemKind === undefined ? {} : { itemKind: prompt.itemKind }),
                  ...(prompt.tier === undefined ? {} : { tier: prompt.tier }),
                  ...(prompt.distance === undefined ? {} : { distance: prompt.distance }),
                  action: prompt.action,
                  available: prompt.available,
                },
              }),
          ...(pickupToast === undefined ? {} : { pickupToast }),
          ...(damageIndicator === undefined ? {} : { damageIndicator }),
          stats,
          ...(statusEffects !== undefined && statusEffects.length > 0 ? { statusEffects } : {}),
          ...(abilityCooldowns !== undefined && abilityCooldowns.length > 0
            ? { abilityCooldowns }
            : {}),
        };
      }
    }

    scoreboard.sort(
      (left, right) => right.kills - left.kills || left.playerId.localeCompare(right.playerId),
    );
    minimapPlayers.sort((left, right) => left.playerId.localeCompare(right.playerId));

    return localPlayer === undefined
      ? { totalPlayers, scoreboard, minimapPlayers }
      : { totalPlayers, localPlayer, scoreboard, minimapPlayers };
  } catch {
    return { totalPlayers: 0, scoreboard: [], minimapPlayers: [] };
  }
};

const readMinimapObjects = (world: HudWorldView): readonly MinimapObject[] => {
  const positions = readOptionalComponent<PositionComponent>(world, 'Position');
  const pickups = readOptionalComponent<PickupComponent>(world, 'Pickup');
  const lootSources = readOptionalComponent<LootSourceComponent>(world, 'LootSource');
  const hazards = readOptionalComponent<HazardComponent>(world, 'Hazard');
  const entities = new Set<number>();
  for (const store of [pickups, lootSources, hazards]) {
    for (const [entity] of store?.entries() ?? []) {
      entities.add(entity);
    }
  }
  return [...entities]
    .sort((left, right) => left - right)
    .flatMap((entity): MinimapObject[] => {
      const position = positions?.get(entity);
      if (position === undefined) {
        return [];
      }
      const pickup = pickups?.get(entity);
      const loot = lootSources?.get(entity);
      const hazard = hazards?.get(entity);
      if (hazard?.enabled) {
        return [
          { objectId: String(entity), x: position.x, y: position.y, kind: 'hazard' as const },
        ];
      }
      if (pickup !== undefined) {
        return [
          {
            objectId: String(entity),
            x: position.x,
            y: position.y,
            kind: 'pickup' as const,
            tier: pickup.tier,
            available: pickup.available,
          },
        ];
      }
      if (loot !== undefined) {
        return [
          {
            objectId: String(entity),
            x: position.x,
            y: position.y,
            kind: 'loot' as const,
            tier: loot.tier,
            available: !loot.collected,
          },
        ];
      }
      return [];
    });
};

/** Derive the full world-owned HUD slice for one tick. */
export const derivePlaytestHudWorldState = (
  world: HudWorldView,
  tickCount: number,
): PlaytestHudWorldState => {
  const { totalPlayers, localPlayer, scoreboard, minimapPlayers } = readPlayers(world);
  const zone = readZone(world);
  return {
    totalPlayers,
    ...(localPlayer !== undefined ? { localPlayer } : {}),
    ...(zone ? { zoneStatus: computeZoneStatus(zone, tickCount) } : {}),
    scoreboard,
    minimap: {
      ...(zone ? { zone: { cx: zone.cx, cy: zone.cy, radius: zone.currentRadius } } : {}),
      players: minimapPlayers,
      objects: readMinimapObjects(world),
    },
  };
};

import type { GameplayWeaponFired } from '@tileborne/ipc-contracts';
import * as BattleRoyaleProtocol from '@tileborne/ipc-contracts/protocols/battle-royale';
import { createSeededRng, type ProjectileDelivery } from '@tileborne/simulation';

import { DEFAULT_BATTLE_ROYALE_CONFIG } from '../battle-royale-config.js';
import {
  BREAKABLE_COMPONENT,
  COLLISION_BODY_COMPONENT,
  FACING_COMPONENT,
  INTERACTABLE_COMPONENT,
  LOOT_SOURCE_COMPONENT,
  PICKUP_COMPONENT,
  PICKUP_PROMPT_COMPONENT,
  PLAYER_COMPONENT,
  POSITION_COMPONENT,
  PROJECTILE_COMPONENT,
  TEAM_COMPONENT,
  VELOCITY_COMPONENT,
  type Player,
  type Position,
} from '../ecs/components.js';
import {
  buildCombatBlockers,
  createBattleRoyaleCombatWorldView,
  createBattleRoyaleHitPolicy,
} from '../ecs/combat-world-view.js';
import { createCombatSystemState, runCombatSystem, type MapBounds } from '../ecs/combat-system.js';
import { createDamageSystemState } from '../ecs/damage-system.js';
import { updatePlayerAnimationStates } from '../ecs/player-animation.js';
import { createBattleRoyaleSnapshotEmitter } from '../server/snapshot-emitter.js';
import { createTestPluginWorld } from '../test-plugin-world.js';
import type { RuntimePlayerInput } from '../types/runtime-plugin.js';
import { resolveBattleRoyaleWeaponEntry } from '../weapon-catalog.js';

const CONFIG = DEFAULT_BATTLE_ROYALE_CONFIG;
const WEAPON_ENTRY = resolveBattleRoyaleWeaponEntry(CONFIG);

const openMapBounds = (): MapBounds => ({
  minX: -10_000,
  minY: -10_000,
  maxX: 10_000,
  maxY: 10_000,
});

const registerStores = (world: ReturnType<typeof createTestPluginWorld>): void => {
  world.registerComponent(POSITION_COMPONENT);
  world.registerComponent(VELOCITY_COMPONENT);
  world.registerComponent(PLAYER_COMPONENT);
  world.registerComponent(FACING_COMPONENT);
  world.registerComponent(TEAM_COMPONENT);
  world.registerComponent(PROJECTILE_COMPONENT);
  world.registerComponent(BREAKABLE_COMPONENT);
  world.registerComponent(COLLISION_BODY_COMPONENT);
  world.registerComponent(INTERACTABLE_COMPONENT);
  world.registerComponent(LOOT_SOURCE_COMPONENT);
  world.registerComponent(PICKUP_COMPONENT);
  world.registerComponent(PICKUP_PROMPT_COMPONENT);
};

const spawnPlayer = (
  world: ReturnType<typeof createTestPluginWorld>,
  playerId: string,
  x: number,
  y: number,
): void => {
  const entity = world.createEntity();
  world.getComponent<Position>(POSITION_COMPONENT).set(entity, { x, y });
  world.getComponent(VELOCITY_COMPONENT).set(entity, { vx: 0, vy: 0 });
  world.getComponent<Player>(PLAYER_COMPONENT).set(entity, {
    playerId,
    health: CONFIG.damage.playerHealth,
    alive: 1,
    team: 'solo',
    modelId: 'model:hero',
  });
  world.getComponent(FACING_COMPONENT).set(entity, { dir: 0 });
  world.getComponent(TEAM_COMPONENT).set(entity, { team: 'solo' });
};

const shootInput = (tick: number, aimDeg: number): RuntimePlayerInput => ({
  tick,
  seq: tick,
  dir: 0,
  shoot: true,
  reload: false,
  interact: false,
  drop: false,
  abilities: [],
  aimDeg,
});

const idleInput = (tick: number): RuntimePlayerInput => ({
  tick,
  seq: tick,
  shoot: false,
  reload: false,
  interact: false,
  drop: false,
  abilities: [],
});

const decodeWelcomeFrame = (bytes: Uint8Array): BattleRoyaleProtocol.WelcomeSnapshot => {
  const frame = BattleRoyaleProtocol.decodeServerMessage(bytes);
  if (frame instanceof BattleRoyaleProtocol.WelcomeSnapshot) {
    return frame;
  }
  throw new Error(`expected WelcomeSnapshot, received ${frame._tag}`);
};

const decodeDeltaFrame = (bytes: Uint8Array): BattleRoyaleProtocol.DeltaSnapshot => {
  const frame = BattleRoyaleProtocol.decodeServerMessage(bytes);
  if (frame instanceof BattleRoyaleProtocol.DeltaSnapshot) {
    return frame;
  }
  throw new Error(`expected DeltaSnapshot, received ${frame._tag}`);
};

export interface AcceptedBattleRoyaleFireFlow {
  readonly events: readonly GameplayWeaponFired[];
  readonly welcomeFrame: BattleRoyaleProtocol.WelcomeSnapshot;
  readonly acceptedDeltaFrame: BattleRoyaleProtocol.DeltaSnapshot;
  readonly replayDeltaFrame: BattleRoyaleProtocol.DeltaSnapshot;
  readonly welcomeBytes: Uint8Array;
  readonly acceptedDeltaBytes: Uint8Array;
  readonly replayDeltaBytes: Uint8Array;
}

export const acceptedBattleRoyaleFireFlow = (): AcceptedBattleRoyaleFireFlow => {
  const world = createTestPluginWorld();
  registerStores(world);
  spawnPlayer(world, 'player-1', 0, 0);
  spawnPlayer(world, 'player-2', 10, 10);

  const emitter = createBattleRoyaleSnapshotEmitter(1);
  const welcomeBytes = emitter.emitWelcome(world, 1);
  const events: GameplayWeaponFired[] = [];
  const acceptedFireTicks = new Map<string, number>();
  const inputFor = (playerId: string): RuntimePlayerInput | undefined =>
    playerId === 'player-1'
      ? shootInput(8, 0)
      : playerId === 'player-2'
        ? shootInput(8, 90)
        : undefined;

  runCombatSystem(
    world,
    {
      worldView: createBattleRoyaleCombatWorldView(
        world,
        {
          maxHealth: CONFIG.damage.playerHealth,
          footprintOffsetY: CONFIG.movement.footprintOffsetY,
        },
        buildCombatBlockers(undefined),
      ),
      policy: createBattleRoyaleHitPolicy(CONFIG.roomRules),
      weapon: WEAPON_ENTRY.weapon,
      delivery: WEAPON_ENTRY.delivery as ProjectileDelivery,
      rng: createSeededRng(1),
      damageState: createDamageSystemState(),
      getPlayerInput: inputFor,
      mapBounds: openMapBounds(),
      weaponSlotCount: CONFIG.projectile.weaponSlotCount,
      initialAmmoReserve: CONFIG.projectile.initialAmmoReserve,
      projectileBoundsRadius: CONFIG.projectile.radius,
      tick: 8,
      onWeaponFired: (event) => {
        events.push(event);
        acceptedFireTicks.set(event.sourceId, event.tick);
      },
    },
    createCombatSystemState(),
  );
  updatePlayerAnimationStates(world, inputFor, (playerId) => acceptedFireTicks.get(playerId));
  const acceptedDeltaBytes = emitter.emitDelta(world, 8);
  updatePlayerAnimationStates(
    world,
    () => idleInput(9),
    () => undefined,
  );
  const replayDeltaBytes = emitter.emitDelta(world, 9);

  return {
    events,
    welcomeBytes,
    acceptedDeltaBytes,
    replayDeltaBytes,
    welcomeFrame: decodeWelcomeFrame(welcomeBytes),
    acceptedDeltaFrame: decodeDeltaFrame(acceptedDeltaBytes),
    replayDeltaFrame: decodeDeltaFrame(replayDeltaBytes),
  };
};

export const acceptedBattleRoyaleFireEvents = (): readonly GameplayWeaponFired[] =>
  acceptedBattleRoyaleFireFlow().events;

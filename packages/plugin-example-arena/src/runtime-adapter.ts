import {
  advanceWeaponTick,
  createSeededRng,
  entitySource,
  fireWeapon,
  fullHealth,
  initialWeaponState,
  makeCombatEntityId,
  resolveDelivery,
  vec2,
  type CombatEntityId,
  type CombatWorldView,
  type HealthComponent,
  type HitResolutionPolicy,
  type SeededRng,
  type Vec2,
  type WeaponState,
} from '@tileborne/simulation';
import { Option } from 'effect';

import { ARENA_PLUGIN_ID } from './constants.js';
import type { ArenaRuntimeHost, ArenaRuntimePlugin } from './types/runtime-plugin.js';
import { ArenaEntitySnapshot, ArenaSnapshot, encodeArenaServerMessage } from './wire-codec.js';
import { resolveArenaWeaponEntry } from './weapon-catalog.js';

const PLAYER_ID = 'player-1';
const DUMMY_ID = 'dummy-1';
const PLAYER_ENTITY = makeCombatEntityId(1);
const DUMMY_ENTITY = makeCombatEntityId(2);
const PLAYER_MAX_HEALTH = 100;
const DUMMY_MAX_HEALTH = 100;
const MOVE_SPEED = 40;
const HOST_TICK_RATE = 20;
const HOST_TICK_MS = 1000 / HOST_TICK_RATE;
const SNAPSHOT_INTERVAL_TICKS = 2;
const IDLE_HEARTBEAT_TICKS = 10;
const ATTACK_VISUAL_TICKS = 4;
const HIT_FLASH_TICKS = 4;

interface ArenaActorState {
  readonly id: string;
  readonly kind: 'player' | 'dummy';
  readonly entity: CombatEntityId;
  x: number;
  y: number;
  headingDeg: number;
  health: HealthComponent;
  lastAttackTick?: number;
  attackUntilTick: number;
  lastHitTick?: number;
  hitFlashUntilTick: number;
}

const seedNumber = (seed: string | number | undefined): number =>
  typeof seed === 'number'
    ? seed
    : [...String(seed ?? 'arena')]
        .map((char) => char.charCodeAt(0))
        .reduce((hash, code) => (hash * 31 + code) >>> 0, 0);

const directionVector = (
  dir: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7,
): { readonly x: number; readonly y: number } => {
  const diagonal = Math.SQRT1_2;
  switch (dir) {
    case 0:
      return { x: 1, y: 0 };
    case 1:
      return { x: diagonal, y: diagonal };
    case 2:
      return { x: 0, y: 1 };
    case 3:
      return { x: -diagonal, y: diagonal };
    case 4:
      return { x: -1, y: 0 };
    case 5:
      return { x: -diagonal, y: -diagonal };
    case 6:
      return { x: 0, y: -1 };
    case 7:
      return { x: diagonal, y: -diagonal };
  }
};

const directionToHeadingDeg = (dir: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7): number => dir * 45;

const arenaHitPolicy: HitResolutionPolicy = {
  isHostile: ({ source, target }) => Option.isNone(source) || source.value !== target,
};

const aimVector = (headingDeg: number): Vec2 => {
  const radians = (headingDeg * Math.PI) / 180;
  return vec2(Math.cos(radians), Math.sin(radians));
};

/**
 * Tiny stand-and-shoot arena runtime: one player, one stationary dummy,
 * paced snapshots, and melee damage resolved by `@tileborne/simulation`.
 */
export const createRuntimeAdapter = (host: ArenaRuntimeHost): ArenaRuntimePlugin => {
  const { weapon, delivery } = resolveArenaWeaponEntry();
  let weaponState: WeaponState = initialWeaponState(weapon);
  const rng: SeededRng = createSeededRng(seedNumber(host.seed));
  const player: ArenaActorState = {
    id: PLAYER_ID,
    kind: 'player',
    entity: PLAYER_ENTITY,
    x: 0,
    y: 0,
    headingDeg: 0,
    health: fullHealth(PLAYER_MAX_HEALTH),
    attackUntilTick: -1,
    hitFlashUntilTick: -1,
  };
  const dummy: ArenaActorState = {
    id: DUMMY_ID,
    kind: 'dummy',
    entity: DUMMY_ENTITY,
    x: 20,
    y: 0,
    headingDeg: 180,
    health: fullHealth(DUMMY_MAX_HEALTH),
    attackUntilTick: -1,
    hitFlashUntilTick: -1,
  };
  let lastSnapshotTick = Number.NEGATIVE_INFINITY;
  let lastSnapshotSignature = '';
  let dirtySinceSnapshot = true;
  let lastSnapshotHadTransientVisual = false;

  const actorForEntity = (entity: CombatEntityId): ArenaActorState | undefined => {
    if (entity === PLAYER_ENTITY) return player;
    if (entity === DUMMY_ENTITY) return dummy;
    return undefined;
  };

  const world: CombatWorldView = {
    entities: () => [PLAYER_ENTITY, DUMMY_ENTITY],
    getHealth: (entity) => Option.fromUndefinedOr(actorForEntity(entity)?.health),
    setHealth: (entity, health) => {
      const actor = actorForEntity(entity);
      if (actor !== undefined) {
        actor.health = health;
      }
    },
    getTeam: () => Option.none(),
    getPosition: (entity) => {
      const actor = actorForEntity(entity);
      return actor === undefined ? Option.none() : Option.some(vec2(actor.x, actor.y));
    },
    blockers: () => [],
  };

  const isAttacking = (actor: ArenaActorState, tick: number): boolean =>
    actor.attackUntilTick >= tick;

  const isHitFlashing = (actor: ArenaActorState, tick: number): boolean =>
    actor.hitFlashUntilTick >= tick;

  const hasTransientVisual = (tick: number): boolean =>
    [player, dummy].some((actor) => isAttacking(actor, tick) || isHitFlashing(actor, tick));

  const snapshotSignature = (tick: number): string =>
    [player, dummy]
      .map((actor) =>
        [
          actor.id,
          actor.x.toFixed(3),
          actor.y.toFixed(3),
          actor.headingDeg.toFixed(3),
          actor.health.current,
          isAttacking(actor, tick) ? (actor.lastAttackTick ?? '') : '',
          isHitFlashing(actor, tick) ? (actor.lastHitTick ?? '') : '',
        ].join(':'),
      )
      .join('|');

  const buildSnapshot = (tick: number): ArenaSnapshot =>
    new ArenaSnapshot({
      tick,
      serverTimestampMs: tick * HOST_TICK_MS,
      entities: [player, dummy].map((actor) => {
        const attacking = isAttacking(actor, tick);
        const hitFlashing = isHitFlashing(actor, tick);
        return new ArenaEntitySnapshot({
          id: actor.id,
          kind: actor.kind,
          x: actor.x,
          y: actor.y,
          health: actor.health.current,
          maxHealth: actor.health.max,
          headingDeg: actor.headingDeg,
          ...(attacking && actor.lastAttackTick !== undefined
            ? { attacking: true, attackTick: actor.lastAttackTick }
            : {}),
          ...(hitFlashing && actor.lastHitTick !== undefined ? { hitTick: actor.lastHitTick } : {}),
        });
      }),
    });

  const emitSnapshot = (tick: number): void => {
    const bytes = encodeArenaServerMessage(buildSnapshot(tick));
    host.msgOut?.push(bytes);
    host.setReplayFrames?.([bytes]);
    lastSnapshotTick = tick;
    lastSnapshotSignature = snapshotSignature(tick);
    dirtySinceSnapshot = false;
    lastSnapshotHadTransientVisual = hasTransientVisual(tick);
  };

  const maybeEmitSnapshot = (tick: number, options: { readonly force?: boolean } = {}): void => {
    if (lastSnapshotHadTransientVisual && !hasTransientVisual(tick)) {
      dirtySinceSnapshot = true;
    }
    const ticksSinceLastSnapshot = tick - lastSnapshotTick;
    if (options.force !== true) {
      if (dirtySinceSnapshot) {
        if (ticksSinceLastSnapshot < SNAPSHOT_INTERVAL_TICKS) {
          return;
        }
      } else if (ticksSinceLastSnapshot < IDLE_HEARTBEAT_TICKS) {
        return;
      }
      const signature = snapshotSignature(tick);
      if (signature === lastSnapshotSignature && ticksSinceLastSnapshot < IDLE_HEARTBEAT_TICKS) {
        dirtySinceSnapshot = false;
        return;
      }
    }
    emitSnapshot(tick);
  };

  return {
    id: ARENA_PLUGIN_ID,
    onInit() {
      emitSnapshot(0);
    },
    onTick(_world, dt, tick) {
      // Engine-owned firing cadence: decay cooldown/reload timers each tick.
      weaponState = advanceWeaponTick(weapon, weaponState).state;
      // No inventory system in this sandbox; refill once cooldown clears.
      if (weaponState.ammoInMagazine <= 0 && weaponState.cooldownRemaining <= 0) {
        weaponState = initialWeaponState(weapon);
      }

      const input = host.getPlayerInput?.(PLAYER_ID);
      if (input !== undefined) {
        if (input.dir !== undefined) {
          const move = directionVector(input.dir);
          player.x += move.x * MOVE_SPEED * dt;
          player.y += move.y * MOVE_SPEED * dt;
          player.headingDeg = directionToHeadingDeg(input.dir);
          dirtySinceSnapshot = true;
        }
        if (input.aimDeg !== undefined && player.headingDeg !== input.aimDeg) {
          player.headingDeg = input.aimDeg;
          dirtySinceSnapshot = true;
        }
        if (input.shoot) {
          const fired = fireWeapon(weapon, weaponState);
          weaponState = fired.state;
          if (fired.outcome._tag === 'WeaponFired') {
            const dummyHealthBefore = dummy.health.current;
            player.lastAttackTick = tick;
            player.attackUntilTick = tick + ATTACK_VISUAL_TICKS;
            resolveDelivery(delivery, {
              world,
              source: entitySource(PLAYER_ENTITY),
              origin: vec2(player.x, player.y),
              aim: aimVector(player.headingDeg),
              policy: arenaHitPolicy,
              rng,
            });
            if (dummy.health.current < dummyHealthBefore) {
              dummy.lastHitTick = tick;
              dummy.hitFlashUntilTick = tick + HIT_FLASH_TICKS;
            }
            dirtySinceSnapshot = true;
            maybeEmitSnapshot(tick, { force: true });
            return;
          }
        }
      }

      maybeEmitSnapshot(tick);
    },
  };
};

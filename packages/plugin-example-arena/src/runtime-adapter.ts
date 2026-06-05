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
} from "@tileborne/simulation";
import { Option } from "effect";

import { ARENA_PLUGIN_ID } from "./constants.js";
import type { ArenaRuntimeHost, ArenaRuntimePlugin } from "./types/runtime-plugin.js";
import {
  ArenaEntitySnapshot,
  ArenaSnapshot,
  encodeArenaServerMessage,
} from "./wire-codec.js";
import { resolveArenaWeaponEntry } from "./weapon-catalog.js";

const PLAYER_ID = "player-1";
const DUMMY_ID = "dummy-1";
const PLAYER_ENTITY = makeCombatEntityId(1);
const DUMMY_ENTITY = makeCombatEntityId(2);
const PLAYER_MAX_HEALTH = 100;
const DUMMY_MAX_HEALTH = 100;
const MOVE_SPEED = 40;

interface ArenaActorState {
  readonly id: string;
  readonly kind: "player" | "dummy";
  readonly entity: CombatEntityId;
  x: number;
  y: number;
  headingDeg: number;
  health: HealthComponent;
}

const seedNumber = (seed: string | number | undefined): number =>
  typeof seed === "number"
    ? seed
    : [...String(seed ?? "arena")]
        .map((char) => char.charCodeAt(0))
        .reduce((hash, code) => (hash * 31 + code) >>> 0, 0);

const directionVector = (dir: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7): { readonly x: number; readonly y: number } => {
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
 * Tiny stand-and-shoot arena runtime: one player, one stationary dummy, full
 * snapshots every tick, and melee damage resolved by `@tileborne/simulation`.
 */
export const createRuntimeAdapter = (host: ArenaRuntimeHost): ArenaRuntimePlugin => {
  const { weapon, delivery } = resolveArenaWeaponEntry();
  let weaponState: WeaponState = initialWeaponState(weapon);
  const rng: SeededRng = createSeededRng(seedNumber(host.seed));
  const player: ArenaActorState = {
    id: PLAYER_ID,
    kind: "player",
    entity: PLAYER_ENTITY,
    x: 0,
    y: 0,
    headingDeg: 0,
    health: fullHealth(PLAYER_MAX_HEALTH),
  };
  const dummy: ArenaActorState = {
    id: DUMMY_ID,
    kind: "dummy",
    entity: DUMMY_ENTITY,
    x: 20,
    y: 0,
    headingDeg: 180,
    health: fullHealth(DUMMY_MAX_HEALTH),
  };

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

  const buildSnapshot = (tick: number): ArenaSnapshot =>
    new ArenaSnapshot({
      tick,
      serverTimestampMs: tick,
      entities: [player, dummy].map(
        (actor) =>
          new ArenaEntitySnapshot({
            id: actor.id,
            kind: actor.kind,
            x: actor.x,
            y: actor.y,
            health: actor.health.current,
            maxHealth: actor.health.max,
            headingDeg: actor.headingDeg,
          }),
      ),
    });

  const emitSnapshot = (tick: number): void => {
    const bytes = encodeArenaServerMessage(buildSnapshot(tick));
    host.msgOut?.push(bytes);
    host.setReplayFrames?.([bytes]);
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
        }
        if (input.aimDeg !== undefined) {
          player.headingDeg = input.aimDeg;
        }
        if (input.shoot) {
          const fired = fireWeapon(weapon, weaponState);
          weaponState = fired.state;
          if (fired.outcome._tag === "WeaponFired") {
            resolveDelivery(delivery, {
              world,
              source: entitySource(PLAYER_ENTITY),
              origin: vec2(player.x, player.y),
              aim: aimVector(player.headingDeg),
              policy: arenaHitPolicy,
              rng,
            });
          }
        }
      }

      emitSnapshot(tick);
    },
  };
};

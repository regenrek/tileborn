import { Option } from 'effect';
import {
  CombatBlocker,
  HealthComponent,
  Vec2,
  makeCombatEntityId,
  makeTeamId,
  type CombatEntityId,
  type CombatWorldView,
  type HitResolutionPolicy,
} from '@tileborne/simulation';

import type { ComponentStore, PluginWorld } from '../types/runtime-plugin.js';
import type { PluginCollisionEnvironment } from './collision.js';
import { PLAYER_COMPONENT, POSITION_COMPONENT, type Player, type Position } from './components.js';
import type { RoomRulesConfig } from './damage-system.js';

export interface CombatWorldViewConfig {
  /** Vitality ceiling used when projecting a BR player's `health` into the neutral pool. */
  readonly maxHealth: number;
  /** Vertical offset from a player's origin to its collision-circle center. */
  readonly footprintOffsetY: number;
}

/**
 * Adapt BR's ECS world to the neutral {@link CombatWorldView} port (ADR-0018):
 * combat reads/writes BR's `Player`/`Position` columns through this seam while
 * staying ignorant of the concrete ECS. Only *alive* players are enumerated as
 * combat entities — dead players are no longer targetable (matching BR's
 * `alive === 1` gate in `findHitPlayer`/zone damage). `setHealth` folds the
 * neutral pool back into BR's `health` + `alive` fields, the single mutation the
 * neutral damage core performs.
 */
export const createBattleRoyaleCombatWorldView = (
  world: PluginWorld,
  config: CombatWorldViewConfig,
  blockers: readonly CombatBlocker[],
): CombatWorldView => {
  const playerStore = (): ComponentStore<Player> => world.getComponent<Player>(PLAYER_COMPONENT);
  const positionStore = (): ComponentStore<Position> =>
    world.getComponent<Position>(POSITION_COMPONENT);

  return {
    entities: function* (): Generator<CombatEntityId> {
      for (const [entity, player] of playerStore().entries()) {
        if (player.alive === 1) {
          yield makeCombatEntityId(entity);
        }
      }
    },
    getHealth: (entity) => {
      const player = playerStore().get(entity);
      if (!player) {
        return Option.none();
      }
      const max = Math.max(player.health, config.maxHealth);
      return Option.some(new HealthComponent({ current: player.health, max }));
    },
    setHealth: (entity, health) => {
      const store = playerStore();
      const player = store.get(entity);
      if (!player) {
        return;
      }
      store.set(entity, {
        ...player,
        health: health.current,
        alive: health.current > 0 ? 1 : 0,
      });
    },
    getTeam: (entity) => {
      const player = playerStore().get(entity);
      return player ? Option.some(makeTeamId(player.team)) : Option.none();
    },
    getPosition: (entity) => {
      const position = positionStore().get(entity);
      return position
        ? Option.some(new Vec2({ x: position.x, y: position.y + config.footprintOffsetY }))
        : Option.none();
    },
    blockers: () => blockers,
  };
};

/**
 * A read-through view that hides one entity from target enumeration so a weapon
 * never strikes its own wielder (the neutral successor to BR's
 * `player.playerId === projectile.ownerId` owner-exclusion). Health/position
 * reads + writes still delegate to the underlying world.
 */
export const excludingEntity = (
  view: CombatWorldView,
  excluded: CombatEntityId,
): CombatWorldView => ({
  ...view,
  entities: function* (): Generator<CombatEntityId> {
    for (const entity of view.entities()) {
      if (entity !== excluded) {
        yield entity;
      }
    }
  },
});

/**
 * Project BR's collision geometry into neutral {@link CombatBlocker}s for the
 * engine's line-of-sight / projectile-blocking sweep. Every BR blocking rect
 * stops both physical shots and vision (BR has a single opaque-wall notion).
 */
export const buildCombatBlockers = (
  environment: PluginCollisionEnvironment | undefined,
): readonly CombatBlocker[] => {
  if (!environment) {
    return [];
  }
  return environment.blockingRects.map(
    (rect) =>
      new CombatBlocker({
        minX: rect.x,
        minY: rect.y,
        maxX: rect.x + rect.width,
        maxY: rect.y + rect.height,
        blocksProjectiles: true,
        blocksVision: true,
      }),
  );
};

/**
 * Map BR's room rules onto a neutral {@link HitResolutionPolicy} (ADR-0018: the
 * mode injects hostility, the engine holds no closed `solo`/`duo`/`squad` enum).
 * Mirrors BR's `isFriendlyFireBlocked`: solo or friendly-fire-on ⇒ every hit is
 * hostile; environmental damage (no source team, e.g. the zone) is always
 * hostile; otherwise same-team hits are blocked.
 */
export const createBattleRoyaleHitPolicy = (roomRules: RoomRulesConfig): HitResolutionPolicy => ({
  isHostile: ({ sourceTeam, targetTeam }) => {
    if (roomRules.matchMode === 'solo' || roomRules.friendlyFire) {
      return true;
    }
    if (Option.isNone(sourceTeam) || Option.isNone(targetTeam)) {
      return true;
    }
    return sourceTeam.value !== targetTeam.value;
  },
});

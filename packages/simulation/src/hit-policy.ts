import { Option } from 'effect';

import type { CombatEntityId, TeamId } from './ids.js';

/**
 * The neutral inputs a {@link HitResolutionPolicy} reasons over when deciding
 * whether a hit may damage a target. Source may be `None` for environmental /
 * non-entity damage (e.g. a hazard); team is open and may be absent.
 */
export interface HitContext {
  readonly source: Option.Option<CombatEntityId>;
  readonly sourceTeam: Option.Option<TeamId>;
  readonly target: CombatEntityId;
  readonly targetTeam: Option.Option<TeamId>;
}

/**
 * Mode-injected rules object: the neutralized successor to BR's
 * `RoomRulesConfig`. The engine never bakes in friendly-fire or a closed
 * `solo`/`duo`/`squad` mode — the owning mode decides hostility here.
 */
export interface HitResolutionPolicy {
  /** Whether the source is permitted to deal damage to the target. */
  readonly isHostile: (context: HitContext) => boolean;
}

/**
 * Free-for-all: every hit is hostile. The neutral default used by tests and
 * single-team scenarios; carries no team semantics.
 */
export const alwaysHostile: HitResolutionPolicy = {
  isHostile: () => true,
};

/**
 * Team-based hostility: a hit is hostile unless source and target share the
 * same present team. Self-damage and missing-team hits are treated as hostile.
 * Teams are open {@link TeamId} values — there is no closed mode enum here.
 */
export const hostileWhenTeamsDiffer: HitResolutionPolicy = {
  isHostile: ({ sourceTeam, targetTeam }) => {
    if (Option.isNone(sourceTeam) || Option.isNone(targetTeam)) {
      return true;
    }
    return sourceTeam.value !== targetTeam.value;
  },
};

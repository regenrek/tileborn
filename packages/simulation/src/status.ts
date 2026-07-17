import { Schema } from 'effect';

import { CombatEntityId, StatusEffectId } from './ids.js';

/**
 * Neutral *application hook* result (ADR-0018): combat can emit that a status
 * effect was applied to a target on hit, carrying only branded ids. This is the
 * P0 surface only — the full DoT / shield / slow / reveal / silence runtime
 * (stacking, duration ticking, expiry) is deferred to P1
 * (`t-p1-status-abilities-plan`) extending this ADR. The orchestrator emits this
 * when a connecting fire intent declares status effects; it holds no effect
 * state itself.
 */
export class StatusApplied extends Schema.TaggedClass<StatusApplied>()('StatusApplied', {
  target: CombatEntityId,
  effect: StatusEffectId,
  source: Schema.optional(CombatEntityId),
}) {}
